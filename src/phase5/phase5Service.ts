import { Match, MatchStatistics, Prediction } from '../types/football';
import { footballService } from '../services/footballDataService';
import { evaluatePhase5Match, runChronologicalPhase5Benchmark } from './phase5Pipeline';
import { Phase5BenchmarkReport, Phase5Prediction } from './phase5Types';

/**
 * Evaluate a single live/selected match through the isolated Phase 5 research layer.
 * Never mutates Phase 3 or Phase 4 prediction objects or stores.
 */
export async function evaluateLivePhase5Match(params: {
  match: Match;
  stats: MatchStatistics;
  phase3Prediction: Prediction;
  competitionMatches?: Match[];
}): Promise<Phase5Prediction> {
  const { match, stats, phase3Prediction, competitionMatches } = params;
  const resolvedMatches =
    competitionMatches && competitionMatches.length > 0
      ? competitionMatches
      : await footballService.getMatches({ leagueId: match.leagueId }).catch(() => []);

  return evaluatePhase5Match(match, stats, {
    phase3Prediction,
    competitionMatches: resolvedMatches,
  });
}

/**
 * Run paired chronological comparison across Phase 3 Frozen, Phase 4 Experimental, and Phase 5 Experimental
 * on the selected historical StatsBomb league without altering any Phase 3 or Phase 4 state.
 */
export async function runServicePhase5Benchmark(options?: {
  leagueId?: string;
  maxMatches?: number;
}): Promise<Phase5BenchmarkReport> {
  const leagues = await footballService.getLeagues();
  const targetLeagueId =
    options?.leagueId ||
    leagues.find((l) => l.id.startsWith('statsbomb-'))?.id ||
    leagues[0]?.id;
  const leagueName = leagues.find((l) => l.id === targetLeagueId)?.name || targetLeagueId || 'Historical League';

  const matches = await footballService.getMatches({ leagueId: targetLeagueId });
  const finished = matches
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const slice =
    typeof options?.maxMatches === 'number' && options.maxMatches > 0 && finished.length > options.maxMatches
      ? finished.slice(-options.maxMatches)
      : finished;

  const { report } = await runChronologicalPhase5Benchmark({
    datasetId: targetLeagueId || 'unknown',
    datasetName: leagueName,
    matches: slice,
    getMatchStats: (m) => footballService.getMatchStatistics(m),
    calculatePhase3: (m, s) =>
      footballService.calculatePrediction(m, s, {
        includeMonteCarlo: false,
      }),
  });

  return report;
}
