/**
 * Quantitative Football Elo Rating System
 * 
 * Implements:
 * 1. Home-advantage adjusted rating differential.
 * 2. Sigmoidal win expectancy with par-draw distribution.
 * 3. Dynamic goal expectation projection derived from rating disparity.
 */

import { SingleModelEvaluation } from '../types/football';

export const BASE_HOME_ADVANTAGE_ELO = 75; // Standard European league home boost

/**
 * Calculates Elo win, draw, and loss probabilities.
 * @param homeElo Home team Elo rating
 * @param awayElo Away team Elo rating
 * @param homeAdvantage Elo bonus for playing at home (default 75)
 */
export function calculateEloProbabilities(
  homeElo: number,
  awayElo: number,
  homeAdvantage: number = BASE_HOME_ADVANTAGE_ELO
): {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedGoalDiff: number;
} {
  const adjustedHomeElo = homeElo + homeAdvantage;
  const eloDiff = adjustedHomeElo - awayElo;

  // Expected score W_e in [0, 1] from standard logistic formula
  const expectedHomePoints = 1 / (1 + Math.pow(10, -eloDiff / 400));

  // Draw probability model: peak at ~28% when eloDiff is 0, decaying as disparity widens
  const drawBase = 0.28;
  const drawDecay = Math.exp(-Math.pow(eloDiff / 320, 2));
  const rawDraw = Math.max(0.12, drawBase * drawDecay);

  // Allocate remaining probability between home win and away win proportionally
  const nonDrawProb = 1 - rawDraw;
  const rawHomeWin = expectedHomePoints * nonDrawProb;
  const rawAwayWin = (1 - expectedHomePoints) * nonDrawProb;

  // Normalize
  const total = rawHomeWin + rawDraw + rawAwayWin;
  const homeWinProb = Math.round((rawHomeWin / total) * 1000) / 10;
  const drawProb = Math.round((rawDraw / total) * 1000) / 10;
  const awayWinProb = Math.round((100 - homeWinProb - drawProb) * 10) / 10;

  // Approximate expected goal difference from Elo gap
  const expectedGoalDiff = eloDiff / 250;

  return {
    homeWinProb,
    drawProb,
    awayWinProb,
    expectedGoalDiff,
  };
}

/**
 * Return a standardized SingleModelEvaluation from Elo calculations
 */
export function evaluateEloModel(
  homeElo: number,
  awayElo: number,
  baseLeagueAvgGoals: number = 2.85
): SingleModelEvaluation {
  const { homeWinProb, drawProb, awayWinProb, expectedGoalDiff } = calculateEloProbabilities(
    homeElo,
    awayElo
  );

  // Derived goal totals from Elo difference and league baseline
  const projectedHomeGoals = Math.max(0.4, (baseLeagueAvgGoals + expectedGoalDiff) / 2);
  const projectedAwayGoals = Math.max(0.3, (baseLeagueAvgGoals - expectedGoalDiff) / 2);

  const estOver25 = Math.round((0.48 + (projectedHomeGoals + projectedAwayGoals - 2.5) * 0.12) * 1000) / 10;
  const estBTTS = Math.round((Math.min(projectedHomeGoals, projectedAwayGoals) * 0.35 + 0.2) * 1000) / 10;

  return {
    modelName: 'Elo',
    homeWinProb,
    drawProb,
    awayWinProb,
    over25Prob: Math.min(85, Math.max(25, estOver25)),
    bttsProb: Math.min(80, Math.max(30, estBTTS)),
    projectedHomeGoals: Math.round(projectedHomeGoals * 100) / 100,
    projectedAwayGoals: Math.round(projectedAwayGoals * 100) / 100,
    notes: `Derived from adjusted Elo differential (${homeElo} + ${BASE_HOME_ADVANTAGE_ELO} vs ${awayElo}).`,
  };
}

export interface HistoricalMatchForElo {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  utcDate: string;
}

export interface EmpiricalTeamElo {
  rating: number | null; // null if matchesPlayed < minMatches
  rawRating: number;
  matchesPlayed: number;
}

/**
 * Computes empirical Elo ratings strictly by replaying completed historical matches
 * in chronological order before `beforeTimeMs`.
 *
 * Returns null rating for any team with fewer than `minMatches` verified matches.
 */
export function computeEmpiricalEloFromMatches(
  matches: HistoricalMatchForElo[],
  beforeTimeMs?: number,
  minMatches: number = 5
): Map<string, EmpiricalTeamElo> {
  // Strictly refuse to compute Elo with an invalid/NaN cutoff timestamp (prevents lookahead leakage)
  if (beforeTimeMs !== undefined && !Number.isFinite(beforeTimeMs)) {
    return new Map<string, EmpiricalTeamElo>();
  }

  const BASE_RATING = 1500;
  const K_FACTOR = 32;
  const HOME_ADVANTAGE_IN_UPDATES = 55;

  const sorted = matches
    .filter((m) => {
      if (!m.homeTeamId || !m.awayTeamId || m.homeTeamId === m.awayTeamId) return false;
      if (
        !Number.isFinite(m.homeGoals) ||
        !Number.isFinite(m.awayGoals) ||
        m.homeGoals < 0 ||
        m.awayGoals < 0
      ) {
        return false;
      }
      const t = new Date(m.utcDate).getTime();
      if (!Number.isFinite(t)) return false;
      if (beforeTimeMs !== undefined && t >= beforeTimeMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const ratings = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const m of sorted) {
    const rHome = ratings.get(m.homeTeamId) ?? BASE_RATING;
    const rAway = ratings.get(m.awayTeamId) ?? BASE_RATING;

    const expHome = 1 / (1 + Math.pow(10, -(rHome + HOME_ADVANTAGE_IN_UPDATES - rAway) / 400));
    const expAway = 1 - expHome;

    let scoreHome = 0.5;
    if (m.homeGoals > m.awayGoals) scoreHome = 1;
    else if (m.homeGoals < m.awayGoals) scoreHome = 0;
    const scoreAway = 1 - scoreHome;

    const goalDiff = Math.abs(m.homeGoals - m.awayGoals);
    const marginMultiplier = goalDiff <= 1 ? 1 : 1 + 0.25 * Math.min(goalDiff - 1, 3);

    ratings.set(m.homeTeamId, rHome + K_FACTOR * marginMultiplier * (scoreHome - expHome));
    ratings.set(m.awayTeamId, rAway + K_FACTOR * marginMultiplier * (scoreAway - expAway));
    counts.set(m.homeTeamId, (counts.get(m.homeTeamId) ?? 0) + 1);
    counts.set(m.awayTeamId, (counts.get(m.awayTeamId) ?? 0) + 1);
  }

  const result = new Map<string, EmpiricalTeamElo>();
  for (const [teamId, raw] of ratings.entries()) {
    const matchesPlayed = counts.get(teamId) ?? 0;
    const rounded = Math.round(raw);
    result.set(teamId, {
      rating: matchesPlayed >= minMatches ? rounded : null,
      rawRating: rounded,
      matchesPlayed,
    });
  }
  return result;
}

