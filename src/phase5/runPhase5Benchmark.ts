/**
 * Reproducible CLI Benchmark Runner for Phase 5 Experimental Research
 *
 * Uses Frozen StatsBombProvider directly against StatsBomb Open Data (CC BY 4.0)
 * strictly on NON-HOLDOUT full seasons (`statsbomb-2-27`, `statsbomb-11-27`, `statsbomb-1238-108`)
 * while explicitly refusing to touch Blind Holdout seasons unless frozen confirmatory audit is requested.
 */
import { StatsBombProvider } from '../services/providers/statsBombProvider';
import { HistoryRecord, Match, MatchStatistics } from '../types/football';
import { runChronologicalPhase5Benchmark } from './phase5Pipeline';
import { Phase5BenchmarkReport } from './phase5Types';

const BLIND_HOLDOUT_IDS = new Set([
  'statsbomb-9-27', // Bundesliga 2015/2016
  'statsbomb-12-27', // Serie A 2015/2016
  'statsbomb-7-27', // Ligue 1 2015/2016
  'statsbomb-9-281', // Bundesliga 2023/2024
]);

const DEFAULT_RESEARCH_DATASETS = [
  { id: 'statsbomb-2-27', name: 'Premier League (2015/2016) [Post-Hoc Diagnostic]' },
  { id: 'statsbomb-11-27', name: 'La Liga (2015/2016) [Full Season]' },
  { id: 'statsbomb-1238-108', name: 'Indian Super League (2021/2022) [Full Season]' },
];

async function benchmarkLeague(
  provider: StatsBombProvider,
  leagueId: string,
  leagueName: string
): Promise<Phase5BenchmarkReport> {
  if (BLIND_HOLDOUT_IDS.has(leagueId)) {
    throw new Error(
      `BLIND HOLDOUT PROTECTION: Refusing to run exploratory Phase 5 benchmark on protected holdout dataset ${leagueId}.`
    );
  }

  const matches = await provider.getMatches({ leagueId });
  const finished = matches
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const statsCache = new Map<string, MatchStatistics>();

  const { report } = await runChronologicalPhase5Benchmark({
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

  return report;
}

async function main() {
  const provider = new StatsBombProvider(
    'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
  );

  const reports: Phase5BenchmarkReport[] = [];
  for (const ds of DEFAULT_RESEARCH_DATASETS) {
    console.error(`Evaluating ${ds.id} (${ds.name})...`);
    const rep = await benchmarkLeague(provider, ds.id, ds.name);
    reports.push(rep);
  }

  console.log(JSON.stringify(reports, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
