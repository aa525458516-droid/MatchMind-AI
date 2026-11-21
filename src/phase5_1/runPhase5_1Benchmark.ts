/**
 * Reproducible CLI Benchmark Runner for Phase 5.1 Experimental Research
 *
 * Uses Frozen StatsBombProvider directly against StatsBomb Open Data (CC BY 4.0)
 * strictly on NON-HOLDOUT full seasons (`statsbomb-2-27`, `statsbomb-11-27`, `statsbomb-1238-108`).
 * Explicitly blocks access to all Blind Holdout seasons.
 */
import { StatsBombProvider } from '../services/providers/statsBombProvider';
import { HistoryRecord, Match, MatchStatistics } from '../types/football';
import { runChronologicalPhase5_1Benchmark } from './phase5_1Pipeline';
import { BLIND_HOLDOUT_IDS } from './phase5_1Service';
import { Phase5_1BenchmarkReport } from './phase5_1Types';

const DEFAULT_RESEARCH_DATASETS = [
  { id: 'statsbomb-2-27', name: 'Premier League (2015/2016) [Post-Hoc Diagnostic]' },
  { id: 'statsbomb-11-27', name: 'La Liga (2015/2016) [Full Season]' },
  { id: 'statsbomb-1238-108', name: 'Indian Super League (2021/2022) [Full Season]' },
];

async function benchmarkLeague(
  provider: StatsBombProvider,
  leagueId: string,
  leagueName: string
): Promise<Phase5_1BenchmarkReport> {
  if (BLIND_HOLDOUT_IDS.has(leagueId)) {
    throw new Error(
      `BLIND HOLDOUT PROTECTION: Refusing to run exploratory Phase 5.1 benchmark on protected holdout dataset ${leagueId}.`
    );
  }

  const matches = await provider.getMatches({ leagueId });
  const finished = matches
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const statsCache = new Map<string, MatchStatistics>();

  return runChronologicalPhase5_1Benchmark({
    datasetId: leagueId,
    datasetName: leagueName,
    matches: finished,
    isBlindHoldout: false,
    getMatchStats: async (m: Match) => {
      const existing = statsCache.get(m.id);
      if (existing) return existing;
      const st = await provider.getMatchStatistics(m, { skipObservedXG: true });
      statsCache.set(m.id, st);
      return st;
    },
    calculatePhase3: async (m: Match, s: MatchStatistics, hist: HistoryRecord[]) =>
      provider.calculatePrediction(m, s, {
        includeMonteCarlo: false,
        calibrationHistory: hist,
      }),
  });
}

async function main() {
  const provider = new StatsBombProvider(
    'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
  );

  const reports: Phase5_1BenchmarkReport[] = [];
  for (const ds of DEFAULT_RESEARCH_DATASETS) {
    console.error(`Evaluating Phase 5.1 on ${ds.id} (${ds.name})...`);
    const rep = await benchmarkLeague(provider, ds.id, ds.name);
    reports.push(rep);
  }

  console.log(JSON.stringify(reports, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
