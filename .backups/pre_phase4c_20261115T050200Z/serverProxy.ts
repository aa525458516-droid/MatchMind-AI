import express, { Request, Response, Router } from 'express';

/**
 * In-memory HTTP cache for free football data providers
 */
export interface CacheEntry {
  data: unknown;
  expiresAt: number;
  cachedAt: string;
}

export interface ProxyValidationResult {
  valid: boolean;
  sanitizedPath?: string;
  error?: string;
}

const OPENLIGA_ALLOWLIST: RegExp[] = [
  /^getavailableleagues$/,
  /^getmatchdata\/[a-z0-9_-]{2,20}$/i,
  /^getmatchdata\/[a-z0-9_-]{2,20}\/\d{4}$/i,
  /^getmatchdata\/[a-z0-9_-]{2,20}\/\d{4}\/\d{1,3}$/i,
  /^getmatchdata\/\d{1,10}$/,
  /^getbltable\/[a-z0-9_-]{2,20}\/\d{4}$/i,
  /^getcurrentgroup\/[a-z0-9_-]{2,20}$/i,
];

const STATSBOMB_ALLOWLIST: RegExp[] = [
  /^competitions\.json$/,
  /^matches\/\d{1,6}\/\d{1,6}\.json$/,
  /^events\/\d{1,10}\.json$/,
  /^lineups\/\d{1,10}\.json$/,
];

const MAX_CACHE_ENTRIES = 200;
const MAX_UPSTREAM_BYTES = 25 * 1024 * 1024;
const CONTROL_OR_WHITESPACE_REGEX = /[\s\u0000-\u001f\u007f]/;

/**
 * Reject path traversal, encoded characters/double encoding, query/fragment injection,
 * whitespace/control chars, absolute URLs, and non-allowlisted paths.
 */
export function validateProxyRequestPath(
  provider: 'openliga' | 'statsbomb',
  rawReqUrl: string,
  rawSubPath: string
): ProxyValidationResult {
  // Reject any query strings or fragments on proxy routes
  if (rawReqUrl.includes('?') || rawSubPath.includes('?') || rawReqUrl.includes('#') || rawSubPath.includes('#')) {
    return { valid: false, error: 'Query parameters and URL fragments are not permitted on football data proxy endpoints.' };
  }

  // Reject any raw percent-encoding, whitespace, control characters, semicolons, backslashes, or '@'
  for (const raw of [rawReqUrl, rawSubPath]) {
    if (
      raw.includes('%') ||
      CONTROL_OR_WHITESPACE_REGEX.test(raw) ||
      raw.includes(';') ||
      raw.includes('\\') ||
      raw.includes('..') ||
      raw.includes('@') ||
      /^https?:/i.test(raw) ||
      raw.includes('://') ||
      raw.startsWith('//')
    ) {
      return { valid: false, error: 'Blocked: Invalid characters, encoding, path traversal, or external URL detected.' };
    }
  }

  const trimmed = rawSubPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) {
    return { valid: false, error: 'Blocked: Empty endpoint path.' };
  }

  const allowlist = provider === 'openliga' ? OPENLIGA_ALLOWLIST : STATSBOMB_ALLOWLIST;
  const isAllowed = allowlist.some((regex) => regex.test(trimmed));

  if (!isAllowed) {
    return {
      valid: false,
      error: `Blocked: Endpoint "${trimmed}" is not in the ${provider} allowlist.`,
    };
  }

  return { valid: true, sanitizedPath: trimmed };
}

export interface FootballProxyOptions {
  fetchFn?: typeof fetch;
  openLigaOrigin?: string;
  statsBombOrigin?: string;
}

interface UpstreamFetchOutcome {
  ok: boolean;
  status: number;
  entry?: CacheEntry;
  error?: string;
}

export function createFootballProxyRouter(options: FootballProxyOptions = {}) {
  const router: Router = express.Router();
  const fetchImpl = options.fetchFn || fetch;
  const openLigaOrigin = (options.openLigaOrigin || 'https://api.openligadb.de').replace(/\/+$/, '');
  const statsBombOrigin = (
    options.statsBombOrigin || 'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
  ).replace(/\/+$/, '');

  const apiCache = new Map<string, CacheEntry>();
  const inFlightRequests = new Map<string, Promise<UpstreamFetchOutcome>>();
  let cacheHits = 0;
  let cacheMisses = 0;

  function pruneExpiredEntries(now = Date.now()): void {
    for (const [k, v] of apiCache.entries()) {
      if (now > v.expiresAt) {
        apiCache.delete(k);
      }
    }
  }

  function getCachedEntry(key: string): CacheEntry | null {
    const entry = apiCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      apiCache.delete(key);
      return null;
    }
    cacheHits++;
    return entry;
  }

  function setCachedData(key: string, data: unknown, ttlMs: number): CacheEntry {
    pruneExpiredEntries();
    if (apiCache.size >= MAX_CACHE_ENTRIES && !apiCache.has(key)) {
      const oldestKey = apiCache.keys().next().value;
      if (oldestKey) apiCache.delete(oldestKey);
    }
    const entry: CacheEntry = {
      data,
      expiresAt: Date.now() + ttlMs,
      cachedAt: new Date().toISOString(),
    };
    apiCache.set(key, entry);
    return entry;
  }

  async function parseJsonUpstreamResponse(response: globalThis.Response, providerLabel: string): Promise<unknown> {
    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
    // OpenLigaDB serves application/json; raw.githubusercontent.com serves text/plain for .json files.
    // Explicitly reject HTML, XML, JavaScript, or binary content types before attempting JSON parsing.
    const isAcceptableContentType =
      contentType === '' ||
      contentType.includes('application/json') ||
      contentType.includes('text/plain');

    if (!isAcceptableContentType) {
      throw new Error(`${providerLabel} returned unsupported Content-Type.`);
    }

    const contentLengthHeader = response.headers?.get?.('content-length');
    if (contentLengthHeader) {
      const declaredBytes = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPSTREAM_BYTES) {
        throw new Error(`${providerLabel} payload exceeds maximum allowed size.`);
      }
    }

    const rawText = await response.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_UPSTREAM_BYTES) {
      throw new Error(`${providerLabel} response body exceeds maximum allowed size.`);
    }

    const trimmed = rawText.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new Error(`${providerLabel} returned non-JSON payload.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${providerLabel} returned malformed JSON.`);
    }

    if (parsed === null || typeof parsed !== 'object') {
      throw new Error(`${providerLabel} returned unexpected primitive JSON payload.`);
    }

    return parsed;
  }

  async function fetchAndCacheUpstream(
    cacheKey: string,
    targetUrl: string,
    providerLabel: string,
    ttlMs: number,
    timeoutMs: number,
    rejectObjectErrorKey: boolean
  ): Promise<UpstreamFetchOutcome> {
    const existing = inFlightRequests.get(cacheKey);
    if (existing) {
      return existing;
    }

    const work = (async (): Promise<UpstreamFetchOutcome> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(targetUrl, {
          signal: controller.signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'MatchMind-AI/1.0 (Non-Commercial Football Research Engine)',
          },
        });

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            error: `${providerLabel} responded with status ${response.status}`,
          };
        }

        const data = await parseJsonUpstreamResponse(response, providerLabel);
        if (rejectObjectErrorKey && !Array.isArray(data) && 'error' in (data as Record<string, unknown>)) {
          return {
            ok: false,
            status: 502,
            error: `${providerLabel} returned an application error payload.`,
          };
        }

        const entry = setCachedData(cacheKey, data, ttlMs);
        return {
          ok: true,
          status: 200,
          entry,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.name === 'AbortError'
            ? `Upstream request timed out after ${Math.round(timeoutMs / 1000)}s.`
            : error instanceof Error
            ? error.message
            : 'Upstream network failure';
        return {
          ok: false,
          status: 502,
          error: `Failed to fetch ${providerLabel} data: ${message}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    })();

    inFlightRequests.set(cacheKey, work);
    try {
      return await work;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  }

  router.get('/openliga/*', async (req: Request, res: Response) => {
    const validation = validateProxyRequestPath('openliga', req.originalUrl || req.url, req.params[0] || '');
    if (!validation.valid || !validation.sanitizedPath) {
      return res.status(403).json({
        success: false,
        error: validation.error || 'Forbidden endpoint path.',
      });
    }

    const subPath = validation.sanitizedPath;
    const cacheKey = `openliga:${subPath}`;

    const cachedEntry = getCachedEntry(cacheKey);
    if (cachedEntry) {
      return res.json({
        success: true,
        data: cachedEntry.data,
        source: 'OpenLigaDB (Cached)',
        fromCache: true,
        cached: true,
        cachedAt: cachedEntry.cachedAt,
        retrievedAt: new Date().toISOString(),
      });
    }

    cacheMisses++;
    let ttlMs = 5 * 60 * 1000;
    if (subPath.startsWith('getavailableleagues') || subPath.startsWith('getbltable')) {
      ttlMs = 30 * 60 * 1000;
    }

    const outcome = await fetchAndCacheUpstream(
      cacheKey,
      `${openLigaOrigin}/${subPath}`,
      'OpenLigaDB',
      ttlMs,
      10000,
      true
    );

    if (!outcome.ok || !outcome.entry) {
      return res.status(outcome.status).json({
        success: false,
        error: outcome.error || 'Failed to fetch OpenLigaDB data.',
      });
    }

    return res.json({
      success: true,
      data: outcome.entry.data,
      source: 'OpenLigaDB (Live)',
      fromCache: false,
      cached: false,
      cachedAt: outcome.entry.cachedAt,
      retrievedAt: outcome.entry.cachedAt,
    });
  });

  router.get('/statsbomb/*', async (req: Request, res: Response) => {
    const validation = validateProxyRequestPath('statsbomb', req.originalUrl || req.url, req.params[0] || '');
    if (!validation.valid || !validation.sanitizedPath) {
      return res.status(403).json({
        success: false,
        error: validation.error || 'Forbidden endpoint path.',
      });
    }

    const subPath = validation.sanitizedPath;
    const cacheKey = `statsbomb:${subPath}`;

    const cachedEntry = getCachedEntry(cacheKey);
    if (cachedEntry) {
      return res.json({
        success: true,
        data: cachedEntry.data,
        source: 'StatsBomb Open Data (Cached)',
        fromCache: true,
        cached: true,
        cachedAt: cachedEntry.cachedAt,
        retrievedAt: new Date().toISOString(),
        attribution: 'Data provided by StatsBomb Open Data under CC BY 4.0',
      });
    }

    cacheMisses++;
    const outcome = await fetchAndCacheUpstream(
      cacheKey,
      `${statsBombOrigin}/${subPath}`,
      'StatsBomb Open Data',
      24 * 60 * 60 * 1000,
      15000,
      false
    );

    if (!outcome.ok || !outcome.entry) {
      return res.status(outcome.status).json({
        success: false,
        error: outcome.error || 'Failed to fetch StatsBomb data.',
      });
    }

    return res.json({
      success: true,
      data: outcome.entry.data,
      source: 'StatsBomb Open Data (Live)',
      fromCache: false,
      cached: false,
      cachedAt: outcome.entry.cachedAt,
      retrievedAt: outcome.entry.cachedAt,
      attribution: 'Data provided by StatsBomb Open Data under CC BY 4.0',
    });
  });

  // Catch bare roots like /api/football/openliga or /api/football/statsbomb without subpath
  router.get(['/openliga', '/statsbomb'], (_req: Request, res: Response) => {
    return res.status(403).json({
      success: false,
      error: 'Blocked: Endpoint path is required.',
    });
  });

  return {
    router,
    getCacheStats: () => {
      pruneExpiredEntries();
      return {
        entries: apiCache.size,
        hits: cacheHits,
        misses: cacheMisses,
      };
    },
    clearCache: () => {
      apiCache.clear();
      inFlightRequests.clear();
    },
  };
}
