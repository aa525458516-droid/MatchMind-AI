/**
 * OpenLigaDB Free Public Football Data Provider
 *
 * Source: https://api.openligadb.de
 * License: Open community data API (Free, no API key required)
 * Responsibility: Live, upcoming, and finished German competition matches.
 *
 * Strict Data Integrity Guarantees:
 * - Discovers leagues and seasons dynamically from API (throws explicit errors on outage).
 * - Zero hardcoded fallback leagues, ratings, xG, lineups, or rest days.
 * - Empirical Elo computed solely by chronological replay of finished matches (< T).
 * - Strict zero-leakage pre-match feature extraction and genuine ABSTAIN when < 5 matches.
 */

import {
  League,
  Team,
  Match,
  MatchStatistics,
  Prediction,
  FormMatchRecord,
  SplitStats,
  TeamStatistics,
  HeadToHeadMatch,
  SingleModelEvaluation,
  DataProvenance,
  HistoryRecord,
} from '../../types/football';
import { calculatePoissonProbabilities, evaluateDixonColesComparison } from '../../utils/poissonModel';
import { computeEmpiricalEloFromMatches, evaluateEloModel, HistoricalMatchForElo } from '../../utils/eloRating';
import { runMonteCarloSimulation } from '../../utils/monteCarloSimulation';
import { computeSmartConfidence, EmpiricalBacktestReference } from '../../utils/confidenceEngine';
import { calibrateMarketProbabilities } from '../../utils/probabilityCalibration';

interface RawOpenLigaMatch {
  matchID: number;
  matchDateTime: string;
  matchDateTimeUTC: string;
  leagueId: number;
  leagueName: string;
  leagueSeason: number;
  leagueShortcut: string;
  matchIsFinished: boolean;
  location?: {
    locationID?: number;
    locationCity?: string;
    locationStadium?: string;
  } | null;
  group?: {
    groupName: string;
    groupOrderID: number;
    groupID: number;
  };
  team1: {
    teamId: number;
    teamName: string;
    shortName: string;
    teamIconUrl: string;
  };
  team2: {
    teamId: number;
    teamName: string;
    shortName: string;
    teamIconUrl: string;
  };
  matchResults?: Array<{
    resultID: number;
    resultName: string;
    pointsTeam1: number;
    pointsTeam2: number;
    resultOrderID: number;
    resultTypeKind: string;
  }>;
}

interface RawOpenLigaTableItem {
  teamInfoId: number;
  teamName: string;
  shortName: string;
  teamIconUrl: string;
  points: number;
  opponentGoals: number;
  goals: number;
  matches: number;
  won: number;
  lost: number;
  draw: number;
  goalDiff: number;
}

interface RawOpenLigaLeague {
  leagueId: number;
  leagueName: string;
  leagueShortcut: string;
  leagueSeason: string;
  sport?: {
    sportId: number;
    sportName: string;
  };
}

interface ProxyEnvelope<T> {
  success?: boolean;
  data?: T;
  source?: string;
  cached?: boolean;
  fromCache?: boolean;
  cachedAt?: string;
  retrievedAt?: string;
  error?: string;
}

interface CachedMatchesEntry {
  matches: RawOpenLigaMatch[];
  cached: boolean;
  cachedAt: string;
  retrievedAt: string;
  expiresAt: number;
}

const CLIENT_LIVE_TTL_MS = 5 * 60 * 1000;
const CLIENT_STATIC_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_SEASONS = 30;
const MAX_MONTE_CARLO_CACHE = 500;

function extractFinalResult(m: RawOpenLigaMatch): { home: number; away: number; htHome: number | null; htAway: number | null } | null {
  if (!m.matchResults || !Array.isArray(m.matchResults) || m.matchResults.length === 0) return null;
  const finalRes =
    m.matchResults.find(
      (r) =>
        r.resultOrderID === 2 ||
        r.resultTypeKind === 'Endresultat' ||
        (r.resultName && r.resultName.includes('Endergebnis'))
    ) || m.matchResults[m.matchResults.length - 1];

  const halfRes = m.matchResults.find(
    (r) =>
      r.resultOrderID === 1 ||
      r.resultTypeKind === 'HalfTime' ||
      (r.resultName && r.resultName.includes('Halbzeit'))
  );

  if (!finalRes) return null;
  if (
    typeof finalRes.pointsTeam1 !== 'number' ||
    typeof finalRes.pointsTeam2 !== 'number' ||
    !Number.isFinite(finalRes.pointsTeam1) ||
    !Number.isFinite(finalRes.pointsTeam2) ||
    finalRes.pointsTeam1 < 0 ||
    finalRes.pointsTeam2 < 0
  ) {
    return null;
  }

  const htHome =
    halfRes &&
    typeof halfRes.pointsTeam1 === 'number' &&
    Number.isFinite(halfRes.pointsTeam1) &&
    halfRes.pointsTeam1 >= 0
      ? halfRes.pointsTeam1
      : null;
  const htAway =
    halfRes &&
    typeof halfRes.pointsTeam2 === 'number' &&
    Number.isFinite(halfRes.pointsTeam2) &&
    halfRes.pointsTeam2 >= 0
      ? halfRes.pointsTeam2
      : null;

  return {
    home: finalRes.pointsTeam1,
    away: finalRes.pointsTeam2,
    htHome,
    htAway,
  };
}

function sanitizeAndDeduplicateOpenLigaMatches(list: RawOpenLigaMatch[]): RawOpenLigaMatch[] {
  const byId = new Map<number, RawOpenLigaMatch>();
  for (const m of list) {
    if (
      !m ||
      typeof m.matchID !== 'number' ||
      !Number.isFinite(m.matchID) ||
      !m.team1 ||
      !m.team2 ||
      typeof m.team1.teamId !== 'number' ||
      typeof m.team2.teamId !== 'number' ||
      m.team1.teamId === m.team2.teamId
    ) {
      continue;
    }
    const existing = byId.get(m.matchID);
    if (!existing) {
      byId.set(m.matchID, m);
    } else {
      // Prefer the entry with verified finished result if duplicate matchIDs appear
      const existingValid = existing.matchIsFinished && extractFinalResult(existing) !== null;
      const incomingValid = m.matchIsFinished && extractFinalResult(m) !== null;
      if (!existingValid && incomingValid) {
        byId.set(m.matchID, m);
      }
    }
  }
  return Array.from(byId.values());
}

function parseLeadingSeasonYear(season?: string): string | undefined {
  if (!season) return undefined;
  const match = String(season).match(/\d{4}/);
  return match ? match[0] : String(season);
}

export class OpenLigaDbProvider {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private leagueCache: { leagues: League[]; expiresAt: number } | null = null;
  private discoveredSeasons = new Map<string, string>();
  private matchesCache = new Map<string, CachedMatchesEntry>();
  private standingsCache = new Map<string, { items: RawOpenLigaTableItem[]; expiresAt: number }>();
  private monteCarloCache = new Map<string, SingleModelEvaluation>();
  private inFlightRequests = new Map<string, Promise<{ data: unknown; cached: boolean; cachedAt: string; retrievedAt: string }>>();
  private lastProvenance: DataProvenance | null = null;

  constructor(
    baseUrl: string = '/api/football/openliga',
    fetchFn: typeof fetch = (...args) => fetch(...args)
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  getProviderName(): string {
    return 'OpenLigaDB (Free Public API)';
  }

  getAttribution(): { text: string; url: string } {
    return {
      text: 'Match and standings data provided by OpenLigaDB community (api.openligadb.de)',
      url: 'https://api.openligadb.de',
    };
  }

  getLastProvenance(): DataProvenance | null {
    return this.lastProvenance;
  }

  clearCache(): void {
    this.leagueCache = null;
    this.discoveredSeasons.clear();
    this.matchesCache.clear();
    this.standingsCache.clear();
    this.monteCarloCache.clear();
    this.inFlightRequests.clear();
  }

  private async requestJson<T>(subPath: string): Promise<{ data: T; cached: boolean; cachedAt: string; retrievedAt: string }> {
    const cleanPath = subPath.replace(/^\/+/, '');
    const inflight = this.inFlightRequests.get(cleanPath);
    if (inflight) {
      return inflight as Promise<{ data: T; cached: boolean; cachedAt: string; retrievedAt: string }>;
    }

    const promise = (async () => {
      const res = await this.fetchFn(`${this.baseUrl}/${cleanPath}`);
      const now = new Date().toISOString();

      let json: ProxyEnvelope<T> | T;
      try {
        json = (await res.json()) as ProxyEnvelope<T> | T;
      } catch {
        throw new Error(`OpenLigaDB returned invalid JSON for ${cleanPath} (HTTP ${res.status}).`);
      }

      if (!res.ok) {
        const errMsg =
          typeof json === 'object' && json !== null && 'error' in json && typeof (json as ProxyEnvelope<T>).error === 'string'
            ? (json as ProxyEnvelope<T>).error!
            : `OpenLigaDB request failed with HTTP ${res.status}`;
        throw new Error(errMsg);
      }

      if (typeof json === 'object' && json !== null && 'data' in json) {
        const env = json as ProxyEnvelope<T>;
        return {
          data: env.data as T,
          cached: Boolean(env.cached || env.fromCache),
          cachedAt: env.cachedAt || now,
          retrievedAt: env.retrievedAt || now,
        };
      }

      return {
        data: json as T,
        cached: false,
        cachedAt: now,
        retrievedAt: now,
      };
    })();

    this.inFlightRequests.set(cleanPath, promise);
    try {
      return await promise;
    } finally {
      this.inFlightRequests.delete(cleanPath);
    }
  }

  /**
   * Dynamically fetch available football leagues from OpenLigaDB.
   * Throws an explicit error if upstream is unreachable.
   */
  async getLeagues(): Promise<League[]> {
    const { data: rawLeagues, cached, cachedAt, retrievedAt } = await this.requestJson<RawOpenLigaLeague[]>(
      'getavailableleagues'
    );

    if (!Array.isArray(rawLeagues)) {
      throw new Error('OpenLigaDB getavailableleagues returned unexpected non-array payload.');
    }

    const targetShortcuts = new Set(['bl1', 'bl2', 'bl3', 'dfb']);
    const footballLeagues = rawLeagues.filter(
      (l) => !l.sport || l.sport.sportName === 'Fußball'
    );

    const leaguesMap = new Map<string, RawOpenLigaLeague>();
    const currentYear = new Date().getFullYear();

    for (const l of footballLeagues) {
      const sc = l.leagueShortcut?.toLowerCase();
      if (!sc || !targetShortcuts.has(sc)) continue;
      const seasonNum = parseInt(l.leagueSeason, 10);
      if (isNaN(seasonNum) || seasonNum < currentYear - 3) continue;
      const existing = leaguesMap.get(sc);
      if (!existing || parseInt(existing.leagueSeason, 10) < seasonNum) {
        leaguesMap.set(sc, l);
      }
    }

    // If none of targetShortcuts matched (e.g., future rename), keep top football leagues dynamically
    if (leaguesMap.size === 0) {
      for (const l of footballLeagues.slice(0, 10)) {
        const sc = l.leagueShortcut?.toLowerCase();
        if (!sc) continue;
        const seasonNum = parseInt(l.leagueSeason, 10);
        const existing = leaguesMap.get(sc);
        if (!existing || (!isNaN(seasonNum) && parseInt(existing.leagueSeason, 10) < seasonNum)) {
          leaguesMap.set(sc, l);
        }
      }
    }

    const supported = Array.from(leaguesMap.values());
    if (supported.length === 0) {
      throw new Error('OpenLigaDB returned zero active football competitions.');
    }

    const leagues: League[] = supported.map((l) => {
      const sc = l.leagueShortcut.toLowerCase();
      const seasonStr = String(l.leagueSeason);
      this.discoveredSeasons.set(sc, seasonStr);
      const seasonStart = parseInt(seasonStr, 10);

      // Compute league aggregates strictly from non-expired cached matches/standings if already loaded, else null
      const cachedEntry = this.matchesCache.get(`getmatchdata/${sc}/${seasonStr}`);
      const validCachedEntry = cachedEntry && Date.now() <= cachedEntry.expiresAt ? cachedEntry : undefined;
      const stats = validCachedEntry ? this.computeLeagueStatsFromRaw(validCachedEntry.matches, sc) : null;

      return {
        id: `openliga-${sc}`,
        name: l.leagueName,
        country: 'Germany',
        flag: '🇩🇪',
        season: !isNaN(seasonStart) ? `${seasonStart}/${seasonStart + 1}` : seasonStr,
        matchday: stats?.currentMatchday ?? null,
        totalMatchdays: stats?.totalMatchdays ?? null,
        totalTeams: stats?.totalTeams ?? null,
        averageGoalsPerMatch: stats?.averageGoalsPerMatch ?? null,
        homeWinRate: stats?.homeWinRate ?? null,
        drawRate: stats?.drawRate ?? null,
        awayWinRate: stats?.awayWinRate ?? null,
      };
    });

    this.leagueCache = { leagues, expiresAt: Date.now() + CLIENT_STATIC_TTL_MS };
    this.lastProvenance = {
      source: 'OpenLigaDB Community API',
      timestamp: retrievedAt,
      cached,
      cachedAt,
      retrievedAt,
      qualityIndicator: 'COMMUNITY_UNVERIFIED',
      qualityScore: null,
      sampleSizeMatches: 0,
      sourceType: 'COMMUNITY_MAINTAINED',
      attribution: 'Data provided by OpenLigaDB community (api.openligadb.de)',
      attributionUrl: 'https://api.openligadb.de',
      isHistorical: false,
    };

    return leagues;
  }

  private computeLeagueStatsFromRaw(matches: RawOpenLigaMatch[], shortcut: string): {
    currentMatchday: number | null;
    totalMatchdays: number | null;
    totalTeams: number | null;
    averageGoalsPerMatch: number | null;
    homeWinRate: number | null;
    drawRate: number | null;
    awayWinRate: number | null;
  } {
    const teamIds = new Set<number>();
    const matchdays = new Set<number>();
    const finishedMatchdays: number[] = [];
    let finishedCount = 0;
    let totalGoals = 0;
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;

    for (const m of matches) {
      teamIds.add(m.team1.teamId);
      teamIds.add(m.team2.teamId);
      if (m.group?.groupOrderID) {
        matchdays.add(m.group.groupOrderID);
      }
      if (m.matchIsFinished) {
        const res = extractFinalResult(m);
        if (res) {
          finishedCount++;
          totalGoals += res.home + res.away;
          if (res.home > res.away) homeWins++;
          else if (res.away > res.home) awayWins++;
          else draws++;
          if (m.group?.groupOrderID) finishedMatchdays.push(m.group.groupOrderID);
        }
      }
    }

    const standingsEntry = this.standingsCache.get(`${shortcut}:${matches[0]?.leagueSeason || ''}`);
    const standings = standingsEntry && Date.now() <= standingsEntry.expiresAt ? standingsEntry.items : undefined;
    const totalTeams = standings && standings.length > 0 ? standings.length : teamIds.size > 0 ? teamIds.size : null;

    return {
      currentMatchday: finishedMatchdays.length > 0 ? Math.max(...finishedMatchdays) : matchdays.size > 0 ? Math.min(...Array.from(matchdays)) : null,
      totalMatchdays: matchdays.size > 0 ? Math.max(...Array.from(matchdays)) : null,
      totalTeams,
      averageGoalsPerMatch: finishedCount > 0 ? Math.round((totalGoals / finishedCount) * 100) / 100 : null,
      homeWinRate: finishedCount > 0 ? Math.round((homeWins / finishedCount) * 1000) / 10 : null,
      drawRate: finishedCount > 0 ? Math.round((draws / finishedCount) * 1000) / 10 : null,
      awayWinRate: finishedCount > 0 ? Math.round((awayWins / finishedCount) * 1000) / 10 : null,
    };
  }

  /**
   * Fetch standings table for a shortcut and season. Returns [] if league has no table (e.g., cup).
   */
  async getStandings(shortcut: string, season: string): Promise<RawOpenLigaTableItem[]> {
    const key = `${shortcut}:${season}`;
    const existing = this.standingsCache.get(key);
    if (existing && Date.now() <= existing.expiresAt) {
      return existing.items;
    }
    if (existing) {
      this.standingsCache.delete(key);
    }

    try {
      const { data: items } = await this.requestJson<RawOpenLigaTableItem[]>(
        `getbltable/${shortcut}/${season}`
      );
      if (Array.isArray(items)) {
        this.standingsCache.set(key, {
          items,
          expiresAt: Date.now() + CLIENT_STATIC_TTL_MS,
        });
        return items;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch raw matches for a league shortcut and optional season.
   * Deduplicates records, rejects invalid fixtures, honors client TTL, and throws on HTTP/JSON failure.
   */
  async fetchRawMatchesWithMeta(shortcut: string, season?: string): Promise<CachedMatchesEntry> {
    const path = season ? `getmatchdata/${shortcut}/${season}` : `getmatchdata/${shortcut}`;
    const existing = this.matchesCache.get(path);
    if (existing && Date.now() <= existing.expiresAt) {
      return existing;
    }
    if (existing) {
      this.matchesCache.delete(path);
    }

    const { data: rawList, cached, cachedAt, retrievedAt } = await this.requestJson<RawOpenLigaMatch[]>(path);
    if (!Array.isArray(rawList)) {
      throw new Error(`OpenLigaDB ${path} returned non-array match payload.`);
    }

    const list = sanitizeAndDeduplicateOpenLigaMatches(rawList);
    const hasUnfinished = list.some((m) => !m.matchIsFinished);
    const ttlMs = hasUnfinished ? CLIENT_LIVE_TTL_MS : CLIENT_STATIC_TTL_MS;

    if (this.matchesCache.size >= MAX_CACHE_SEASONS) {
      const now = Date.now();
      for (const [k, v] of this.matchesCache.entries()) {
        if (now > v.expiresAt) this.matchesCache.delete(k);
      }
      if (this.matchesCache.size >= MAX_CACHE_SEASONS) {
        const oldestKey = this.matchesCache.keys().next().value;
        if (oldestKey) this.matchesCache.delete(oldestKey);
      }
    }

    const entry: CachedMatchesEntry = {
      matches: list,
      cached,
      cachedAt,
      retrievedAt,
      expiresAt: Date.now() + ttlMs,
    };
    this.matchesCache.set(path, entry);
    return entry;
  }

  async fetchRawMatches(shortcut: string, season?: string): Promise<RawOpenLigaMatch[]> {
    const entry = await this.fetchRawMatchesWithMeta(shortcut, season);
    return entry.matches;
  }

  private async resolveSeasonForShortcut(shortcut: string, requestedSeason?: string): Promise<string> {
    const parsedReq = parseLeadingSeasonYear(requestedSeason);
    if (parsedReq) return parsedReq;

    if (this.discoveredSeasons.has(shortcut)) {
      return this.discoveredSeasons.get(shortcut)!;
    }

    try {
      await this.getLeagues();
      if (this.discoveredSeasons.has(shortcut)) {
        return this.discoveredSeasons.get(shortcut)!;
      }
    } catch (err) {
      // If getavailableleagues fails, rethrow so caller knows provider is unavailable
      throw err;
    }

    return String(new Date().getFullYear());
  }

  /**
   * Convert OpenLigaDB matches into standardized Match objects.
   * Honors season, status, and date filters. Computes empirical chronological Elo.
   */
  async getMatches(options?: {
    leagueId?: string;
    season?: string;
    date?: string;
    status?: string;
  }): Promise<Match[]> {
    const shortcut = (options?.leagueId || 'openliga-bl1').replace('openliga-', '').toLowerCase();
    let season = await this.resolveSeasonForShortcut(shortcut, options?.season);

    let entry = await this.fetchRawMatchesWithMeta(shortcut, season);

    // Only check previous season if explicit season was NOT requested and current returned 0 matches
    if (entry.matches.length === 0 && !options?.season) {
      const prevYear = String((parseInt(season, 10) || new Date().getFullYear()) - 1);
      const prevEntry = await this.fetchRawMatchesWithMeta(shortcut, prevYear);
      if (prevEntry.matches.length > 0) {
        entry = prevEntry;
        season = prevYear;
      }
    }

    const standings = await this.getStandings(shortcut, season);

    // Build chronological historical list for empirical Elo calculation across the season
    const eloInput: HistoricalMatchForElo[] = [];
    for (const m of entry.matches) {
      if (!m.matchIsFinished) continue;
      const res = extractFinalResult(m);
      if (!res) continue;
      eloInput.push({
        homeTeamId: String(m.team1.teamId),
        awayTeamId: String(m.team2.teamId),
        homeGoals: res.home,
        awayGoals: res.away,
        utcDate: m.matchDateTimeUTC || m.matchDateTime,
      });
    }
    const empiricalEloMap = computeEmpiricalEloFromMatches(eloInput, undefined, 5);

    const mapped = entry.matches.map((raw) =>
      this.mapRawMatch(raw, shortcut, standings.length > 0, empiricalEloMap, entry)
    );

    if (mapped.length > 0) {
      this.lastProvenance = mapped[0].provenance;
    }

    let filtered = mapped;
    if (options?.status) {
      filtered = filtered.filter((m) => m.status === options.status);
    }
    if (options?.date) {
      filtered = filtered.filter((m) => m.utcDate.startsWith(options.date!));
    }

    return filtered;
  }

  private mapRawMatch(
    raw: RawOpenLigaMatch,
    shortcut: string,
    hasStandings: boolean,
    empiricalEloMap: Map<string, { rating: number | null; rawRating: number; matchesPlayed: number }>,
    entry: { cached: boolean; cachedAt: string; retrievedAt: string }
  ): Match {
    const res = extractFinalResult(raw);
    const isFinished = raw.matchIsFinished;
    const homeScore = isFinished && res ? res.home : null;
    const awayScore = isFinished && res ? res.away : null;
    const htHome = isFinished && res ? res.htHome : null;
    const htAway = isFinished && res ? res.htAway : null;
    const matchDate = raw.matchDateTimeUTC || raw.matchDateTime;

    const homeEloEntry = empiricalEloMap.get(String(raw.team1.teamId));
    const awayEloEntry = empiricalEloMap.get(String(raw.team2.teamId));
    const minSample = Math.min(homeEloEntry?.matchesPlayed ?? 0, awayEloEntry?.matchesPlayed ?? 0);

    // Deterministic data completeness score calculated strictly from verifiable fields
    const completenessScore =
      (minSample >= 10 ? 40 : minSample >= 5 ? 25 : minSample * 4) +
      (hasStandings ? 25 : 0) +
      (raw.group ? 15 : 0) +
      (isFinished && homeScore !== null ? 20 : 10);

    const provenance: DataProvenance = {
      source: 'OpenLigaDB Community API',
      timestamp: entry.retrievedAt,
      cached: entry.cached,
      cachedAt: entry.cachedAt,
      retrievedAt: entry.retrievedAt,
      qualityIndicator: 'COMMUNITY_UNVERIFIED',
      qualityScore: Math.min(100, completenessScore),
      sampleSizeMatches: minSample,
      sourceType: 'COMMUNITY_MAINTAINED',
      attribution: 'Data provided by OpenLigaDB community (api.openligadb.de)',
      attributionUrl: 'https://api.openligadb.de',
      isHistorical: isFinished,
      completenessBreakdown: {
        hasScores: homeScore !== null,
        hasStandings,
        hasXG: false,
        hasLineups: false,
        sampleSizeMatches: minSample,
      },
    };

    const stadiumName = raw.location?.locationStadium?.trim() || null;

    const homeTeam: Team = {
      id: `openliga-team-${raw.team1.teamId}`,
      name: raw.team1.teamName,
      shortName: raw.team1.shortName || raw.team1.teamName,
      code: (raw.team1.shortName || raw.team1.teamName).slice(0, 3).toUpperCase(),
      crest: raw.team1.teamIconUrl || '',
      country: 'Germany',
      stadium: stadiumName,
      leagueId: `openliga-${shortcut}`,
      eloRating: homeEloEntry?.rating ?? null,
    };

    const awayTeam: Team = {
      id: `openliga-team-${raw.team2.teamId}`,
      name: raw.team2.teamName,
      shortName: raw.team2.shortName || raw.team2.teamName,
      code: (raw.team2.shortName || raw.team2.teamName).slice(0, 3).toUpperCase(),
      crest: raw.team2.teamIconUrl || '',
      country: 'Germany',
      stadium: null,
      leagueId: `openliga-${shortcut}`,
      eloRating: awayEloEntry?.rating ?? null,
    };

    return {
      id: `openliga-${raw.matchID}`,
      leagueId: `openliga-${shortcut}`,
      leagueName: raw.leagueName || shortcut.toUpperCase(),
      season: String(raw.leagueSeason),
      matchday: raw.group?.groupOrderID ?? null,
      homeTeam,
      awayTeam,
      utcDate: matchDate,
      status: isFinished ? 'FINISHED' : 'SCHEDULED',
      score: {
        home: homeScore,
        away: awayScore,
        htHome,
        htAway,
      },
      venue: stadiumName,
      round: raw.group?.groupName,
      matchCategory: isFinished ? 'HISTORICAL' : 'LIVE_UPCOMING',
      isDemoData: false,
      provenance,
    };
  }

  /**
   * Retrieve a single match by ID.
   * Uses already cached season matches first to avoid N+1 API calls.
   */
  async getMatchById(id: string): Promise<Match | null> {
    const rawMatchId = parseInt(id.replace('openliga-', ''), 10);
    if (isNaN(rawMatchId)) return null;

    // 1. Check cached season lists first
    for (const [key, entry] of this.matchesCache.entries()) {
      const found = entry.matches.find((m) => m.matchID === rawMatchId);
      if (found) {
        const shortcut = (found.leagueShortcut || key.split('/')[1] || 'bl1').toLowerCase();
        const season = String(found.leagueSeason || '');
        const standings = season ? await this.getStandings(shortcut, season) : [];
        const eloInput: HistoricalMatchForElo[] = [];
        for (const m of entry.matches) {
          if (!m.matchIsFinished) continue;
          const res = extractFinalResult(m);
          if (!res) continue;
          eloInput.push({
            homeTeamId: String(m.team1.teamId),
            awayTeamId: String(m.team2.teamId),
            homeGoals: res.home,
            awayGoals: res.away,
            utcDate: m.matchDateTimeUTC || m.matchDateTime,
          });
        }
        const eloMap = computeEmpiricalEloFromMatches(eloInput, undefined, 5);
        return this.mapRawMatch(found, shortcut, standings.length > 0, eloMap, entry);
      }
    }

    // 2. Fetch single match endpoint
    const { data: raw, cached, cachedAt, retrievedAt } = await this.requestJson<RawOpenLigaMatch>(
      `getmatchdata/${rawMatchId}`
    );
    if (!raw || !raw.matchID) return null;

    const shortcut = (raw.leagueShortcut || 'bl1').toLowerCase();
    const season = String(raw.leagueSeason || '');
    const seasonMatches = await this.getMatches({
      leagueId: `openliga-${shortcut}`,
      season: season || undefined,
    });
    const matched = seasonMatches.find((m) => m.id === id);
    if (matched) return matched;

    return this.mapRawMatch(raw, shortcut, false, new Map(), { cached, cachedAt, retrievedAt });
  }

  /**
   * Calculate strictly pre-match statistics and empirical form from finished matches < T.
   * Never invents missing stats (xG, possession, shots, lineups, injuries remain null).
   * Never uses hardcoded attack/defense constants; marks hasSufficientData=false when < 5 matches.
   */
  async getMatchStatistics(match: Match): Promise<MatchStatistics> {
    const shortcut = match.leagueId.replace('openliga-', '').toLowerCase();
    const season = parseLeadingSeasonYear(match.season) || (await this.resolveSeasonForShortcut(shortcut));
    const entry = await this.fetchRawMatchesWithMeta(shortcut, season);
    const allMatches = entry.matches;

    const matchTime = new Date(match.utcDate).getTime();
    const hasValidMatchTime = Number.isFinite(matchTime);
    const rawTargetId = parseInt(match.id.replace('openliga-', ''), 10);

    // Strictly finished matches played strictly BEFORE this match kickoff.
    // Never accept matches when target kickoff timestamp is invalid/NaN (prevents lookahead leakage).
    const priorFinishedMatches = hasValidMatchTime
      ? allMatches.filter((m) => {
          if (!m.matchIsFinished) return false;
          if (m.matchID === rawTargetId) return false;
          if (extractFinalResult(m) === null) return false;
          const t = new Date(m.matchDateTimeUTC || m.matchDateTime).getTime();
          return Number.isFinite(t) && t < matchTime;
        })
      : [];

    const homeRawTeamId = parseInt(match.homeTeam.id.replace('openliga-team-', ''), 10);
    const awayRawTeamId = parseInt(match.awayTeam.id.replace('openliga-team-', ''), 10);

    // Build chronological Elo dataset strictly before kickoff
    const eloInput: HistoricalMatchForElo[] = [];
    for (const m of priorFinishedMatches) {
      const res = extractFinalResult(m);
      if (!res) continue;
      eloInput.push({
        homeTeamId: String(m.team1.teamId),
        awayTeamId: String(m.team2.teamId),
        homeGoals: res.home,
        awayGoals: res.away,
        utcDate: m.matchDateTimeUTC || m.matchDateTime,
      });
    }
    const eloBeforeKickoff = hasValidMatchTime
      ? computeEmpiricalEloFromMatches(eloInput, matchTime, 5)
      : new Map();
    const homeElo = eloBeforeKickoff.get(String(homeRawTeamId))?.rating ?? null;
    const awayElo = eloBeforeKickoff.get(String(awayRawTeamId))?.rating ?? null;

    const homeForm = this.extractTeamForm(homeRawTeamId, priorFinishedMatches, eloInput, matchTime);
    const awayForm = this.extractTeamForm(awayRawTeamId, priorFinishedMatches, eloInput, matchTime);
    const headToHead = this.extractHeadToHead(homeRawTeamId, awayRawTeamId, priorFinishedMatches);

    const hasSufficientSample = hasValidMatchTime && homeForm.allPrior.length >= 5 && awayForm.allPrior.length >= 5;

    // Empirical goal intensity estimation strictly from priorFinishedMatches (< T)
    let homeExpectedGoals: number | null = null;
    let awayExpectedGoals: number | null = null;
    let totalExpectedGoals: number | null = null;
    let unavailableReason: string | undefined;

    if (hasSufficientSample) {
      let totalLeagueGoals = 0;
      let totalLeagueHomeGoals = 0;
      let totalLeagueAwayGoals = 0;
      let leagueCount = 0;

      for (const m of priorFinishedMatches) {
        const res = extractFinalResult(m);
        if (!res) continue;
        leagueCount++;
        totalLeagueHomeGoals += res.home;
        totalLeagueAwayGoals += res.away;
        totalLeagueGoals += res.home + res.away;
      }

      if (leagueCount >= 10 && totalLeagueGoals > 0) {
        const PRIOR_MATCH_WEIGHT = 5;
        const avgHomeGoalsLeague = totalLeagueHomeGoals / leagueCount;
        const avgAwayGoalsLeague = totalLeagueAwayGoals / leagueCount;
        const avgGoalsPerSide = totalLeagueGoals / (leagueCount * 2);

        const shrinkRate = (goals: number, matchesPlayed: number, baseline: number): number =>
          (goals + PRIOR_MATCH_WEIGHT * baseline) / (matchesPlayed + PRIOR_MATCH_WEIGHT);

        const useHomeVenue = homeForm.homeOnly.played >= 3;
        const useAwayVenue = awayForm.awayOnly.played >= 3;

        const homeAttackBaseline = useHomeVenue ? avgHomeGoalsLeague : avgGoalsPerSide;
        const awayDefenseBaseline = useAwayVenue ? avgHomeGoalsLeague : avgGoalsPerSide;
        const awayAttackBaseline = useAwayVenue ? avgAwayGoalsLeague : avgGoalsPerSide;
        const homeDefenseBaseline = useHomeVenue ? avgAwayGoalsLeague : avgGoalsPerSide;

        const shrunkHomeScored = useHomeVenue
          ? shrinkRate(homeForm.homeOnly.scored, homeForm.homeOnly.played, homeAttackBaseline)
          : shrinkRate(homeForm.overall.scored, homeForm.overall.played, homeAttackBaseline);
        const shrunkAwayConceded = useAwayVenue
          ? shrinkRate(awayForm.awayOnly.conceded, awayForm.awayOnly.played, awayDefenseBaseline)
          : shrinkRate(awayForm.overall.conceded, awayForm.overall.played, awayDefenseBaseline);

        const shrunkAwayScored = useAwayVenue
          ? shrinkRate(awayForm.awayOnly.scored, awayForm.awayOnly.played, awayAttackBaseline)
          : shrinkRate(awayForm.overall.scored, awayForm.overall.played, awayAttackBaseline);
        const shrunkHomeConceded = useHomeVenue
          ? shrinkRate(homeForm.homeOnly.conceded, homeForm.homeOnly.played, homeDefenseBaseline)
          : shrinkRate(homeForm.overall.conceded, homeForm.overall.played, homeDefenseBaseline);

        const homeAttack = shrunkHomeScored / Math.max(0.5, homeAttackBaseline);
        const awayDefense = shrunkAwayConceded / Math.max(0.5, awayDefenseBaseline);
        const awayAttack = shrunkAwayScored / Math.max(0.5, awayAttackBaseline);
        const homeDefense = shrunkHomeConceded / Math.max(0.5, homeDefenseBaseline);

        homeExpectedGoals = Math.max(
          0.35,
          Math.min(4.0, Math.round(homeAttack * awayDefense * avgHomeGoalsLeague * 100) / 100)
        );
        awayExpectedGoals = Math.max(
          0.35,
          Math.min(4.0, Math.round(awayAttack * homeDefense * avgAwayGoalsLeague * 100) / 100)
        );
        totalExpectedGoals = Math.round((homeExpectedGoals + awayExpectedGoals) * 100) / 100;
      } else {
        unavailableReason = `Insufficient league-wide historical matches prior to kickoff (${leagueCount} available; minimum 10 required).`;
      }
    } else if (!hasValidMatchTime) {
      unavailableReason = 'Invalid or missing target match kickoff timestamp; cannot verify strict pre-match chronology.';
    } else {
      unavailableReason = `Insufficient verified pre-match sample size (home: ${homeForm.allPrior.length}, away: ${awayForm.allPrior.length}; minimum 5 completed prior matches required for each team).`;
    }

    const minSample = Math.min(homeForm.allPrior.length, awayForm.allPrior.length);
    const hasElo = homeElo !== null && awayElo !== null;
    const hasRest = homeForm.restDays !== null && awayForm.restDays !== null;
    const completenessScore = Math.min(
      100,
      (minSample >= 10 ? 40 : minSample >= 5 ? 25 + (minSample - 5) * 3 : minSample * 4) +
        (hasSufficientSample ? 20 : 0) +
        (hasElo ? 15 : 0) +
        (hasRest ? 10 : 0)
    );

    const provenance: DataProvenance = {
      source: 'OpenLigaDB Community API (api.openligadb.de)',
      timestamp: entry.retrievedAt,
      cached: entry.cached,
      cachedAt: entry.cachedAt,
      retrievedAt: entry.retrievedAt,
      qualityIndicator: hasSufficientSample ? 'COMMUNITY_UNVERIFIED' : 'PARTIAL',
      qualityScore: completenessScore,
      sampleSizeMatches: minSample,
      sourceType: 'COMMUNITY_MAINTAINED',
      attribution: 'Match results from OpenLigaDB community. xG, shots, possession, lineups, and injuries are not recorded by this provider.',
      attributionUrl: 'https://api.openligadb.de',
      isHistorical: match.status === 'FINISHED',
      completenessBreakdown: {
        hasScores: priorFinishedMatches.length > 0,
        hasStandings: false,
        hasXG: false,
        hasLineups: false,
        sampleSizeMatches: minSample,
      },
    };

    const buildSplit = (agg: FormAggregate): SplitStats => ({
      matchesPlayed: agg.played,
      wins: agg.wins,
      draws: agg.draws,
      losses: agg.losses,
      goalsScored: agg.scored,
      goalsConceded: agg.conceded,
      avgGoalsScored: agg.avgScored,
      avgGoalsConceded: agg.avgConceded,
      totalXG: null,
      totalXGA: null,
      avgXG: null,
      avgXGA: null,
      cleanSheets: agg.cleanSheets,
      failedToScore: agg.failedToScore,
      avgPossession: null,
      avgShotsOnTarget: null,
      avgShotsConcededOnTarget: null,
      shotConversionRate: null,
    });

    const homeTeamStats: TeamStatistics = {
      teamId: match.homeTeam.id,
      teamName: match.homeTeam.name,
      recentForm: homeForm.letters.slice(-5),
      formMatches: homeForm.matches,
      overall: buildSplit(homeForm.overall),
      homeOrAwaySplit: buildSplit(homeForm.homeOnly),
      eloRating: homeElo,
      opponentStrengthIndex: homeForm.opponentStrengthIndex,
      restDays: homeForm.restDays,
      fixtureCongestionIndex: homeForm.fixtureCongestionIndex,
      confirmedLineupAvailable: null,
      injuriesCount: null,
      keyPlayersMissing: [],
      isDemoData: false,
      provenance,
    };

    const awayTeamStats: TeamStatistics = {
      teamId: match.awayTeam.id,
      teamName: match.awayTeam.name,
      recentForm: awayForm.letters.slice(-5),
      formMatches: awayForm.matches,
      overall: buildSplit(awayForm.overall),
      homeOrAwaySplit: buildSplit(awayForm.awayOnly),
      eloRating: awayElo,
      opponentStrengthIndex: awayForm.opponentStrengthIndex,
      restDays: awayForm.restDays,
      fixtureCongestionIndex: awayForm.fixtureCongestionIndex,
      confirmedLineupAvailable: null,
      injuriesCount: null,
      keyPlayersMissing: [],
      isDemoData: false,
      provenance,
    };

    const h2hGoals = headToHead.reduce((acc, h) => {
      const parts = h.score.split('-').map((s) => parseInt(s.trim(), 10));
      return acc + (parts[0] || 0) + (parts[1] || 0);
    }, 0);

    return {
      matchId: match.id,
      homeTeamStats,
      awayTeamStats,
      headToHead,
      headToHeadSummary: {
        totalMatches: headToHead.length,
        homeWins: headToHead.filter((h) => h.winner === 'HOME').length,
        awayWins: headToHead.filter((h) => h.winner === 'AWAY').length,
        draws: headToHead.filter((h) => h.winner === 'DRAW').length,
        totalGoals: h2hGoals,
        avgGoals: headToHead.length > 0 ? Math.round((h2hGoals / headToHead.length) * 100) / 100 : null,
      },
      homeExpectedGoals,
      awayExpectedGoals,
      totalExpectedGoals,
      observedMatchXG: null,
      hasSufficientData: hasSufficientSample && homeExpectedGoals !== null && awayExpectedGoals !== null,
      unavailableReason,
      isDemoData: false,
      provenance,
    };
  }

  private extractTeamForm(
    teamId: number,
    priorFinishedMatches: RawOpenLigaMatch[],
    eloInput: HistoricalMatchForElo[],
    targetMatchTimeMs: number
  ) {
    const relevant = priorFinishedMatches
      .filter((m) => m.team1.teamId === teamId || m.team2.teamId === teamId)
      .sort(
        (a, b) =>
          new Date(a.matchDateTimeUTC || a.matchDateTime).getTime() -
          new Date(b.matchDateTimeUTC || b.matchDateTime).getTime()
      );

    const overallAgg = createEmptyAggregate();
    const homeAgg = createEmptyAggregate();
    const awayAgg = createEmptyAggregate();

    for (const m of relevant) {
      const res = extractFinalResult(m);
      if (!res) continue;
      const isHome = m.team1.teamId === teamId;
      const gf = isHome ? res.home : res.away;
      const ga = isHome ? res.away : res.home;
      recordMatchInAggregate(overallAgg, gf, ga);
      if (isHome) recordMatchInAggregate(homeAgg, gf, ga);
      else recordMatchInAggregate(awayAgg, gf, ga);
    }

    finalizeAggregate(overallAgg);
    finalizeAggregate(homeAgg);
    finalizeAggregate(awayAgg);

    const last12 = relevant.slice(-12);
    const matches: FormMatchRecord[] = [];
    const letters: Array<'W' | 'D' | 'L'> = [];
    const oppElos: number[] = [];

    for (let i = 0; i < last12.length; i++) {
      const m = last12[i];
      const res = extractFinalResult(m);
      if (!res) continue;

      const isHome = m.team1.teamId === teamId;
      const opponent = isHome ? m.team2 : m.team1;
      const teamGoals = isHome ? res.home : res.away;
      const oppGoals = isHome ? res.away : res.home;

      const result: 'W' | 'D' | 'L' = teamGoals > oppGoals ? 'W' : teamGoals < oppGoals ? 'L' : 'D';
      const thisMatchTime = new Date(m.matchDateTimeUTC || m.matchDateTime).getTime();

      // Empirical opponent Elo strictly before that prior match
      const oppEloMap = computeEmpiricalEloFromMatches(eloInput, thisMatchTime, 5);
      const oppElo = oppEloMap.get(String(opponent.teamId))?.rating ?? null;
      if (oppElo !== null) oppElos.push(oppElo);

      // Measurable rest days since team's previous finished match
      let prevIdx = relevant.indexOf(m) - 1;
      let restDays: number | null = null;
      if (prevIdx >= 0) {
        const prevTime = new Date(relevant[prevIdx].matchDateTimeUTC || relevant[prevIdx].matchDateTime).getTime();
        if (!isNaN(prevTime) && !isNaN(thisMatchTime)) {
          restDays = Math.max(0, Math.round((thisMatchTime - prevTime) / (1000 * 60 * 60 * 24)));
        }
      }

      letters.push(result);
      matches.push({
        opponent: opponent.shortName || opponent.teamName,
        opponentCode: (opponent.shortName || opponent.teamName).slice(0, 3).toUpperCase(),
        opponentElo: oppElo,
        isHome,
        score: `${teamGoals}-${oppGoals}`,
        result,
        date: (m.matchDateTimeUTC || m.matchDateTime).split('T')[0],
        goalsFor: teamGoals,
        goalsAgainst: oppGoals,
        xG: null,
        xGA: null,
        shots: null,
        shotsOnTarget: null,
        shotsConceded: null,
        possession: null,
        restDays,
      });
    }

    // Rest days leading into the target match
    let restDaysBeforeTarget: number | null = null;
    if (relevant.length > 0 && !isNaN(targetMatchTimeMs)) {
      const lastTime = new Date(
        relevant[relevant.length - 1].matchDateTimeUTC || relevant[relevant.length - 1].matchDateTime
      ).getTime();
      if (!isNaN(lastTime) && targetMatchTimeMs > lastTime) {
        restDaysBeforeTarget = Math.max(0, Math.round((targetMatchTimeMs - lastTime) / (1000 * 60 * 60 * 24)));
      }
    }

    // Measurable fixture congestion in the 21 days strictly prior to kickoff
    let fixtureCongestionIndex: number | null = null;
    if (relevant.length > 0 && Number.isFinite(targetMatchTimeMs)) {
      const window21dMs = 21 * 24 * 60 * 60 * 1000;
      const recent21d = relevant.filter((m) => {
        const t = new Date(m.matchDateTimeUTC || m.matchDateTime).getTime();
        return Number.isFinite(t) && t < targetMatchTimeMs && targetMatchTimeMs - t <= window21dMs;
      }).length;
      fixtureCongestionIndex = Math.min(100, recent21d * 20);
    }

    const opponentStrengthIndex =
      oppElos.length > 0 ? Math.round(oppElos.reduce((a, b) => a + b, 0) / oppElos.length) : null;

    return {
      allPrior: relevant,
      matches,
      letters,
      overall: overallAgg,
      homeOnly: homeAgg,
      awayOnly: awayAgg,
      opponentStrengthIndex,
      restDays: restDaysBeforeTarget,
      fixtureCongestionIndex,
    };
  }

  private extractHeadToHead(
    homeTeamId: number,
    awayTeamId: number,
    priorFinishedMatches: RawOpenLigaMatch[]
  ): HeadToHeadMatch[] {
    const h2hRaw = priorFinishedMatches
      .filter(
        (m) =>
          (m.team1.teamId === homeTeamId && m.team2.teamId === awayTeamId) ||
          (m.team1.teamId === awayTeamId && m.team2.teamId === homeTeamId)
      )
      .sort(
        (a, b) =>
          new Date(b.matchDateTimeUTC || b.matchDateTime).getTime() -
          new Date(a.matchDateTimeUTC || a.matchDateTime).getTime()
      );

    return h2hRaw.slice(0, 5).map((m) => {
      const res = extractFinalResult(m);
      const p1 = res?.home ?? 0;
      const p2 = res?.away ?? 0;

      let winner: 'HOME' | 'AWAY' | 'DRAW' = 'DRAW';
      if (p1 > p2) winner = 'HOME';
      else if (p2 > p1) winner = 'AWAY';

      return {
        date: (m.matchDateTimeUTC || m.matchDateTime).split('T')[0],
        homeTeamName: m.team1.shortName || m.team1.teamName,
        awayTeamName: m.team2.shortName || m.team2.teamName,
        score: `${p1}-${p2}`,
        winner,
        competition: m.leagueName || 'OpenLigaDB',
        homeXG: null,
        awayXG: null,
      };
    });
  }

  /**
   * Calculate prediction or genuine ABSTAIN when insufficient sample / high uncertainty.
   * Monte Carlo 10,000 simulation is lazy/cached (`includeMonteCarlo: true` for match detail).
   */
  async calculatePrediction(
    match: Match,
    stats: MatchStatistics,
    options?: {
      includeMonteCarlo?: boolean;
      empiricalBacktest?: EmpiricalBacktestReference | null;
      calibrationHistory?: HistoryRecord[];
    }
  ): Promise<Prediction> {
    if (
      match.isDemoData ||
      stats.isDemoData ||
      stats.homeTeamStats?.isDemoData ||
      stats.awayTeamStats?.isDemoData
    ) {
      throw new Error('Refusing demo-contaminated match or statistics inside OpenLigaDbProvider.');
    }

    const calculatedAt = new Date().toISOString();
    const sampleSize = Math.min(
      stats.homeTeamStats.formMatches.length,
      stats.awayTeamStats.formMatches.length
    );
    const preMatchXGAvailable =
      typeof stats.homeTeamStats.overall?.avgXG === 'number' &&
      typeof stats.awayTeamStats.overall?.avgXG === 'number';

    const rawHomeXG = stats.homeExpectedGoals;
    const rawAwayXG = stats.awayExpectedGoals;
    const hasFiniteXG =
      typeof rawHomeXG === 'number' &&
      typeof rawAwayXG === 'number' &&
      Number.isFinite(rawHomeXG) &&
      Number.isFinite(rawAwayXG) &&
      rawHomeXG > 0 &&
      rawAwayXG > 0;

    if (
      !stats.hasSufficientData ||
      typeof rawHomeXG !== 'number' ||
      typeof rawAwayXG !== 'number' ||
      !Number.isFinite(rawHomeXG) ||
      !Number.isFinite(rawAwayXG) ||
      rawHomeXG <= 0 ||
      rawAwayXG <= 0
    ) {
      const abstainPillars = computeSmartConfidence(
        null,
        [],
        stats.homeTeamStats,
        stats.awayTeamStats,
        options?.empiricalBacktest
      );
      const reason =
        stats.unavailableReason ||
        (!hasFiniteXG && stats.hasSufficientData
          ? 'Invalid or non-finite expected goal intensity; prediction abstained for data integrity.'
          : abstainPillars.abstainReason) ||
        'Prediction unavailable due to insufficient verified pre-match data.';
      return {
        matchId: match.id,
        calculatedAt,
        modelType: 'ABSTAIN',
        probabilities: null,
        rawProbabilities: null,
        expectedScore: null,
        topScorelines: [],
        modelEvaluations: [],
        confidence: null,
        confidenceScore: null,
        abstainReason: reason,
        confidencePillars: {
          ...abstainPillars,
          decision: 'ABSTAIN_DATA_DEFICIT',
          abstainReason: reason,
        },
        metricsExplanation: reason,
        isDemoData: false,
        sampleSizeMatches: sampleSize,
        preMatchXGAvailable,
        historicalValidationAvailable: false,
        provenance: stats.provenance,
      };
    }

    const homeXG: number = rawHomeXG;
    const awayXG: number = rawAwayXG;

    const { poissonEval, dixonColesEval } = evaluateDixonColesComparison(homeXG, awayXG);
    const modelEvaluations: SingleModelEvaluation[] = [poissonEval, dixonColesEval];

    if (
      typeof stats.homeTeamStats.eloRating === 'number' &&
      Number.isFinite(stats.homeTeamStats.eloRating) &&
      typeof stats.awayTeamStats.eloRating === 'number' &&
      Number.isFinite(stats.awayTeamStats.eloRating)
    ) {
      modelEvaluations.push(
        evaluateEloModel(stats.homeTeamStats.eloRating, stats.awayTeamStats.eloRating)
      );
    }

    if (options?.includeMonteCarlo) {
      const mcKey = `${match.id}:${homeXG}:${awayXG}`;
      let mcEval = this.monteCarloCache.get(mcKey);
      if (!mcEval) {
        if (this.monteCarloCache.size >= MAX_MONTE_CARLO_CACHE) {
          const oldest = this.monteCarloCache.keys().next().value;
          if (oldest) this.monteCarloCache.delete(oldest);
        }
        mcEval = runMonteCarloSimulation(homeXG, awayXG, 10000).evaluation;
        this.monteCarloCache.set(mcKey, mcEval);
      }
      modelEvaluations.push(mcEval);
    }

    const dcProbabilities = calculatePoissonProbabilities(homeXG, awayXG, 7, true);
    const markets = dcProbabilities.markets;
    const topScorelines = dcProbabilities.topScorelines;

    const confidencePillars = computeSmartConfidence(
      markets,
      modelEvaluations,
      stats.homeTeamStats,
      stats.awayTeamStats,
      options?.empiricalBacktest
    );
    const historicalValidationAvailable = typeof confidencePillars.historicalAccuracy === 'number';

    if (sampleSize < 5 || confidencePillars.decision.startsWith('ABSTAIN')) {
      const reason =
        confidencePillars.abstainReason ||
        'Prediction abstained due to insufficient sample size or elevated cross-model uncertainty.';
      return {
        matchId: match.id,
        calculatedAt,
        modelType: 'ABSTAIN',
        probabilities: null,
        rawProbabilities: null,
        expectedScore: null,
        topScorelines: [],
        modelEvaluations,
        confidence: null,
        confidenceScore: null,
        abstainReason: reason,
        confidencePillars,
        metricsExplanation: reason,
        isDemoData: false,
        sampleSizeMatches: sampleSize,
        preMatchXGAvailable,
        historicalValidationAvailable,
        provenance: stats.provenance,
      };
    }

    const calibrated = calibrateMarketProbabilities(
      markets,
      match.utcDate,
      options?.calibrationHistory ?? []
    );

    const confidenceLevel: Exclude<Prediction['confidence'], null> =
      confidencePillars.decision === 'RECOMMENDED_ANALYSIS' ? 'HIGH' : 'MEDIUM';

    const rel = confidencePillars.dataReliability ?? 0;
    const agr = confidencePillars.modelAgreement ?? 50;
    const hist = confidencePillars.historicalAccuracy;
    const confidenceScore =
      hist !== null
        ? Math.round(rel * 0.35 + agr * 0.4 + hist * 0.25)
        : Math.round(rel * 0.45 + agr * 0.55);

    const calibrationNote = calibrated.status.applied
      ? ` Causal temperature calibration applied (${calibrated.status.sampleCount} prior fixtures < kickoff).`
      : ` Raw Gamma-Poisson probabilities (causal calibration not trained: ${calibrated.status.sampleCount}/${calibrated.status.minRequired} prior fixtures).`;

    return {
      matchId: match.id,
      calculatedAt,
      modelType: 'ENSEMBLE_VALIDATED',
      probabilities: calibrated.probabilities,
      rawProbabilities: markets,
      calibrationStatus: calibrated.status,
      expectedScore: {
        home: Math.round(homeXG * 10) / 10,
        away: Math.round(awayXG * 10) / 10,
        mostLikelyScore: topScorelines[0]?.score || '1 - 1',
        probability: topScorelines[0]?.probability ?? 0,
      },
      topScorelines,
      modelEvaluations,
      confidence: confidenceLevel,
      confidenceScore,
      confidencePillars,
      metricsExplanation: `Calculated strictly from ${sampleSize}+ prior OpenLigaDB results with Gamma-Poisson shrinkage and Dixon-Coles intensity estimation.${calibrationNote}${options?.includeMonteCarlo ? ' Verified with 10,000 Monte Carlo runs.' : ''}`,
      isDemoData: false,
      sampleSizeMatches: sampleSize,
      preMatchXGAvailable,
      historicalValidationAvailable,
      provenance: stats.provenance,
    };
  }
}

interface FormAggregate {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
  avgScored: number;
  avgConceded: number;
  cleanSheets: number;
  failedToScore: number;
}

function createEmptyAggregate(): FormAggregate {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    scored: 0,
    conceded: 0,
    avgScored: 0,
    avgConceded: 0,
    cleanSheets: 0,
    failedToScore: 0,
  };
}

function recordMatchInAggregate(agg: FormAggregate, gf: number, ga: number): void {
  agg.played++;
  agg.scored += gf;
  agg.conceded += ga;
  if (gf > ga) agg.wins++;
  else if (gf < ga) agg.losses++;
  else agg.draws++;
  if (ga === 0) agg.cleanSheets++;
  if (gf === 0) agg.failedToScore++;
}

function finalizeAggregate(agg: FormAggregate): void {
  if (agg.played > 0) {
    agg.avgScored = Math.round((agg.scored / agg.played) * 100) / 100;
    agg.avgConceded = Math.round((agg.conceded / agg.played) * 100) / 100;
  }
}
