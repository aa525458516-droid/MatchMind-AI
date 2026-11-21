/**
 * Scientific Validation & Calibration Metrics Engine
 * 
 * Implements:
 * 1. Multi-category Brier Score and Log Loss (Cross-Entropy).
 * 2. Calibration curve binning (predicted probability vs observed empirical frequency).
 * 3. Market-by-market accuracy breakdown with benchmark comparison against naive baselines.
 * 4. Identification of scientifically validated >= 80% accuracy target cohorts without result manipulation.
 */

import { HistoryRecord, CalibrationBin, MarketValidationResult, BacktestRun } from '../types/football';

/** Brier score contribution for a single binary forecast: (p - o)^2 */
export function computeBrierScore(prob0to1: number, actual: boolean): number {
  const o = actual ? 1 : 0;
  return Math.pow(prob0to1 - o, 2);
}

/** Log Loss (Cross-Entropy) with epsilon clamping to avoid log(0) */
export function computeLogLoss(prob0to1: number, actual: boolean): number {
  const eps = 1e-15;
  const p = Math.max(eps, Math.min(1 - eps, prob0to1));
  return actual ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Generate empirical calibration curve bins from forecasted probabilities and actual binary outcomes.
 */
export function computeCalibrationCurve(
  samples: Array<{ predictedProb: number; actual: boolean }>
): CalibrationBin[] {
  const binDefinitions = [
    { label: '30% - 45%', min: 30, max: 45 },
    { label: '45% - 55%', min: 45, max: 55 },
    { label: '55% - 65%', min: 55, max: 65 },
    { label: '65% - 75%', min: 65, max: 75 },
    { label: '75% - 85%', min: 75, max: 85 },
    { label: '85% - 100%', min: 85, max: 100 },
  ];

  return binDefinitions.map((bin) => {
    const matching = samples.filter(
      (s) => s.predictedProb >= bin.min && s.predictedProb < bin.max
    );

    if (matching.length === 0) {
      return {
        binRange: bin.label,
        binMin: bin.min,
        binMax: bin.max,
        sampleCount: 0,
        predictedAvgProb: 0,
        observedActualFrequency: 0,
        calibrationError: 0,
      };
    }

    const predictedAvgProb =
      matching.reduce((acc, c) => acc + c.predictedProb, 0) / matching.length;
    const observedCount = matching.filter((m) => m.actual).length;
    const observedActualFrequency = (observedCount / matching.length) * 100;
    const calibrationError = Math.abs(predictedAvgProb - observedActualFrequency);

    return {
      binRange: bin.label,
      binMin: bin.min,
      binMax: bin.max,
      sampleCount: matching.length,
      predictedAvgProb: Math.round(predictedAvgProb * 10) / 10,
      observedActualFrequency: Math.round(observedActualFrequency * 10) / 10,
      calibrationError: Math.round(calibrationError * 10) / 10,
    };
  });
}

/**
 * Perform market-by-market scientific backtesting evaluation against standard baselines.
 * Excludes abstained predictions so abstentions never distort accuracy/Brier metrics.
 */
export function evaluateBacktestPerformance(records: HistoryRecord[]): {
  marketResults: MarketValidationResult[];
  overallBrierScore: number | null;
  overallLogLoss: number | null;
  overallAccuracy: number | null;
  calibrationBins: CalibrationBin[];
  testedCount: number;
  abstainedCount: number;
} {
  const testable = records.filter(
    (r) =>
      r.prediction.modelType !== 'ABSTAIN' &&
      r.prediction.confidence !== null &&
      r.prediction.probabilities !== null
  );
  const abstainedCount = records.length - testable.length;

  if (testable.length === 0) {
    return {
      marketResults: [],
      overallBrierScore: null,
      overallLogLoss: null,
      overallAccuracy: null,
      calibrationBins: [],
      testedCount: 0,
      abstainedCount,
    };
  }

  const n = testable.length;

  // Overall 1X2 argmax winner accuracy across tested matches
  const winnerHits = testable.filter((r) => {
    const probs = r.prediction.probabilities!;
    let predictedWinner: 'HOME' | 'DRAW' | 'AWAY' = 'HOME';
    if (probs.draw >= probs.homeWin && probs.draw >= probs.awayWin) {
      predictedWinner = 'DRAW';
    } else if (probs.awayWin > probs.homeWin && probs.awayWin >= probs.draw) {
      predictedWinner = 'AWAY';
    }
    return predictedWinner === r.actualResult.winner;
  }).length;
  const overallAccuracy = Math.round((winnerHits / n) * 1000) / 10;

  // 1. Home Win Market (1X2)
  const homeWinSamples = testable.map((r) => {
    const prob = r.prediction.probabilities!.homeWin;
    return {
      predictedProb: prob,
      actual: r.actualResult.winner === 'HOME',
      p0to1: prob / 100,
    };
  });
  const homeWinCorrect = homeWinSamples.filter(
    (s) => (s.predictedProb >= 50 && s.actual) || (s.predictedProb < 50 && !s.actual)
  ).length;
  const homeWinAcc = Math.round((homeWinCorrect / n) * 1000) / 10;
  const homeWinBrier =
    homeWinSamples.reduce((a, c) => a + computeBrierScore(c.p0to1, c.actual), 0) / n;
  const homeWinLogLoss =
    homeWinSamples.reduce((a, c) => a + computeLogLoss(c.p0to1, c.actual), 0) / n;

  // 2. Over 1.5 Goals Market
  const over15Samples = testable.map((r) => {
    const prob = r.prediction.probabilities!.over15;
    return {
      predictedProb: prob,
      actual: r.actualResult.over15,
      p0to1: prob / 100,
    };
  });
  const over15Correct = over15Samples.filter(
    (s) => (s.predictedProb >= 50 && s.actual) || (s.predictedProb < 50 && !s.actual)
  ).length;
  const over15Acc = Math.round((over15Correct / n) * 1000) / 10;
  const over15Brier =
    over15Samples.reduce((a, c) => a + computeBrierScore(c.p0to1, c.actual), 0) / n;
  const over15LogLoss =
    over15Samples.reduce((a, c) => a + computeLogLoss(c.p0to1, c.actual), 0) / n;

  // 3. Over 2.5 Goals Market
  const over25Samples = testable.map((r) => {
    const prob = r.prediction.probabilities!.over25;
    return {
      predictedProb: prob,
      actual: r.actualResult.over25,
      p0to1: prob / 100,
    };
  });
  const over25Correct = over25Samples.filter(
    (s) => (s.predictedProb >= 50 && s.actual) || (s.predictedProb < 50 && !s.actual)
  ).length;
  const over25Acc = Math.round((over25Correct / n) * 1000) / 10;
  const over25Brier =
    over25Samples.reduce((a, c) => a + computeBrierScore(c.p0to1, c.actual), 0) / n;
  const over25LogLoss =
    over25Samples.reduce((a, c) => a + computeLogLoss(c.p0to1, c.actual), 0) / n;

  // 4. Both Teams to Score (BTTS)
  const bttsSamples = testable.map((r) => {
    const prob = r.prediction.probabilities!.bttsYes;
    return {
      predictedProb: prob,
      actual: r.actualResult.btts,
      p0to1: prob / 100,
    };
  });
  const bttsCorrect = bttsSamples.filter(
    (s) => (s.predictedProb >= 50 && s.actual) || (s.predictedProb < 50 && !s.actual)
  ).length;
  const bttsAcc = Math.round((bttsCorrect / n) * 1000) / 10;
  const bttsBrier =
    bttsSamples.reduce((a, c) => a + computeBrierScore(c.p0to1, c.actual), 0) / n;
  const bttsLogLoss =
    bttsSamples.reduce((a, c) => a + computeLogLoss(c.p0to1, c.actual), 0) / n;

  // 5. Double Chance (1X or X2 favored)
  const dcSamples = testable.map((r) => {
    const probs = r.prediction.probabilities!;
    const pickHomeOrDraw = probs.homeOrDraw >= probs.awayOrDraw;
    const predProb = pickHomeOrDraw ? probs.homeOrDraw : probs.awayOrDraw;
    const actualHit = pickHomeOrDraw
      ? r.actualResult.winner === 'HOME' || r.actualResult.winner === 'DRAW'
      : r.actualResult.winner === 'AWAY' || r.actualResult.winner === 'DRAW';
    return {
      predictedProb: predProb,
      actual: actualHit,
      p0to1: predProb / 100,
    };
  });
  const dcCorrect = dcSamples.filter((s) => s.actual).length;
  const dcAcc = Math.round((dcCorrect / n) * 1000) / 10;
  const dcBrier =
    dcSamples.reduce((a, c) => a + computeBrierScore(c.p0to1, c.actual), 0) / n;
  const dcLogLoss =
    dcSamples.reduce((a, c) => a + computeLogLoss(c.p0to1, c.actual), 0) / n;

  // Measure actual empirical naive home-bias baseline directly on the tested dataset
  const actualHomeRate =
    Math.round(
      (testable.filter((r) => r.actualResult.winner === 'HOME').length / n) * 1000
    ) / 10;
  const actualHomeOrDrawRate =
    Math.round(
      (testable.filter(
        (r) => r.actualResult.winner === 'HOME' || r.actualResult.winner === 'DRAW'
      ).length /
        n) *
        1000
    ) / 10;
  const actualOver15Rate =
    Math.round((testable.filter((r) => r.actualResult.over15).length / n) * 1000) / 10;
  const actualOver25Rate =
    Math.round((testable.filter((r) => r.actualResult.over25).length / n) * 1000) / 10;
  const actualBttsRate =
    Math.round((testable.filter((r) => r.actualResult.btts).length / n) * 1000) / 10;

  const marketResults: MarketValidationResult[] = [
    {
      marketKey: 'DOUBLE_CHANCE',
      marketLabel: 'Double Chance (1X / X2 Favored)',
      totalPredictions: n,
      correctPredictions: dcCorrect,
      accuracyPercentage: dcAcc,
      brierScore: Math.round(dcBrier * 1000) / 1000,
      logLoss: Math.round(dcLogLoss * 1000) / 1000,
      baselineComparison: {
        randomBaselineAccuracy: 66.7,
        homeBiasBaselineAccuracy: actualHomeOrDrawRate,
        accuracyAdvantage: Math.round((dcAcc - actualHomeOrDrawRate) * 10) / 10,
      },
      isTargetCategory: true,
      targetAchievementStatus: n >= 20 && dcAcc >= 80.0 ? 'ACHIEVED' : 'RESEARCH_IN_PROGRESS',
    },
    {
      marketKey: 'OVER_15',
      marketLabel: 'Goal Floor (Over 1.5 Goals)',
      totalPredictions: n,
      correctPredictions: over15Correct,
      accuracyPercentage: over15Acc,
      brierScore: Math.round(over15Brier * 1000) / 1000,
      logLoss: Math.round(over15LogLoss * 1000) / 1000,
      baselineComparison: {
        randomBaselineAccuracy: 50.0,
        homeBiasBaselineAccuracy: actualOver15Rate,
        accuracyAdvantage: Math.round((over15Acc - actualOver15Rate) * 10) / 10,
      },
      isTargetCategory: true,
      targetAchievementStatus: n >= 20 && over15Acc >= 80.0 ? 'ACHIEVED' : 'RESEARCH_IN_PROGRESS',
    },
    {
      marketKey: 'OVER_25',
      marketLabel: 'Over 2.5 Match Goals',
      totalPredictions: n,
      correctPredictions: over25Correct,
      accuracyPercentage: over25Acc,
      brierScore: Math.round(over25Brier * 1000) / 1000,
      logLoss: Math.round(over25LogLoss * 1000) / 1000,
      baselineComparison: {
        randomBaselineAccuracy: 50.0,
        homeBiasBaselineAccuracy: actualOver25Rate,
        accuracyAdvantage: Math.round((over25Acc - actualOver25Rate) * 10) / 10,
      },
      isTargetCategory: false,
      targetAchievementStatus: n >= 20 && over25Acc >= 80.0 ? 'ACHIEVED' : 'RESEARCH_IN_PROGRESS',
    },
    {
      marketKey: 'HOME_WIN',
      marketLabel: 'Match Winner 1X2 (Home Win)',
      totalPredictions: n,
      correctPredictions: homeWinCorrect,
      accuracyPercentage: homeWinAcc,
      brierScore: Math.round(homeWinBrier * 1000) / 1000,
      logLoss: Math.round(homeWinLogLoss * 1000) / 1000,
      baselineComparison: {
        randomBaselineAccuracy: 33.3,
        homeBiasBaselineAccuracy: actualHomeRate,
        accuracyAdvantage: Math.round((homeWinAcc - actualHomeRate) * 10) / 10,
      },
      isTargetCategory: false,
      targetAchievementStatus: n >= 20 && homeWinAcc >= 80.0 ? 'ACHIEVED' : 'RESEARCH_IN_PROGRESS',
    },
    {
      marketKey: 'BTTS',
      marketLabel: 'Both Teams To Score (BTTS)',
      totalPredictions: n,
      correctPredictions: bttsCorrect,
      accuracyPercentage: bttsAcc,
      brierScore: Math.round(bttsBrier * 1000) / 1000,
      logLoss: Math.round(bttsLogLoss * 1000) / 1000,
      baselineComparison: {
        randomBaselineAccuracy: 50.0,
        homeBiasBaselineAccuracy: actualBttsRate,
        accuracyAdvantage: Math.round((bttsAcc - actualBttsRate) * 10) / 10,
      },
      isTargetCategory: false,
      targetAchievementStatus: n >= 20 && bttsAcc >= 80.0 ? 'ACHIEVED' : 'RESEARCH_IN_PROGRESS',
    },
  ];

  const allCalibrationSamples = [
    ...homeWinSamples,
    ...over15Samples,
    ...over25Samples,
    ...bttsSamples,
    ...dcSamples,
  ];
  const calibrationBins = computeCalibrationCurve(allCalibrationSamples);

  const overallBrierScore =
    Math.round(
      ((homeWinBrier + over15Brier + over25Brier + bttsBrier + dcBrier) / 5) * 1000
    ) / 1000;

  const overallLogLoss =
    Math.round(
      ((homeWinLogLoss + over15LogLoss + over25LogLoss + bttsLogLoss + dcLogLoss) / 5) * 1000
    ) / 1000;

  return {
    marketResults,
    overallBrierScore,
    overallLogLoss,
    overallAccuracy,
    calibrationBins,
    testedCount: n,
    abstainedCount,
  };
}

