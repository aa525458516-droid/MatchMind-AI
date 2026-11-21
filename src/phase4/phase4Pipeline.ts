import {
  HistoryRecord,
  MarketProbabilities,
  Match,
  MatchStatistics,
  Prediction,
} from '../types/football';
import { calibrateMarketProbabilities } from '../utils/probabilityCalibration';
import { computeBrierScore, computeLogLoss } from '../utils/validationMetrics';
import {
  CalibrationStateLabel,
  ExperimentReportMetadata,
  GoalMarketMetricsPair,
  MODEL_VERSION_PHASE3,
  MODEL_VERSION_PHASE4,
  ModelSideMetrics,
  PHASE4_EXPERIMENT_ID,
  Phase4BenchmarkComparison,
  Phase4Prediction,
} from './phase4Types';
import { extractVariantBProjection } from './variantBExtractor';
import { evaluateGoalMarketExperiment } from './goalMarketExperiment';
import { evaluateDrawExperiment } from './drawExperiment';
import {
  combineCausalEnsemble,
  EnsemblePriorSample,
  learnCausalEnsembleWeights,
} from './ensembleExperiment';
import { assessMarketAbstentions } from './marketAbstainEngine';
import { buildTransparentExplanation } from './explanationEngine';

export interface EvaluatePhase4Options {
  phase3Prediction: Prediction;
  competitionMatches?: Match[];
  phase4History?: HistoryRecord[];
  phase4EvalHistory?: EnsemblePriorSample[];
  monteCarloIterations?: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function computeBinaryECE(samples: Array<{ prob01: number; actual: boolean }>, numBins = 5): number | null {
  if (samples.length === 0) return null;
  let weightedErr = 0;
  for (let b = 0; b < numBins; b++) {
    const low = b / numBins;
    const high = (b + 1) / numBins;
    const matching = samples.filter((s) =>
      b === numBins - 1 ? s.prob01 >= low && s.prob01 <= high : s.prob01 >= low && s.prob01 < high
    );
    if (matching.length === 0) continue;
    const avgP = matching.reduce((acc, s) => acc + s.prob01, 0) / matching.length;
    const avgY = matching.filter((s) => s.actual).length / matching.length;
    weightedErr += (matching.length / samples.length) * Math.abs(avgP - avgY);
  }
  return Math.round(weightedErr * 1000) / 10; // percentage e.g. 4.2%
}

function computeMulticlassOneXTwoECE(
  samples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }>
): number | null {
  if (samples.length === 0) return null;
  const eceH = computeBinaryECE(samples.map((s) => ({ prob01: s.pH, actual: s.winner === 'HOME' }))) ?? 0;
  const eceD = computeBinaryECE(samples.map((s) => ({ prob01: s.pD, actual: s.winner === 'DRAW' }))) ?? 0;
  const eceA = computeBinaryECE(samples.map((s) => ({ prob01: s.pA, actual: s.winner === 'AWAY' }))) ?? 0;
  return round1((eceH + eceD + eceA) / 3);
}

/**
 * Compute an isolated Phase 4 prediction without mutating or weakening Phase 3 baseline output.
 */
export function evaluatePhase4Match(
  match: Match,
  stats: MatchStatistics,
  options: EvaluatePhase4Options
): Phase4Prediction {
  const {
    phase3Prediction,
    competitionMatches,
    phase4History = [],
    phase4EvalHistory = [],
    monteCarloIterations = 2500,
  } = options;

  const calculatedAt = new Date().toISOString();
  const sampleSize = Math.min(
    stats.homeTeamStats.formMatches.length,
    stats.awayTeamStats.formMatches.length
  );

  const isPhase3Abstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    !phase3Prediction.probabilities ||
    !stats.hasSufficientData ||
    stats.homeExpectedGoals === null ||
    stats.awayExpectedGoals === null;

  const variantB = extractVariantBProjection(match, stats, competitionMatches);

  if (isPhase3Abstain || !variantB.lambdas) {
    const abstainReason =
      phase3Prediction.abstainReason ||
      stats.unavailableReason ||
      'Insufficient pre-match evidence (< 5 verified matches or < 10 league priors).';
    const fakePhase3 =
      phase3Prediction.modelType === 'ABSTAIN'
        ? phase3Prediction
        : {
            ...phase3Prediction,
            modelType: 'ABSTAIN' as const,
            probabilities: null,
            expectedScore: null,
            confidence: null,
            confidenceScore: null,
            abstainReason,
          };

    const drawExp = {
      drawProb: null,
      rawDixonColesDrawProb: null,
      parityScore: null,
      lowScoringIndex: null,
      drawSignal: false,
      drawThreshold: 0.285,
      causalAdjustmentApplied: false,
      causalSamplesUsed: 0,
    };

    const marketAssessment = assessMarketAbstentions({
      phase3Prediction: fakePhase3,
      rawMarkets: null,
      calibratedMarkets: null,
      negBinResult: null,
      calibrationStatus: 'UNAVAILABLE',
      sampleSize,
      homePlayed: stats.homeTeamStats.overall.matchesPlayed,
      awayPlayed: stats.awayTeamStats.overall.matchesPlayed,
      hasElo:
        typeof stats.homeTeamStats.eloRating === 'number' &&
        typeof stats.awayTeamStats.eloRating === 'number',
      agreementScore: phase3Prediction.confidencePillars.modelAgreement,
    });

    const explanation = buildTransparentExplanation({
      match,
      stats,
      phase3Prediction: fakePhase3,
      variantBHome: null,
      variantBAway: null,
      drawExperiment: drawExp,
      marketAssessment,
      calibrationStatus: 'UNAVAILABLE',
      calibrationSampleCount: 0,
    });

    return {
      matchId: match.id,
      calculatedAt,
      modelVersion: MODEL_VERSION_PHASE4,
      baselineVersion: MODEL_VERSION_PHASE3,
      experimentId: PHASE4_EXPERIMENT_ID,
      phase3Prediction: fakePhase3,
      abstainScope: 'MATCH_ABSTAIN',
      abstainReason,
      lambdaComparison: {
        phase3Home: stats.homeExpectedGoals,
        phase3Away: stats.awayExpectedGoals,
        variantBHome: null,
        variantBAway: null,
        homeVenueWeight: null,
        awayVenueWeight: null,
        reliabilityWeight: null,
      },
      drawExperiment: drawExp,
      goalMarkets: {
        oneXTwo: marketAssessment.oneXTwo,
        doubleChance: marketAssessment.doubleChance,
        over15: marketAssessment.over15,
        over25: marketAssessment.over25,
        btts: marketAssessment.btts,
      },
      ensemble: {
        probabilities: null,
        rawProbabilities: null,
        weights: {
          poisson: 0,
          dixonColes: 0,
          elo: 0,
          monteCarlo: 0,
          variantBNegBin: 0,
          learnedFromSamples: 0,
          isUniformFallback: true,
          method: 'UNIFORM_PRIOR',
        },
        evaluations: [],
        expectedGoals: { home: null, away: null },
        mostLikelyScore: null,
        mostLikelyScoreProb: null,
        topScorelines: [],
        calibrationStatus: 'UNAVAILABLE',
        calibrationSampleCount: 0,
      },
      explanation,
      isDemoData: match.isDemoData,
      sampleSizeMatches: sampleSize,
      provenance: stats.provenance,
    };
  }

  const hasElo =
    typeof stats.homeTeamStats.eloRating === 'number' &&
    Number.isFinite(stats.homeTeamStats.eloRating) &&
    typeof stats.awayTeamStats.eloRating === 'number' &&
    Number.isFinite(stats.awayTeamStats.eloRating);

  const lambdaH_P4 = variantB.lambdas.homeExpectedGoals;
  const lambdaA_P4 = variantB.lambdas.awayExpectedGoals;

  // 1. Negative-Binomial Variant-B Goal Market & Dispersion Model
  const negBinResult = evaluateGoalMarketExperiment(
    lambdaH_P4,
    lambdaA_P4,
    stats.homeTeamStats.overall.matchesPlayed,
    stats.awayTeamStats.overall.matchesPlayed
  );

  // 2. Causal Ensemble Weights (< T) & Multi-Model Blending
  const weights = learnCausalEnsembleWeights(
    match.utcDate,
    hasElo,
    phase4History,
    phase4EvalHistory
  );

  const { combinedMarkets, evaluations } = combineCausalEnsemble(
    match.id,
    stats.homeExpectedGoals!,
    stats.awayExpectedGoals!,
    lambdaH_P4,
    lambdaA_P4,
    stats.homeTeamStats.eloRating,
    stats.awayTeamStats.eloRating,
    negBinResult,
    weights,
    monteCarloIterations
  );

  // 3. Draw-aware causal adjustment (< T) reconciled consistently with 1X2 & Double Chance
  const drawExp = evaluateDrawExperiment(
    combinedMarkets.draw,
    lambdaH_P4,
    lambdaA_P4,
    stats.homeTeamStats.eloRating,
    stats.awayTeamStats.eloRating,
    match.utcDate,
    phase4History
  );

  let rawMarkets: MarketProbabilities = { ...combinedMarkets };
  if (drawExp.causalAdjustmentApplied && drawExp.drawProb !== null) {
    const newDraw = drawExp.drawProb;
    const remOld = Math.max(0.1, rawMarkets.homeWin + rawMarkets.awayWin);
    const remNew = Math.max(1.0, 100 - newDraw);
    const homeWin = round1((rawMarkets.homeWin / remOld) * remNew);
    const awayWin = round1(100 - homeWin - newDraw);
    rawMarkets = {
      ...rawMarkets,
      homeWin,
      draw: newDraw,
      awayWin,
      homeOrDraw: round1(homeWin + newDraw),
      awayOrDraw: round1(awayWin + newDraw),
      homeOrAway: round1(homeWin + awayWin),
    };
  }

  // 4. Causal Temperature Scaling on Phase 4 raw probabilities (< T, min 100 samples)
  const calResult = calibrateMarketProbabilities(rawMarkets, match.utcDate, phase4History);
  const calibrationStatus: CalibrationStateLabel =
    calResult.status.status === 'CALIBRATED' ? 'CALIBRATED' : 'NOT_TRAINED';

  // 5. Market-specific ABSTAIN assessment
  const marketAssessment = assessMarketAbstentions({
    phase3Prediction,
    rawMarkets,
    calibratedMarkets: calResult.probabilities,
    negBinResult,
    calibrationStatus,
    sampleSize,
    homePlayed: stats.homeTeamStats.overall.matchesPlayed,
    awayPlayed: stats.awayTeamStats.overall.matchesPlayed,
    hasElo,
    agreementScore: phase3Prediction.confidencePillars.modelAgreement,
  });

  // 6. Grounded Explanation Engine
  const explanation = buildTransparentExplanation({
    match,
    stats,
    phase3Prediction,
    variantBHome: lambdaH_P4,
    variantBAway: lambdaA_P4,
    drawExperiment: drawExp,
    marketAssessment,
    calibrationStatus,
    calibrationSampleCount: calResult.status.sampleCount,
  });

  return {
    matchId: match.id,
    calculatedAt,
    modelVersion: MODEL_VERSION_PHASE4,
    baselineVersion: MODEL_VERSION_PHASE3,
    experimentId: PHASE4_EXPERIMENT_ID,
    phase3Prediction,
    abstainScope: marketAssessment.abstainScope,
    abstainReason: marketAssessment.summaryReason,
    lambdaComparison: {
      phase3Home: stats.homeExpectedGoals,
      phase3Away: stats.awayExpectedGoals,
      variantBHome: lambdaH_P4,
      variantBAway: lambdaA_P4,
      homeVenueWeight: variantB.lambdas.venueWeights?.homeVenueWeight ?? null,
      awayVenueWeight: variantB.lambdas.venueWeights?.awayVenueWeight ?? null,
      reliabilityWeight: variantB.lambdas.reliabilityWeight,
    },
    drawExperiment: drawExp,
    goalMarkets: {
      oneXTwo: marketAssessment.oneXTwo,
      doubleChance: marketAssessment.doubleChance,
      over15: marketAssessment.over15,
      over25: marketAssessment.over25,
      btts: marketAssessment.btts,
    },
    ensemble: {
      probabilities: calResult.probabilities,
      rawProbabilities: rawMarkets,
      weights,
      evaluations,
      expectedGoals: {
        home: lambdaH_P4,
        away: lambdaA_P4,
      },
      mostLikelyScore: negBinResult.topScorelines[0]?.score ?? null,
      mostLikelyScoreProb: negBinResult.topScorelines[0]?.probability ?? null,
      topScorelines: negBinResult.topScorelines,
      calibrationStatus,
      calibrationSampleCount: calResult.status.sampleCount,
    },
    explanation,
    isDemoData: match.isDemoData,
    sampleSizeMatches: sampleSize,
    provenance: stats.provenance,
  };
}

interface PairedMatchRow {
  match: Match;
  phase3: Prediction;
  phase4: Phase4Prediction;
}

function buildGoalPairMetrics(
  samples: Array<{ prob01: number; actual: boolean; uncertainty?: number }>,
  abstainedCount: number
): GoalMarketMetricsPair {
  const n = samples.length;
  if (n === 0) {
    return {
      evaluatedCount: 0,
      abstainedCount,
      accuracy: null,
      brier: null,
      logLoss: null,
      ece: null,
      predictedMean: null,
      actualRate: null,
      meanUncertainty: null,
    };
  }
  const hits = samples.filter((s) => (s.prob01 >= 0.5 && s.actual) || (s.prob01 < 0.5 && !s.actual)).length;
  const brier = samples.reduce((a, s) => a + computeBrierScore(s.prob01, s.actual), 0) / n;
  const logLoss = samples.reduce((a, s) => a + computeLogLoss(s.prob01, s.actual), 0) / n;
  const predMean = (samples.reduce((a, s) => a + s.prob01, 0) / n) * 100;
  const actualRate = (samples.filter((s) => s.actual).length / n) * 100;
  const ece = computeBinaryECE(samples);
  const uncVals = samples.filter((s) => typeof s.uncertainty === 'number').map((s) => s.uncertainty!);
  const meanUnc = uncVals.length > 0 ? round3(uncVals.reduce((a, b) => a + b, 0) / uncVals.length) : null;

  return {
    evaluatedCount: n,
    abstainedCount,
    accuracy: round1((hits / n) * 100),
    brier: round3(brier),
    logLoss: round3(logLoss),
    ece,
    predictedMean: round1(predMean),
    actualRate: round1(actualRate),
    meanUncertainty: meanUnc,
  };
}

function summarizePhase3Side(rows: PairedMatchRow[]): ModelSideMetrics {
  const totalFixtures = rows.length;
  const evalRows = rows.filter(
    (r) =>
      r.phase3.modelType !== 'ABSTAIN' &&
      r.phase3.confidence !== null &&
      r.phase3.probabilities !== null
  );
  const evaluatedMatches = evalRows.length;
  const abstainedMatches = totalFixtures - evaluatedMatches;
  const coveragePct = totalFixtures > 0 ? round1((evaluatedMatches / totalFixtures) * 100) : 0;

  if (evaluatedMatches === 0) {
    const emptyGoal = buildGoalPairMetrics([], 0);
    return {
      modelVersion: MODEL_VERSION_PHASE3,
      totalFixtures,
      evaluatedMatches: 0,
      abstainedMatches,
      coveragePct: 0,
      oneXTwo: { sampleSize: 0, accuracy: null, brier: null, logLoss: null, meanEceRaw: null, meanEceCalibrated: null },
      draw: { sampleSize: 0, precision: null, recall: null, f1: null, actualDrawRate: null, predictedDrawMean: null, brier: null, logLoss: null },
      doubleChance: { sampleSize: 0, abstainedCount: 0, accuracy: null, brier: null, logLoss: null },
      over15: emptyGoal,
      over25: emptyGoal,
      btts: emptyGoal,
      goalsProjection: {
        sampleSize: 0,
        predictedHomeMean: null,
        actualHomeMean: null,
        predictedAwayMean: null,
        actualAwayMean: null,
        totalGoalsMAE: null,
        totalGoalsRMSE: null,
      },
    };
  }

  let acc1X2Hits = 0;
  let brier1X2Sum = 0;
  let logLoss1X2Sum = 0;
  const rawSamples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }> = [];
  const calSamples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }> = [];

  let drawTP = 0, drawFP = 0, drawFN = 0;
  let drawBrierSum = 0, drawLossSum = 0, drawPredSum = 0, drawActualCount = 0;

  let dcHits = 0, dcBrierSum = 0, dcLossSum = 0;
  const o15Samples: Array<{ prob01: number; actual: boolean }> = [];
  const o25Samples: Array<{ prob01: number; actual: boolean }> = [];
  const bttsSamples: Array<{ prob01: number; actual: boolean }> = [];

  let predHomeSum = 0, actHomeSum = 0, predAwaySum = 0, actAwaySum = 0;
  let absGoalErrSum = 0, sqGoalErrSum = 0;

  for (const row of evalRows) {
    const hG = row.match.score.home!;
    const aG = row.match.score.away!;
    const winner: 'HOME' | 'DRAW' | 'AWAY' = hG > aG ? 'HOME' : aG > hG ? 'AWAY' : 'DRAW';
    const p = row.phase3.probabilities!;
    const pRaw = row.phase3.rawProbabilities ?? p;

    const pH = p.homeWin / 100;
    const pD = p.draw / 100;
    const pA = p.awayWin / 100;
    const predWinner: 'HOME' | 'DRAW' | 'AWAY' =
      pD >= pH && pD >= pA ? 'DRAW' : pA > pH && pA >= pD ? 'AWAY' : 'HOME';
    if (predWinner === winner) acc1X2Hits++;

    const yH = winner === 'HOME' ? 1 : 0;
    const yD = winner === 'DRAW' ? 1 : 0;
    const yA = winner === 'AWAY' ? 1 : 0;
    brier1X2Sum += Math.pow(pH - yH, 2) + Math.pow(pD - yD, 2) + Math.pow(pA - yA, 2);
    const pActual = Math.max(1e-12, winner === 'HOME' ? pH : winner === 'DRAW' ? pD : pA);
    logLoss1X2Sum += -Math.log(pActual);

    calSamples.push({ pH, pD, pA, winner });
    rawSamples.push({ pH: pRaw.homeWin / 100, pD: pRaw.draw / 100, pA: pRaw.awayWin / 100, winner });

    // Balanced draw signal comparison threshold 0.285
    const isActualDraw = winner === 'DRAW';
    const isPredDraw = pD >= 0.285;
    if (isPredDraw && isActualDraw) drawTP++;
    else if (isPredDraw && !isActualDraw) drawFP++;
    else if (!isPredDraw && isActualDraw) drawFN++;
    if (isActualDraw) drawActualCount++;
    drawPredSum += pD;
    drawBrierSum += computeBrierScore(pD, isActualDraw);
    drawLossSum += computeLogLoss(pD, isActualDraw);

    const pick1X = p.homeOrDraw >= p.awayOrDraw;
    const dcProb01 = (pick1X ? p.homeOrDraw : p.awayOrDraw) / 100;
    const dcActual = pick1X ? winner === 'HOME' || winner === 'DRAW' : winner === 'AWAY' || winner === 'DRAW';
    if (dcActual) dcHits++;
    dcBrierSum += computeBrierScore(dcProb01, dcActual);
    dcLossSum += computeLogLoss(dcProb01, dcActual);

    o15Samples.push({ prob01: p.over15 / 100, actual: hG + aG > 1.5 });
    o25Samples.push({ prob01: p.over25 / 100, actual: hG + aG > 2.5 });
    bttsSamples.push({ prob01: p.bttsYes / 100, actual: hG > 0 && aG > 0 });

    const expH = row.phase3.expectedScore?.home ?? 0;
    const expA = row.phase3.expectedScore?.away ?? 0;
    predHomeSum += expH;
    predAwaySum += expA;
    actHomeSum += hG;
    actAwaySum += aG;
    const err = Math.abs(expH + expA - (hG + aG));
    absGoalErrSum += err;
    sqGoalErrSum += err * err;
  }

  const precision = drawTP + drawFP > 0 ? round1((drawTP / (drawTP + drawFP)) * 100) : null;
  const recall = drawTP + drawFN > 0 ? round1((drawTP / (drawTP + drawFN)) * 100) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? round1((2 * precision * recall) / (precision + recall))
      : null;

  return {
    modelVersion: MODEL_VERSION_PHASE3,
    totalFixtures,
    evaluatedMatches,
    abstainedMatches,
    coveragePct,
    oneXTwo: {
      sampleSize: evaluatedMatches,
      accuracy: round1((acc1X2Hits / evaluatedMatches) * 100),
      brier: round3(brier1X2Sum / evaluatedMatches),
      logLoss: round3(logLoss1X2Sum / evaluatedMatches),
      meanEceRaw: computeMulticlassOneXTwoECE(rawSamples),
      meanEceCalibrated: computeMulticlassOneXTwoECE(calSamples),
    },
    draw: {
      sampleSize: evaluatedMatches,
      precision,
      recall,
      f1,
      actualDrawRate: round1((drawActualCount / evaluatedMatches) * 100),
      predictedDrawMean: round1((drawPredSum / evaluatedMatches) * 100),
      brier: round3(drawBrierSum / evaluatedMatches),
      logLoss: round3(drawLossSum / evaluatedMatches),
    },
    doubleChance: {
      sampleSize: evaluatedMatches,
      abstainedCount: abstainedMatches,
      accuracy: round1((dcHits / evaluatedMatches) * 100),
      brier: round3(dcBrierSum / evaluatedMatches),
      logLoss: round3(dcLossSum / evaluatedMatches),
    },
    over15: buildGoalPairMetrics(o15Samples, abstainedMatches),
    over25: buildGoalPairMetrics(o25Samples, abstainedMatches),
    btts: buildGoalPairMetrics(bttsSamples, abstainedMatches),
    goalsProjection: {
      sampleSize: evaluatedMatches,
      predictedHomeMean: round3(predHomeSum / evaluatedMatches),
      actualHomeMean: round3(actHomeSum / evaluatedMatches),
      predictedAwayMean: round3(predAwaySum / evaluatedMatches),
      actualAwayMean: round3(actAwaySum / evaluatedMatches),
      totalGoalsMAE: round3(absGoalErrSum / evaluatedMatches),
      totalGoalsRMSE: round3(Math.sqrt(sqGoalErrSum / evaluatedMatches)),
    },
  };
}

function summarizePhase4Side(rows: PairedMatchRow[]): ModelSideMetrics {
  const totalFixtures = rows.length;
  const nonGlobalAbstain = rows.filter(
    (r) => r.phase4.abstainScope !== 'MATCH_ABSTAIN' && r.phase4.ensemble.probabilities !== null
  );
  const evaluatedMatches = nonGlobalAbstain.length;
  const abstainedMatches = totalFixtures - evaluatedMatches;
  const coveragePct = totalFixtures > 0 ? round1((evaluatedMatches / totalFixtures) * 100) : 0;

  // 1X2 evaluated strictly where oneXTwo.status === 'AVAILABLE'
  const oneXTwoRows = nonGlobalAbstain.filter(
    (r) => r.phase4.goalMarkets.oneXTwo.status === 'AVAILABLE'
  );
  let acc1X2Hits = 0, brier1X2Sum = 0, logLoss1X2Sum = 0;
  const raw1X2Samples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }> = [];
  const cal1X2Samples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }> = [];

  let drawTP = 0, drawFP = 0, drawFN = 0;
  let drawBrierSum = 0, drawLossSum = 0, drawPredSum = 0, drawActualCount = 0;

  for (const r of oneXTwoRows) {
    const hG = r.match.score.home!;
    const aG = r.match.score.away!;
    const winner: 'HOME' | 'DRAW' | 'AWAY' = hG > aG ? 'HOME' : aG > hG ? 'AWAY' : 'DRAW';
    const gm = r.phase4.goalMarkets.oneXTwo;
    const pH = (gm.homeWin ?? 33.3) / 100;
    const pD = (gm.draw ?? 33.3) / 100;
    const pA = (gm.awayWin ?? 33.4) / 100;
    const predWinner: 'HOME' | 'DRAW' | 'AWAY' =
      pD >= pH && pD >= pA ? 'DRAW' : pA > pH && pA >= pD ? 'AWAY' : 'HOME';
    if (predWinner === winner) acc1X2Hits++;

    brier1X2Sum +=
      Math.pow(pH - (winner === 'HOME' ? 1 : 0), 2) +
      Math.pow(pD - (winner === 'DRAW' ? 1 : 0), 2) +
      Math.pow(pA - (winner === 'AWAY' ? 1 : 0), 2);
    const pAct = Math.max(1e-12, winner === 'HOME' ? pH : winner === 'DRAW' ? pD : pA);
    logLoss1X2Sum += -Math.log(pAct);

    cal1X2Samples.push({ pH, pD, pA, winner });
    raw1X2Samples.push({
      pH: (gm.rawHomeWin ?? gm.homeWin ?? 33.3) / 100,
      pD: (gm.rawDraw ?? gm.draw ?? 33.3) / 100,
      pA: (gm.rawAwayWin ?? gm.awayWin ?? 33.4) / 100,
      winner,
    });

    const isActualDraw = winner === 'DRAW';
    const isPredDraw = r.phase4.drawExperiment.drawSignal;
    if (isPredDraw && isActualDraw) drawTP++;
    else if (isPredDraw && !isActualDraw) drawFP++;
    else if (!isPredDraw && isActualDraw) drawFN++;
    if (isActualDraw) drawActualCount++;
    drawPredSum += pD;
    drawBrierSum += computeBrierScore(pD, isActualDraw);
    drawLossSum += computeLogLoss(pD, isActualDraw);
  }

  // Double Chance evaluated strictly where doubleChance.status === 'AVAILABLE'
  const dcRows = nonGlobalAbstain.filter(
    (r) => r.phase4.goalMarkets.doubleChance.status === 'AVAILABLE'
  );
  let dcHits = 0, dcBrierSum = 0, dcLossSum = 0;
  for (const r of dcRows) {
    const hG = r.match.score.home!;
    const aG = r.match.score.away!;
    const winner: 'HOME' | 'DRAW' | 'AWAY' = hG > aG ? 'HOME' : aG > hG ? 'AWAY' : 'DRAW';
    const p = r.phase4.ensemble.probabilities!;
    const pick1X = p.homeOrDraw >= p.awayOrDraw;
    const dcProb01 = r.phase4.goalMarkets.doubleChance.calibratedProb / 100;
    const dcAct = pick1X ? winner === 'HOME' || winner === 'DRAW' : winner === 'AWAY' || winner === 'DRAW';
    if (dcAct) dcHits++;
    dcBrierSum += computeBrierScore(dcProb01, dcAct);
    dcLossSum += computeLogLoss(dcProb01, dcAct);
  }

  const o15Samples: Array<{ prob01: number; actual: boolean; uncertainty?: number }> = [];
  let o15Abstain = 0;
  const o25Samples: Array<{ prob01: number; actual: boolean; uncertainty?: number }> = [];
  let o25Abstain = 0;
  const bttsSamples: Array<{ prob01: number; actual: boolean; uncertainty?: number }> = [];
  let bttsAbstain = 0;

  let predHomeSum = 0, actHomeSum = 0, predAwaySum = 0, actAwaySum = 0;
  let absGoalErrSum = 0, sqGoalErrSum = 0;

  for (const r of rows) {
    const hG = r.match.score.home!;
    const aG = r.match.score.away!;
    const gm = r.phase4.goalMarkets;

    if (gm.over15.status === 'AVAILABLE') {
      o15Samples.push({
        prob01: gm.over15.calibratedProb / 100,
        actual: hG + aG > 1.5,
        uncertainty: gm.over15.uncertainty,
      });
    } else o15Abstain++;

    if (gm.over25.status === 'AVAILABLE') {
      o25Samples.push({
        prob01: gm.over25.calibratedProb / 100,
        actual: hG + aG > 2.5,
        uncertainty: gm.over25.uncertainty,
      });
    } else o25Abstain++;

    if (gm.btts.status === 'AVAILABLE') {
      bttsSamples.push({
        prob01: gm.btts.calibratedProb / 100,
        actual: hG > 0 && aG > 0,
        uncertainty: gm.btts.uncertainty,
      });
    } else bttsAbstain++;

    if (r.phase4.abstainScope !== 'MATCH_ABSTAIN' && r.phase4.ensemble.expectedGoals.home !== null && r.phase4.ensemble.expectedGoals.away !== null) {
      const expH = r.phase4.ensemble.expectedGoals.home;
      const expA = r.phase4.ensemble.expectedGoals.away;
      predHomeSum += expH;
      predAwaySum += expA;
      actHomeSum += hG;
      actAwaySum += aG;
      const err = Math.abs(expH + expA - (hG + aG));
      absGoalErrSum += err;
      sqGoalErrSum += err * err;
    }
  }

  const n1x2 = oneXTwoRows.length;
  const precision = drawTP + drawFP > 0 ? round1((drawTP / (drawTP + drawFP)) * 100) : null;
  const recall = drawTP + drawFN > 0 ? round1((drawTP / (drawTP + drawFN)) * 100) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? round1((2 * precision * recall) / (precision + recall))
      : null;

  return {
    modelVersion: MODEL_VERSION_PHASE4,
    totalFixtures,
    evaluatedMatches,
    abstainedMatches,
    coveragePct,
    oneXTwo: {
      sampleSize: n1x2,
      accuracy: n1x2 > 0 ? round1((acc1X2Hits / n1x2) * 100) : null,
      brier: n1x2 > 0 ? round3(brier1X2Sum / n1x2) : null,
      logLoss: n1x2 > 0 ? round3(logLoss1X2Sum / n1x2) : null,
      meanEceRaw: computeMulticlassOneXTwoECE(raw1X2Samples),
      meanEceCalibrated: computeMulticlassOneXTwoECE(cal1X2Samples),
    },
    draw: {
      sampleSize: n1x2,
      precision,
      recall,
      f1,
      actualDrawRate: n1x2 > 0 ? round1((drawActualCount / n1x2) * 100) : null,
      predictedDrawMean: n1x2 > 0 ? round1((drawPredSum / n1x2) * 100) : null,
      brier: n1x2 > 0 ? round3(drawBrierSum / n1x2) : null,
      logLoss: n1x2 > 0 ? round3(drawLossSum / n1x2) : null,
    },
    doubleChance: {
      sampleSize: dcRows.length,
      abstainedCount: totalFixtures - dcRows.length,
      accuracy: dcRows.length > 0 ? round1((dcHits / dcRows.length) * 100) : null,
      brier: dcRows.length > 0 ? round3(dcBrierSum / dcRows.length) : null,
      logLoss: dcRows.length > 0 ? round3(dcLossSum / dcRows.length) : null,
    },
    over15: buildGoalPairMetrics(o15Samples, o15Abstain),
    over25: buildGoalPairMetrics(o25Samples, o25Abstain),
    btts: buildGoalPairMetrics(bttsSamples, bttsAbstain),
    goalsProjection: {
      sampleSize: evaluatedMatches,
      predictedHomeMean: evaluatedMatches > 0 ? round3(predHomeSum / evaluatedMatches) : null,
      actualHomeMean: evaluatedMatches > 0 ? round3(actHomeSum / evaluatedMatches) : null,
      predictedAwayMean: evaluatedMatches > 0 ? round3(predAwaySum / evaluatedMatches) : null,
      actualAwayMean: evaluatedMatches > 0 ? round3(actAwaySum / evaluatedMatches) : null,
      totalGoalsMAE: evaluatedMatches > 0 ? round3(absGoalErrSum / evaluatedMatches) : null,
      totalGoalsRMSE: evaluatedMatches > 0 ? round3(Math.sqrt(sqGoalErrSum / evaluatedMatches)) : null,
    },
  };
}

/**
 * Run strictly chronological walk-forward comparison between Frozen Phase 3 and Experimental Phase 4.
 * Accepts arbitrary matches + stats/prediction resolvers so it works cleanly across both UI services and tests.
 */
export async function runChronologicalPhase4Comparison(params: {
  datasetName: string;
  leagueId: string;
  dataSource: string;
  matches: Match[];
  maxMatches?: number | null;
  getMatchStats: (match: Match) => Promise<MatchStatistics>;
  calculatePhase3: (match: Match, stats: MatchStatistics, historyPriors: HistoryRecord[]) => Promise<Prediction>;
}): Promise<Phase4BenchmarkComparison> {
  const { datasetName, leagueId, dataSource, matches, maxMatches, getMatchStats, calculatePhase3 } = params;

  const finished = matches
    .filter(
      (m) =>
        m.score.home !== null &&
        m.score.away !== null &&
        Number.isFinite(new Date(m.utcDate).getTime())
    )
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const targetSlice =
    maxMatches === null || maxMatches === undefined || maxMatches <= 0 || finished.length <= maxMatches
      ? finished
      : finished.slice(-maxMatches);

  const phase3History: HistoryRecord[] = [];
  const phase4History: HistoryRecord[] = [];
  const phase4EvalHistory: EnsemblePriorSample[] = [];
  const pairedRows: PairedMatchRow[] = [];

  let futureViolations = 0;
  let targetXgUsed = 0;

  for (const m of targetSlice) {
    const matchMs = new Date(m.utcDate).getTime();
    const stats = await getMatchStats(m);

    // Explicit causality check on returned stats
    const allPriorDates = [
      ...stats.homeTeamStats.formMatches.map((f) => new Date(f.date).getTime()),
      ...stats.awayTeamStats.formMatches.map((f) => new Date(f.date).getTime()),
    ];
    for (const dt of allPriorDates) {
      if (Number.isFinite(dt) && dt > matchMs) futureViolations++;
    }
    if (stats.observedMatchXG && stats.homeTeamStats.overall.avgXG === stats.observedMatchXG.homeXG) {
      // Only a safeguard check when identical scalar leaks
      if (stats.homeTeamStats.formMatches.length === 0) targetXgUsed++;
    }

    const p3 = await calculatePhase3(m, stats, phase3History);
    const p4 = evaluatePhase4Match(m, stats, {
      phase3Prediction: p3,
      competitionMatches: finished,
      phase4History,
      phase4EvalHistory,
      monteCarloIterations: 1500,
    });

    pairedRows.push({ match: m, phase3: p3, phase4: p4 });

    const hG = m.score.home!;
    const aG = m.score.away!;
    const winner: 'HOME' | 'AWAY' | 'DRAW' = hG > aG ? 'HOME' : aG > hG ? 'AWAY' : 'DRAW';
    const actualResult = {
      finalScore: `${hG} - ${aG}`,
      homeGoals: hG,
      awayGoals: aG,
      winner,
      over15: hG + aG > 1.5,
      over25: hG + aG > 2.5,
      btts: hG > 0 && aG > 0,
    };

    phase3History.push({
      id: `p3-${m.id}`,
      match: m,
      prediction: p3,
      actualResult,
      modelAccuracyNotes: '',
      brierScoreContribution: null,
    });

    const p4AsPred: Prediction = {
      ...p3,
      modelType: p4.abstainScope === 'MATCH_ABSTAIN' ? 'ABSTAIN' : 'ENSEMBLE_VALIDATED',
      probabilities: p4.ensemble.probabilities,
      rawProbabilities: p4.ensemble.rawProbabilities,
      modelEvaluations: p4.ensemble.evaluations,
      expectedScore:
        p4.ensemble.expectedGoals.home !== null && p4.ensemble.expectedGoals.away !== null
          ? {
              home: p4.ensemble.expectedGoals.home,
              away: p4.ensemble.expectedGoals.away,
              mostLikelyScore: p4.ensemble.mostLikelyScore || '1 - 1',
              probability: p4.ensemble.mostLikelyScoreProb ?? 0,
            }
          : null,
    };

    phase4History.push({
      id: `p4-${m.id}`,
      match: m,
      prediction: p4AsPred,
      actualResult,
      modelAccuracyNotes: '',
      brierScoreContribution: null,
    });

    if (p4.abstainScope !== 'MATCH_ABSTAIN' && p4.ensemble.evaluations.length > 0) {
      phase4EvalHistory.push({
        utcDate: m.utcDate,
        actualWinner: winner,
        modelEvaluations: p4.ensemble.evaluations,
      });
    }
  }

  const dates = targetSlice.map((m) => m.utcDate.split('T')[0]).sort();
  const evaluationWindow =
    dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'No fixtures';

  const phase3Metrics = summarizePhase3Side(pairedRows);
  const phase4Metrics = summarizePhase4Side(pairedRows);

  const causalityStatus: Phase4BenchmarkComparison['causalityStatus'] =
    futureViolations === 0 && targetXgUsed === 0
      ? 'STRICT_PRE_KICKOFF_CONFIRMED'
      : 'UNVERIFIED';

  const experimentMetadata: ExperimentReportMetadata = {
    experimentId: PHASE4_EXPERIMENT_ID,
    modelVersion: MODEL_VERSION_PHASE4,
    baselineVersion: MODEL_VERSION_PHASE3,
    parameters: {
      variantBOverallPrior: 12,
      variantBVenuePooling: 12,
      variantBJointReliability: 4,
      negBinBaseShape: 12,
      drawSignalThreshold: 0.285,
      drawMinCausalSamples: 80,
      ensembleMinCausalSamples: 30,
      calibrationMinCausalSamples: 100,
    },
    evaluationWindow,
    dataSources: [dataSource],
    causalityStatus,
    reproducibilitySignature: `${PHASE4_EXPERIMENT_ID}:${leagueId}:${targetSlice.length}:seeded`,
    sampleSize: pairedRows.length,
  };

  return {
    datasetName,
    leagueId,
    evaluationWindow,
    dataSource,
    causalityStatus,
    executedAt: new Date().toISOString(),
    experimentMetadata,
    phase3: phase3Metrics,
    phase4: phase4Metrics,
    leakageChecks: {
      futureDataViolations: futureViolations,
      targetXgUsed,
      verified: causalityStatus === 'STRICT_PRE_KICKOFF_CONFIRMED',
    },
  };
}
