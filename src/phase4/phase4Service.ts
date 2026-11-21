import { HistoryRecord, Match, MatchStatistics, Prediction } from '../types/football';
import { footballService } from '../services/footballDataService';
import {
  MODEL_VERSION_PHASE3,
  MODEL_VERSION_PHASE4,
  Phase4BenchmarkComparison,
  Phase4Prediction,
} from './phase4Types';
import { evaluatePhase4Match, runChronologicalPhase4Comparison } from './phase4Pipeline';
import { recordVersionedPrediction } from './phase4HistoryStore';

/**
 * Compute an isolated Phase 4 prediction for a single match using strictly pre-match data,
 * without touching frozen Phase 3 service code. Optionally archives both Phase 3 and Phase 4
 * versions separately in phase4HistoryStore.
 */
export async function evaluateLivePhase4Match(params: {
  match: Match;
  stats: MatchStatistics;
  phase3Prediction: Prediction;
  competitionMatches?: Match[];
  recordHistory?: boolean;
}): Promise<Phase4Prediction> {
  const { match, stats, phase3Prediction, competitionMatches, recordHistory = true } = params;

  let loadedCompetitionMatches = competitionMatches;
  if (!loadedCompetitionMatches) {
    try {
      loadedCompetitionMatches = await footballService.getMatches({ leagueId: match.leagueId });
    } catch {
      loadedCompetitionMatches = undefined;
    }
  }

  let causalHistory: HistoryRecord[] = [];
  if (match.matchCategory === 'HISTORICAL' || match.leagueId.startsWith('statsbomb-')) {
    try {
      causalHistory = await footballService.getHistoryRecords({
        leagueId: match.leagueId,
        maxMatches: 120,
      });
    } catch {
      causalHistory = [];
    }
  }

  const p4 = evaluatePhase4Match(match, stats, {
    phase3Prediction,
    competitionMatches: loadedCompetitionMatches,
    phase4History: causalHistory,
    monteCarloIterations: 2500,
  });

  if (recordHistory) {
    recordVersionedPrediction(match, phase3Prediction, MODEL_VERSION_PHASE3);
    recordVersionedPrediction(match, p4, MODEL_VERSION_PHASE4);
  }

  return p4;
}

/**
 * Run a paired chronological comparison of Frozen Phase 3 vs Experimental Phase 4
 * over the selected historical competition using real cached provider data.
 */
export async function runServicePhase4Comparison(options: {
  leagueId?: string;
  fullSeason?: boolean;
}): Promise<Phase4BenchmarkComparison> {
  const provider = footballService.getActiveProvider();
  if (provider === 'OPENLIGADB') {
    throw new Error(
      'OpenLigaDB provides live season schedules without multi-season historical archives. Switch to StatsBomb or Unified mode to benchmark Phase 3 vs Phase 4.'
    );
  }

  const leagues = await footballService.getLeagues();
  const historicalLeagues =
    provider === 'UNIFIED' || provider === 'STATSBOMB'
      ? leagues.filter((l) => l.id.startsWith('statsbomb-'))
      : leagues;

  const targetLeague =
    (options.leagueId && historicalLeagues.find((l) => l.id === options.leagueId)) ||
    historicalLeagues[0];

  if (!targetLeague) {
    throw new Error('No historical dataset available for Phase 3 vs Phase 4 chronological benchmark.');
  }

  // Re-use exact frozen Phase 3 chronological walk-forward outputs from footballService
  const { records, backtestRun } = await footballService.getHistoryAndBacktest({
    leagueId: targetLeague.id,
    fullSeason: options.fullSeason,
  });

  const allMatches = await footballService.getMatches({ leagueId: targetLeague.id });
  const phase3ByMatchId = new Map<string, Prediction>();
  const matchesForEval: Match[] = [];

  for (const rec of records) {
    phase3ByMatchId.set(rec.match.id, rec.prediction);
    matchesForEval.push(rec.match);
  }

  const allFinished = allMatches.filter(
    (m) => m.score.home !== null && m.score.away !== null
  );

  const comparison = await runChronologicalPhase4Comparison({
    datasetName: `${targetLeague.name} (${targetLeague.season})`,
    leagueId: targetLeague.id,
    dataSource: backtestRun.dataSource,
    matches: matchesForEval,
    maxMatches: options.fullSeason ? null : records.length,
    getMatchStats: (m) => footballService.getMatchStatistics(m, { skipObservedXG: true }),
    calculatePhase3: async (m, s) => {
      const cached = phase3ByMatchId.get(m.id);
      if (cached) return cached;
      return footballService.calculatePrediction(m, s, { includeMonteCarlo: false });
    },
  });

  // Also ensure comparison window uses full historical context cleanly if needed
  void allFinished;
  return comparison;
}
