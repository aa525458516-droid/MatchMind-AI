/**
 * Phase 4A Experimental Module — Goal Rate Stabilization & Hierarchical Shrinkage
 *
 * STRICTLY ISOLATED FROM PRODUCTION.
 * Does NOT alter frozen Phase 3 providers, Poisson/Dixon-Coles matrices,
 * Elo ratings, causal temperature calibration, or ABSTAIN thresholds.
 *
 * Implements two separated experimental goal-intensity estimators:
 * - VARIANT_A: Stronger Gamma-Poisson shrinkage (K_RATE = 14) + joint product
 *   reliability damping (K_JOINT = 4) using the existing hard >= 3 venue split rule.
 * - VARIANT_B: 2-level Hierarchical Gamma-Poisson shrinkage (K_OVERALL = 12) +
 *   smooth partial-pooling venue blending (K_VENUE = 12) + joint product
 *   reliability damping (K_JOINT = 4), eliminating the hard >= 3 venue discontinuity.
 */

export type ExperimentalIntensityVariant = 'FROZEN_BASELINE' | 'VARIANT_A' | 'VARIANT_B';

export interface TeamGoalCounts {
  overall: {
    played: number;
    scored: number;
    conceded: number;
  };
  venueOnly: {
    played: number;
    scored: number;
    conceded: number;
  };
}

export interface LeaguePriorRates {
  priorLeagueCount: number;
  avgHomeGoalsLeague: number;
  avgAwayGoalsLeague: number;
  avgGoalsPerSide: number;
}

export interface ExperimentalLambdaResult {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  totalExpectedGoals: number;
  homeAttackRatio: number;
  awayDefenseRatio: number;
  awayAttackRatio: number;
  homeDefenseRatio: number;
  reliabilityWeight: number;
  venueWeights?: {
    homeVenueWeight: number;
    awayVenueWeight: number;
  };
}

export const FROZEN_BASELINE_PARAMS = {
  PRIOR_MATCH_WEIGHT: 5,
  VENUE_MIN_PLAYED: 3,
  MIN_BASELINE_FLOOR: 0.5,
  LAMBDA_MIN: 0.35,
  LAMBDA_MAX: 4.0,
} as const;

export const VARIANT_A_PARAMS = {
  PRIOR_RATE_WEIGHT: 14,
  JOINT_RELIABILITY_WEIGHT: 4,
  VENUE_MIN_PLAYED: 3,
  MIN_BASELINE_FLOOR: 0.5,
  LAMBDA_MIN: 0.35,
  LAMBDA_MAX: 4.0,
} as const;

export const VARIANT_B_PARAMS = {
  OVERALL_PRIOR_WEIGHT: 12,
  VENUE_POOLING_WEIGHT: 12,
  JOINT_RELIABILITY_WEIGHT: 4,
  MIN_BASELINE_FLOOR: 0.5,
  LAMBDA_MIN: 0.35,
  LAMBDA_MAX: 4.0,
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampLambda(value: number, minVal: number, maxVal: number): number {
  return Math.max(minVal, Math.min(maxVal, round2(value)));
}

function gammaPoissonShrink(goals: number, matchesPlayed: number, baseline: number, priorWeight: number): number {
  return (goals + priorWeight * baseline) / (matchesPlayed + priorWeight);
}

/**
 * Exact replica of Frozen Phase 3 goal-intensity calculation for side-by-side invariance checks.
 */
export function estimateFrozenBaselineLambdas(
  home: TeamGoalCounts,
  away: TeamGoalCounts,
  league: LeaguePriorRates
): ExperimentalLambdaResult | null {
  if (
    league.priorLeagueCount < 10 ||
    home.overall.played < 5 ||
    away.overall.played < 5 ||
    league.avgGoalsPerSide <= 0
  ) {
    return null;
  }

  const { PRIOR_MATCH_WEIGHT, VENUE_MIN_PLAYED, MIN_BASELINE_FLOOR, LAMBDA_MIN, LAMBDA_MAX } =
    FROZEN_BASELINE_PARAMS;

  const useHomeVenue = home.venueOnly.played >= VENUE_MIN_PLAYED;
  const useAwayVenue = away.venueOnly.played >= VENUE_MIN_PLAYED;

  const homeAttBase = useHomeVenue ? league.avgHomeGoalsLeague : league.avgGoalsPerSide;
  const awayDefBase = useAwayVenue ? league.avgHomeGoalsLeague : league.avgGoalsPerSide;
  const awayAttBase = useAwayVenue ? league.avgAwayGoalsLeague : league.avgGoalsPerSide;
  const homeDefBase = useHomeVenue ? league.avgAwayGoalsLeague : league.avgGoalsPerSide;

  const shrunkHomeScored = useHomeVenue
    ? gammaPoissonShrink(home.venueOnly.scored, home.venueOnly.played, homeAttBase, PRIOR_MATCH_WEIGHT)
    : gammaPoissonShrink(home.overall.scored, home.overall.played, homeAttBase, PRIOR_MATCH_WEIGHT);

  const shrunkAwayConceded = useAwayVenue
    ? gammaPoissonShrink(away.venueOnly.conceded, away.venueOnly.played, awayDefBase, PRIOR_MATCH_WEIGHT)
    : gammaPoissonShrink(away.overall.conceded, away.overall.played, awayDefBase, PRIOR_MATCH_WEIGHT);

  const shrunkAwayScored = useAwayVenue
    ? gammaPoissonShrink(away.venueOnly.scored, away.venueOnly.played, awayAttBase, PRIOR_MATCH_WEIGHT)
    : gammaPoissonShrink(away.overall.scored, away.overall.played, awayAttBase, PRIOR_MATCH_WEIGHT);

  const shrunkHomeConceded = useHomeVenue
    ? gammaPoissonShrink(home.venueOnly.conceded, home.venueOnly.played, homeDefBase, PRIOR_MATCH_WEIGHT)
    : gammaPoissonShrink(home.overall.conceded, home.overall.played, homeDefBase, PRIOR_MATCH_WEIGHT);

  const homeAttack = shrunkHomeScored / Math.max(MIN_BASELINE_FLOOR, homeAttBase);
  const awayDefense = shrunkAwayConceded / Math.max(MIN_BASELINE_FLOOR, awayDefBase);
  const awayAttack = shrunkAwayScored / Math.max(MIN_BASELINE_FLOOR, awayAttBase);
  const homeDefense = shrunkHomeConceded / Math.max(MIN_BASELINE_FLOOR, homeDefBase);

  const homeExpectedGoals = clampLambda(
    homeAttack * awayDefense * league.avgHomeGoalsLeague,
    LAMBDA_MIN,
    LAMBDA_MAX
  );
  const awayExpectedGoals = clampLambda(
    awayAttack * homeDefense * league.avgAwayGoalsLeague,
    LAMBDA_MIN,
    LAMBDA_MAX
  );

  return {
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals: round2(homeExpectedGoals + awayExpectedGoals),
    homeAttackRatio: homeAttack,
    awayDefenseRatio: awayDefense,
    awayAttackRatio: awayAttack,
    homeDefenseRatio: homeDefense,
    reliabilityWeight: 1.0,
  };
}

/**
 * VARIANT A: Stronger Gamma-Poisson Shrinkage (K = 14) + Joint Evidence Damping (K_joint = 4)
 * with Existing Hard Venue Split Transition (played >= 3).
 */
export function estimateVariantALambdas(
  home: TeamGoalCounts,
  away: TeamGoalCounts,
  league: LeaguePriorRates
): ExperimentalLambdaResult | null {
  if (
    league.priorLeagueCount < 10 ||
    home.overall.played < 5 ||
    away.overall.played < 5 ||
    league.avgGoalsPerSide <= 0
  ) {
    return null;
  }

  const {
    PRIOR_RATE_WEIGHT,
    JOINT_RELIABILITY_WEIGHT,
    VENUE_MIN_PLAYED,
    MIN_BASELINE_FLOOR,
    LAMBDA_MIN,
    LAMBDA_MAX,
  } = VARIANT_A_PARAMS;

  const useHomeVenue = home.venueOnly.played >= VENUE_MIN_PLAYED;
  const useAwayVenue = away.venueOnly.played >= VENUE_MIN_PLAYED;

  const homeAttBase = useHomeVenue ? league.avgHomeGoalsLeague : league.avgGoalsPerSide;
  const awayDefBase = useAwayVenue ? league.avgHomeGoalsLeague : league.avgGoalsPerSide;
  const awayAttBase = useAwayVenue ? league.avgAwayGoalsLeague : league.avgGoalsPerSide;
  const homeDefBase = useHomeVenue ? league.avgAwayGoalsLeague : league.avgGoalsPerSide;

  const homeSampleUsed = useHomeVenue ? home.venueOnly.played : home.overall.played;
  const awaySampleUsed = useAwayVenue ? away.venueOnly.played : away.overall.played;

  const shrunkHomeScored = useHomeVenue
    ? gammaPoissonShrink(home.venueOnly.scored, home.venueOnly.played, homeAttBase, PRIOR_RATE_WEIGHT)
    : gammaPoissonShrink(home.overall.scored, home.overall.played, homeAttBase, PRIOR_RATE_WEIGHT);

  const shrunkAwayConceded = useAwayVenue
    ? gammaPoissonShrink(away.venueOnly.conceded, away.venueOnly.played, awayDefBase, PRIOR_RATE_WEIGHT)
    : gammaPoissonShrink(away.overall.conceded, away.overall.played, awayDefBase, PRIOR_RATE_WEIGHT);

  const shrunkAwayScored = useAwayVenue
    ? gammaPoissonShrink(away.venueOnly.scored, away.venueOnly.played, awayAttBase, PRIOR_RATE_WEIGHT)
    : gammaPoissonShrink(away.overall.scored, away.overall.played, awayAttBase, PRIOR_RATE_WEIGHT);

  const shrunkHomeConceded = useHomeVenue
    ? gammaPoissonShrink(home.venueOnly.conceded, home.venueOnly.played, homeDefBase, PRIOR_RATE_WEIGHT)
    : gammaPoissonShrink(home.overall.conceded, home.overall.played, homeDefBase, PRIOR_RATE_WEIGHT);

  const homeAttack = shrunkHomeScored / Math.max(MIN_BASELINE_FLOOR, homeAttBase);
  const awayDefense = shrunkAwayConceded / Math.max(MIN_BASELINE_FLOOR, awayDefBase);
  const awayAttack = shrunkAwayScored / Math.max(MIN_BASELINE_FLOOR, awayAttBase);
  const homeDefense = shrunkHomeConceded / Math.max(MIN_BASELINE_FLOOR, homeDefBase);

  const nEff = Math.min(homeSampleUsed, awaySampleUsed);
  const reliabilityWeight = nEff / (nEff + JOINT_RELIABILITY_WEIGHT);

  const rawHomeMult = Math.max(0.1, homeAttack * awayDefense);
  const rawAwayMult = Math.max(0.1, awayAttack * homeDefense);

  const homeExpectedGoals = clampLambda(
    league.avgHomeGoalsLeague * Math.pow(rawHomeMult, reliabilityWeight),
    LAMBDA_MIN,
    LAMBDA_MAX
  );
  const awayExpectedGoals = clampLambda(
    league.avgAwayGoalsLeague * Math.pow(rawAwayMult, reliabilityWeight),
    LAMBDA_MIN,
    LAMBDA_MAX
  );

  return {
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals: round2(homeExpectedGoals + awayExpectedGoals),
    homeAttackRatio: homeAttack,
    awayDefenseRatio: awayDefense,
    awayAttackRatio: awayAttack,
    homeDefenseRatio: homeDefense,
    reliabilityWeight,
  };
}

/**
 * VARIANT B: 2-Level Hierarchical Gamma-Poisson Shrinkage (K_overall = 12) +
 * Smooth Partial-Pooling Venue Blending (K_venue = 12) + Joint Evidence Damping (K_joint = 4).
 *
 * Level 1 shrinks overall team attack/defense rates toward the league side average (K_overall = 12).
 * Level 2 shrinks venue-specific rates toward each team's own Level-1 overall ratio
 * with smooth weight w_venue = n_venue / (n_venue + K_venue), removing any hard cutoff.
 */
export function estimateVariantBLambdas(
  home: TeamGoalCounts,
  away: TeamGoalCounts,
  league: LeaguePriorRates
): ExperimentalLambdaResult | null {
  if (
    league.priorLeagueCount < 10 ||
    home.overall.played < 5 ||
    away.overall.played < 5 ||
    league.avgGoalsPerSide <= 0
  ) {
    return null;
  }

  const {
    OVERALL_PRIOR_WEIGHT,
    VENUE_POOLING_WEIGHT,
    JOINT_RELIABILITY_WEIGHT,
    MIN_BASELINE_FLOOR,
    LAMBDA_MIN,
    LAMBDA_MAX,
  } = VARIANT_B_PARAMS;

  const sideBase = Math.max(MIN_BASELINE_FLOOR, league.avgGoalsPerSide);
  const homeVenueBase = Math.max(MIN_BASELINE_FLOOR, league.avgHomeGoalsLeague);
  const awayVenueBase = Math.max(MIN_BASELINE_FLOOR, league.avgAwayGoalsLeague);

  // Level 1: Overall shrunk team attack & defense relative ratios
  const homeAttOverall =
    gammaPoissonShrink(home.overall.scored, home.overall.played, sideBase, OVERALL_PRIOR_WEIGHT) /
    sideBase;
  const homeDefOverall =
    gammaPoissonShrink(home.overall.conceded, home.overall.played, sideBase, OVERALL_PRIOR_WEIGHT) /
    sideBase;
  const awayAttOverall =
    gammaPoissonShrink(away.overall.scored, away.overall.played, sideBase, OVERALL_PRIOR_WEIGHT) /
    sideBase;
  const awayDefOverall =
    gammaPoissonShrink(away.overall.conceded, away.overall.played, sideBase, OVERALL_PRIOR_WEIGHT) /
    sideBase;

  // Level 2: Hierarchical partial pooling from overall prior to venue-specific evidence
  const wHomeVenue = home.venueOnly.played / (home.venueOnly.played + VENUE_POOLING_WEIGHT);
  const wAwayVenue = away.venueOnly.played / (away.venueOnly.played + VENUE_POOLING_WEIGHT);

  const homeAttVenueRaw =
    home.venueOnly.played > 0 ? home.venueOnly.scored / (home.venueOnly.played * homeVenueBase) : homeAttOverall;
  const homeDefVenueRaw =
    home.venueOnly.played > 0 ? home.venueOnly.conceded / (home.venueOnly.played * awayVenueBase) : homeDefOverall;

  const awayAttVenueRaw =
    away.venueOnly.played > 0 ? away.venueOnly.scored / (away.venueOnly.played * awayVenueBase) : awayAttOverall;
  const awayDefVenueRaw =
    away.venueOnly.played > 0 ? away.venueOnly.conceded / (away.venueOnly.played * homeVenueBase) : awayDefOverall;

  const homeAttack = wHomeVenue * homeAttVenueRaw + (1 - wHomeVenue) * homeAttOverall;
  const homeDefense = wHomeVenue * homeDefVenueRaw + (1 - wHomeVenue) * homeDefOverall;
  const awayAttack = wAwayVenue * awayAttVenueRaw + (1 - wAwayVenue) * awayAttOverall;
  const awayDefense = wAwayVenue * awayDefVenueRaw + (1 - wAwayVenue) * awayDefOverall;

  const nEff = Math.min(home.overall.played, away.overall.played);
  const reliabilityWeight = nEff / (nEff + JOINT_RELIABILITY_WEIGHT);

  const rawHomeMult = Math.max(0.1, homeAttack * awayDefense);
  const rawAwayMult = Math.max(0.1, awayAttack * homeDefense);

  const homeExpectedGoals = clampLambda(
    league.avgHomeGoalsLeague * Math.pow(rawHomeMult, reliabilityWeight),
    LAMBDA_MIN,
    LAMBDA_MAX
  );
  const awayExpectedGoals = clampLambda(
    league.avgAwayGoalsLeague * Math.pow(rawAwayMult, reliabilityWeight),
    LAMBDA_MIN,
    LAMBDA_MAX
  );

  return {
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals: round2(homeExpectedGoals + awayExpectedGoals),
    homeAttackRatio: homeAttack,
    awayDefenseRatio: awayDefense,
    awayAttackRatio: awayAttack,
    homeDefenseRatio: homeDefense,
    reliabilityWeight,
    venueWeights: {
      homeVenueWeight: wHomeVenue,
      awayVenueWeight: wAwayVenue,
    },
  };
}

export function estimateExperimentalLambdas(
  variant: ExperimentalIntensityVariant,
  home: TeamGoalCounts,
  away: TeamGoalCounts,
  league: LeaguePriorRates
): ExperimentalLambdaResult | null {
  if (variant === 'FROZEN_BASELINE') {
    return estimateFrozenBaselineLambdas(home, away, league);
  }
  if (variant === 'VARIANT_A') {
    return estimateVariantALambdas(home, away, league);
  }
  return estimateVariantBLambdas(home, away, league);
}
