import { Match } from '../types/football';
import { computeEmpiricalEloFromMatches, HistoricalMatchForElo } from '../utils/eloRating';
import { CausalTeamRateSummary, Phase5CausalPriors } from './phase5Types';

function emptyTeamSummary(): CausalTeamRateSummary {
  return {
    played: 0,
    venuePlayed: 0,
    scored: 0,
    conceded: 0,
    venueScored: 0,
    venueConceded: 0,
    cleanSheets: 0,
    failedToScore: 0,
    draws: 0,
    over25Count: 0,
    bttsCount: 0,
  };
}

function sampleVariance(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  return ss / (values.length - 1);
}

/**
 * Estimate Negative Binomial dispersion r via strictly causal method-of-moments (< T).
 * For NB(mu, r), Var(G) = mu + mu^2 / r => r = mu^2 / (Var(G) - mu).
 * Shrinks strongly toward near-Poisson (r = 35) when sample is small or Var <= mu.
 */
export function estimateCausalDispersionR(
  mean: number | null,
  variance: number | null,
  sampleCount: number
): { dispersionR: number; overdispersionRatio: number | null } {
  if (
    mean === null ||
    variance === null ||
    !Number.isFinite(mean) ||
    !Number.isFinite(variance) ||
    mean <= 0.1
  ) {
    return { dispersionR: 35.0, overdispersionRatio: null };
  }

  const ratio = variance / mean;
  if (sampleCount < 20 || variance <= mean * 1.03) {
    return { dispersionR: 35.0, overdispersionRatio: ratio };
  }

  const rawR = (mean * mean) / (variance - mean);
  // Empirical Bayes blend toward conservative prior r=22 based on league sample depth
  const weightData = sampleCount / (sampleCount + 60);
  const blendedR = weightData * rawR + (1 - weightData) * 22.0;
  return {
    dispersionR: Math.max(3.0, Math.min(40.0, blendedR)),
    overdispersionRatio: ratio,
  };
}

/**
 * Extract all league, dispersion, team-rate, and Elo priors strictly from matches finished < targetKickoffUtc.
 * NEVER touches targetMatch scores, simultaneous (=T) kickoffs, or future (>T) fixtures.
 */
export function extractPhase5CausalPriors(
  targetMatch: Match,
  competitionMatches: Match[]
): Phase5CausalPriors {
  const targetMs = new Date(targetMatch.utcDate).getTime();
  const validTimestamp = Number.isFinite(targetMs);

  const homeTeamPriors = emptyTeamSummary();
  const awayTeamPriors = emptyTeamSummary();

  if (!validTimestamp) {
    return {
      targetMatchId: targetMatch.id,
      targetKickoffUtc: targetMatch.utcDate,
      validTimestamp: false,
      priorLeagueMatches: 0,
      avgHomeGoals: null,
      avgAwayGoals: null,
      avgTotalGoals: null,
      varHomeGoals: null,
      varAwayGoals: null,
      varTotalGoals: null,
      causalDispersionHome: 35.0,
      causalDispersionAway: 35.0,
      overdispersionRatioHome: null,
      overdispersionRatioAway: null,
      leagueDrawRate: null,
      leagueOver25Rate: null,
      leagueBttsRate: null,
      leagueHomeScoredAnyRate: null,
      leagueAwayScoredAnyRate: null,
      homeEloCausal: null,
      awayEloCausal: null,
      homeTeamPriors,
      awayTeamPriors,
    };
  }

  const priorMatches = competitionMatches
    .filter((m) => {
      if (m.id === targetMatch.id) return false;
      if (m.status !== 'FINISHED') return false;
      if (
        typeof m.score?.home !== 'number' ||
        typeof m.score?.away !== 'number' ||
        !Number.isFinite(m.score.home) ||
        !Number.isFinite(m.score.away) ||
        m.score.home < 0 ||
        m.score.away < 0
      ) {
        return false;
      }
      const ms = new Date(m.utcDate).getTime();
      return Number.isFinite(ms) && ms < targetMs;
    })
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const homeGoalsList: number[] = [];
  const awayGoalsList: number[] = [];
  const totalGoalsList: number[] = [];
  const eloInput: HistoricalMatchForElo[] = [];

  let sumHome = 0;
  let sumAway = 0;
  let drawCount = 0;
  let over25Count = 0;
  let bttsCount = 0;
  let homeScoredAny = 0;
  let awayScoredAny = 0;

  const targetHomeId = targetMatch.homeTeam.id;
  const targetAwayId = targetMatch.awayTeam.id;

  const recordTeam = (summary: CausalTeamRateSummary, gf: number, ga: number, isTargetVenue: boolean) => {
    summary.played++;
    summary.scored += gf;
    summary.conceded += ga;
    if (isTargetVenue) {
      summary.venuePlayed++;
      summary.venueScored += gf;
      summary.venueConceded += ga;
    }
    if (ga === 0) summary.cleanSheets++;
    if (gf === 0) summary.failedToScore++;
    if (gf === ga) summary.draws++;
    if (gf + ga > 2) summary.over25Count++;
    if (gf > 0 && ga > 0) summary.bttsCount++;
  };

  for (const m of priorMatches) {
    const hg = m.score.home!;
    const ag = m.score.away!;
    sumHome += hg;
    sumAway += ag;
    homeGoalsList.push(hg);
    awayGoalsList.push(ag);
    totalGoalsList.push(hg + ag);

    if (hg === ag) drawCount++;
    if (hg + ag > 2) over25Count++;
    if (hg > 0 && ag > 0) bttsCount++;
    if (hg > 0) homeScoredAny++;
    if (ag > 0) awayScoredAny++;

    eloInput.push({
      homeTeamId: m.homeTeam.id,
      awayTeamId: m.awayTeam.id,
      homeGoals: hg,
      awayGoals: ag,
      utcDate: m.utcDate,
    });

    if (m.homeTeam.id === targetHomeId) recordTeam(homeTeamPriors, hg, ag, true);
    else if (m.awayTeam.id === targetHomeId) recordTeam(homeTeamPriors, ag, hg, false);

    if (m.awayTeam.id === targetAwayId) recordTeam(awayTeamPriors, ag, hg, true);
    else if (m.homeTeam.id === targetAwayId) recordTeam(awayTeamPriors, hg, ag, false);
  }

  const n = priorMatches.length;
  const avgHomeGoals = n > 0 ? sumHome / n : null;
  const avgAwayGoals = n > 0 ? sumAway / n : null;
  const avgTotalGoals = n > 0 ? (sumHome + sumAway) / n : null;

  const varHomeGoals = avgHomeGoals !== null ? sampleVariance(homeGoalsList, avgHomeGoals) : null;
  const varAwayGoals = avgAwayGoals !== null ? sampleVariance(awayGoalsList, avgAwayGoals) : null;
  const varTotalGoals = avgTotalGoals !== null ? sampleVariance(totalGoalsList, avgTotalGoals) : null;

  const dispH = estimateCausalDispersionR(avgHomeGoals, varHomeGoals, n);
  const dispA = estimateCausalDispersionR(avgAwayGoals, varAwayGoals, n);

  const causalEloMap = computeEmpiricalEloFromMatches(eloInput, targetMs, 5);
  const homeEloCausal = causalEloMap.get(targetHomeId)?.rating ?? null;
  const awayEloCausal = causalEloMap.get(targetAwayId)?.rating ?? null;

  return {
    targetMatchId: targetMatch.id,
    targetKickoffUtc: targetMatch.utcDate,
    validTimestamp: true,
    priorLeagueMatches: n,
    avgHomeGoals,
    avgAwayGoals,
    avgTotalGoals,
    varHomeGoals,
    varAwayGoals,
    varTotalGoals,
    causalDispersionHome: dispH.dispersionR,
    causalDispersionAway: dispA.dispersionR,
    overdispersionRatioHome: dispH.overdispersionRatio,
    overdispersionRatioAway: dispA.overdispersionRatio,
    leagueDrawRate: n > 0 ? drawCount / n : null,
    leagueOver25Rate: n > 0 ? over25Count / n : null,
    leagueBttsRate: n > 0 ? bttsCount / n : null,
    leagueHomeScoredAnyRate: n > 0 ? homeScoredAny / n : null,
    leagueAwayScoredAnyRate: n > 0 ? awayScoredAny / n : null,
    homeEloCausal,
    awayEloCausal,
    homeTeamPriors,
    awayTeamPriors,
  };
}
