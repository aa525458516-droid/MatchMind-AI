/**
 * Phase 6 Clean Multi-Season Ingestion Harness (Step 1)
 *
 * Strictly isolated under src/phase6/.
 * Features:
 * - Protected holdout & external validation dataset guards
 * - Season-keyed dataset IDs and cache keys
 * - Explicit exclusion ledger (NEVER silently skips malformed data)
 * - Relegation playoff filtering
 * - Invalid / epoch (< 2000-01-01) timestamp rejection
 * - Finished-match-only historical state ingestion
 * - Exact-timestamp cohort batching
 * - Enforced skipObservedXG: true on all StatsBomb statistics fetches
 */

import { Match, MatchStatistics } from '../types/football';
import { OpenLigaDbProvider } from '../services/providers/openLigaDbProvider';
import { StatsBombProvider } from '../services/providers/statsBombProvider';
import {
  APPROVED_CHAIN_A_BL1_SEASONS,
  APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS,
  APPROVED_CHAIN_C_STATSBOMB_IDS,
  assertApprovedPhase6Dataset,
  enforceSkipObservedXG,
  makeSeasonCacheKey,
} from './phase6Guards';
import {
  PHASE6_MIN_VALID_TIMESTAMP_MS,
  Phase6CleanMatch,
  Phase6ExclusionReason,
  Phase6SeasonDataset,
  Phase6SeasonExclusionLedger,
  Phase6TimestampBatch,
} from './phase6Types';

export interface Phase6SanitizeInputMatch {
  id: string;
  utcDate: string | null | undefined;
  status?: string;
  matchday?: number | null;
  groupName?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeGoals: number | null | undefined;
  awayGoals: number | null | undefined;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
}

export function isRelegationPlayoffFixture(groupName: string | null | undefined): boolean {
  if (!groupName) return false;
  return /relegation|play[- ]?off/i.test(groupName);
}

export function createEmptyExclusionLedger(
  seasonKey: string,
  rawMatchCount: number
): Phase6SeasonExclusionLedger {
  return {
    seasonKey,
    rawMatchCount,
    retainedMatchCount: 0,
    excludedTotal: 0,
    countsByReason: {
      RELEGATION_PLAYOFF: 0,
      INVALID_OR_EPOCH_TIMESTAMP: 0,
      UNFINISHED_OR_NULL_SCORE: 0,
      INVALID_TEAM_ID: 0,
      DUPLICATE_MATCH_ID: 0,
    },
    samples: [],
  };
}

function recordExclusion(
  ledger: Phase6SeasonExclusionLedger,
  match: Phase6SanitizeInputMatch,
  reason: Phase6ExclusionReason,
  detail: string
): void {
  ledger.excludedTotal++;
  ledger.countsByReason[reason]++;
  if (ledger.samples.length < 50) {
    ledger.samples.push({
      matchId: String(match.id || 'unknown'),
      seasonKey: ledger.seasonKey,
      utcDate: match.utcDate ?? null,
      groupName: match.groupName ?? null,
      reason,
      detail,
    });
  }
}

/**
 * Sanitize raw matches for a single competition-season and record all exclusions explicitly.
 */
export function sanitizeSeasonMatches(params: {
  provider: 'openliga' | 'statsbomb';
  competitionKey: string;
  tier: number;
  seasonLabel: string;
  rawMatches: Phase6SanitizeInputMatch[];
}): {
  seasonKey: string;
  matches: Phase6CleanMatch[];
  exclusions: Phase6SeasonExclusionLedger;
} {
  const { provider, competitionKey, tier, seasonLabel, rawMatches } = params;
  const seasonKey = makeSeasonCacheKey(provider, competitionKey, seasonLabel, tier);
  const ledger = createEmptyExclusionLedger(seasonKey, rawMatches.length);
  const seenIds = new Set<string>();
  const retained: Phase6CleanMatch[] = [];

  for (const raw of rawMatches) {
    const id = String(raw.id || '').trim();
    if (!id || seenIds.has(id)) {
      recordExclusion(ledger, raw, 'DUPLICATE_MATCH_ID', `Duplicate or empty match ID "${id}"`);
      continue;
    }

    if (isRelegationPlayoffFixture(raw.groupName)) {
      seenIds.add(id);
      recordExclusion(
        ledger,
        raw,
        'RELEGATION_PLAYOFF',
        `Excluded inter-tier playoff fixture (${raw.groupName})`
      );
      continue;
    }

    const homeTeamId = String(raw.homeTeamId || '').trim();
    const awayTeamId = String(raw.awayTeamId || '').trim();
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
      seenIds.add(id);
      recordExclusion(
        ledger,
        raw,
        'INVALID_TEAM_ID',
        `Invalid team pairing (${homeTeamId} vs ${awayTeamId})`
      );
      continue;
    }

    const utcStr = raw.utcDate ? String(raw.utcDate).trim() : '';
    const timestampMs = utcStr ? new Date(utcStr).getTime() : NaN;
    if (!Number.isFinite(timestampMs) || timestampMs < PHASE6_MIN_VALID_TIMESTAMP_MS) {
      seenIds.add(id);
      recordExclusion(
        ledger,
        raw,
        'INVALID_OR_EPOCH_TIMESTAMP',
        `Timestamp "${utcStr}" is invalid or predates 2000-01-01 epoch floor`
      );
      continue;
    }

    const hg = raw.homeGoals;
    const ag = raw.awayGoals;
    if (
      (raw.status && raw.status !== 'FINISHED') ||
      typeof hg !== 'number' ||
      typeof ag !== 'number' ||
      !Number.isFinite(hg) ||
      !Number.isFinite(ag) ||
      hg < 0 ||
      ag < 0
    ) {
      seenIds.add(id);
      recordExclusion(
        ledger,
        raw,
        'UNFINISHED_OR_NULL_SCORE',
        `Unfinished or missing non-negative integer score (status=${raw.status}, score=${hg}-${ag})`
      );
      continue;
    }

    seenIds.add(id);
    retained.push({
      id,
      provider,
      competitionKey,
      tier,
      seasonLabel,
      seasonKey,
      utcDate: new Date(timestampMs).toISOString(),
      timestampMs,
      matchday: typeof raw.matchday === 'number' && Number.isFinite(raw.matchday) ? raw.matchday : null,
      groupName: raw.groupName ?? null,
      homeTeamId,
      awayTeamId,
      homeTeamName: String(raw.homeTeamName || homeTeamId),
      awayTeamName: String(raw.awayTeamName || awayTeamId),
      homeGoals: hg,
      awayGoals: ag,
      htHomeGoals: typeof raw.htHomeGoals === 'number' && Number.isFinite(raw.htHomeGoals) ? raw.htHomeGoals : null,
      htAwayGoals: typeof raw.htAwayGoals === 'number' && Number.isFinite(raw.htAwayGoals) ? raw.htAwayGoals : null,
    });
  }

  retained.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
  ledger.retainedMatchCount = retained.length;
  return { seasonKey, matches: retained, exclusions: ledger };
}

/**
 * Group chronologically ordered matches into exact-timestamp batches.
 * Simultaneous kickoffs share one batch so state never updates within the same timestamp T.
 */
export function groupMatchesByExactTimestamp(matches: Phase6CleanMatch[]): Phase6TimestampBatch[] {
  if (matches.length === 0) return [];
  const sorted = [...matches].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
  const batches: Phase6TimestampBatch[] = [];

  let i = 0;
  while (i < sorted.length) {
    const t0 = sorted[i].timestampMs;
    const cohort: Phase6CleanMatch[] = [];
    while (i < sorted.length && sorted[i].timestampMs === t0) {
      cohort.push(sorted[i]);
      i++;
    }
    batches.push({
      timestampMs: t0,
      utcDate: cohort[0].utcDate,
      matches: cohort,
    });
  }
  return batches;
}

/**
 * Season-keyed isolated dataset loader & cache for Phase 6 development chains.
 */
export class Phase6CrossSeasonLoader {
  private readonly seasonCache = new Map<string, Phase6SeasonDataset>();
  private readonly rawMatchCache = new Map<string, Match[]>();

  constructor(
    private readonly openLigaProvider: OpenLigaDbProvider = new OpenLigaDbProvider('https://api.openligadb.de'),
    private readonly statsBombProvider: StatsBombProvider = new StatsBombProvider(
      'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
    )
  ) {}

  clearCache(): void {
    this.seasonCache.clear();
    this.rawMatchCache.clear();
  }

  getCachedSeasonKeys(): string[] {
    return Array.from(this.seasonCache.keys());
  }

  getRawMatchesByCacheKey(seasonKey: string): Match[] {
    return this.rawMatchCache.get(seasonKey) ?? [];
  }

  async fetchStatsBombStatisticsStrict(
    match: Match,
    options?: { skipObservedXG?: boolean }
  ): Promise<MatchStatistics> {
    assertApprovedPhase6Dataset(match.leagueId);
    const strictOpts = enforceSkipObservedXG(options);
    return this.statsBombProvider.getMatchStatistics(match, strictOpts);
  }

  async loadOpenLigaSeason(
    shortcut: 'bl1' | 'bl2',
    season: string,
    options?: { allowChainB?: boolean }
  ): Promise<Phase6SeasonDataset> {
    const datasetId = `openliga-${shortcut}-${season}`;
    assertApprovedPhase6Dataset(datasetId, options);

    const tier = shortcut === 'bl1' ? 1 : 2;
    const competitionKey = `openliga-${shortcut}`;
    const cacheKey = makeSeasonCacheKey('openliga', competitionKey, season, tier);
    const cached = this.seasonCache.get(cacheKey);
    if (cached) return cached;

    const leagueMatches = await this.openLigaProvider.getMatches({
      leagueId: competitionKey,
      season,
    });

    const rawInputs: Phase6SanitizeInputMatch[] = leagueMatches.map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday ?? null,
      groupName: m.round ?? null,
      homeTeamId: m.homeTeam?.id,
      awayTeamId: m.awayTeam?.id,
      homeTeamName: m.homeTeam?.name,
      awayTeamName: m.awayTeam?.name,
      homeGoals: m.score?.home,
      awayGoals: m.score?.away,
      htHomeGoals: m.score?.htHome ?? null,
      htAwayGoals: m.score?.htAway ?? null,
    }));

    const sanitized = sanitizeSeasonMatches({
      provider: 'openliga',
      competitionKey,
      tier,
      seasonLabel: season,
      rawMatches: rawInputs,
    });

    const dataset: Phase6SeasonDataset = {
      seasonKey: sanitized.seasonKey,
      provider: 'openliga',
      competitionKey,
      competitionName:
        shortcut === 'bl1' ? `1. Bundesliga ${season}/${Number(season) + 1}` : `2. Bundesliga ${season}/${Number(season) + 1}`,
      tier,
      seasonLabel: season,
      matches: sanitized.matches,
      exclusions: sanitized.exclusions,
    };

    this.rawMatchCache.set(sanitized.seasonKey, leagueMatches);
    this.seasonCache.set(sanitized.seasonKey, dataset);
    return dataset;
  }

  async loadStatsBombSeason(
    datasetId: string,
    tier: number = 1,
    options?: { allowChainB?: boolean }
  ): Promise<Phase6SeasonDataset> {
    assertApprovedPhase6Dataset(datasetId, options);

    const parts = datasetId.replace('statsbomb-', '').split('-');
    const competitionKey = `statsbomb-${parts[0] || datasetId}`;
    const seasonLabel = parts[1] || datasetId;
    const cacheKey = makeSeasonCacheKey('statsbomb', competitionKey, seasonLabel, tier);
    const cached = this.seasonCache.get(cacheKey);
    if (cached) return cached;

    const leagueMatches = await this.statsBombProvider.getMatches({ leagueId: datasetId });
    this.rawMatchCache.set(cacheKey, leagueMatches);

    const rawInputs: Phase6SanitizeInputMatch[] = leagueMatches.map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday ?? null,
      groupName: m.round ?? null,
      homeTeamId: m.homeTeam?.id,
      awayTeamId: m.awayTeam?.id,
      homeTeamName: m.homeTeam?.name,
      awayTeamName: m.awayTeam?.name,
      homeGoals: m.score?.home,
      awayGoals: m.score?.away,
      htHomeGoals: m.score?.htHome ?? null,
      htAwayGoals: m.score?.htAway ?? null,
    }));

    const sanitized = sanitizeSeasonMatches({
      provider: 'statsbomb',
      competitionKey,
      tier,
      seasonLabel,
      rawMatches: rawInputs,
    });

    const dataset: Phase6SeasonDataset = {
      seasonKey: sanitized.seasonKey,
      provider: 'statsbomb',
      competitionKey,
      competitionName: leagueMatches[0]?.leagueName ? `${leagueMatches[0].leagueName} (${leagueMatches[0].season})` : datasetId,
      tier,
      seasonLabel,
      matches: sanitized.matches,
      exclusions: sanitized.exclusions,
    };

    this.seasonCache.set(cacheKey, dataset);
    return dataset;
  }

  async loadApprovedChainA(): Promise<{
    bl1Seasons: Phase6SeasonDataset[];
    bl2BridgeSeasons: Map<string, Phase6SeasonDataset>;
  }> {
    const bl1Seasons: Phase6SeasonDataset[] = [];
    const bl2BridgeSeasons = new Map<string, Phase6SeasonDataset>();

    for (const s of APPROVED_CHAIN_A_BL1_SEASONS) {
      bl1Seasons.push(await this.loadOpenLigaSeason('bl1', s));
    }
    for (const s of APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS) {
      bl2BridgeSeasons.set(s, await this.loadOpenLigaSeason('bl2', s));
    }
    return { bl1Seasons, bl2BridgeSeasons };
  }

  async loadApprovedChainC(): Promise<Phase6SeasonDataset[]> {
    const out: Phase6SeasonDataset[] = [];
    for (const id of APPROVED_CHAIN_C_STATSBOMB_IDS) {
      out.push(await this.loadStatsBombSeason(id, 1));
    }
    return out;
  }

  getOpenLigaProvider(): OpenLigaDbProvider {
    return this.openLigaProvider;
  }

  getStatsBombProvider(): StatsBombProvider {
    return this.statsBombProvider;
  }
}
