import { Match, MatchStatistics } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { extractVariantBProjection } from '../phase4/variantBExtractor';
import { BinaryCalibSample, calibratePhase5Binary } from './phase5Calibration';
import { computeNormalizedBivariateNegBin } from './phase5O25Model';
import { Phase5BttsVariantComparison, Phase5CausalPriors } from './phase5Types';

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0.02, Math.min(0.98, p));
}

/**
 * Evaluate Phase 5C BTTS Research Model independently of Over 2.5, comparing:
 * A) Existing Phase 3 Poisson-DC BTTS
 * B) Independent Attack/Defense Scoring & Conceding (Clean-sheet / Failed-to-score) Causal Model
 * C) Normalized Negative Binomial + Dixon-Coles BTTS
 * D) Causally Calibrated BTTS (< T)
 */
export function evaluatePhase5BttsModel(params: {
  match: Match;
  stats: MatchStatistics;
  competitionMatches: Match[];
  priors: Phase5CausalPriors;
  bttsHistory: BinaryCalibSample[];
}): Phase5BttsVariantComparison {
  const { match, stats, competitionMatches, priors, bttsHistory } = params;
  const p3H = stats.homeExpectedGoals;
  const p3A = stats.awayExpectedGoals;

  if (!priors.validTimestamp || p3H === null || p3A === null || !Number.isFinite(p3H) || !Number.isFinite(p3A)) {
    return {
      variantAExistingPct: null,
      variantBIndependentPct: null,
      variantCNegBinPct: null,
      variantDCalibratedPct: null,
      homeScoringProbPct: null,
      awayScoringProbPct: null,
      selectedRawPct: null,
      selectedFinalPct: null,
      calibrationMethod: 'RAW_IDENTITY',
      calibrationStatus: 'NOT_TRAINED',
      calibrationSamplesUsed: 0,
      uncertainty: null,
    };
  }

  // Variant A: Existing Phase 3 Poisson-DC BTTS
  const variantA01 = calculatePoissonProbabilities(p3H, p3A, 7, true).markets.bttsYes / 100;

  // Shrunk Variant-B lambdas (< T)
  const vbProj = extractVariantBProjection(match, stats, competitionMatches);
  const lambdaH = vbProj.lambdas?.homeExpectedGoals ?? p3H;
  const lambdaA = vbProj.lambdas?.awayExpectedGoals ?? p3A;

  // Variant C: Exact Normalized NegBin + Dixon-Coles BTTS
  const nbRes = computeNormalizedBivariateNegBin(
    lambdaH,
    lambdaA,
    priors.causalDispersionHome,
    priors.causalDispersionAway
  );
  const variantC01 = nbRes.bttsYes01;

  // Variant B: Independent Attack/Defense Scoring & Failed-to-Score / Clean-Sheet Causal Model
  // Shrinks team's actual empirical P(scored >= 1) and opponent's P(conceded >= 1) toward causal league base rates
  const leagueHomeScorePrior = priors.leagueHomeScoredAnyRate ?? 0.72;
  const leagueAwayScorePrior = priors.leagueAwayScoredAnyRate ?? 0.65;
  const K_SCORING = 8;

  const hP = priors.homeTeamPriors;
  const aP = priors.awayTeamPriors;

  const homeAttScoreRate =
    hP.played > 0
      ? (hP.played - hP.failedToScore + K_SCORING * leagueHomeScorePrior) / (hP.played + K_SCORING)
      : leagueHomeScorePrior;
  const awayDefConcedeRate =
    aP.played > 0
      ? (aP.played - aP.cleanSheets + K_SCORING * leagueHomeScorePrior) / (aP.played + K_SCORING)
      : leagueHomeScorePrior;

  const awayAttScoreRate =
    aP.played > 0
      ? (aP.played - aP.failedToScore + K_SCORING * leagueAwayScorePrior) / (aP.played + K_SCORING)
      : leagueAwayScorePrior;
  const homeDefConcedeRate =
    hP.played > 0
      ? (hP.played - hP.cleanSheets + K_SCORING * leagueAwayScorePrior) / (hP.played + K_SCORING)
      : leagueAwayScorePrior;

  // NegBin zero-goal complement P_NB(X >= 1) from shrunk lambdas
  const pNbHomeScores = 1 - Math.pow(priors.causalDispersionHome / (priors.causalDispersionHome + lambdaH), priors.causalDispersionHome);
  const pNbAwayScores = 1 - Math.pow(priors.causalDispersionAway / (priors.causalDispersionAway + lambdaA), priors.causalDispersionAway);

  // Combine empirical scoring/conceding tendency (mean in logit space) with NB scoring intensity
  const pHomeScores = clamp01(0.65 * pNbHomeScores + 0.35 * ((homeAttScoreRate + awayDefConcedeRate) / 2));
  const pAwayScores = clamp01(0.65 * pNbAwayScores + 0.35 * ((awayAttScoreRate + homeDefConcedeRate) / 2));

  // Add Dixon-Coles low-score zero-zero covariance correction delta = P_NB_DC(H>=1,A>=1) - P_NB(H>=1)*P_NB(A>=1)
  const dcZeroZeroDelta = variantC01 - pNbHomeScores * pNbAwayScores;
  const variantB01 = clamp01(pHomeScores * pAwayScores + dcZeroZeroDelta);

  // Epistemic posterior uncertainty over lambda quantiles (matches Variant-B prior K=12)
  const hPlayed = stats.homeTeamStats.overall.matchesPlayed;
  const aPlayed = stats.awayTeamStats.overall.matchesPlayed;
  const relStdH = 1 / Math.sqrt(Math.max(8, hPlayed + 12));
  const relStdA = 1 / Math.sqrt(Math.max(8, aPlayed + 12));
  const gridBtts: number[] = [];
  for (const sH of [-1, 0, 1]) {
    for (const sA of [-1, 0, 1]) {
      const lH = Math.max(0.25, Math.min(4.2, lambdaH * (1 + sH * relStdH)));
      const lA = Math.max(0.25, Math.min(4.2, lambdaA * (1 + sA * relStdA)));
      gridBtts.push(
        computeNormalizedBivariateNegBin(lH, lA, priors.causalDispersionHome, priors.causalDispersionAway)
          .bttsYes01
      );
    }
  }
  const meanGrid = gridBtts.reduce((a, b) => a + b, 0) / gridBtts.length;
  const varianceGrid = gridBtts.reduce((a, x) => a + (x - meanGrid) ** 2, 0) / gridBtts.length;
  const uncertainty = Math.round(Math.sqrt(varianceGrid) * 1000) / 1000;

  // Blend Variant B & Variant C conservatively (equal structural weight) before causal calibration
  const rawStructural01 = clamp01(0.5 * variantB01 + 0.5 * variantC01);

  // Variant D: Causal Calibration (< T)
  const calOut = calibratePhase5Binary(rawStructural01, match.utcDate, bttsHistory);
  const variantD01 = calOut.status === 'CALIBRATED' ? calOut.calibratedProb01 : null;
  const final01 = variantD01 ?? rawStructural01;

  return {
    variantAExistingPct: Math.round(variantA01 * 1000) / 10,
    variantBIndependentPct: Math.round(variantB01 * 1000) / 10,
    variantCNegBinPct: Math.round(variantC01 * 1000) / 10,
    variantDCalibratedPct: variantD01 !== null ? Math.round(variantD01 * 1000) / 10 : null,
    homeScoringProbPct: Math.round(pHomeScores * 1000) / 10,
    awayScoringProbPct: Math.round(pAwayScores * 1000) / 10,
    selectedRawPct: Math.round(rawStructural01 * 1000) / 10,
    selectedFinalPct: Math.round(final01 * 1000) / 10,
    calibrationMethod: calOut.selectedMethod,
    calibrationStatus: calOut.status,
    calibrationSamplesUsed: calOut.sampleCount,
    uncertainty,
  };
}
