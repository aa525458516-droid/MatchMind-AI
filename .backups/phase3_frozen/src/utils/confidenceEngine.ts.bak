/**
 * 4-Pillar Smart Confidence & Abstention Engine
 *
 * Evaluates strictly measurable properties:
 * 1. Model Probability (raw mathematical likelihood)
 * 2. Historical Accuracy (ONLY from an executed empirical backtest; null if unavailable)
 * 3. Data Reliability (sample size, xG/goal completeness, empirical Elo, rest days, freshness)
 * 4. Model Agreement (consensus across models that actually produced valid probabilities)
 *
 * Enforces ABSTENTION when sample size < 5 or data/model agreement falls below bounds.
 */

import {
  MarketProbabilities,
  SingleModelEvaluation,
  TeamStatistics,
  ConfidencePillars,
} from '../types/football';

export interface EmpiricalBacktestReference {
  doubleChanceAccuracy?: number | null;
  over15Accuracy?: number | null;
  homeWinAccuracy?: number | null;
  brierScoreOverall?: number | null;
}

function isFiniteProb(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100;
}

export function computeSmartConfidence(
  probabilities: MarketProbabilities | null,
  modelEvaluations: SingleModelEvaluation[],
  homeStats: TeamStatistics,
  awayStats: TeamStatistics,
  empiricalBacktest?: EmpiricalBacktestReference | null
): ConfidencePillars {
  const homeSampleSize = homeStats.formMatches?.length ?? 0;
  const awaySampleSize = awayStats.formMatches?.length ?? 0;
  const minSample = Math.min(homeSampleSize, awaySampleSize);

  // Measure data completeness deterministically (0-100)
  let reliability = 0;

  // 1. Sample size (up to 40 pts)
  if (minSample >= 10) reliability += 40;
  else if (minSample >= 5) reliability += 25 + Math.round(((minSample - 5) / 5) * 10);

  // 2. Goal / xG completeness (up to 25 pts)
  const hasRealXG =
    typeof homeStats.overall?.avgXG === 'number' &&
    Number.isFinite(homeStats.overall.avgXG) &&
    typeof awayStats.overall?.avgXGA === 'number' &&
    Number.isFinite(awayStats.overall.avgXGA);
  const hasVerifiedGoals =
    typeof homeStats.overall?.matchesPlayed === 'number' &&
    Number.isFinite(homeStats.overall.matchesPlayed) &&
    homeStats.overall.matchesPlayed >= 5 &&
    typeof awayStats.overall?.matchesPlayed === 'number' &&
    Number.isFinite(awayStats.overall.matchesPlayed) &&
    awayStats.overall.matchesPlayed >= 5;
  if (hasRealXG) reliability += 25;
  else if (hasVerifiedGoals) reliability += 15;

  // 3. Empirical Elo availability (up to 15 pts)
  if (
    typeof homeStats.eloRating === 'number' &&
    Number.isFinite(homeStats.eloRating) &&
    typeof awayStats.eloRating === 'number' &&
    Number.isFinite(awayStats.eloRating)
  ) {
    reliability += 15;
  }

  // 4. Measurable rest days & freshness (up to 10 pts)
  if (
    typeof homeStats.restDays === 'number' &&
    Number.isFinite(homeStats.restDays) &&
    typeof awayStats.restDays === 'number' &&
    Number.isFinite(awayStats.restDays)
  ) {
    reliability += 10;
  }

  // 5. Verified lineup / injury tracking (up to 10 pts)
  if (
    homeStats.confirmedLineupAvailable === true &&
    awayStats.confirmedLineupAvailable === true &&
    typeof homeStats.injuriesCount === 'number' &&
    Number.isFinite(homeStats.injuriesCount) &&
    typeof awayStats.injuriesCount === 'number' &&
    Number.isFinite(awayStats.injuriesCount)
  ) {
    reliability += 10;
  }

  const dataReliability = Math.min(100, reliability);

  const hasValidProbabilities =
    probabilities !== null &&
    isFiniteProb(probabilities.homeWin) &&
    isFiniteProb(probabilities.draw) &&
    isFiniteProb(probabilities.awayWin) &&
    isFiniteProb(probabilities.homeOrDraw) &&
    isFiniteProb(probabilities.awayOrDraw) &&
    isFiniteProb(probabilities.over15) &&
    isFiniteProb(probabilities.over25) &&
    isFiniteProb(probabilities.bttsYes);

  // Insufficient sample size or invalid/non-finite probabilities -> immediate ABSTAIN
  if (!hasValidProbabilities || minSample < 5) {
    return {
      modelProbability: null,
      historicalAccuracy: null,
      dataReliability,
      modelAgreement: null,
      decision: 'ABSTAIN_DATA_DEFICIT',
      abstainReason:
        !probabilities || minSample < 5
          ? `Insufficient verified pre-match sample size (home: ${homeSampleSize}, away: ${awaySampleSize}; minimum required: 5).`
          : 'Invalid or non-finite probability distribution; prediction abstained for data integrity.',
    };
  }

  // Pillar 1: Peak model likelihood
  const top1X2 = Math.max(probabilities.homeWin, probabilities.draw, probabilities.awayWin);
  const topDC = Math.max(probabilities.homeOrDraw, probabilities.awayOrDraw);
  const modelProbability = Math.round(Math.max(top1X2, topDC) * 10) / 10;

  // Pillar 2: Historical accuracy ONLY from an actual completed backtest run
  let historicalAccuracy: number | null = null;
  if (empiricalBacktest) {
    let candidate: number | null | undefined = null;
    if (probabilities.homeOrDraw >= 75 || probabilities.awayOrDraw >= 75) {
      candidate = empiricalBacktest.doubleChanceAccuracy;
    } else if (probabilities.over15 >= 78) {
      candidate = empiricalBacktest.over15Accuracy;
    } else {
      candidate = empiricalBacktest.homeWinAccuracy;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      historicalAccuracy = candidate;
    }
  }

  // Pillar 4: Model agreement across evaluated models with finite probabilities
  const finiteEvaluations = modelEvaluations.filter((m) => isFiniteProb(m.homeWinProb));
  let agreementScore: number | null = null;
  if (finiteEvaluations.length >= 2) {
    const homeWinProbs = finiteEvaluations.map((m) => m.homeWinProb);
    const mean = homeWinProbs.reduce((a, b) => a + b, 0) / homeWinProbs.length;
    const variance =
      homeWinProbs.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / homeWinProbs.length;
    const stdDev = Math.sqrt(variance);
    agreementScore = Math.max(20, Math.min(99, Math.round((1 - stdDev / 25) * 100)));
  }

  // Decision logic
  let decision: ConfidencePillars['decision'] = 'MODERATE_SIGNAL';
  let abstainReason: string | undefined;
  let targetCategoryTier: string | undefined;

  if (dataReliability < 50) {
    decision = 'ABSTAIN_DATA_DEFICIT';
    abstainReason = `Data completeness below reliability threshold (${dataReliability}/100; minimum 50 required).`;
  } else if (agreementScore !== null && agreementScore < 55) {
    decision = 'ABSTAIN_UNCERTAINTY';
    abstainReason = `Model divergence exceeds uncertainty threshold (Consensus index: ${agreementScore}%).`;
  } else if (
    dataReliability >= 70 &&
    (agreementScore === null || agreementScore >= 70) &&
    modelProbability >= 70
  ) {
    decision = 'RECOMMENDED_ANALYSIS';
    targetCategoryTier =
      probabilities.homeOrDraw >= 75 || probabilities.awayOrDraw >= 75
        ? 'High-Signal Double Chance (1X/X2)'
        : 'High-Signal Goal / Match Outcome';
  }

  return {
    modelProbability,
    historicalAccuracy,
    dataReliability,
    modelAgreement: agreementScore,
    decision,
    abstainReason,
    targetCategoryTier,
  };
}

