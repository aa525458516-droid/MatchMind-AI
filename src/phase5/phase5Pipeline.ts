import { HistoryRecord, Match, MatchStatistics, Prediction } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { evaluateEloModel } from '../utils/eloRating';
import { evaluatePhase4Match, runChronologicalPhase4Comparison } from '../phase4/phase4Pipeline';
import { Phase4BenchmarkComparison, Phase4Prediction } from '../phase4/phase4Types';
import { extractVariantBProjection } from '../phase4/variantBExtractor';
import { extractPhase5CausalPriors } from './phase5CausalPriors';
import {
  BinaryCalibSample,
  calibratePhase5Binary,
  calibratePhase5OneXTwo,
  MultiClassCalibSample,
} from './phase5Calibration';
import {
  computeDrawStructuralFeatures,
  evaluatePhase5DrawModel,
  Phase5DrawHistoryEntry,
} from './phase5DrawModel';
import { computeNormalizedBivariateNegBin, evaluatePhase5O25Model } from './phase5O25Model';
import { evaluatePhase5BttsModel } from './phase5BttsModel';
import { assessPhase5MarketDecisions } from './phase5Abstain';
import {
  BinaryEvalSummary,
  GoalsRegressionSummary,
  MODEL_VERSION_PHASE5,
  OneXTwoEvalSummary,
  Phase5BenchmarkReport,
  Phase5Prediction,
} from './phase5Types';

export interface Phase5EvaluationHistoryContext {
  oneXTwoSamples?: MultiClassCalibSample[];
  drawSamples?: Phase5DrawHistoryEntry[];
  o25Samples?: BinaryCalibSample[];
  bttsSamples?: BinaryCalibSample[];
  /** Optional Phase 3 HistoryRecords when called live from MatchAnalysisPage */
  phase3History?: HistoryRecord[];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function normalizeThreeWayPct(h: number, d: number, a: number): {
  homeWin: number;
  draw: number;
  awayWin: number;
} {
  const sum = h + d + a;
  if (!(sum > 0)) return { homeWin: 33.4, draw: 33.3, awayWin: 33.3 };
  const pH = round1((h / sum) * 100);
  const pD = round1((d / sum) * 100);
  const pA = round1(100 - pH - pD);
  return { homeWin: pH, draw: pD, awayWin: Math.max(0, pA) };
}

/** Convert Phase 3 HistoryRecords into Phase 5 causal calibration samples if dedicated buffers aren't supplied. */
function buildContextFromPhase3History(
  history: HistoryRecord[],
  targetUtc: string
): Required<Omit<Phase5EvaluationHistoryContext, 'phase3History'>> {
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

  const oneXTwoSamples: MultiClassCalibSample[] = [];
  const drawSamples: Phase5DrawHistoryEntry[] = [];
  const o25Samples: BinaryCalibSample[] = [];
  const bttsSamples: BinaryCalibSample[] = [];

  for (const r of valid) {
    const ms = new Date(r.match.utcDate).getTime();
    const raw = r.prediction.rawProbabilities || r.prediction.probabilities!;
    oneXTwoSamples.push({
      timestampMs: ms,
      pH: raw.homeWin / 100,
      pD: raw.draw / 100,
      pA: raw.awayWin / 100,
      winner: r.actualResult.winner,
    });
    const lh = r.prediction.expectedScore?.home ?? 1.35;
    const la = r.prediction.expectedScore?.away ?? 1.15;
    const feat = computeDrawStructuralFeatures(lh, la, null, null, 10, 10);
    drawSamples.push({
      timestampMs: ms,
      rawDixonColesDraw01: raw.draw / 100,
      shrunkDraw01: raw.draw / 100,
      parityScore: feat.parityScore,
      lowScoringIndex: feat.lowScoringIndex,
      leagueDrawPrior01: 0.26,
      isDraw: r.actualResult.winner === 'DRAW',
    });
    o25Samples.push({
      timestampMs: ms,
      rawProb01: raw.over25 / 100,
      actual: r.actualResult.over25,
    });
    bttsSamples.push({
      timestampMs: ms,
      rawProb01: raw.bttsYes / 100,
      actual: r.actualResult.btts,
    });
  }

  return { oneXTwoSamples, drawSamples, o25Samples, bttsSamples };
}

/**
 * Evaluate a single match with Phase 5 experimental research pipeline.
 * Completely isolated from Phase 3 and Phase 4 production/experimental stores.
 */
export function evaluatePhase5Match(
  match: Match,
  stats: MatchStatistics,
  options: {
    phase3Prediction: Prediction;
    competitionMatches: Match[];
    historyContext?: Phase5EvaluationHistoryContext;
  }
): Phase5Prediction {
  const { phase3Prediction, competitionMatches, historyContext } = options;
  const calculatedAt = new Date().toISOString();

  const priors = extractPhase5CausalPriors(match, competitionMatches);

  const resolvedCtx = historyContext?.oneXTwoSamples
    ? {
        oneXTwoSamples: historyContext.oneXTwoSamples,
        drawSamples: historyContext.drawSamples ?? [],
        o25Samples: historyContext.o25Samples ?? [],
        bttsSamples: historyContext.bttsSamples ?? [],
      }
    : buildContextFromPhase3History(historyContext?.phase3History ?? [], match.utcDate);

  const isGlobalAbstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    phase3Prediction.probabilities === null ||
    !stats.hasSufficientData ||
    stats.homeExpectedGoals === null ||
    stats.awayExpectedGoals === null;

  if (isGlobalAbstain) {
    const emptyDraw = evaluatePhase5DrawModel({
      match,
      stats,
      dixonColesDrawProbPct: null,
      lambdaHome: null,
      lambdaAway: null,
      priors,
      drawHistory: [],
    });
    const emptyO25 = evaluatePhase5O25Model({
      match,
      stats,
      competitionMatches,
      priors,
      o25History: [],
    });
    const emptyBtts = evaluatePhase5BttsModel({
      match,
      stats,
      competitionMatches,
      priors,
      bttsHistory: [],
    });
    const abstainAssess = assessPhase5MarketDecisions({
      phase3Prediction,
      stats,
      hasCausalElo: priors.homeEloCausal !== null && priors.awayEloCausal !== null,
      oneXTwoRaw: null,
      oneXTwoFinal: null,
      oneXTwoCalibrationStatus: 'NOT_TRAINED',
      oneXTwoCalibrationMethod: 'RAW_IDENTITY',
      oneXTwoCalibrationSamples: 0,
      oneXTwoUncertainty: null,
      drawResearch: emptyDraw,
      o25Research: emptyO25,
      bttsResearch: emptyBtts,
    });

    return {
      matchId: match.id,
      modelVersion: MODEL_VERSION_PHASE5,
      calculatedAt,
      isExperimental: true,
      abstainScope: 'MATCH_ABSTAIN',
      abstainReason: phase3Prediction.abstainReason || abstainAssess.abstainReason,
      phase3Prediction,
      causalPriors: priors,
      expectedGoals: {
        phase3Home: stats.homeExpectedGoals,
        phase3Away: stats.awayExpectedGoals,
        shrunkHome: null,
        shrunkAway: null,
      },
      oneXTwo: {
        homeWin: null,
        draw: null,
        awayWin: null,
        rawHomeWin: null,
        rawDraw: null,
        rawAwayWin: null,
        calibrationStatus: 'NOT_TRAINED',
        calibrationMethod: 'RAW_IDENTITY',
        calibrationSampleCount: 0,
      },
      drawResearch: emptyDraw,
      o25Research: emptyO25,
      bttsResearch: emptyBtts,
      calibrationDiagnostics: {
        oneXTwo: [],
        draw: [],
        over25: [],
        btts: [],
      },
      marketDecisions: abstainAssess.decisions,
      limitationsNote:
        'Phase 5 preserves Phase 3 global ABSTAIN when verified pre-match sample < 5 or data integrity falls below threshold.',
    };
  }

  const p3H = stats.homeExpectedGoals!;
  const p3A = stats.awayExpectedGoals!;
  const vbProj = extractVariantBProjection(match, stats, competitionMatches);
  const shrunkH = vbProj.lambdas?.homeExpectedGoals ?? p3H;
  const shrunkA = vbProj.lambdas?.awayExpectedGoals ?? p3A;

  // Normalized Bivariate NegBin + Dixon-Coles on Phase 5 shrunk lambdas
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

  // Posterior epistemic uncertainty for 1X2 & Draw over 3x3 lambda grid (matches prior K=12)
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
  const drawUncertainty =
    Math.round(Math.sqrt(drawGrid.reduce((a, x) => a + (x - drawMeanG) ** 2, 0) / drawGrid.length) * 1000) /
    1000;
  const diffMeanG = winDiffGrid.reduce((a, b) => a + b, 0) / winDiffGrid.length;
  const oneXTwoUncertainty =
    Math.round(Math.sqrt(winDiffGrid.reduce((a, x) => a + (x - diffMeanG) ** 2, 0) / winDiffGrid.length) * 1000) /
    1000;

  // Combine 1X2 baseline: 55% NegBin-DC (shrunk), 25% Poisson-DC (shrunk), 20% Causal Elo (if available)
  const rawHomeMix = eloEval
    ? 0.55 * nbShrunk.homeWin01 + 0.25 * (poissonBase.homeWin / 100) + 0.2 * (eloEval.homeWinProb / 100)
    : 0.68 * nbShrunk.homeWin01 + 0.32 * (poissonBase.homeWin / 100);
  const rawDrawMix = eloEval
    ? 0.55 * nbShrunk.draw01 + 0.25 * (poissonBase.draw / 100) + 0.2 * (eloEval.drawProb / 100)
    : 0.68 * nbShrunk.draw01 + 0.32 * (poissonBase.draw / 100);
  const rawAwayMix = eloEval
    ? 0.55 * nbShrunk.awayWin01 + 0.25 * (poissonBase.awayWin / 100) + 0.2 * (eloEval.awayWinProb / 100)
    : 0.68 * nbShrunk.awayWin01 + 0.32 * (poissonBase.awayWin / 100);

  // Phase 5A Draw Research
  const drawResearch = evaluatePhase5DrawModel({
    match,
    stats,
    dixonColesDrawProbPct: rawDrawMix * 100,
    lambdaHome: shrunkH,
    lambdaAway: shrunkA,
    priors,
    drawHistory: resolvedCtx.drawSamples,
    drawUncertainty,
  });

  // Reconcile 1X2 raw probabilities with Phase 5A shrunk/logistic draw estimate prior to 1X2 causal calibration
  const rawDrawFor1X2 = (drawResearch.logisticAdjustedDrawProbPct ?? rawDrawMix * 100) / 100;
  const clampedDraw = Math.max(0.08, Math.min(0.45, rawDrawFor1X2));
  const remMass = Math.max(0.01, rawHomeMix + rawAwayMix);
  const adjHome01 = ((1 - clampedDraw) * rawHomeMix) / remMass;
  const adjAway01 = ((1 - clampedDraw) * rawAwayMix) / remMass;

  const oneXTwoRaw = normalizeThreeWayPct(adjHome01, clampedDraw, adjAway01);
  const cal1X2 = calibratePhase5OneXTwo(
    adjHome01,
    clampedDraw,
    adjAway01,
    match.utcDate,
    resolvedCtx.oneXTwoSamples
  );
  const oneXTwoFinal = normalizeThreeWayPct(cal1X2.pH, cal1X2.pD, cal1X2.pA);

  // Phase 5B Over 2.5 Research
  const o25Research = evaluatePhase5O25Model({
    match,
    stats,
    competitionMatches,
    priors,
    o25History: resolvedCtx.o25Samples,
  });

  // Phase 5C BTTS Research
  const bttsResearch = evaluatePhase5BttsModel({
    match,
    stats,
    competitionMatches,
    priors,
    bttsHistory: resolvedCtx.bttsSamples,
  });

  // Calibration diagnostic comparisons for each binary market
  const drawCalDiag = calibratePhase5Binary(
    (drawResearch.logisticAdjustedDrawProbPct ?? rawDrawMix * 100) / 100,
    match.utcDate,
    resolvedCtx.drawSamples.map((d) => ({
      timestampMs: d.timestampMs,
      rawProb01: d.shrunkDraw01,
      actual: d.isDraw,
    }))
  );
  const o25CalDiag = calibratePhase5Binary(
    (o25Research.selectedRawPct ?? 50) / 100,
    match.utcDate,
    resolvedCtx.o25Samples
  );
  const bttsCalDiag = calibratePhase5Binary(
    (bttsResearch.selectedRawPct ?? 50) / 100,
    match.utcDate,
    resolvedCtx.bttsSamples
  );

  // Independent market-specific abstention decisions
  const marketAssess = assessPhase5MarketDecisions({
    phase3Prediction,
    stats,
    hasCausalElo,
    oneXTwoRaw,
    oneXTwoFinal,
    oneXTwoCalibrationStatus: cal1X2.status,
    oneXTwoCalibrationMethod: cal1X2.selectedMethod,
    oneXTwoCalibrationSamples: cal1X2.sampleCount,
    oneXTwoUncertainty,
    drawResearch,
    o25Research,
    bttsResearch,
  });

  return {
    matchId: match.id,
    modelVersion: MODEL_VERSION_PHASE5,
    calculatedAt,
    isExperimental: true,
    abstainScope: marketAssess.abstainScope,
    abstainReason: marketAssess.abstainReason,
    phase3Prediction,
    causalPriors: priors,
    expectedGoals: {
      phase3Home: Math.round(p3H * 100) / 100,
      phase3Away: Math.round(p3A * 100) / 100,
      shrunkHome: Math.round(shrunkH * 100) / 100,
      shrunkAway: Math.round(shrunkA * 100) / 100,
    },
    oneXTwo: {
      homeWin: oneXTwoFinal.homeWin,
      draw: oneXTwoFinal.draw,
      awayWin: oneXTwoFinal.awayWin,
      rawHomeWin: oneXTwoRaw.homeWin,
      rawDraw: oneXTwoRaw.draw,
      rawAwayWin: oneXTwoRaw.awayWin,
      calibrationStatus: cal1X2.status,
      calibrationMethod: cal1X2.selectedMethod,
      calibrationSampleCount: cal1X2.sampleCount,
    },
    drawResearch,
    o25Research,
    bttsResearch,
    calibrationDiagnostics: {
      oneXTwo: cal1X2.comparisons,
      draw: drawCalDiag.comparisons,
      over25: o25CalDiag.comparisons,
      btts: bttsCalDiag.comparisons,
    },
    marketDecisions: marketAssess.decisions,
    limitationsNote:
      'Experimental Phase 5 research model. Calibration returns NOT_TRAINED below 100 (Temp) / 150 (Beta) / 220 (Isotonic) causal priors (< T). Single-match football outcomes remain inherently noisy.',
  };
}

// ---------------------------------------------------------------------------
// Statistical & Benchmark Evaluation Helpers
// ---------------------------------------------------------------------------

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

function summarizeBinarySamples(
  items: Array<{ prob01: number | null; actual: boolean; status: 'PREDICT' | 'ABSTAIN' | 'NOT_TRAINED' }>,
  threshold01: number = 0.5
): BinaryEvalSummary {
  const predicted = items.filter((i) => i.status === 'PREDICT' && i.prob01 !== null);
  const abstainedCount = items.filter((i) => i.status === 'ABSTAIN').length;
  const notTrainedCount = items.filter((i) => i.status === 'NOT_TRAINED').length;
  const total = items.length;
  const n = predicted.length;
  const coveragePct = total > 0 ? round1((n / total) * 100) : 0;

  if (n === 0) {
    return {
      sampleSize: 0,
      abstainedCount,
      notTrainedCount,
      coveragePct,
      actualPositiveRatePct: null,
      predictedMeanProbPct: null,
      accuracyPct: null,
      accuracyCi95: null,
      precisionPct: null,
      recallPct: null,
      f1Pct: null,
      brier: null,
      logLoss: null,
      ecePct: null,
      tailEcePct: null,
      reliabilityBins: [],
    };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let hits = 0;
  let posCount = 0;
  let sumProb = 0;
  let sumBrier = 0;
  let sumLoss = 0;

  const binDefs = [
    { label: '0-20%', min: 0, max: 0.2 },
    { label: '20-40%', min: 0.2, max: 0.4 },
    { label: '40-60%', min: 0.4, max: 0.6 },
    { label: '60-80%', min: 0.6, max: 0.8 },
    { label: '80-100%', min: 0.8, max: 1.0001 },
  ];
  const binStats = binDefs.map((b) => ({ ...b, count: 0, sumP: 0, sumY: 0 }));

  let tailCount = 0;
  let tailSumP = 0;
  let tailSumY = 0;

  for (const item of predicted) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, item.prob01!));
    const y = item.actual ? 1 : 0;
    const callPos = p >= threshold01;
    if (callPos && item.actual) tp++;
    if (callPos && !item.actual) fp++;
    if (!callPos && item.actual) fn++;
    if (callPos === item.actual) hits++;
    posCount += y;
    sumProb += p;
    sumBrier += (p - y) * (p - y);
    sumLoss += item.actual ? -Math.log(p) : -Math.log(1 - p);

    for (const b of binStats) {
      if (p >= b.min && p < b.max) {
        b.count++;
        b.sumP += p;
        b.sumY += y;
        break;
      }
    }

    const topP = Math.max(p, 1 - p);
    const topY = p >= 0.5 ? y : 1 - y;
    if (topP >= 0.7) {
      tailCount++;
      tailSumP += topP;
      tailSumY += topY;
    }
  }

  let ece = 0;
  const reliabilityBins = binStats.map((b) => {
    if (b.count === 0) {
      return {
        binLabel: b.label,
        count: 0,
        avgPredictedPct: null,
        actualRatePct: null,
        absErrorPct: null,
      };
    }
    const avgP = b.sumP / b.count;
    const avgY = b.sumY / b.count;
    const err = Math.abs(avgP - avgY);
    ece += (b.count / n) * err;
    return {
      binLabel: b.label,
      count: b.count,
      avgPredictedPct: round1(avgP * 100),
      actualRatePct: round1(avgY * 100),
      absErrorPct: round1(err * 100),
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
    actualPositiveRatePct: round1((posCount / n) * 100),
    predictedMeanProbPct: round1((sumProb / n) * 100),
    accuracyPct: round1((hits / n) * 100),
    accuracyCi95: wilsonCi95(hits, n),
    precisionPct: precision !== null ? round1(precision * 100) : null,
    recallPct: recall !== null ? round1(recall * 100) : null,
    f1Pct: f1 !== null ? round1(f1 * 100) : null,
    brier: Math.round((sumBrier / n) * 1000) / 1000,
    logLoss: Math.round((sumLoss / n) * 1000) / 1000,
    ecePct: Math.round(ece * 1000) / 10,
    tailEcePct:
      tailCount > 0
        ? Math.round(Math.abs(tailSumP / tailCount - tailSumY / tailCount) * 1000) / 10
        : null,
    reliabilityBins,
  };
}

function summarizeOneXTwoSamples(
  items: Array<{
    pH01: number | null;
    pD01: number | null;
    pA01: number | null;
    winner: 'HOME' | 'DRAW' | 'AWAY';
    abstained: boolean;
  }>
): OneXTwoEvalSummary {
  const predicted = items.filter(
    (i) => !i.abstained && i.pH01 !== null && i.pD01 !== null && i.pA01 !== null
  );
  const abstainedCount = items.length - predicted.length;
  const n = predicted.length;
  const coveragePct = items.length > 0 ? round1((n / items.length) * 100) : 0;

  if (n === 0) {
    return {
      sampleSize: 0,
      abstainedCount,
      coveragePct,
      accuracyPct: null,
      accuracyCi95: null,
      brier: null,
      logLoss: null,
      meanEcePct: null,
      tailEcePct: null,
      predictedRates: { homePct: null, drawPct: null, awayPct: null },
      actualRates: { homePct: null, drawPct: null, awayPct: null },
      reliabilityBins: [],
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

  const binDefs = [
    { label: '0-20%', min: 0, max: 0.2 },
    { label: '20-40%', min: 0.2, max: 0.4 },
    { label: '40-60%', min: 0.4, max: 0.6 },
    { label: '60-80%', min: 0.6, max: 0.8 },
    { label: '80-100%', min: 0.8, max: 1.0001 },
  ];
  const binStats = binDefs.map((b) => ({ ...b, count: 0, sumP: 0, sumY: 0 }));

  let tailCount = 0;
  let tailSumP = 0;
  let tailSumY = 0;

  for (const item of predicted) {
    const sum = Math.max(1e-6, item.pH01! + item.pD01! + item.pA01!);
    const pH = Math.max(1e-6, Math.min(1 - 1e-6, item.pH01! / sum));
    const pD = Math.max(1e-6, Math.min(1 - 1e-6, item.pD01! / sum));
    const pA = Math.max(1e-6, Math.min(1 - 1e-6, item.pA01! / sum));

    sumPH += pH;
    sumPD += pD;
    sumPA += pA;

    const yH = item.winner === 'HOME' ? 1 : 0;
    const yD = item.winner === 'DRAW' ? 1 : 0;
    const yA = item.winner === 'AWAY' ? 1 : 0;
    actH += yH;
    actD += yD;
    actA += yA;

    const predClass = pH >= pD && pH >= pA ? 'HOME' : pA >= pD && pA >= pH ? 'AWAY' : 'DRAW';
    if (predClass === item.winner) hits++;

    sumBrier += (pH - yH) ** 2 + (pD - yD) ** 2 + (pA - yA) ** 2;
    const hitP = item.winner === 'HOME' ? pH : item.winner === 'DRAW' ? pD : pA;
    sumLoss += -Math.log(Math.max(1e-6, hitP));

    // Reliability over predicted outcome entries (3*n entries) + tail over max class confidence >= 70%
    const pairs: Array<[number, number]> = [
      [pH, yH],
      [pD, yD],
      [pA, yA],
    ];
    for (const [p, y] of pairs) {
      for (const b of binStats) {
        if (p >= b.min && p < b.max) {
          b.count++;
          b.sumP += p;
          b.sumY += y;
          break;
        }
      }
    }

    const topP = Math.max(pH, pD, pA);
    const topHit = predClass === item.winner ? 1 : 0;
    if (topP >= 0.7) {
      tailCount++;
      tailSumP += topP;
      tailSumY += topHit;
    }
  }

  let ece = 0;
  const reliabilityBins = binStats.map((b) => {
    if (b.count === 0) {
      return {
        binLabel: b.label,
        count: 0,
        avgPredictedPct: null,
        actualRatePct: null,
        absErrorPct: null,
      };
    }
    const avgP = b.sumP / b.count;
    const avgY = b.sumY / b.count;
    const err = Math.abs(avgP - avgY);
    ece += (b.count / (n * 3)) * err;
    return {
      binLabel: b.label,
      count: b.count,
      avgPredictedPct: round1(avgP * 100),
      actualRatePct: round1(avgY * 100),
      absErrorPct: round1(err * 100),
    };
  });

  return {
    sampleSize: n,
    abstainedCount,
    coveragePct,
    accuracyPct: round1((hits / n) * 100),
    accuracyCi95: wilsonCi95(hits, n),
    brier: Math.round((sumBrier / n) * 1000) / 1000,
    logLoss: Math.round((sumLoss / n) * 1000) / 1000,
    meanEcePct: Math.round(ece * 1000) / 10,
    tailEcePct:
      tailCount > 0
        ? Math.round(Math.abs(tailSumP / tailCount - tailSumY / tailCount) * 1000) / 10
        : null,
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
    reliabilityBins,
  };
}

function summarizeGoals(
  rows: Array<{ predTotal: number | null; actTotal: number }>
): GoalsRegressionSummary {
  const valid = rows.filter((r) => r.predTotal !== null && Number.isFinite(r.predTotal));
  if (valid.length === 0) {
    return {
      sampleSize: 0,
      mae: null,
      rmse: null,
      predictedMeanTotal: null,
      actualMeanTotal: null,
      bias: null,
    };
  }
  let ae = 0;
  let se = 0;
  let sumPred = 0;
  let sumAct = 0;
  for (const r of valid) {
    const err = r.predTotal! - r.actTotal;
    ae += Math.abs(err);
    se += err * err;
    sumPred += r.predTotal!;
    sumAct += r.actTotal;
  }
  const n = valid.length;
  return {
    sampleSize: n,
    mae: Math.round((ae / n) * 1000) / 1000,
    rmse: Math.round(Math.sqrt(se / n) * 1000) / 1000,
    predictedMeanTotal: Math.round((sumPred / n) * 1000) / 1000,
    actualMeanTotal: Math.round((sumAct / n) * 1000) / 1000,
    bias: Math.round(((sumPred - sumAct) / n) * 1000) / 1000,
  };
}

/**
 * Run paired chronological walk-forward comparison across:
 * Phase 3 Frozen vs Phase 4 Experimental vs Phase 5 Experimental vs Naive Baselines.
 * Strictly respects target kickoff timestamp T (0 future, target, or same-timestamp leakage).
 */
export async function runChronologicalPhase5Benchmark(params: {
  datasetId: string;
  datasetName: string;
  matches: Match[];
  isBlindHoldout?: boolean;
  getMatchStats: (match: Match) => Promise<MatchStatistics>;
  calculatePhase3: (match: Match, stats: MatchStatistics, priorHistory: HistoryRecord[]) => Promise<Prediction>;
}): Promise<{
  report: Phase5BenchmarkReport;
  phase4Comparison: Phase4BenchmarkComparison;
}> {
  const { datasetId, datasetName, matches, isBlindHoldout = false, getMatchStats, calculatePhase3 } = params;

  const chrono = [...matches]
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  // Paired Phase 4 benchmark runner (keeps Phase 4 logic completely untouched)
  const phase4Comparison = await runChronologicalPhase4Comparison({
    datasetName,
    leagueId: datasetId,
    dataSource: datasetName,
    matches: chrono,
    getMatchStats,
    calculatePhase3,
  });

  const statsCache = new Map<string, MatchStatistics>();
  const p3Cache = new Map<string, Prediction>();
  const p4Cache = new Map<string, Phase4Prediction>();

  const p3History: HistoryRecord[] = [];
  const p4History: HistoryRecord[] = [];
  const p5OneXTwoHistory: MultiClassCalibSample[] = [];
  const p5DrawHistory: Phase5DrawHistoryEntry[] = [];
  const p5O25History: BinaryCalibSample[] = [];
  const p5BttsHistory: BinaryCalibSample[] = [];

  let futureViolations = 0;
  let targetXgViolations = 0;
  let sameTimestampViolations = 0;
  let postKickoffViolations = 0;

  // Collection buffers
  const p3_1x2: Array<{ pH01: number | null; pD01: number | null; pA01: number | null; winner: 'HOME' | 'DRAW' | 'AWAY'; abstained: boolean }> = [];
  const p4_1x2: typeof p3_1x2 = [];
  const p5_1x2_all: typeof p3_1x2 = [];
  const p5_1x2_flt: typeof p3_1x2 = [];

  const p3_drawArgmax: Array<{ prob01: number | null; actual: boolean; status: 'PREDICT' | 'ABSTAIN' | 'NOT_TRAINED' }> = [];
  const p3_drawSig: typeof p3_drawArgmax = [];
  const p4_drawArgmax: typeof p3_drawArgmax = [];
  const p4_drawSig: typeof p3_drawArgmax = [];
  const p5_drawArgmax: typeof p3_drawArgmax = [];
  const p5_drawSig: typeof p3_drawArgmax = [];
  const p5_drawFlt: typeof p3_drawArgmax = [];

  const p3_o25: typeof p3_drawArgmax = [];
  const p4_o25: typeof p3_drawArgmax = [];
  const p5_o25_all: typeof p3_drawArgmax = [];
  const p5_o25_flt: typeof p3_drawArgmax = [];

  const o25_varA: typeof p3_drawArgmax = [];
  const o25_varB: typeof p3_drawArgmax = [];
  const o25_varC: typeof p3_drawArgmax = [];
  const o25_varD: typeof p3_drawArgmax = [];

  const p3_btts: typeof p3_drawArgmax = [];
  const p4_btts: typeof p3_drawArgmax = [];
  const p5_btts_all: typeof p3_drawArgmax = [];
  const p5_btts_flt: typeof p3_drawArgmax = [];

  const btts_varA: typeof p3_drawArgmax = [];
  const btts_varB: typeof p3_drawArgmax = [];
  const btts_varC: typeof p3_drawArgmax = [];
  const btts_varD: typeof p3_drawArgmax = [];

  // Calibration ablation buffers (on non-abstained matches)
  const cal1x2_raw: typeof p3_1x2 = [];
  const cal1x2_temp: typeof p3_1x2 = [];
  let cal1x2CalCount = 0;
  let cal1x2NotTrained = 0;

  const calO25_raw: typeof p3_drawArgmax = [];
  const calO25_temp: typeof p3_drawArgmax = [];
  const calO25_beta: typeof p3_drawArgmax = [];
  const calO25_iso: typeof p3_drawArgmax = [];
  const calBtts_raw: typeof p3_drawArgmax = [];
  const calBtts_temp: typeof p3_drawArgmax = [];
  const calBtts_beta: typeof p3_drawArgmax = [];
  const calBtts_iso: typeof p3_drawArgmax = [];
  const calDraw_raw: typeof p3_drawArgmax = [];
  const calDraw_temp: typeof p3_drawArgmax = [];
  const calDraw_beta: typeof p3_drawArgmax = [];
  const calDraw_iso: typeof p3_drawArgmax = [];

  // Baselines (scored over Phase 3 non-abstained set for direct paired comparison)
  const base_homeBias: typeof p3_1x2 = [];
  const base_emp1x2: typeof p3_1x2 = [];
  const base_empDraw: typeof p3_drawArgmax = [];
  const base_empO25: typeof p3_drawArgmax = [];
  const base_empBtts: typeof p3_drawArgmax = [];
  const actualO25Flags: boolean[] = [];
  const actualBttsFlags: boolean[] = [];

  const p3_goals: Array<{ predTotal: number | null; actTotal: number }> = [];
  const p4_goals: Array<{ predTotal: number | null; actTotal: number }> = [];
  const p5_goals: Array<{ predTotal: number | null; actTotal: number }> = [];

  // Track cumulative causal league outcomes strictly < T
  let priorCount = 0;
  let priorH = 0;
  let priorD = 0;
  let priorA = 0;
  let priorO25 = 0;
  let priorBtts = 0;

  // Note: queue same-timestamp batches so simultaneous kickoffs don't leak into each other!
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
      const actO25 = hg + ag > 2;
      const actBtts = hg > 0 && ag > 0;

      // Leakage verification against prior buffers
      for (const fm of p5OneXTwoHistory) {
        if (fm.timestampMs > mMs) futureViolations++;
        if (fm.timestampMs === mMs) sameTimestampViolations++;
      }

      const stats = await getMatchStats(m);
      statsCache.set(m.id, stats);
      if (stats.homeTeamStats.formMatches.some((f) => f.xG !== null && stats.observedMatchXG && f.xG === stats.observedMatchXG.homeXG)) {
        targetXgViolations++;
      }
      if (stats.observedMatchXG !== null && stats.homeTeamStats.overall.avgXG !== null) {
        postKickoffViolations++;
      }

      const p3 = await calculatePhase3(m, stats, p3History);
      p3Cache.set(m.id, p3);
      const p4 = evaluatePhase4Match(m, stats, {
        phase3Prediction: p3,
        phase4History: p4History,
        competitionMatches: chrono,
      });
      p4Cache.set(m.id, p4);

      const p5 = evaluatePhase5Match(m, stats, {
        phase3Prediction: p3,
        competitionMatches: chrono,
        historyContext: {
          oneXTwoSamples: p5OneXTwoHistory,
          drawSamples: p5DrawHistory,
          o25Samples: p5O25History,
          bttsSamples: p5BttsHistory,
        },
      });

      const p3Abstain = p3.modelType === 'ABSTAIN' || p3.probabilities === null;
      const p4Abstain = p4.abstainScope === 'MATCH_ABSTAIN' || p4.ensemble.probabilities === null;

      // 1X2
      p3_1x2.push({
        pH01: p3Abstain ? null : p3.probabilities!.homeWin / 100,
        pD01: p3Abstain ? null : p3.probabilities!.draw / 100,
        pA01: p3Abstain ? null : p3.probabilities!.awayWin / 100,
        winner: actWinner,
        abstained: p3Abstain,
      });
      p4_1x2.push({
        pH01: p4Abstain ? null : p4.ensemble.probabilities!.homeWin / 100,
        pD01: p4Abstain ? null : p4.ensemble.probabilities!.draw / 100,
        pA01: p4Abstain ? null : p4.ensemble.probabilities!.awayWin / 100,
        winner: actWinner,
        abstained: p4Abstain,
      });
      p5_1x2_all.push({
        pH01: p3Abstain ? null : p5.oneXTwo.homeWin! / 100,
        pD01: p3Abstain ? null : p5.oneXTwo.draw! / 100,
        pA01: p3Abstain ? null : p5.oneXTwo.awayWin! / 100,
        winner: actWinner,
        abstained: p3Abstain,
      });
      const p5_1x2_dec = p5.marketDecisions['1X2'];
      p5_1x2_flt.push({
        pH01: p5_1x2_dec.status === 'PREDICT' && p5_1x2_dec.probs1X2 ? p5_1x2_dec.probs1X2.homeWin / 100 : null,
        pD01: p5_1x2_dec.status === 'PREDICT' && p5_1x2_dec.probs1X2 ? p5_1x2_dec.probs1X2.draw / 100 : null,
        pA01: p5_1x2_dec.status === 'PREDICT' && p5_1x2_dec.probs1X2 ? p5_1x2_dec.probs1X2.awayWin / 100 : null,
        winner: actWinner,
        abstained: p5_1x2_dec.status !== 'PREDICT',
      });

      // Paired baselines on Phase 3 non-abstained matches
      if (!p3Abstain) {
        actualO25Flags.push(actO25);
        actualBttsFlags.push(actBtts);

        base_homeBias.push({
          pH01: 0.96,
          pD01: 0.02,
          pA01: 0.02,
          winner: actWinner,
          abstained: false,
        });
        const denom1 = priorCount + 3;
        base_emp1x2.push({
          pH01: (priorH + 1) / denom1,
          pD01: (priorD + 1) / denom1,
          pA01: (priorA + 1) / denom1,
          winner: actWinner,
          abstained: false,
        });
        const denomB = priorCount + 2;
        base_empDraw.push({
          prob01: (priorD + 0.52) / denomB,
          actual: actDraw,
          status: 'PREDICT',
        });
        base_empO25.push({
          prob01: (priorO25 + 1) / denomB,
          actual: actO25,
          status: 'PREDICT',
        });
        base_empBtts.push({
          prob01: (priorBtts + 1) / denomB,
          actual: actBtts,
          status: 'PREDICT',
        });
      }

      // Draw Argmax & Draw Signal
      const p3ArgmaxDraw = !p3Abstain && p3.probabilities!.draw > p3.probabilities!.homeWin && p3.probabilities!.draw > p3.probabilities!.awayWin;
      p3_drawArgmax.push({
        prob01: p3Abstain ? null : p3ArgmaxDraw ? 0.51 : Math.min(0.49, p3.probabilities!.draw / 100),
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      p3_drawSig.push({
        prob01: p3Abstain ? null : p3.probabilities!.draw / 100,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });

      const p4ArgmaxDraw = !p4Abstain && p4.ensemble.probabilities!.draw > p4.ensemble.probabilities!.homeWin && p4.ensemble.probabilities!.draw > p4.ensemble.probabilities!.awayWin;
      p4_drawArgmax.push({
        prob01: p4Abstain ? null : p4ArgmaxDraw ? 0.51 : Math.min(0.49, p4.ensemble.probabilities!.draw / 100),
        actual: actDraw,
        status: p4Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      p4_drawSig.push({
        prob01: p4Abstain ? null : p4.ensemble.probabilities!.draw / 100,
        actual: actDraw,
        status: p4Abstain ? 'ABSTAIN' : 'PREDICT',
      });

      const p5ArgmaxDraw = !p3Abstain && p5.oneXTwo.draw! > p5.oneXTwo.homeWin! && p5.oneXTwo.draw! > p5.oneXTwo.awayWin!;
      p5_drawArgmax.push({
        prob01: p3Abstain ? null : p5ArgmaxDraw ? 0.51 : Math.min(0.49, p5.oneXTwo.draw! / 100),
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      p5_drawSig.push({
        prob01: p3Abstain ? null : p5.drawResearch.finalDrawProbPct! / 100,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      const drawDec = p5.marketDecisions.DRAW;
      p5_drawFlt.push({
        prob01: drawDec.status === 'PREDICT' && drawDec.finalProbabilityPct !== null ? drawDec.finalProbabilityPct / 100 : null,
        actual: actDraw,
        status: drawDec.status,
      });

      // Over 2.5
      p3_o25.push({ prob01: p3Abstain ? null : p3.probabilities!.over25 / 100, actual: actO25, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      p4_o25.push({ prob01: p4Abstain ? null : p4.ensemble.probabilities!.over25 / 100, actual: actO25, status: p4Abstain ? 'ABSTAIN' : 'PREDICT' });
      p5_o25_all.push({ prob01: p3Abstain ? null : p5.o25Research.selectedFinalPct! / 100, actual: actO25, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      const o25Dec = p5.marketDecisions.OVER25;
      p5_o25_flt.push({
        prob01: o25Dec.status === 'PREDICT' && o25Dec.finalProbabilityPct !== null ? o25Dec.finalProbabilityPct / 100 : null,
        actual: actO25,
        status: o25Dec.status,
      });

      o25_varA.push({ prob01: p3Abstain ? null : p5.o25Research.variantAPoissonPct! / 100, actual: actO25, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      o25_varB.push({ prob01: p3Abstain ? null : p5.o25Research.variantBNegBinPct! / 100, actual: actO25, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      o25_varC.push({ prob01: p3Abstain ? null : p5.o25Research.variantCShrunkPct! / 100, actual: actO25, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      o25_varD.push({
        prob01: !p3Abstain && p5.o25Research.variantDCalibratedPct !== null ? p5.o25Research.variantDCalibratedPct / 100 : null,
        actual: actO25,
        status: p3Abstain ? 'ABSTAIN' : p5.o25Research.variantDCalibratedPct !== null ? 'PREDICT' : 'NOT_TRAINED',
      });

      // BTTS
      p3_btts.push({ prob01: p3Abstain ? null : p3.probabilities!.bttsYes / 100, actual: actBtts, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      p4_btts.push({ prob01: p4Abstain ? null : p4.ensemble.probabilities!.bttsYes / 100, actual: actBtts, status: p4Abstain ? 'ABSTAIN' : 'PREDICT' });
      p5_btts_all.push({ prob01: p3Abstain ? null : p5.bttsResearch.selectedFinalPct! / 100, actual: actBtts, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      const bttsDec = p5.marketDecisions.BTTS;
      p5_btts_flt.push({
        prob01: bttsDec.status === 'PREDICT' && bttsDec.finalProbabilityPct !== null ? bttsDec.finalProbabilityPct / 100 : null,
        actual: actBtts,
        status: bttsDec.status,
      });

      btts_varA.push({ prob01: p3Abstain ? null : p5.bttsResearch.variantAExistingPct! / 100, actual: actBtts, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      btts_varB.push({ prob01: p3Abstain ? null : p5.bttsResearch.variantBIndependentPct! / 100, actual: actBtts, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      btts_varC.push({ prob01: p3Abstain ? null : p5.bttsResearch.variantCNegBinPct! / 100, actual: actBtts, status: p3Abstain ? 'ABSTAIN' : 'PREDICT' });
      btts_varD.push({
        prob01: !p3Abstain && p5.bttsResearch.variantDCalibratedPct !== null ? p5.bttsResearch.variantDCalibratedPct / 100 : null,
        actual: actBtts,
        status: p3Abstain ? 'ABSTAIN' : p5.bttsResearch.variantDCalibratedPct !== null ? 'PREDICT' : 'NOT_TRAINED',
      });

      // Calibration Ablation Audit (on non-abstained fixtures)
      if (!p3Abstain) {
        cal1x2_raw.push({
          pH01: p5.oneXTwo.rawHomeWin! / 100,
          pD01: p5.oneXTwo.rawDraw! / 100,
          pA01: p5.oneXTwo.rawAwayWin! / 100,
          winner: actWinner,
          abstained: false,
        });
        cal1x2_temp.push({
          pH01: p5.oneXTwo.homeWin! / 100,
          pD01: p5.oneXTwo.draw! / 100,
          pA01: p5.oneXTwo.awayWin! / 100,
          winner: actWinner,
          abstained: false,
        });
        if (p5.oneXTwo.calibrationStatus === 'CALIBRATED') cal1x2CalCount++;
        else cal1x2NotTrained++;

        const o25CalRes = calibratePhase5Binary(p5.o25Research.selectedRawPct! / 100, m.utcDate, p5O25History);
        calO25_raw.push({ prob01: o25CalRes.variantProbabilities.rawProb01, actual: actO25, status: 'PREDICT' });
        calO25_temp.push({
          prob01: o25CalRes.variantProbabilities.temperatureProb01,
          actual: actO25,
          status: o25CalRes.variantProbabilities.temperatureProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calO25_beta.push({
          prob01: o25CalRes.variantProbabilities.betaProb01,
          actual: actO25,
          status: o25CalRes.variantProbabilities.betaProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calO25_iso.push({
          prob01: o25CalRes.variantProbabilities.isotonicProb01,
          actual: actO25,
          status: o25CalRes.variantProbabilities.isotonicProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });

        const bttsCalRes = calibratePhase5Binary(p5.bttsResearch.selectedRawPct! / 100, m.utcDate, p5BttsHistory);
        calBtts_raw.push({ prob01: bttsCalRes.variantProbabilities.rawProb01, actual: actBtts, status: 'PREDICT' });
        calBtts_temp.push({
          prob01: bttsCalRes.variantProbabilities.temperatureProb01,
          actual: actBtts,
          status: bttsCalRes.variantProbabilities.temperatureProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calBtts_beta.push({
          prob01: bttsCalRes.variantProbabilities.betaProb01,
          actual: actBtts,
          status: bttsCalRes.variantProbabilities.betaProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calBtts_iso.push({
          prob01: bttsCalRes.variantProbabilities.isotonicProb01,
          actual: actBtts,
          status: bttsCalRes.variantProbabilities.isotonicProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });

        const drawBinSamples = p5DrawHistory.map((d) => ({ timestampMs: d.timestampMs, rawProb01: d.shrunkDraw01, actual: d.isDraw }));
        const drawCalRes = calibratePhase5Binary((p5.drawResearch.logisticAdjustedDrawProbPct ?? 26) / 100, m.utcDate, drawBinSamples);
        calDraw_raw.push({ prob01: drawCalRes.variantProbabilities.rawProb01, actual: actDraw, status: 'PREDICT' });
        calDraw_temp.push({
          prob01: drawCalRes.variantProbabilities.temperatureProb01,
          actual: actDraw,
          status: drawCalRes.variantProbabilities.temperatureProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calDraw_beta.push({
          prob01: drawCalRes.variantProbabilities.betaProb01,
          actual: actDraw,
          status: drawCalRes.variantProbabilities.betaProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });
        calDraw_iso.push({
          prob01: drawCalRes.variantProbabilities.isotonicProb01,
          actual: actDraw,
          status: drawCalRes.variantProbabilities.isotonicProb01 !== null ? 'PREDICT' : 'NOT_TRAINED',
        });

        p3_goals.push({
          predTotal:
            p3.expectedScore !== null ? p3.expectedScore.home + p3.expectedScore.away : null,
          actTotal: hg + ag,
        });
        p4_goals.push({
          predTotal:
            p4.lambdaComparison.variantBHome !== null && p4.lambdaComparison.variantBAway !== null
              ? p4.lambdaComparison.variantBHome + p4.lambdaComparison.variantBAway
              : null,
          actTotal: hg + ag,
        });
        p5_goals.push({
          predTotal:
            p5.expectedGoals.shrunkHome !== null && p5.expectedGoals.shrunkAway !== null
              ? p5.expectedGoals.shrunkHome + p5.expectedGoals.shrunkAway
              : null,
          actTotal: hg + ag,
        });
      }

      // Queue post-kickoff updates AFTER all same-timestamp matches are predicted
      batchPostUpdates.push(() => {
        priorCount++;
        if (actWinner === 'HOME') priorH++;
        else if (actWinner === 'DRAW') priorD++;
        else priorA++;
        if (actO25) priorO25++;
        if (actBtts) priorBtts++;

        const rec: HistoryRecord = {
          id: `p5-bench-${m.id}`,
          match: m,
          prediction: p3,
          actualResult: {
            finalScore: `${hg} - ${ag}`,
            homeGoals: hg,
            awayGoals: ag,
            winner: actWinner,
            over15: hg + ag > 1.5,
            over25: actO25,
            btts: actBtts,
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
          p5O25History.push({
            timestampMs: mMs,
            rawProb01: p5.o25Research.selectedRawPct! / 100,
            actual: actO25,
          });
          p5BttsHistory.push({
            timestampMs: mMs,
            rawProb01: p5.bttsResearch.selectedRawPct! / 100,
            actual: actBtts,
          });
        }
      });
    }

    for (const upd of batchPostUpdates) upd();
    idx = endIdx;
  }

  // Majority class baselines computed transparently for reference
  const o25PosCount = actualO25Flags.filter(Boolean).length;
  const o25MajAcc =
    actualO25Flags.length > 0
      ? round1((Math.max(o25PosCount, actualO25Flags.length - o25PosCount) / actualO25Flags.length) * 100)
      : null;
  const o25MajLabel =
    o25PosCount >= actualO25Flags.length - o25PosCount ? 'OVER_2.5' : 'UNDER_2.5';

  const bttsPosCount = actualBttsFlags.filter(Boolean).length;
  const bttsMajAcc =
    actualBttsFlags.length > 0
      ? round1((Math.max(bttsPosCount, actualBttsFlags.length - bttsPosCount) / actualBttsFlags.length) * 100)
      : null;
  const bttsMajLabel =
    bttsPosCount >= actualBttsFlags.length - bttsPosCount ? 'BTTS_YES' : 'BTTS_NO';

  const homeBiasSum = summarizeOneXTwoSamples(base_homeBias);
  const emp1x2Sum = summarizeOneXTwoSamples(base_emp1x2);

  const cal1x2RawSum = summarizeOneXTwoSamples(cal1x2_raw);
  const cal1x2TempSum = summarizeOneXTwoSamples(cal1x2_temp);

  const o25RawSum = summarizeBinarySamples(calO25_raw);
  const o25TempSum = summarizeBinarySamples(calO25_temp);
  const o25BetaSum = summarizeBinarySamples(calO25_beta);
  const o25IsoSum = summarizeBinarySamples(calO25_iso);
  const p5O25Sum = summarizeBinarySamples(p5_o25_all);

  const bttsRawSum = summarizeBinarySamples(calBtts_raw);
  const bttsTempSum = summarizeBinarySamples(calBtts_temp);
  const bttsBetaSum = summarizeBinarySamples(calBtts_beta);
  const bttsIsoSum = summarizeBinarySamples(calBtts_iso);
  const p5BttsSum = summarizeBinarySamples(p5_btts_all);

  const drawRawSum = summarizeBinarySamples(calDraw_raw, 0.285);
  const drawTempSum = summarizeBinarySamples(calDraw_temp, 0.285);
  const drawBetaSum = summarizeBinarySamples(calDraw_beta, 0.285);
  const drawIsoSum = summarizeBinarySamples(calDraw_iso, 0.285);
  const p5DrawSigSum = summarizeBinarySamples(p5_drawSig, 0.285);

  const dates = chrono.map((m) => m.utcDate.split('T')[0]).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A';

  const report: Phase5BenchmarkReport = {
    datasetId,
    datasetName,
    dateRange,
    totalFixtures: chrono.length,
    isBlindHoldout,
    leakageCheck: {
      verified:
        futureViolations === 0 &&
        targetXgViolations === 0 &&
        sameTimestampViolations === 0 &&
        postKickoffViolations === 0,
      futureDataViolations: futureViolations,
      targetXgViolations,
      sameTimestampViolations,
      postKickoffViolations,
    },
    baselines: {
      oneXTwoHomeBias: {
        accuracyPct: homeBiasSum.accuracyPct,
        brier: homeBiasSum.brier,
        logLoss: homeBiasSum.logLoss,
      },
      oneXTwoEmpiricalLeague: {
        accuracyPct: emp1x2Sum.accuracyPct,
        brier: emp1x2Sum.brier,
        logLoss: emp1x2Sum.logLoss,
      },
      drawEmpiricalPrior: summarizeBinarySamples(base_empDraw, 0.285),
      over25MajorityClass: { accuracyPct: o25MajAcc, majorityLabel: o25MajLabel },
      over25EmpiricalPrior: summarizeBinarySamples(base_empO25, 0.5),
      bttsMajorityClass: { accuracyPct: bttsMajAcc, majorityLabel: bttsMajLabel },
      bttsEmpiricalPrior: summarizeBinarySamples(base_empBtts, 0.5),
    },
    models: {
      phase3Frozen: {
        oneXTwo: summarizeOneXTwoSamples(p3_1x2),
        drawArgmax: summarizeBinarySamples(p3_drawArgmax, 0.5),
        drawSignal: summarizeBinarySamples(p3_drawSig, 0.285),
        over25: summarizeBinarySamples(p3_o25, 0.5),
        btts: summarizeBinarySamples(p3_btts, 0.5),
        goals: summarizeGoals(p3_goals),
      },
      phase4Experimental: {
        oneXTwo: summarizeOneXTwoSamples(p4_1x2),
        drawArgmax: summarizeBinarySamples(p4_drawArgmax, 0.5),
        drawSignal: summarizeBinarySamples(p4_drawSig, 0.285),
        over25: summarizeBinarySamples(p4_o25, 0.5),
        btts: summarizeBinarySamples(p4_btts, 0.5),
        goals: summarizeGoals(p4_goals),
      },
      phase5Experimental: {
        oneXTwo: summarizeOneXTwoSamples(p5_1x2_all),
        oneXTwoFiltered: summarizeOneXTwoSamples(p5_1x2_flt),
        drawArgmax: summarizeBinarySamples(p5_drawArgmax, 0.5),
        drawSignal: p5DrawSigSum,
        drawFiltered: summarizeBinarySamples(p5_drawFlt, 0.285),
        over25: p5O25Sum,
        over25Filtered: summarizeBinarySamples(p5_o25_flt, 0.5),
        btts: p5BttsSum,
        bttsFiltered: summarizeBinarySamples(p5_btts_flt, 0.5),
        goals: summarizeGoals(p5_goals),
      },
    },
    o25Variants: {
      variantA_PoissonDC: summarizeBinarySamples(o25_varA, 0.5),
      variantB_NegBin: summarizeBinarySamples(o25_varB, 0.5),
      variantC_Shrunk: summarizeBinarySamples(o25_varC, 0.5),
      variantD_Calibrated: summarizeBinarySamples(o25_varD, 0.5),
    },
    bttsVariants: {
      variantA_Existing: summarizeBinarySamples(btts_varA, 0.5),
      variantB_Independent: summarizeBinarySamples(btts_varB, 0.5),
      variantC_NegBin: summarizeBinarySamples(btts_varC, 0.5),
      variantD_Calibrated: summarizeBinarySamples(btts_varD, 0.5),
    },
    calibrationAudit: {
      oneXTwo: {
        rawLogLoss: cal1x2RawSum.logLoss,
        tempLogLoss: cal1x2TempSum.logLoss,
        rawEcePct: cal1x2RawSum.meanEcePct,
        tempEcePct: cal1x2TempSum.meanEcePct,
        rawTailEcePct: cal1x2RawSum.tailEcePct,
        tempTailEcePct: cal1x2TempSum.tailEcePct,
        calibratedCount: cal1x2CalCount,
        notTrainedCount: cal1x2NotTrained,
      },
      over25: {
        rawLogLoss: o25RawSum.logLoss,
        tempLogLoss: o25TempSum.logLoss,
        betaLogLoss: o25BetaSum.logLoss,
        isotonicLogLoss: o25IsoSum.logLoss,
        phase5SelectedLogLoss: p5O25Sum.logLoss,
        rawEcePct: o25RawSum.ecePct,
        phase5SelectedEcePct: p5O25Sum.ecePct,
        notTrainedCount: o25IsoSum.notTrainedCount,
      },
      btts: {
        rawLogLoss: bttsRawSum.logLoss,
        tempLogLoss: bttsTempSum.logLoss,
        betaLogLoss: bttsBetaSum.logLoss,
        isotonicLogLoss: bttsIsoSum.logLoss,
        phase5SelectedLogLoss: p5BttsSum.logLoss,
        rawEcePct: bttsRawSum.ecePct,
        phase5SelectedEcePct: p5BttsSum.ecePct,
        notTrainedCount: bttsIsoSum.notTrainedCount,
      },
      draw: {
        rawLogLoss: drawRawSum.logLoss,
        tempLogLoss: drawTempSum.logLoss,
        betaLogLoss: drawBetaSum.logLoss,
        isotonicLogLoss: drawIsoSum.logLoss,
        phase5SelectedLogLoss: p5DrawSigSum.logLoss,
        rawEcePct: drawRawSum.ecePct,
        phase5SelectedEcePct: p5DrawSigSum.ecePct,
        notTrainedCount: drawIsoSum.notTrainedCount,
      },
    },
  };

  return { report, phase4Comparison };
}
