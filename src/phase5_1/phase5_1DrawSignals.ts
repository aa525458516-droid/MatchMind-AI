import { MatchStatistics } from '../types/football';
import { Phase5CausalPriors } from '../phase5/phase5Types';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { DrawFeatureUsefulnessEntry, Phase5_1DrawSignalFeatures } from './phase5_1Types';

const EPS = 1e-6;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.26;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function logit(p: number): number {
  const c = clamp01(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z > 30) return 1 - EPS;
  if (z < -30) return EPS;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Extract strictly pre-kickoff (< T) draw signal features.
 * Zero access to target match score, observedMatchXG, events, or future fixtures.
 */
export function extractPhase5_1DrawSignals(params: {
  stats: MatchStatistics;
  priors: Phase5CausalPriors;
  shrunkLambdaHome: number | null;
  shrunkLambdaAway: number | null;
}): Phase5_1DrawSignalFeatures {
  const { stats, priors, shrunkLambdaHome, shrunkLambdaAway } = params;

  if (
    !priors.validTimestamp ||
    shrunkLambdaHome === null ||
    shrunkLambdaAway === null ||
    !Number.isFinite(shrunkLambdaHome) ||
    !Number.isFinite(shrunkLambdaAway)
  ) {
    return {
      valid: false,
      lambdaHome: null,
      lambdaAway: null,
      absStrengthDiff: null,
      expectedGoalDiff: null,
      absExpectedGoalDiff: null,
      totalExpectedGoals: null,
      poissonDrawProb01: null,
      historicalLeagueDrawRate01: null,
      teamStrengthUncertainty: null,
      venueNormalizedStrengthDiff: null,
      shrunkAttackDefenseSymmetry: null,
      lowScoringIndex: null,
      eloAbsDiffCausal: null,
      eloSymmetry: null,
      homeDrawRateCausal: null,
      awayDrawRateCausal: null,
    };
  }

  const lH = Math.max(0.25, Math.min(4.2, shrunkLambdaHome));
  const lA = Math.max(0.25, Math.min(4.2, shrunkLambdaAway));
  const expectedGoalDiff = lH - lA;
  const absExpectedGoalDiff = Math.abs(expectedGoalDiff);
  const totalExpectedGoals = lH + lA;

  // Bivariate Poisson-Dixon-Coles draw probability strictly from pre-match shrunk lambdas
  const poissonDC = calculatePoissonProbabilities(lH, lA, 7, true).markets;
  const poissonDrawProb01 = clamp01(poissonDC.draw / 100);

  // Hierarchical Bayesian league draw prior strictly < T (K=20 toward 0.26)
  const K_DRAW = 20;
  const historicalLeagueDrawRate01 =
    priors.priorLeagueMatches > 0 && priors.leagueDrawRate !== null
      ? (priors.leagueDrawRate * priors.priorLeagueMatches + K_DRAW * 0.26) /
        (priors.priorLeagueMatches + K_DRAW)
      : 0.26;

  // Pre-match sample depth & team strength uncertainty
  const homePlayed = Math.max(
    stats.homeTeamStats.overall.matchesPlayed,
    priors.homeTeamPriors.played
  );
  const awayPlayed = Math.max(
    stats.awayTeamStats.overall.matchesPlayed,
    priors.awayTeamPriors.played
  );
  const minPlayed = Math.max(0, Math.min(homePlayed, awayPlayed));
  const teamStrengthUncertainty = 1 / Math.sqrt(minPlayed + 4);

  // Causal Elo absolute difference & symmetry (strictly from < T matches)
  const hasElo =
    priors.homeEloCausal !== null &&
    priors.awayEloCausal !== null &&
    Number.isFinite(priors.homeEloCausal) &&
    Number.isFinite(priors.awayEloCausal);
  const eloAbsDiffCausal = hasElo
    ? Math.abs(priors.homeEloCausal! + 55 - priors.awayEloCausal!)
    : null;
  const eloSymmetry =
    eloAbsDiffCausal !== null ? Math.exp(-Math.pow(eloAbsDiffCausal / 280, 2)) : null;

  // Shrinkage-adjusted attack/defense symmetry across sides
  const scaleTotal = Math.max(0.9, totalExpectedGoals * 0.45);
  const shrunkAttackDefenseSymmetry = Math.exp(-absExpectedGoalDiff / scaleTotal);

  // Combined absolute strength difference (standardized composite in ~[0, 3])
  const absStrengthDiff =
    eloAbsDiffCausal !== null
      ? 0.6 * (absExpectedGoalDiff / 0.55) + 0.4 * (eloAbsDiffCausal / 160)
      : absExpectedGoalDiff / 0.55;

  // Venue-normalized pre-match net goal strength difference (with K=6 partial pooling toward overall)
  const computeVenueNet = (
    teamSummary: typeof priors.homeTeamPriors,
    fallbackOverall: { matchesPlayed: number; goalsScored: number; goalsConceded: number },
    fallbackVenue: { matchesPlayed: number; goalsScored: number; goalsConceded: number }
  ): number => {
    const oP = Math.max(teamSummary.played, fallbackOverall.matchesPlayed);
    const oGf = teamSummary.played > 0 ? teamSummary.scored : fallbackOverall.goalsScored;
    const oGa = teamSummary.played > 0 ? teamSummary.conceded : fallbackOverall.goalsConceded;
    const vP = Math.max(teamSummary.venuePlayed, fallbackVenue.matchesPlayed);
    const vGf = teamSummary.venuePlayed > 0 ? teamSummary.venueScored : fallbackVenue.goalsScored;
    const vGa = teamSummary.venuePlayed > 0 ? teamSummary.venueConceded : fallbackVenue.goalsConceded;

    const overallNet = oP > 0 ? (oGf - oGa) / (oP + 4) : 0;
    const venueNet = vP > 0 ? (vGf - vGa) / (vP + 3) : overallNet;
    const wVenue = vP / (vP + 6);
    return wVenue * venueNet + (1 - wVenue) * overallNet;
  };

  const homeVenueNet = computeVenueNet(
    priors.homeTeamPriors,
    stats.homeTeamStats.overall,
    stats.homeTeamStats.homeOrAwaySplit
  );
  const awayVenueNet = computeVenueNet(
    priors.awayTeamPriors,
    stats.awayTeamStats.overall,
    stats.awayTeamStats.homeOrAwaySplit
  );
  const venueNormalizedStrengthDiff = Math.abs(homeVenueNet - awayVenueNet);

  // Low-scoring tendency index
  const lowScoringIndex = Math.exp(-0.5 * Math.max(0, totalExpectedGoals - 1.9));

  // Shrunk causal team draw rates (Bayesian K=10 toward historicalLeagueDrawRate01)
  const homeDrawRateCausal =
    (priors.homeTeamPriors.draws + 10 * historicalLeagueDrawRate01) /
    (priors.homeTeamPriors.played + 10);
  const awayDrawRateCausal =
    (priors.awayTeamPriors.draws + 10 * historicalLeagueDrawRate01) /
    (priors.awayTeamPriors.played + 10);

  return {
    valid: true,
    lambdaHome: Math.round(lH * 1000) / 1000,
    lambdaAway: Math.round(lA * 1000) / 1000,
    absStrengthDiff: Math.round(absStrengthDiff * 1000) / 1000,
    expectedGoalDiff: Math.round(expectedGoalDiff * 1000) / 1000,
    absExpectedGoalDiff: Math.round(absExpectedGoalDiff * 1000) / 1000,
    totalExpectedGoals: Math.round(totalExpectedGoals * 1000) / 1000,
    poissonDrawProb01: Math.round(poissonDrawProb01 * 10000) / 10000,
    historicalLeagueDrawRate01: Math.round(historicalLeagueDrawRate01 * 10000) / 10000,
    teamStrengthUncertainty: Math.round(teamStrengthUncertainty * 1000) / 1000,
    venueNormalizedStrengthDiff: Math.round(venueNormalizedStrengthDiff * 1000) / 1000,
    shrunkAttackDefenseSymmetry: Math.round(shrunkAttackDefenseSymmetry * 1000) / 1000,
    lowScoringIndex: Math.round(lowScoringIndex * 1000) / 1000,
    eloAbsDiffCausal: eloAbsDiffCausal !== null ? Math.round(eloAbsDiffCausal) : null,
    eloSymmetry: eloSymmetry !== null ? Math.round(eloSymmetry * 1000) / 1000 : null,
    homeDrawRateCausal: Math.round(homeDrawRateCausal * 1000) / 1000,
    awayDrawRateCausal: Math.round(awayDrawRateCausal * 1000) / 1000,
  };
}

/**
 * Compute Mann-Whitney / Wilcoxon ROC-AUC for a univariate numeric feature.
 */
function computeUnivariateAuc(values: Array<{ x: number; y: boolean }>): number | null {
  const pos = values.filter((v) => v.y);
  const neg = values.filter((v) => !v.y);
  if (pos.length === 0 || neg.length === 0) return null;

  let wins = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (p.x > q.x) wins += 1;
      else if (p.x === q.x) wins += 0.5;
    }
  }
  const auc = wins / (pos.length * neg.length);
  return Math.round(Math.max(auc, 1 - auc) * 1000) / 1000;
}

/**
 * Evaluate each draw signal feature independently via causal 3-fold walk-forward univariate logistic regression
 * vs the league draw prior baseline.
 */
export function auditDrawFeatureUsefulness(
  rows: Array<{
    features: Phase5_1DrawSignalFeatures;
    isDraw: boolean;
    leaguePrior01: number;
  }>
): DrawFeatureUsefulnessEntry[] {
  const specs: Array<{ name: string; extract: (f: Phase5_1DrawSignalFeatures) => number | null }> = [
    { name: 'poissonDrawProb01', extract: (f) => f.poissonDrawProb01 },
    { name: 'absStrengthDiff', extract: (f) => f.absStrengthDiff },
    { name: 'absExpectedGoalDiff', extract: (f) => f.absExpectedGoalDiff },
    { name: 'totalExpectedGoals', extract: (f) => f.totalExpectedGoals },
    { name: 'venueNormalizedStrengthDiff', extract: (f) => f.venueNormalizedStrengthDiff },
    { name: 'shrunkAttackDefenseSymmetry', extract: (f) => f.shrunkAttackDefenseSymmetry },
    { name: 'lowScoringIndex', extract: (f) => f.lowScoringIndex },
    { name: 'historicalLeagueDrawRate01', extract: (f) => f.historicalLeagueDrawRate01 },
    { name: 'teamStrengthUncertainty', extract: (f) => f.teamStrengthUncertainty },
    { name: 'eloSymmetry', extract: (f) => f.eloSymmetry },
    {
      name: 'avgTeamDrawRateCausal',
      extract: (f) =>
        f.homeDrawRateCausal !== null && f.awayDrawRateCausal !== null
          ? (f.homeDrawRateCausal + f.awayDrawRateCausal) / 2
          : null,
    },
  ];

  const validBase = rows.filter((r) => r.features.valid);
  if (validBase.length < 30) return [];

  return specs.map((spec) => {
    const pts = validBase
      .map((r) => ({
        x: spec.extract(r.features),
        y: r.isDraw,
        baseP: clamp01(r.leaguePrior01),
      }))
      .filter((p): p is { x: number; y: boolean; baseP: number } => p.x !== null && Number.isFinite(p.x));

    if (pts.length < 30) {
      return {
        featureName: spec.name,
        sampleSize: pts.length,
        meanOnDraws: null,
        meanOnNonDraws: null,
        correlationWithDraw: null,
        rocAuc: null,
        univariateCvLogLoss: null,
        baselineLogLoss: null,
        logLossDelta: null,
      };
    }

    const pos = pts.filter((p) => p.y);
    const neg = pts.filter((p) => !p.y);
    const meanOnDraws = pos.length > 0 ? pos.reduce((a, p) => a + p.x, 0) / pos.length : null;
    const meanOnNonDraws = neg.length > 0 ? neg.reduce((a, p) => a + p.x, 0) / neg.length : null;

    const meanX = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const meanY = pos.length / pts.length;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (const p of pts) {
      const dx = p.x - meanX;
      const dy = (p.y ? 1 : 0) - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const corr = denX > 1e-12 && denY > 1e-12 ? num / Math.sqrt(denX * denY) : 0;

    // 3-fold blocked causal CV for univariate logistic offset on top of logit(leaguePrior)
    const k = 3;
    const foldSize = Math.floor(pts.length / k);
    let uniLoss = 0;
    let baseLoss = 0;
    let cvN = 0;

    for (let fold = 0; fold < k; fold++) {
      const start = fold * foldSize;
      const end = fold === k - 1 ? pts.length : (fold + 1) * foldSize;
      const val = pts.slice(start, end);
      const train = [...pts.slice(0, start), ...pts.slice(end)];

      const trMean = train.reduce((a, p) => a + p.x, 0) / train.length;
      const trVar = train.reduce((a, p) => a + (p.x - trMean) ** 2, 0) / train.length;
      const trStd = Math.max(1e-4, Math.sqrt(trVar));

      let b0 = 0;
      let b1 = 0;
      const reg = 10.0;
      const lr = 0.15;
      for (let it = 0; it < 50; it++) {
        let g0 = (reg * b0) / train.length;
        let g1 = (reg * b1) / train.length;
        for (const s of train) {
          const z = (s.x - trMean) / trStd;
          const pred = sigmoid(logit(s.baseP) + b0 + b1 * z);
          const err = pred - (s.y ? 1 : 0);
          g0 += err / train.length;
          g1 += (err * z) / train.length;
        }
        const step = lr / (1 + it * 0.04);
        b0 = Math.max(-0.8, Math.min(0.8, b0 - step * g0));
        b1 = Math.max(-1.2, Math.min(1.2, b1 - step * g1));
      }

      for (const s of val) {
        const z = (s.x - trMean) / trStd;
        const pUni = clamp01(sigmoid(logit(s.baseP) + b0 + b1 * z));
        const pBase = clamp01(s.baseP);
        uniLoss += s.y ? -Math.log(pUni) : -Math.log(1 - pUni);
        baseLoss += s.y ? -Math.log(pBase) : -Math.log(1 - pBase);
        cvN++;
      }
    }

    const avgUni = cvN > 0 ? uniLoss / cvN : null;
    const avgBase = cvN > 0 ? baseLoss / cvN : null;

    return {
      featureName: spec.name,
      sampleSize: pts.length,
      meanOnDraws: meanOnDraws !== null ? Math.round(meanOnDraws * 1000) / 1000 : null,
      meanOnNonDraws: meanOnNonDraws !== null ? Math.round(meanOnNonDraws * 1000) / 1000 : null,
      correlationWithDraw: Math.round(corr * 1000) / 1000,
      rocAuc: computeUnivariateAuc(pts.map((p) => ({ x: p.x, y: p.y }))),
      univariateCvLogLoss: avgUni !== null ? Math.round(avgUni * 10000) / 10000 : null,
      baselineLogLoss: avgBase !== null ? Math.round(avgBase * 10000) / 10000 : null,
      logLossDelta:
        avgUni !== null && avgBase !== null ? Math.round((avgUni - avgBase) * 10000) / 10000 : null,
    };
  });
}
