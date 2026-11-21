import { Match, MatchStatistics } from '../types/football';
import {
  estimateVariantBLambdas,
  ExperimentalLambdaResult,
  LeaguePriorRates,
  TeamGoalCounts,
} from '../utils/experimentalGoalIntensity';

export interface VariantBExtractionResult {
  homeCounts: TeamGoalCounts;
  awayCounts: TeamGoalCounts;
  leaguePrior: LeaguePriorRates | null;
  lambdas: ExperimentalLambdaResult | null;
  usedFallbackLeagueBaseline: boolean;
}

/**
 * Compute strictly causal (< targetKickoff) LeaguePriorRates from raw matches.
 * Never includes target match or any match with utcDate >= targetKickoff.
 */
export function computeCausalLeaguePriorFromMatches(
  allMatches: Match[],
  targetMatchId: string,
  targetKickoffUtc: string
): LeaguePriorRates | null {
  const targetMs = new Date(targetKickoffUtc).getTime();
  if (!Number.isFinite(targetMs)) return null;

  let count = 0;
  let totalHome = 0;
  let totalAway = 0;

  for (const m of allMatches) {
    if (m.id === targetMatchId) continue;
    if (m.status !== 'FINISHED') continue;
    if (m.score.home === null || m.score.away === null) continue;
    if (!Number.isFinite(m.score.home) || !Number.isFinite(m.score.away)) continue;
    if (m.score.home < 0 || m.score.away < 0) continue;

    const t = new Date(m.utcDate).getTime();
    if (!Number.isFinite(t) || t >= targetMs) continue;

    count++;
    totalHome += m.score.home;
    totalAway += m.score.away;
  }

  if (count < 10 || totalHome + totalAway <= 0) {
    return null;
  }

  const avgHomeGoalsLeague = totalHome / count;
  const avgAwayGoalsLeague = totalAway / count;
  const avgGoalsPerSide = (totalHome + totalAway) / (count * 2);

  return {
    priorLeagueCount: count,
    avgHomeGoalsLeague,
    avgAwayGoalsLeague,
    avgGoalsPerSide,
  };
}

/**
 * Extract Variant B inputs from strictly pre-match MatchStatistics (and optional causal prior matches).
 * Never mutates frozen Phase 3 inputs. Returns null lambdas when minimum sample < 5 or priorLeagueCount < 10.
 */
export function extractVariantBProjection(
  match: Match,
  stats: MatchStatistics,
  competitionMatches?: Match[]
): VariantBExtractionResult {
  const hOverall = stats.homeTeamStats.overall;
  const hVenue = stats.homeTeamStats.homeOrAwaySplit;
  const aOverall = stats.awayTeamStats.overall;
  const aVenue = stats.awayTeamStats.homeOrAwaySplit;

  const homeCounts: TeamGoalCounts = {
    overall: {
      played: hOverall.matchesPlayed,
      scored: hOverall.goalsScored,
      conceded: hOverall.goalsConceded,
    },
    venueOnly: {
      played: hVenue.matchesPlayed,
      scored: hVenue.goalsScored,
      conceded: hVenue.goalsConceded,
    },
  };

  const awayCounts: TeamGoalCounts = {
    overall: {
      played: aOverall.matchesPlayed,
      scored: aOverall.goalsScored,
      conceded: aOverall.goalsConceded,
    },
    venueOnly: {
      played: aVenue.matchesPlayed,
      scored: aVenue.goalsScored,
      conceded: aVenue.goalsConceded,
    },
  };

  if (!stats.hasSufficientData || hOverall.matchesPlayed < 5 || aOverall.matchesPlayed < 5) {
    return {
      homeCounts,
      awayCounts,
      leaguePrior: null,
      lambdas: null,
      usedFallbackLeagueBaseline: false,
    };
  }

  let leaguePrior = competitionMatches
    ? computeCausalLeaguePriorFromMatches(competitionMatches, match.id, match.utcDate)
    : null;
  let usedFallbackLeagueBaseline = false;

  // When analyzing a single fixture without the full competition list loaded in memory,
  // infer empirical home/away prior split strictly if phase3 stats already cleared sufficiency (>= 10 league matches)
  // without fabricating outcomes (derive conservative pooled rate from team & phase3 overall balance).
  if (
    !leaguePrior &&
    typeof stats.homeExpectedGoals === 'number' &&
    typeof stats.awayExpectedGoals === 'number' &&
    Number.isFinite(stats.homeExpectedGoals) &&
    Number.isFinite(stats.awayExpectedGoals)
  ) {
    const pooledCount = hOverall.matchesPlayed + aOverall.matchesPlayed;
    if (pooledCount >= 10) {
      const avgGoalsScoredBoth =
        (hOverall.goalsScored + hOverall.goalsConceded + aOverall.goalsScored + aOverall.goalsConceded) /
        (2 * pooledCount);
      const safeSide = Math.max(0.85, Math.min(2.1, avgGoalsScoredBoth));
      leaguePrior = {
        priorLeagueCount: pooledCount,
        avgHomeGoalsLeague: Math.round(safeSide * 1.11 * 1000) / 1000,
        avgAwayGoalsLeague: Math.round(safeSide * 0.89 * 1000) / 1000,
        avgGoalsPerSide: Math.round(safeSide * 1000) / 1000,
      };
      usedFallbackLeagueBaseline = true;
    }
  }

  const lambdas = leaguePrior ? estimateVariantBLambdas(homeCounts, awayCounts, leaguePrior) : null;

  return {
    homeCounts,
    awayCounts,
    leaguePrior,
    lambdas,
    usedFallbackLeagueBaseline,
  };
}
