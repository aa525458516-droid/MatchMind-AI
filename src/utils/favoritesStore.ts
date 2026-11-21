const FAVORITES_STORAGE_KEY = 'matchmind_favorites_v1';

export interface FavoritesState {
  teamIds: string[];
  leagueIds: string[];
  matchIds: string[];
}

const EMPTY_FAVORITES: FavoritesState = {
  teamIds: [],
  leagueIds: [],
  matchIds: [],
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeFavorites(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadFavorites(): FavoritesState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...EMPTY_FAVORITES, teamIds: [], leagueIds: [], matchIds: [] };
  }
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return { ...EMPTY_FAVORITES, teamIds: [], leagueIds: [], matchIds: [] };
    const parsed = JSON.parse(raw) as Partial<FavoritesState>;
    return {
      teamIds: Array.isArray(parsed.teamIds) ? parsed.teamIds.filter((x) => typeof x === 'string') : [],
      leagueIds: Array.isArray(parsed.leagueIds) ? parsed.leagueIds.filter((x) => typeof x === 'string') : [],
      matchIds: Array.isArray(parsed.matchIds) ? parsed.matchIds.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...EMPTY_FAVORITES, teamIds: [], leagueIds: [], matchIds: [] };
  }
}

function saveFavorites(state: FavoritesState): FavoritesState {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage write errors safely
    }
  }
  notify();
  return state;
}

export function toggleFavoriteTeam(teamId: string): FavoritesState {
  const cur = loadFavorites();
  const exists = cur.teamIds.includes(teamId);
  const teamIds = exists ? cur.teamIds.filter((id) => id !== teamId) : [...cur.teamIds, teamId];
  return saveFavorites({ ...cur, teamIds });
}

export function toggleFavoriteLeague(leagueId: string): FavoritesState {
  const cur = loadFavorites();
  const exists = cur.leagueIds.includes(leagueId);
  const leagueIds = exists ? cur.leagueIds.filter((id) => id !== leagueId) : [...cur.leagueIds, leagueId];
  return saveFavorites({ ...cur, leagueIds });
}

export function toggleFavoriteMatch(matchId: string): FavoritesState {
  const cur = loadFavorites();
  const exists = cur.matchIds.includes(matchId);
  const matchIds = exists ? cur.matchIds.filter((id) => id !== matchId) : [...cur.matchIds, matchId];
  return saveFavorites({ ...cur, matchIds });
}

export function clearAllFavorites(): FavoritesState {
  return saveFavorites({ teamIds: [], leagueIds: [], matchIds: [] });
}
