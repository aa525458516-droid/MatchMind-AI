import { HistoryRecord, Match, MatchStatistics, Prediction } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { evaluateEloModel } from '../utils/eloRating';
import { evaluatePhase4Match } from '../phase4/phase4Pipeline';
import { extractVariantBProjection } from '../phase4/variantBExtractor';
import { extractPhase5CausalPriors } from '../phase5/phase5CausalPriors';
import { computeNormalizedBivariateNegBin } from '../phase5/phase5O25Model';
import { evaluatePhase5Match } from '../phase5/phase5Pipeline';
import {
  calibrate1XTwoApproachA_Existing,
  calibrate1XTwoApproachB_Temperature,
  calibrate1XTwoApproachC_Beta,
  computeClassTailBreakdown,
  computeSixBinReliability,
  normalizeSimplex,
  summarizeThresholdRegion,
} from './phase5_1Calibration';
import { calibrate1XTwoApproachD_TailShrinkage } from './phase5_1TailCalibration';
import { auditDrawFeatureUsefulness, extractPhase5_1DrawSignals } from './phase5_1DrawSignals';
import {
  evaluateDrawThresholds,
  evaluatePhase5_1DrawVariants,
  FIXED_DRAW_THRESHOLD,
  Phase5_1DrawHistoryRecord,
} from './phase5_1DrawModel';
import { assessPhase5_1Decisions } from './phase5_1Abstain';
import {
  DrawPhase5_1EvalSummary,
  MODEL_VERSION_PHASE5_1,
  OneXTwoPhase5_1EvalSummary,
  Phase5_1BenchmarkReport,
  Phase5_1CalibSample1X2,
  Phase5_1DrawSignalFeatures,
  Phase5_1Prediction,
  Phase5_1Status,
} from './phase5_1Types';

export interface Phase5_1EvaluationContext {
  oneXTwoSamples?: Phase5_1CalibSample1X2[];
  drawHistory?: Phase5_1DrawHistoryRecord[];
  /** Threshold tuning priors (< T) */
  drawThresholdPriors?: Array<{ timestampMs: number; prob01: number; isDraw: boolean }>;
  /** Live fallback when called directly on a single fixture from UI */
  phase3History?: HistoryRecord[];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function toThreeWayPct(h01: number, d01: number, a01: number): {
  homeWin: number;
  draw: number;
  awayWin: number;
} {
  const [nH, nD, nA] = normalizeSimplex(h01, d01, a01);
  const pH = round1(nH * 100);
  const pD = round1(nD * 100);
  const pA = round1(Math.max(0, 100 - pH - pD));
  return { homeWin: pH, draw: pD, awayWin: pA };
}

function wilsonCi95(hits: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.959964;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [
    Math.round(Math.max(0, center - half) * 1000) / 10,
    Math.round(Math.min(1, center + half) * 1000) / 10,
  ];
}

function buildContextFromPhase3History(
  history: HistoryRecord[],
  targetUtc: string
): Required<Omit<Phase5_1EvaluationContext, 'phase3History'>> {
  const targetMs = new Date(targetUtc).getTime();
  const valid = Number.isFinite(targetMs)
    ? history.filter((r) => {
        const ms = new Date(r.match.utcDate).getTime();
        return (
          Number.isFinite(ms) &&
          ms < targetMs &&
          r.prediction.modelType !== 'ABSTAIN' &&
          r.prediction.probabilities !== null
        );
      })
    : [];

  const oneXTwoSamples: Phase5_1CalibSample1X2[] = [];
  const drawHistory: Phase5_1DrawHistoryRecord[] = [];
  const drawThresholdPriors: Array<{ timestampMs: number; prob01: number; isDraw: boolean }> = [];

  for (const r of valid) {
    const ms = new Date(r.match.utcDate).getTime();
    const raw = r.prediction.rawProbabilities || r.prediction.probabilities!;
    const pD01 = Math.max(0.01, Math.min(0.99, raw.draw / 100));
    oneXTwoSamples.push({
      timestampMs: ms,
      pH: raw.homeWin / 100,
      pD: raw.draw / 100,
      pA: raw.awayWin / 100,
      winner: r.actualResult.winner,
    });
    const dummyFeat: Phase5_1DrawSignalFeatures = {
      valid: false,
      lambdaHome: r.prediction.expectedScore?.home ?? null,
      lambdaAway: r.prediction.expectedScore?.away ?? null,
      absStrengthDiff: null,
      expectedGoalDiff: null,
      absExpectedGoalDiff: null,
      totalExpectedGoals: null,
      poissonDrawProb01: pD01,
      historicalLeagueDrawRate01: 0.26,
      teamStrengthUncertainty: 0.25,
      venueNormalizedStrengthDiff: null,
      shrunkAttackDefenseSymmetry: null,
      lowScoringIndex: null,
      eloAbsDiffCausal: null,
      eloSymmetry: null,
      homeDrawRateCausal: 0.26,
      awayDrawRateCausal: 0.26,
    };
    drawHistory.push({
      timestampMs: ms,
      features: dummyFeat,
      probA01: pD01,
      probB01: pD01,
      probC01: null,
      probEnsemble01: null,
      phase5HistoryEntry: {
        timestampMs: ms,
        rawDixonColesDraw01: pD01,
        shrunkDraw01: pD01,
        parityScore: 0.65,
        lowScoringIndex: 0.72,
        leagueDrawPrior01: 0.26,
        isDraw: r.actualResult.winner === 'DRAW',
      },
      isDraw: r.actualResult.winner === 'DRAW',
    });
    drawThresholdPriors.push({
      timestampMs: ms,
      prob01: pD01,
      isDraw: r.actualResult.winner === 'DRAW',
    });
  }

  return { oneXTwoSamples, drawHistory, drawThresholdPriors };
}

/**
 * Evaluate a single match through the strictly causal Phase 5.1 research pipeline.
 * Leaves Phase 3, Phase 4, and Phase 5 completely untouched.
 */
export function evaluatePhase5_1Match(
  match: Match,
  stats: MatchStatistics,
  options: {
    phase3Prediction: Prediction;
    competitionMatches: Match[];
    context?: Phase5_1EvaluationContext;
  }
): Phase5_1Prediction {
  const { phase3Prediction, competitionMatches, context } = options;
  const calculatedAt = new Date().toISOString();

  const priors = extractPhase5CausalPriors(match, competitionMatches);

  const resolvedCtx = context?.oneXTwoSamples
    ? {
        oneXTwoSamples: context.oneXTwoSamples,
        drawHistory: context.drawHistory ?? [],
        drawThresholdPriors: context.drawThresholdPriors ?? [],
      }
    : buildContextFromPhase3History(context?.phase3History ?? [], match.utcDate);

  const targetMs = new Date(match.utcDate).getTime();
  const causalThresholdPriors = Number.isFinite(targetMs)
    ? resolvedCtx.drawThresholdPriors
        .filter((d) => Number.isFinite(d.timestampMs) && d.timestampMs < targetMs)
        .map((d) => ({ prob01: d.prob01, isDraw: d.isDraw }))
    : [];

  const isGlobalAbstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    phase3Prediction.probabilities === null ||
    !stats.hasSufficientData ||
    stats.homeExpectedGoals === null ||
    stats.awayExpectedGoals === null;

  if (isGlobalAbstain) {
    const emptyDrawSignals = extractPhase5_1DrawSignals({
      stats,
      priors,
      shrunkLambdaHome: null,
      shrunkLambdaAway: null,
    });
    const emptyDraw = evaluatePhase5_1DrawVariants({
      match,
      stats,
      dixonColesMixDrawProbPct: null,
      lambdaHome: null,
      lambdaAway: null,
      priors,
      features: emptyDrawSignals,
      drawHistory: [],
      drawUncertainty: null,
    });
    const thresholds = evaluateDrawThresholds({
      p1x2Home01: null,
      p1x2Draw01: null,
      p1x2Away01: null,
      selectedDrawProb01: null,
      priorRowsForThreshold: [],
    });
    const dec = assessPhase5_1Decisions({
      phase3Prediction,
      stats,
      hasCausalElo: priors.homeEloCausal !== null && priors.awayEloCausal !== null,
      oneXTwoFinalPct: null,
      oneXTwoUncertainty: null,
      drawVariantOutput: emptyDraw.variants[emptyDraw.selectedVariant],
      drawUncertainty: null,
    });

    const emptyVariant1X2 = {
      homeWin: null,
      draw: null,
      awayWin: null,
      status: 'NOT_TRAINED' as const,
      sampleCount: 0,
      appliedDetail: 'Global Phase 3 ABSTAIN preserved.',
    };

    return {
      matchId: match.id,
      modelVersion: MODEL_VERSION_PHASE5_1,
      calculatedAt,
      isExperimental: true,
      abstainScope: 'MATCH_ABSTAIN',
      abstainReason: dec.abstainReason,
      phase3Prediction,
      causalPriors: priors,
      expectedGoals: { shrunkHome: null, shrunkAway: null },
      oneXTwoRaw: { homeWin: null, draw: null, awayWin: null },
      oneXTwoVariants: {
        A_EXISTING_PHASE5: emptyVariant1X2,
        B_TEMPERATURE: emptyVariant1X2,
        C_BETA: emptyVariant1X2,
        D_TAIL_SHRINKAGE: emptyVariant1X2,
      },
      oneXTwoSelected: {
        approach: 'D_TAIL_SHRINKAGE',
        homeWin: null,
        draw: null,
        awayWin: null,
        status: 'NOT_TRAINED',
        sampleCount: 0,
        tailShrinkage: null,
      },
      drawSignals: emptyDrawSignals,
      drawVariants: emptyDraw.variants,
      drawSelected: {
        variant: emptyDraw.selectedVariant,
        probPct: null,
        status: 'ABSTAIN',
        calibrationStatus: 'NOT_TRAINED',
        samplesUsed: 0,
        thresholds,
      },
      marketDecisions: {
        '1X2': dec.oneXTwoDecision,
        DRAW: dec.drawDecision,
      },
      limitationsNote:
        'Phase 5.1 preserves Frozen Phase 3 global ABSTAIN when pre-match sample < 5 or data integrity deficit occurs.',
    };
  }

  // Shrunk lambdas using Variant B extractor (pre-match + causal < T priors)
  const p3H = stats.homeExpectedGoals!;
  const p3A = stats.awayExpectedGoals!;
  const vbProj = extractVariantBProjection(match, stats, competitionMatches);
  const shrunkH = vbProj.lambdas?.homeExpectedGoals ?? p3H;
  const shrunkA = vbProj.lambdas?.awayExpectedGoals ?? p3A;

  // Underlying 1X2 probability mix matching Phase 5 raw generator
  const nbShrunk = computeNormalizedBivariateNegBin(
    shrunkH,
    shrunkA,
    priors.causalDispersionHome,
    priors.causalDispersionAway
  );
  const poissonBase = calculatePoissonProbabilities(shrunkH, shrunkA, 7, true).markets;
  const hasCausalElo = priors.homeEloCausal !== null && priors.awayEloCausal !== null;
  const eloEval = hasCausalElo
    ? evaluateEloModel(priors.homeEloCausal!, priors.awayEloCausal!)
    : null;

  // Epistemic posterior variance over shrunk lambdas
  const hPlayed = stats.homeTeamStats.overall.matchesPlayed;
  const aPlayed = stats.awayTeamStats.overall.matchesPlayed;
  const relStdH = 1 / Math.sqrt(Math.max(8, hPlayed + 12));
  const relStdA = 1 / Math.sqrt(Math.max(8, aPlayed + 12));
  const drawGrid: number[] = [];
  const winDiffGrid: number[] = [];
  for (const sH of [-1, 0, 1]) {
    for (const sA of [-1, 0, 1]) {
      const lH = Math.max(0.25, Math.min(4.2, shrunkH * (1 + sH * relStdH)));
      const lA = Math.max(0.25, Math.min(4.2, shrunkA * (1 + sA * relStdA)));
      const nb = computeNormalizedBivariateNegBin(
        lH,
        lA,
        priors.causalDispersionHome,
        priors.causalDispersionAway
      );
      drawGrid.push(nb.draw01);
      winDiffGrid.push(Math.max(nb.homeWin01, nb.awayWin01));
    }
  }
  const drawMeanG = drawGrid.reduce((a, b) => a + b, 0) / drawGrid.length;
  const drawUncertainty = round3(
    Math.sqrt(drawGrid.reduce((a, x) => a + (x - drawMeanG) ** 2, 0) / drawGrid.length)
  );
  const diffMeanG = winDiffGrid.reduce((a, b) => a + b, 0) / winDiffGrid.length;
  const oneXTwoUncertainty = round3(
    Math.sqrt(winDiffGrid.reduce((a, x) => a + (x - diffMeanG) ** 2, 0) / winDiffGrid.length)
  );

  const rawHomeMix = eloEval
    ? 0.55 * nbShrunk.homeWin01 + 0.25 * (poissonBase.homeWin / 100) + 0.2 * (eloEval.homeWinProb / 100)
    : 0.68 * nbShrunk.homeWin01 + 0.32 * (poissonBase.homeWin / 100);
  const rawDrawMix = eloEval
    ? 0.55 * nbShrunk.draw01 + 0.25 * (poissonBase.draw / 100) + 0.2 * (eloEval.drawProb / 100)
    : 0.68 * nbShrunk.draw01 + 0.32 * (poissonBase.draw / 100);
  const rawAwayMix = eloEval
    ? 0.55 * nbShrunk.awayWin01 + 0.25 * (poissonBase.awayWin / 100) + 0.2 * (eloEval.awayWinProb / 100)
    : 0.68 * nbShrunk.awayWin01 + 0.32 * (poissonBase.awayWin / 100);

  // Extract causal draw signals & evaluate Variants A / B / C / D strictly < T
  const drawSignals = extractPhase5_1DrawSignals({
    stats,
    priors,
    shrunkLambdaHome: shrunkH,
    shrunkLambdaAway: shrunkA,
  });

  const drawEval = evaluatePhase5_1DrawVariants({
    match,
    stats,
    dixonColesMixDrawProbPct: rawDrawMix * 100,
    lambdaHome: shrunkH,
    lambdaAway: shrunkA,
    priors,
    features: drawSignals,
    drawHistory: resolvedCtx.drawHistory,
    drawUncertainty,
  });

  // Raw 1X2 anchored to Phase 5's uncalibrated simplex so A/B/C/D calibration comparison is purely controlled
  const rawDrawBase = drawEval.variants.A_PHASE5.rawProb01 ?? rawDrawMix;
  const clampedDraw = Math.max(0.08, Math.min(0.45, rawDrawBase));
  const remMass = Math.max(0.01, rawHomeMix + rawAwayMix);
  const rawH01 = ((1 - clampedDraw) * rawHomeMix) / remMass;
  const rawA01 = ((1 - clampedDraw) * rawAwayMix) / remMass;
  const oneXTwoRawPct = toThreeWayPct(rawH01, clampedDraw, rawA01);

  // Run 1X2 Calibration Approaches A, B, C, D strictly < T
  const calA = calibrate1XTwoApproachA_Existing(rawH01, clampedDraw, rawA01, match.utcDate, resolvedCtx.oneXTwoSamples);
  const calB = calibrate1XTwoApproachB_Temperature(rawH01, clampedDraw, rawA01, match.utcDate, resolvedCtx.oneXTwoSamples);
  const calC = calibrate1XTwoApproachC_Beta(rawH01, clampedDraw, rawA01, match.utcDate, resolvedCtx.oneXTwoSamples);
  const calD = calibrate1XTwoApproachD_TailShrinkage(rawH01, clampedDraw, rawA01, match.utcDate, resolvedCtx.oneXTwoSamples);

  const toVariantCard = (res: typeof calA) => {
    const pct = toThreeWayPct(res.homeWin01, res.draw01, res.awayWin01);
    return {
      homeWin: pct.homeWin,
      draw: pct.draw,
      awayWin: pct.awayWin,
      status: res.status,
      sampleCount: res.sampleCount,
      appliedDetail: res.reason,
    };
  };

  // Approach D is primary Phase 5.1 calibrated 1X2 output (reversibly drops to base/raw if NOT_TRAINED)
  const selected1X2Pct = toThreeWayPct(calD.homeWin01, calD.draw01, calD.awayWin01);

  const selectedDrawOut = drawEval.variants[drawEval.selectedVariant];
  const drawThresholds = evaluateDrawThresholds({
    p1x2Home01: calD.homeWin01,
    p1x2Draw01: calD.draw01,
    p1x2Away01: calD.awayWin01,
    selectedDrawProb01: selectedDrawOut.finalProb01,
    priorRowsForThreshold: causalThresholdPriors,
  });

  const dec = assessPhase5_1Decisions({
    phase3Prediction,
    stats,
    hasCausalElo,
    oneXTwoFinalPct: selected1X2Pct,
    oneXTwoUncertainty,
    drawVariantOutput: selectedDrawOut,
    drawUncertainty,
  });

  return {
    matchId: match.id,
    modelVersion: MODEL_VERSION_PHASE5_1,
    calculatedAt,
    isExperimental: true,
    abstainScope: dec.abstainScope,
    abstainReason: dec.abstainReason,
    phase3Prediction,
    causalPriors: priors,
    expectedGoals: {
      shrunkHome: Math.round(shrunkH * 100) / 100,
      shrunkAway: Math.round(shrunkA * 100) / 100,
    },
    oneXTwoRaw: oneXTwoRawPct,
    oneXTwoVariants: {
      A_EXISTING_PHASE5: toVariantCard(calA),
      B_TEMPERATURE: toVariantCard(calB),
      C_BETA: toVariantCard(calC),
      D_TAIL_SHRINKAGE: toVariantCard(calD),
    },
    oneXTwoSelected: {
      approach: 'D_TAIL_SHRINKAGE',
      homeWin: selected1X2Pct.homeWin,
      draw: selected1X2Pct.draw,
      awayWin: selected1X2Pct.awayWin,
      status: calD.status,
      sampleCount: calD.sampleCount,
      tailShrinkage: calD.tailShrinkage,
    },
    drawSignals,
    drawVariants: drawEval.variants,
    drawSelected: {
      variant: drawEval.selectedVariant,
      probPct:
        selectedDrawOut.finalProb01 !== null
          ? round1(selectedDrawOut.finalProb01 * 100)
          : null,
      status: selectedDrawOut.status,
      calibrationStatus: selectedDrawOut.calibrationStatus,
      samplesUsed: selectedDrawOut.samplesUsed,
      thresholds: drawThresholds,
    },
    marketDecisions: {
      '1X2': dec.oneXTwoDecision,
      DRAW: dec.drawDecision,
    },
    limitationsNote:
      'Experimental Phase 5.1 research model investigating causal tail calibration and draw discrimination. Returns NOT_TRAINED below causal sample thresholds. Probabilities only — never guaranteed outcomes.',
  };
}

// ---------------------------------------------------------------------------
// Benchmark Metric Aggregators
// ---------------------------------------------------------------------------

interface RawOneXTwoEvalItem {
  pH01: number | null;
  pD01: number | null;
  pA01: number | null;
  winner: 'HOME' | 'DRAW' | 'AWAY';
  status: Phase5_1Status;
}

function summarizeOneXTwo51(items: RawOneXTwoEvalItem[]): OneXTwoPhase5_1EvalSummary {
  const predicted = items.filter(
    (i) => i.status === 'PREDICT' && i.pH01 !== null && i.pD01 !== null && i.pA01 !== null
  );
  const abstainedCount = items.filter((i) => i.status === 'ABSTAIN').length;
  const notTrainedCount = items.filter((i) => i.status === 'NOT_TRAINED').length;
  const n = predicted.length;
  const coveragePct = items.length > 0 ? round1((n / items.length) * 100) : 0;

  if (n === 0) {
    return {
      sampleSize: 0,
      abstainedCount,
      notTrainedCount,
      coveragePct,
      accuracyPct: null,
      accuracyCi95: null,
      brier: null,
      logLoss: null,
      ecePct: null,
      tailEcePct: null,
      ge70AggregateErrorPct: null,
      sixBinReliability: computeSixBinReliability([]),
      tailRegions: {
        bin70_80: summarizeThresholdRegion([], '70-80%', 70, 79.999),
        bin80_90: summarizeThresholdRegion([], '80-90%', 80, 89.999),
        bin90_100: summarizeThresholdRegion([], '90-100%', 90, 100),
        ge70: summarizeThresholdRegion([], '>=70%', 70),
        ge80: summarizeThresholdRegion([], '>=80%', 80),
        ge85: summarizeThresholdRegion([], '>=85%', 85),
      },
      classWiseTail: {
        HOME: computeClassTailBreakdown([], 'HOME'),
        DRAW: computeClassTailBreakdown([], 'DRAW'),
        AWAY: computeClassTailBreakdown([], 'AWAY'),
        OVERALL_TOP: computeClassTailBreakdown([], 'OVERALL_TOP'),
      },
      predictedRates: { homePct: null, drawPct: null, awayPct: null },
      actualRates: { homePct: null, drawPct: null, awayPct: null },
    };
  }

  let hits = 0;
  let sumBrier = 0;
  let sumLoss = 0;
  let sumPH = 0;
  let sumPD = 0;
  let sumPA = 0;
  let actH = 0;
  let actD = 0;
  let actA = 0;

  const allOutcomeEntries: Array<{ prob01: number; hit: boolean }> = [];
  const topConfEntries: Array<{ prob01: number; hit: boolean }> = [];
  const homeEntries: Array<{ prob01: number; hit: boolean }> = [];
  const drawEntries: Array<{ prob01: number; hit: boolean }> = [];
  const awayEntries: Array<{ prob01: number; hit: boolean }> = [];

  for (const item of predicted) {
    const [pH, pD, pA] = normalizeSimplex(item.pH01!, item.pD01!, item.pA01!);
    sumPH += pH;
    sumPD += pD;
    sumPA += pA;

    const yH = item.winner === 'HOME';
    const yD = item.winner === 'DRAW';
    const yA = item.winner === 'AWAY';
    if (yH) actH++;
    else if (yD) actD++;
    else actA++;

    const predClass = pH >= pD && pH >= pA ? 'HOME' : pA >= pD && pA >= pH ? 'AWAY' : 'DRAW';
    const isHit = predClass === item.winner;
    if (isHit) hits++;

    sumBrier += (pH - (yH ? 1 : 0)) ** 2 + (pD - (yD ? 1 : 0)) ** 2 + (pA - (yA ? 1 : 0)) ** 2;
    const hitP = yH ? pH : yD ? pD : pA;
    sumLoss += -Math.log(Math.max(1e-6, hitP));

    allOutcomeEntries.push({ prob01: pH, hit: yH });
    allOutcomeEntries.push({ prob01: pD, hit: yD });
    allOutcomeEntries.push({ prob01: pA, hit: yA });

    topConfEntries.push({ prob01: Math.max(pH, pD, pA), hit: isHit });
    homeEntries.push({ prob01: pH, hit: yH });
    drawEntries.push({ prob01: pD, hit: yD });
    awayEntries.push({ prob01: pA, hit: yA });
  }

  // Standard 6-bin ECE across 3*n outcome probabilities
  const sixBinReliability = computeSixBinReliability(allOutcomeEntries);
  const totalEntries = allOutcomeEntries.length;
  let eceSum = 0;
  for (const b of sixBinReliability) {
    if (b.count > 0 && b.calibrationErrorPct !== null) {
      eceSum += (b.count / totalEntries) * b.calibrationErrorPct;
    }
  }

  // Tail reliability evaluated strictly on High-Confidence Predictions (top-class confidence >= 70%)
  const topSix = computeSixBinReliability(topConfEntries);
  const bin70_80 = topSix[3];
  const bin80_90 = topSix[4];
  const bin90_100 = topSix[5];
  const tailTotal = bin70_80.count + bin80_90.count + bin90_100.count;
  let tailEcePct: number | null = null;
  if (tailTotal > 0) {
    let wErr = 0;
    for (const tb of [bin70_80, bin80_90, bin90_100]) {
      if (tb.count > 0 && tb.calibrationErrorPct !== null) {
        wErr += (tb.count / tailTotal) * tb.calibrationErrorPct;
      }
    }
    tailEcePct = round1(wErr);
  }

  const ge70 = summarizeThresholdRegion(topConfEntries, '>=70%', 70);
  const ge80 = summarizeThresholdRegion(topConfEntries, '>=80%', 80);
  const ge85 = summarizeThresholdRegion(topConfEntries, '>=85%', 85);

  return {
    sampleSize: n,
    abstainedCount,
    notTrainedCount,
    coveragePct,
    accuracyPct: round1((hits / n) * 100),
    accuracyCi95: wilsonCi95(hits, n),
    brier: round3(sumBrier / n),
    logLoss: round3(sumLoss / n),
    ecePct: round1(eceSum),
    tailEcePct,
    ge70AggregateErrorPct: ge70.calibrationErrorPct,
    sixBinReliability,
    tailRegions: {
      bin70_80,
      bin80_90,
      bin90_100,
      ge70,
      ge80,
      ge85,
    },
    classWiseTail: {
      HOME: computeClassTailBreakdown(homeEntries, 'HOME'),
      DRAW: computeClassTailBreakdown(drawEntries, 'DRAW'),
      AWAY: computeClassTailBreakdown(awayEntries, 'AWAY'),
      OVERALL_TOP: computeClassTailBreakdown(topConfEntries, 'OVERALL_TOP'),
    },
    predictedRates: {
      homePct: round1((sumPH / n) * 100),
      drawPct: round1((sumPD / n) * 100),
      awayPct: round1((sumPA / n) * 100),
    },
    actualRates: {
      homePct: round1((actH / n) * 100),
      drawPct: round1((actD / n) * 100),
      awayPct: round1((actA / n) * 100),
    },
  };
}

interface RawDrawEvalItem {
  prob01: number | null;
  triggered: boolean;
  actual: boolean;
  status: Phase5_1Status;
  thresholdUsed01: number | null;
  trainingSamples: number;
}

function summarizeDraw51(items: RawDrawEvalItem[], thresholdDesc: string): DrawPhase5_1EvalSummary {
  const predicted = items.filter((i) => i.status === 'PREDICT' && i.prob01 !== null);
  const abstainedCount = items.filter((i) => i.status === 'ABSTAIN').length;
  const notTrainedCount = items.filter((i) => i.status === 'NOT_TRAINED').length;
  const n = predicted.length;
  const coveragePct = items.length > 0 ? round1((n / items.length) * 100) : 0;

  if (n === 0) {
    return {
      sampleSize: 0,
      abstainedCount,
      notTrainedCount,
      coveragePct,
      thresholdUsedDesc: thresholdDesc,
      meanThresholdPct: null,
      meanTrainingSampleSize: null,
      positiveCallRatePct: null,
      actualDrawRatePct: null,
      predictedMeanProbPct: null,
      precisionPct: null,
      recallPct: null,
      f1Pct: null,
      accuracyPct: null,
      brier: null,
      logLoss: null,
      ecePct: null,
      calibrationCurve: [],
    };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let hits = 0;
  let posCalls = 0;
  let actDraws = 0;
  let sumProb = 0;
  let sumBrier = 0;
  let sumLoss = 0;
  let sumThresh = 0;
  let threshCount = 0;
  let sumTrainN = 0;

  const binDefs = [
    { binLabel: '0-20%', minPct: 0, maxPct: 20 },
    { binLabel: '20-25%', minPct: 20, maxPct: 25 },
    { binLabel: '25-30%', minPct: 25, maxPct: 30 },
    { binLabel: '30-40%', minPct: 30, maxPct: 40 },
    { binLabel: '40-100%', minPct: 40, maxPct: 100.001 },
  ];
  const bins = binDefs.map((b) => ({ ...b, count: 0, sumP: 0, sumY: 0 }));

  for (const item of predicted) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, item.prob01!));
    const y = item.actual ? 1 : 0;
    if (item.triggered) posCalls++;
    if (item.triggered && item.actual) tp++;
    else if (item.triggered && !item.actual) fp++;
    else if (!item.triggered && item.actual) fn++;
    if (item.triggered === item.actual) hits++;
    actDraws += y;
    sumProb += p;
    sumBrier += (p - y) * (p - y);
    sumLoss += item.actual ? -Math.log(p) : -Math.log(1 - p);

    if (item.thresholdUsed01 !== null) {
      sumThresh += item.thresholdUsed01;
      threshCount++;
    }
    sumTrainN += item.trainingSamples;

    const pct = p * 100;
    for (const b of bins) {
      if (pct >= b.minPct && pct < b.maxPct) {
        b.count++;
        b.sumP += p;
        b.sumY += y;
        break;
      }
    }
  }

  let ece = 0;
  const calibrationCurve = bins.map((b) => {
    if (b.count === 0) {
      return {
        binLabel: b.binLabel,
        minPct: b.minPct,
        maxPct: Math.min(100, b.maxPct),
        count: 0,
        meanPredictedPct: null,
        observedFrequencyPct: null,
        calibrationErrorPct: null,
        signedBiasPct: null,
      };
    }
    const meanP = (b.sumP / b.count) * 100;
    const obs = (b.sumY / b.count) * 100;
    const err = Math.abs(meanP - obs);
    ece += (b.count / n) * (err / 100);
    return {
      binLabel: b.binLabel,
      minPct: b.minPct,
      maxPct: Math.min(100, b.maxPct),
      count: b.count,
      meanPredictedPct: round1(meanP),
      observedFrequencyPct: round1(obs),
      calibrationErrorPct: round1(err),
      signedBiasPct: round1(meanP - obs),
    };
  });

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    sampleSize: n,
    abstainedCount,
    notTrainedCount,
    coveragePct,
    thresholdUsedDesc: thresholdDesc,
    meanThresholdPct: threshCount > 0 ? round1((sumThresh / threshCount) * 100) : null,
    meanTrainingSampleSize: n > 0 ? Math.round(sumTrainN / n) : null,
    positiveCallRatePct: round1((posCalls / n) * 100),
    actualDrawRatePct: round1((actDraws / n) * 100),
    predictedMeanProbPct: round1((sumProb / n) * 100),
    precisionPct: precision !== null ? round1(precision * 100) : null,
    recallPct: recall !== null ? round1(recall * 100) : null,
    f1Pct: f1 !== null ? round1(f1 * 100) : null,
    accuracyPct: round1((hits / n) * 100),
    brier: round3(sumBrier / n),
    logLoss: round3(sumLoss / n),
    ecePct: round1(ece * 100),
    calibrationCurve,
  };
}

/**
 * Paired Causal Walk-Forward Benchmark across:
 * Phase 3 Frozen vs Phase 4 Exp vs Phase 5 Exp vs Phase 5.1 (Calibration A-D & Draw Variants A-D).
 * Processes identical kickoff timestamps as simultaneous batches (0 leakage).
 */
export async function runChronologicalPhase5_1Benchmark(params: {
  datasetId: string;
  datasetName: string;
  matches: Match[];
  isBlindHoldout?: boolean;
  getMatchStats: (match: Match) => Promise<MatchStatistics>;
  calculatePhase3: (match: Match, stats: MatchStatistics, priorHistory: HistoryRecord[]) => Promise<Prediction>;
}): Promise<Phase5_1BenchmarkReport> {
  const { datasetId, datasetName, matches, isBlindHoldout = false, getMatchStats, calculatePhase3 } = params;

  const chrono = [...matches]
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const p3History: HistoryRecord[] = [];
  const p4History: HistoryRecord[] = [];

  // Phase 5 buffers
  const p5OneXTwoHistory: Phase5_1CalibSample1X2[] = [];
  const p5DrawHistory: Array<{
    timestampMs: number;
    rawDixonColesDraw01: number;
    shrunkDraw01: number;
    parityScore: number;
    lowScoringIndex: number;
    leagueDrawPrior01: number;
    isDraw: boolean;
  }> = [];

  // Phase 5.1 strictly causal buffers
  const p51OneXTwoHistory: Phase5_1CalibSample1X2[] = [];
  const p51DrawHistory: Phase5_1DrawHistoryRecord[] = [];
  const p51ThresholdPriors: Array<{ timestampMs: number; prob01: number; isDraw: boolean }> = [];
  const featureAuditRows: Array<{ features: Phase5_1DrawSignalFeatures; isDraw: boolean; leaguePrior01: number }> = [];

  // 8 Explicit Leakage Counters
  let futureDataViolations = 0;
  let targetMatchViolations = 0;
  let sameTimestampViolations = 0;
  let targetXgViolations = 0;
  let targetEventsViolations = 0;
  let seasonEndRatingViolations = 0;
  let futureCalibrationViolations = 0;
  let futureThresholdViolations = 0;

  // Collection buffers
  const b_homeBias: RawOneXTwoEvalItem[] = [];
  const b_emp1x2: RawOneXTwoEvalItem[] = [];
  const b_p3_1x2: RawOneXTwoEvalItem[] = [];
  const b_p4_1x2: RawOneXTwoEvalItem[] = [];
  const b_p5_1x2: RawOneXTwoEvalItem[] = [];
  const b_p51_A: RawOneXTwoEvalItem[] = [];
  const b_p51_B: RawOneXTwoEvalItem[] = [];
  const b_p51_C: RawOneXTwoEvalItem[] = [];
  const b_p51_D: RawOneXTwoEvalItem[] = [];
  const b_p51_flt: RawOneXTwoEvalItem[] = [];

  const d_emp: RawDrawEvalItem[] = [];
  const d_p3Argmax: RawDrawEvalItem[] = [];
  const d_p3Sig: RawDrawEvalItem[] = [];
  const d_p4: RawDrawEvalItem[] = [];
  const d_p5Argmax: RawDrawEvalItem[] = [];
  const d_p5Sig: RawDrawEvalItem[] = [];
  const d_varA: RawDrawEvalItem[] = [];
  const d_varB: RawDrawEvalItem[] = [];
  const d_varC: RawDrawEvalItem[] = [];
  const d_varD: RawDrawEvalItem[] = [];
  const d_thArgmax: RawDrawEvalItem[] = [];
  const d_thFixed: RawDrawEvalItem[] = [];
  const d_thCausal: RawDrawEvalItem[] = [];

  let priorCount = 0;
  let priorH = 0;
  let priorD = 0;
  let priorA = 0;

  let idx = 0;
  while (idx < chrono.length) {
    const batchTs = new Date(chrono[idx].utcDate).getTime();
    let endIdx = idx + 1;
    while (endIdx < chrono.length && new Date(chrono[endIdx].utcDate).getTime() === batchTs) {
      endIdx++;
    }
    const batch = chrono.slice(idx, endIdx);
    const batchPostUpdates: Array<() => void> = [];

    for (const m of batch) {
      const mMs = new Date(m.utcDate).getTime();
      const hg = m.score.home!;
      const ag = m.score.away!;
      const actWinner: 'HOME' | 'DRAW' | 'AWAY' = hg > ag ? 'HOME' : ag > hg ? 'AWAY' : 'DRAW';
      const actDraw = actWinner === 'DRAW';

      // Verify all causal priors strictly < mMs (0 future, target, same-timestamp, calibration, or threshold leakage)
      for (const s of p51OneXTwoHistory) {
        if (s.timestampMs > mMs) {
          futureDataViolations++;
          futureCalibrationViolations++;
        } else if (s.timestampMs === mMs) {
          sameTimestampViolations++;
        }
      }
      for (const t of p51ThresholdPriors) {
        if (t.timestampMs > mMs) futureThresholdViolations++;
        else if (t.timestampMs === mMs) sameTimestampViolations++;
      }
      for (const h of p3History) {
        if (h.match.id === m.id) targetMatchViolations++;
        const hMs = new Date(h.match.utcDate).getTime();
        if (hMs > mMs) futureDataViolations++;
        else if (hMs === mMs) sameTimestampViolations++;
      }

      const stats = await getMatchStats(m);
      if (stats.observedMatchXG != null) {
        targetXgViolations++;
      }
      if (
        stats.homeTeamStats.confirmedLineupAvailable === true ||
        stats.homeTeamStats.formMatches.some((f) => new Date(f.date).getTime() >= mMs) ||
        stats.awayTeamStats.formMatches.some((f) => new Date(f.date).getTime() >= mMs)
      ) {
        targetEventsViolations++;
      }

      const p3 = await calculatePhase3(m, stats, p3History);
      const p4 = evaluatePhase4Match(m, stats, {
        phase3Prediction: p3,
        phase4History: p4History,
        competitionMatches: chrono,
      });
      const p5 = evaluatePhase5Match(m, stats, {
        phase3Prediction: p3,
        competitionMatches: chrono,
        historyContext: {
          oneXTwoSamples: p5OneXTwoHistory,
          drawSamples: p5DrawHistory,
          o25Samples: [],
          bttsSamples: [],
        },
      });
      const p51 = evaluatePhase5_1Match(m, stats, {
        phase3Prediction: p3,
        competitionMatches: chrono,
        context: {
          oneXTwoSamples: p51OneXTwoHistory,
          drawHistory: p51DrawHistory,
          drawThresholdPriors: p51ThresholdPriors,
        },
      });

      // Verify Elo causal prior never used post-match/season-end team.eloRating directly when < 5 team prior games
      if (
        p51.causalPriors.homeTeamPriors.played < 5 &&
        p51.causalPriors.homeEloCausal !== null
      ) {
        seasonEndRatingViolations++;
      }

      const p3Abstain = p3.modelType === 'ABSTAIN' || p3.probabilities === null;
      const p4Abstain = p4.abstainScope === 'MATCH_ABSTAIN' || p4.ensemble.probabilities === null;

      // 1X2 recording
      b_p3_1x2.push({
        pH01: p3Abstain ? null : p3.probabilities!.homeWin / 100,
        pD01: p3Abstain ? null : p3.probabilities!.draw / 100,
        pA01: p3Abstain ? null : p3.probabilities!.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      b_p4_1x2.push({
        pH01: p4Abstain ? null : p4.ensemble.probabilities!.homeWin / 100,
        pD01: p4Abstain ? null : p4.ensemble.probabilities!.draw / 100,
        pA01: p4Abstain ? null : p4.ensemble.probabilities!.awayWin / 100,
        winner: actWinner,
        status: p4Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      b_p5_1x2.push({
        pH01: p3Abstain ? null : p5.oneXTwo.homeWin! / 100,
        pD01: p3Abstain ? null : p5.oneXTwo.draw! / 100,
        pA01: p3Abstain ? null : p5.oneXTwo.awayWin! / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });

      const vA = p51.oneXTwoVariants.A_EXISTING_PHASE5;
      const vB = p51.oneXTwoVariants.B_TEMPERATURE;
      const vC = p51.oneXTwoVariants.C_BETA;
      const vD = p51.oneXTwoVariants.D_TAIL_SHRINKAGE;

      b_p51_A.push({
        pH01: p3Abstain || vA.homeWin === null ? null : vA.homeWin / 100,
        pD01: p3Abstain || vA.draw === null ? null : vA.draw / 100,
        pA01: p3Abstain || vA.awayWin === null ? null : vA.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      b_p51_B.push({
        pH01: p3Abstain || vB.homeWin === null ? null : vB.homeWin / 100,
        pD01: p3Abstain || vB.draw === null ? null : vB.draw / 100,
        pA01: p3Abstain || vB.awayWin === null ? null : vB.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      b_p51_C.push({
        pH01: p3Abstain || vC.homeWin === null ? null : vC.homeWin / 100,
        pD01: p3Abstain || vC.draw === null ? null : vC.draw / 100,
        pA01: p3Abstain || vC.awayWin === null ? null : vC.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      b_p51_D.push({
        pH01: p3Abstain || vD.homeWin === null ? null : vD.homeWin / 100,
        pD01: p3Abstain || vD.draw === null ? null : vD.draw / 100,
        pA01: p3Abstain || vD.awayWin === null ? null : vD.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });

      const dec1x2 = p51.marketDecisions['1X2'];
      b_p51_flt.push({
        pH01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.homeWin / 100 : null,
        pD01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.draw / 100 : null,
        pA01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.awayWin / 100 : null,
        winner: actWinner,
        status: dec1x2.status,
      });

      // Paired baselines on Phase 3 evaluated cohort
      if (!p3Abstain) {
        b_homeBias.push({ pH01: 0.96, pD01: 0.02, pA01: 0.02, winner: actWinner, status: 'PREDICT' });
        const den1 = priorCount + 3;
        b_emp1x2.push({
          pH01: (priorH + 1) / den1,
          pD01: (priorD + 1) / den1,
          pA01: (priorA + 1) / den1,
          winner: actWinner,
          status: 'PREDICT',
        });

        const empDrawP = (priorD + 0.52) / (priorCount + 2);
        d_emp.push({
          prob01: empDrawP,
          triggered: empDrawP >= FIXED_DRAW_THRESHOLD,
          actual: actDraw,
          status: 'PREDICT',
          thresholdUsed01: FIXED_DRAW_THRESHOLD,
          trainingSamples: priorCount,
        });

        if (p51.drawSignals.valid) {
          featureAuditRows.push({
            features: p51.drawSignals,
            isDraw: actDraw,
            leaguePrior01: p51.drawSignals.historicalLeagueDrawRate01 ?? 0.26,
          });
        }
      } else {
        d_emp.push({
          prob01: null,
          triggered: false,
          actual: actDraw,
          status: 'ABSTAIN',
          thresholdUsed01: null,
          trainingSamples: 0,
        });
      }

      // Draw baselines & variants
      const p3DrawP = p3Abstain ? null : p3.probabilities!.draw / 100;
      const p3IsArgmaxDraw =
        !p3Abstain &&
        p3.probabilities!.draw > p3.probabilities!.homeWin &&
        p3.probabilities!.draw > p3.probabilities!.awayWin;
      d_p3Argmax.push({
        prob01: p3DrawP,
        triggered: p3IsArgmaxDraw,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: null,
        trainingSamples: 0,
      });
      d_p3Sig.push({
        prob01: p3DrawP,
        triggered: p3DrawP !== null && p3DrawP >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
        trainingSamples: 0,
      });

      const p4DrawP = p4Abstain ? null : p4.ensemble.probabilities!.draw / 100;
      d_p4.push({
        prob01: p4DrawP,
        triggered: p4DrawP !== null && p4DrawP >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p4Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
        trainingSamples: 0,
      });

      const p5DrawP = p3Abstain ? null : (p5.drawResearch.finalDrawProbPct ?? 26) / 100;
      const p5IsArgmaxDraw =
        !p3Abstain &&
        p5.oneXTwo.draw! > p5.oneXTwo.homeWin! &&
        p5.oneXTwo.draw! > p5.oneXTwo.awayWin!;
      d_p5Argmax.push({
        prob01: p5DrawP,
        triggered: p5IsArgmaxDraw,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: null,
        trainingSamples: 0,
      });
      d_p5Sig.push({
        prob01: p5DrawP,
        triggered: p5DrawP !== null && p5DrawP >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
        trainingSamples: 0,
      });

      const dvA = p51.drawVariants.A_PHASE5;
      const dvB = p51.drawVariants.B_POISSON_PRIOR;
      const dvC = p51.drawVariants.C_STRENGTH_SYMMETRY;
      const dvD = p51.drawVariants.D_CAUSAL_ENSEMBLE;

      const pushVar = (buf: RawDrawEvalItem[], dv: typeof dvA) => {
        buf.push({
          prob01: p3Abstain ? null : dv.finalProb01,
          triggered: !p3Abstain && dv.status === 'PREDICT' && dv.finalProb01 !== null && dv.finalProb01 >= FIXED_DRAW_THRESHOLD,
          actual: actDraw,
          status: p3Abstain ? 'ABSTAIN' : dv.status,
          thresholdUsed01: FIXED_DRAW_THRESHOLD,
          trainingSamples: dv.samplesUsed,
        });
      };
      pushVar(d_varA, dvA);
      pushVar(d_varB, dvB);
      pushVar(d_varC, dvC);
      pushVar(d_varD, dvD);

      // Draw Threshold Comparisons on Phase 5.1 selected draw output
      const selProb = p51.drawSelected.probPct !== null ? p51.drawSelected.probPct / 100 : null;
      const thA = p51.drawSelected.thresholds.ARGMAX;
      const thF = p51.drawSelected.thresholds.FIXED_THRESHOLD;
      const thC = p51.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD;

      d_thArgmax.push({
        prob01: p3Abstain ? null : selProb,
        triggered: !p3Abstain && thA.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thA.status,
        thresholdUsed01: null,
        trainingSamples: 0,
      });
      d_thFixed.push({
        prob01: p3Abstain ? null : selProb,
        triggered: !p3Abstain && thF.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thF.status,
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
        trainingSamples: 0,
      });
      d_thCausal.push({
        prob01: p3Abstain || thC.status !== 'PREDICT' ? null : selProb,
        triggered: !p3Abstain && thC.status === 'PREDICT' && thC.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thC.status,
        thresholdUsed01: thC.threshold01,
        trainingSamples: thC.trainingSamples,
      });

      // Queue post-kickoff causal updates ONLY after all simultaneous-kickoff predictions complete
      batchPostUpdates.push(() => {
        priorCount++;
        if (actWinner === 'HOME') priorH++;
        else if (actWinner === 'DRAW') priorD++;
        else priorA++;

        const rec: HistoryRecord = {
          id: `p51-${m.id}`,
          match: m,
          prediction: p3,
          actualResult: {
            finalScore: `${hg} - ${ag}`,
            homeGoals: hg,
            awayGoals: ag,
            winner: actWinner,
            over15: hg + ag > 1.5,
            over25: hg + ag > 2,
            btts: hg > 0 && ag > 0,
          },
          modelAccuracyNotes: '',
          brierScoreContribution: null,
        };
        p3History.push(rec);

        if (!p4Abstain && p4.ensemble.probabilities) {
          p4History.push({
            ...rec,
            prediction: {
              ...p3,
              probabilities: p4.ensemble.probabilities,
              rawProbabilities: p4.ensemble.rawProbabilities,
            },
          });
        }

        if (!p3Abstain) {
          p5OneXTwoHistory.push({
            timestampMs: mMs,
            pH: p5.oneXTwo.rawHomeWin! / 100,
            pD: p5.oneXTwo.rawDraw! / 100,
            pA: p5.oneXTwo.rawAwayWin! / 100,
            winner: actWinner,
          });
          p5DrawHistory.push({
            timestampMs: mMs,
            rawDixonColesDraw01: (p5.drawResearch.rawDixonColesDrawProbPct ?? 26) / 100,
            shrunkDraw01: (p5.drawResearch.shrunkDrawProbPct ?? 26) / 100,
            parityScore: p5.drawResearch.parityScore ?? 0.65,
            lowScoringIndex: p5.drawResearch.lowScoringIndex ?? 0.72,
            leagueDrawPrior01: (p5.drawResearch.empiricalLeagueDrawPriorPct ?? 26) / 100,
            isDraw: actDraw,
          });

          if (p51.oneXTwoRaw.homeWin !== null && p51.oneXTwoRaw.draw !== null && p51.oneXTwoRaw.awayWin !== null) {
            p51OneXTwoHistory.push({
              timestampMs: mMs,
              pH: p51.oneXTwoRaw.homeWin / 100,
              pD: p51.oneXTwoRaw.draw / 100,
              pA: p51.oneXTwoRaw.awayWin / 100,
              winner: actWinner,
            });
          }

          p51DrawHistory.push({
            timestampMs: mMs,
            features: p51.drawSignals,
            probA01: p51.drawVariants.A_PHASE5.finalProb01,
            probB01: p51.drawVariants.B_POISSON_PRIOR.finalProb01,
            probC01: p51.drawVariants.C_STRENGTH_SYMMETRY.finalProb01,
            probEnsemble01: p51.drawVariants.D_CAUSAL_ENSEMBLE.rawProb01,
            phase5HistoryEntry: {
              timestampMs: mMs,
              rawDixonColesDraw01: (p5.drawResearch.rawDixonColesDrawProbPct ?? 26) / 100,
              shrunkDraw01: (p5.drawResearch.shrunkDrawProbPct ?? 26) / 100,
              parityScore: p5.drawResearch.parityScore ?? 0.65,
              lowScoringIndex: p5.drawResearch.lowScoringIndex ?? 0.72,
              leagueDrawPrior01: (p5.drawResearch.empiricalLeagueDrawPriorPct ?? 26) / 100,
              isDraw: actDraw,
            },
            isDraw: actDraw,
          });

          if (p51.drawSelected.probPct !== null) {
            p51ThresholdPriors.push({
              timestampMs: mMs,
              prob01: p51.drawSelected.probPct / 100,
              isDraw: actDraw,
            });
          }
        }
      });
    }

    for (const upd of batchPostUpdates) upd();
    idx = endIdx;
  }

  const dates = chrono.map((m) => m.utcDate.split('T')[0]).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A';

  const summaryA = summarizeOneXTwo51(b_p51_A);
  const summaryD = summarizeOneXTwo51(b_p51_D);
  const tailNote = `Base P5 Tail ECE=${summaryA.tailEcePct ?? 'N/A'}% (HOME >=70%: n=${summaryA.classWiseTail.HOME.ge70Count}, pred=${summaryA.classWiseTail.HOME.ge70MeanPredPct ?? 'N/A'}% vs obs=${summaryA.classWiseTail.HOME.ge70ObservedPct ?? 'N/A'}%; AWAY >=70%: n=${summaryA.classWiseTail.AWAY.ge70Count}, pred=${summaryA.classWiseTail.AWAY.ge70MeanPredPct ?? 'N/A'}% vs obs=${summaryA.classWiseTail.AWAY.ge70ObservedPct ?? 'N/A'}%) -> Phase 5.1 Tail ECE=${summaryD.tailEcePct ?? 'N/A'}%.`;

  return {
    datasetId,
    datasetName,
    dateRange,
    totalFixtures: chrono.length,
    isBlindHoldout,
    leakageCheck: {
      verified:
        futureDataViolations === 0 &&
        targetMatchViolations === 0 &&
        sameTimestampViolations === 0 &&
        targetXgViolations === 0 &&
        targetEventsViolations === 0 &&
        seasonEndRatingViolations === 0 &&
        futureCalibrationViolations === 0 &&
        futureThresholdViolations === 0,
      futureDataViolations,
      targetMatchViolations,
      sameTimestampViolations,
      targetXgViolations,
      targetEventsViolations,
      seasonEndRatingViolations,
      futureCalibrationViolations,
      futureThresholdViolations,
    },
    oneXTwo: {
      baselines: {
        homeBias: summarizeOneXTwo51(b_homeBias),
        empiricalLeague: summarizeOneXTwo51(b_emp1x2),
        phase3Frozen: summarizeOneXTwo51(b_p3_1x2),
        phase4Experimental: summarizeOneXTwo51(b_p4_1x2),
        phase5Experimental: summarizeOneXTwo51(b_p5_1x2),
      },
      phase5_1Approaches: {
        A_existingCalibration: summaryA,
        B_temperatureScaling: summarizeOneXTwo51(b_p51_B),
        C_betaCalibration: summarizeOneXTwo51(b_p51_C),
        D_tailShrinkage: summaryD,
      },
      phase5_1Filtered: summarizeOneXTwo51(b_p51_flt),
      tailDiagnosticsNote: tailNote,
    },
    draw: {
      baselines: {
        empiricalDrawRate: summarizeDraw51(d_emp, 'fixed@0.285'),
        phase3Argmax: summarizeDraw51(d_p3Argmax, 'argmax'),
        phase3Signal: summarizeDraw51(d_p3Sig, 'fixed@0.285'),
        phase4Experimental: summarizeDraw51(d_p4, 'fixed@0.285'),
        phase5Argmax: summarizeDraw51(d_p5Argmax, 'argmax'),
        phase5Signal: summarizeDraw51(d_p5Sig, 'fixed@0.285'),
      },
      variants: {
        variantA_phase5: summarizeDraw51(d_varA, 'fixed@0.285'),
        variantB_poissonPrior: summarizeDraw51(d_varB, 'fixed@0.285'),
        variantC_strengthSymmetry: summarizeDraw51(d_varC, 'fixed@0.285'),
        variantD_causalEnsemble: summarizeDraw51(d_varD, 'fixed@0.285'),
      },
      thresholdComparison: {
        defaultArgmax: summarizeDraw51(d_thArgmax, 'argmax(1X2)'),
        fixedThreshold285: summarizeDraw51(d_thFixed, 'fixed@28.5%'),
        causalLearnedThreshold: summarizeDraw51(d_thCausal, 'causal_frozen(<T)'),
      },
      featureUsefulnessAudit: auditDrawFeatureUsefulness(featureAuditRows),
    },
  };
}
