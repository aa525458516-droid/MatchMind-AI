import { Match, MatchStatistics, Prediction } from '../types/football';
import { footballService } from '../services/footballDataService';
import { evaluatePhase5_1Match, runChronologicalPhase5_1Benchmark } from './phase5_1Pipeline';
import { Phase5_1BenchmarkReport, Phase5_1Prediction } from './phase5_1Types';

export const BLIND_HOLDOUT_IDS = new Set([
  'statsbomb-9-27', // Bundesliga 2015/2016
  'statsbomb-12-27', // Serie A 2015/2016
  'statsbomb-7-27', // Ligue 1 2015/2016
  'statsbomb-9-281', // Bundesliga 2023/2024
]);

/**
 * Evaluate a single live/selected match through the isolated Phase 5.1 experimental layer.
 * Never modifies Phase 3, Phase 4, or Phase 5 state.
 */
export async function evaluateLivePhase5_1Match(params: {
  match: Match;
  stats: MatchStatistics;
  phase3Prediction: Prediction;
  competitionMatches?: Match[];
}): Promise<Phase5_1Prediction> {
  const { match, stats, phase3Prediction, competitionMatches } = params;
  const resolvedMatches =
    competitionMatches && competitionMatches.length > 0
      ? competitionMatches
      : await footballService.getMatches({ leagueId: match.leagueId }).catch(() => []);

  return evaluatePhase5_1Match(match, stats, {
    phase3Prediction,
    competitionMatches: resolvedMatches,
  });
}

/**
 * Run paired chronological comparison for Phase 5.1 on an approved non-holdout league.
 */
export async function runServicePhase5_1Benchmark(options?: {
  leagueId?: string;
  maxMatches?: number;
}): Promise<Phase5_1BenchmarkReport> {
  const leagues = await footballService.getLeagues();
  const nonHoldoutLeagues = leagues.filter(
    (l) => l.id.startsWith('statsbomb-') && !BLIND_HOLDOUT_IDS.has(l.id)
  );
  const targetLeagueId =
    options?.leagueId && !BLIND_HOLDOUT_IDS.has(options.leagueId)
      ? options.leagueId
      : nonHoldoutLeagues[0]?.id;

  if (!targetLeagueId) {
    throw new Error('No non-holdout historical dataset available for Phase 5.1 research.');
  }
  if (BLIND_HOLDOUT_IDS.has(targetLeagueId)) {
    throw new Error(
      `BLIND HOLDOUT PROTECTION: Refusing to run exploratory Phase 5.1 research on ${targetLeagueId}.`
    );
  }

  const leagueName = leagues.find((l) => l.id === targetLeagueId)?.name || targetLeagueId;
  const matches = await footballService.getMatches({ leagueId: targetLeagueId });
  const finished = matches
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const slice =
    typeof options?.maxMatches === 'number' && options.maxMatches > 0 && finished.length > options.maxMatches
      ? finished.slice(-options.maxMatches)
      : finished;

  return runChronologicalPhase5_1Benchmark({
    datasetId: targetLeagueId,
    datasetName: leagueName,
    matches: slice,
    isBlindHoldout: false,
    getMatchStats: (m) => footballService.getMatchStatistics(m, { skipObservedXG: true }),
    calculatePhase3: (m, s) =>
      footballService.calculatePrediction(m, s, {
        includeMonteCarlo: false,
      }),
  });
}
