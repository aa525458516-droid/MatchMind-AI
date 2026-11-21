import { Match, Prediction } from '../types/football';
import {
  MODEL_VERSION_PHASE3,
  ModelVersionTag,
  Phase4Prediction,
  Phase4VersionedHistoryRecord,
} from './phase4Types';

const PHASE4_HISTORY_KEY = 'matchmind_phase4_history_v1';
const MAX_HISTORY_ENTRIES = 400;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribePhase4History(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadVersionedHistory(): Phase4VersionedHistoryRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(PHASE4_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistVersionedHistory(records: Phase4VersionedHistoryRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      PHASE4_HISTORY_KEY,
      JSON.stringify(records.slice(0, MAX_HISTORY_ENTRIES))
    );
  } catch {
    // Ignore storage quota issues safely
  }
}

/**
 * Append or update a prediction record strictly keyed by `(matchId, modelVersion)`.
 * Guarantees Phase 4 predictions NEVER overwrite archived Phase 3 predictions.
 */
export function recordVersionedPrediction(
  match: Match,
  prediction: Prediction | Phase4Prediction,
  version: ModelVersionTag
): Phase4VersionedHistoryRecord {
  const key = `${match.id}::${version}`;
  const isPhase4 = 'phase3Prediction' in prediction;

  const entry: Phase4VersionedHistoryRecord = isPhase4
    ? {
        key,
        matchId: match.id,
        modelVersion: version,
        experimentId: prediction.experimentId,
        calculatedAt: prediction.calculatedAt,
        matchDate: match.utcDate,
        homeTeamName: match.homeTeam.shortName,
        awayTeamName: match.awayTeam.shortName,
        competition: match.leagueName,
        leagueId: match.leagueId,
        provider: match.provenance.source,
        status:
          prediction.abstainScope === 'MATCH_ABSTAIN'
            ? 'MATCH_ABSTAIN'
            : prediction.abstainScope === 'MARKET_ONLY'
            ? 'MARKET_ABSTAIN'
            : 'AVAILABLE',
        confidence: prediction.phase3Prediction.confidence,
        confidenceScore: prediction.phase3Prediction.confidenceScore,
        sampleSize: prediction.sampleSizeMatches,
        calibrationStatus: prediction.ensemble.calibrationStatus,
        probabilities: prediction.ensemble.probabilities,
        expectedScore: prediction.ensemble.mostLikelyScore,
        abstainReason: prediction.abstainReason,
        isDemoData: match.isDemoData,
      }
    : {
        key,
        matchId: match.id,
        modelVersion: MODEL_VERSION_PHASE3,
        experimentId: null,
        calculatedAt: prediction.calculatedAt,
        matchDate: match.utcDate,
        homeTeamName: match.homeTeam.shortName,
        awayTeamName: match.awayTeam.shortName,
        competition: match.leagueName,
        leagueId: match.leagueId,
        provider: match.provenance.source,
        status: prediction.modelType === 'ABSTAIN' ? 'MATCH_ABSTAIN' : 'AVAILABLE',
        confidence: prediction.confidence,
        confidenceScore: prediction.confidenceScore,
        sampleSize: prediction.sampleSizeMatches ?? match.provenance.sampleSizeMatches,
        calibrationStatus: prediction.calibrationStatus?.applied ? 'CALIBRATED' : 'NOT_TRAINED',
        probabilities: prediction.probabilities,
        expectedScore: prediction.expectedScore?.mostLikelyScore ?? null,
        abstainReason: prediction.abstainReason,
        isDemoData: match.isDemoData,
      };

  const existing = loadVersionedHistory();
  const filtered = existing.filter((r) => r.key !== key);
  const next = [entry, ...filtered];
  persistVersionedHistory(next);
  notify();
  return entry;
}

export function clearVersionedHistory(): void {
  persistVersionedHistory([]);
  notify();
}
