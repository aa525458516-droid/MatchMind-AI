/**
 * Unit, Invariance, and Smoothness Tests for Phase 4A Experimental Goal Intensity Estimators
 */

import {
  estimateFrozenBaselineLambdas,
  estimateVariantALambdas,
  estimateVariantBLambdas,
  estimateExperimentalLambdas,
  TeamGoalCounts,
  LeaguePriorRates,
} from './experimentalGoalIntensity';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tol: number = 1e-6, message: string = ''): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Expected ~${expected}, got ${actual}. ${message}`);
  }
}

function runExperimentalGoalIntensityTests(): void {
  console.log('🧪 Starting Phase 4A Experimental Goal Intensity Tests...');

  const stdLeague: LeaguePriorRates = {
    priorLeagueCount: 120,
    avgHomeGoalsLeague: 1.5,
    avgAwayGoalsLeague: 1.2,
    avgGoalsPerSide: 1.35,
  };

  // 1. Sample size / priorLeagueCount guards (ABSTAIN safety preserved)
  const smallTeam: TeamGoalCounts = {
    overall: { played: 4, scored: 8, conceded: 4 },
    venueOnly: { played: 2, scored: 4, conceded: 2 },
  };
  const validTeam: TeamGoalCounts = {
    overall: { played: 10, scored: 15, conceded: 10 },
    venueOnly: { played: 5, scored: 8, conceded: 4 },
  };

  for (const variant of ['FROZEN_BASELINE', 'VARIANT_A', 'VARIANT_B'] as const) {
    assert(
      estimateExperimentalLambdas(variant, smallTeam, validTeam, stdLeague) === null,
      `${variant} must return null when home.overall.played < 5`
    );
    assert(
      estimateExperimentalLambdas(variant, validTeam, smallTeam, stdLeague) === null,
      `${variant} must return null when away.overall.played < 5`
    );
    assert(
      estimateExperimentalLambdas(variant, validTeam, validTeam, {
        ...stdLeague,
        priorLeagueCount: 9,
      }) === null,
      `${variant} must return null when priorLeagueCount < 10`
    );
  }

  // 2. Exact numerical equivalence of estimateFrozenBaselineLambdas with production formula
  const homeAsymmetric: TeamGoalCounts = {
    overall: { played: 6, scored: 12, conceded: 6 },
    venueOnly: { played: 3, scored: 9, conceded: 3 },
  };
  const awayAsymmetric: TeamGoalCounts = {
    overall: { played: 5, scored: 4, conceded: 10 },
    venueOnly: { played: 2, scored: 1, conceded: 6 },
  };
  // Manual production computation:
  // useHomeVenue = true, useAwayVenue = false
  // homeAttack = ((9 + 5*1.5)/(3+5)) / 1.5 = (16.5/8)/1.5 = 2.0625/1.5 = 1.375
  // awayDefense = ((10 + 5*1.35)/(5+5)) / 1.35 = (16.75/10)/1.35 = 1.675/1.35 = 1.24074074
  // homeLambda = round2(1.375 * 1.24074074 * 1.5) = round2(2.559027) = 2.56
  // awayAttack = ((4 + 5*1.35)/10)/1.35 = 10.75/13.5 = 0.7962963
  // homeDefense = ((3 + 5*1.2)/8)/1.2 = (9/8)/1.2 = 0.9375
  // awayLambda = round2(0.7962963 * 0.9375 * 1.2) = round2(0.895833) = 0.90
  const frozenAsym = estimateFrozenBaselineLambdas(homeAsymmetric, awayAsymmetric, stdLeague)!;
  assert(frozenAsym !== null, 'Frozen parity case should evaluate');
  assertClose(frozenAsym.homeExpectedGoals, 2.56, 1e-6, 'Frozen baseline home lambda parity');
  assertClose(frozenAsym.awayExpectedGoals, 0.9, 1e-6, 'Frozen baseline away lambda parity');

  // 3. Variance moderation under small-sample extremes
  const hotHome: TeamGoalCounts = {
    overall: { played: 6, scored: 18, conceded: 3 },
    venueOnly: { played: 3, scored: 12, conceded: 1 },
  };
  const leakyAway: TeamGoalCounts = {
    overall: { played: 6, scored: 4, conceded: 16 },
    venueOnly: { played: 3, scored: 1, conceded: 10 },
  };
  const frozenHot = estimateFrozenBaselineLambdas(hotHome, leakyAway, stdLeague)!;
  const varAHot = estimateVariantALambdas(hotHome, leakyAway, stdLeague)!;
  const varBHot = estimateVariantBLambdas(hotHome, leakyAway, stdLeague)!;

  assert(
    varAHot.homeExpectedGoals < frozenHot.homeExpectedGoals,
    `Variant A (${varAHot.homeExpectedGoals}) must shrink extreme high lambda below Frozen (${frozenHot.homeExpectedGoals})`
  );
  assert(
    varBHot.homeExpectedGoals < frozenHot.homeExpectedGoals,
    `Variant B (${varBHot.homeExpectedGoals}) must shrink extreme high lambda below Frozen (${frozenHot.homeExpectedGoals})`
  );
  assert(
    varAHot.homeExpectedGoals > stdLeague.avgHomeGoalsLeague &&
      varBHot.homeExpectedGoals > stdLeague.avgHomeGoalsLeague,
    'Both variants must still preserve directional signal above league home mean'
  );

  // 4. Venue cutoff discontinuity vs Variant B smooth partial-pooling transition (played 2 -> 3)
  const homeAt2: TeamGoalCounts = {
    overall: { played: 10, scored: 15, conceded: 10 },
    venueOnly: { played: 2, scored: 6, conceded: 1 }, // high venue rate on tiny sample
  };
  const homeAt3: TeamGoalCounts = {
    overall: { played: 11, scored: 18, conceded: 11 },
    venueOnly: { played: 3, scored: 9, conceded: 2 }, // +1 home win 3-1
  };
  const neutralAway: TeamGoalCounts = {
    overall: { played: 12, scored: 16, conceded: 16 },
    venueOnly: { played: 6, scored: 7, conceded: 9 },
  };

  const f2 = estimateFrozenBaselineLambdas(homeAt2, neutralAway, stdLeague)!;
  const f3 = estimateFrozenBaselineLambdas(homeAt3, neutralAway, stdLeague)!;
  const b2 = estimateVariantBLambdas(homeAt2, neutralAway, stdLeague)!;
  const b3 = estimateVariantBLambdas(homeAt3, neutralAway, stdLeague)!;

  const frozenJump = Math.abs(f3.homeExpectedGoals - f2.homeExpectedGoals);
  const varBJump = Math.abs(b3.homeExpectedGoals - b2.homeExpectedGoals);
  assert(
    varBJump < frozenJump,
    `Variant B transition (delta=${varBJump.toFixed(2)}) must be smoother across n_venue=2->3 than Frozen hard cutoff (delta=${frozenJump.toFixed(2)})`
  );
  assert(
    b2.venueWeights !== undefined && b3.venueWeights !== undefined &&
      b3.venueWeights.homeVenueWeight > b2.venueWeights.homeVenueWeight,
    'Variant B venue weight must strictly increase with home venue sample size'
  );

  // 5. Monotonicity with respect to goals scored and clamping bounds [0.35, 4.0]
  const lowScoringHome: TeamGoalCounts = {
    overall: { played: 15, scored: 0, conceded: 40 },
    venueOnly: { played: 8, scored: 0, conceded: 22 },
  };
  const highConcedingAway: TeamGoalCounts = {
    overall: { played: 15, scored: 0, conceded: 60 },
    venueOnly: { played: 8, scored: 0, conceded: 35 },
  };
  const ultraHighHome: TeamGoalCounts = {
    overall: { played: 15, scored: 75, conceded: 2 },
    venueOnly: { played: 8, scored: 45, conceded: 0 },
  };

  for (const variant of ['FROZEN_BASELINE', 'VARIANT_A', 'VARIANT_B'] as const) {
    const lowRes = estimateExperimentalLambdas(variant, lowScoringHome, validTeam, stdLeague)!;
    const highRes = estimateExperimentalLambdas(variant, ultraHighHome, highConcedingAway, stdLeague)!;
    assert(
      Number.isFinite(lowRes.homeExpectedGoals) && Number.isFinite(lowRes.awayExpectedGoals),
      `${variant} lowRes lambdas must be finite`
    );
    assert(
      lowRes.homeExpectedGoals >= 0.35 && lowRes.awayExpectedGoals <= 4.0,
      `${variant} lowRes lambdas must respect [0.35, 4.0] bounds`
    );
    assert(
      highRes.homeExpectedGoals <= 4.0 && highRes.awayExpectedGoals >= 0.35,
      `${variant} highRes lambdas must respect [0.35, 4.0] bounds`
    );
    assert(
      highRes.homeExpectedGoals > lowRes.homeExpectedGoals,
      `${variant} homeExpectedGoals must be strictly higher for dominant offense vs zero-goal offense`
    );
  }

  console.log('✅ ALL PHASE 4A EXPERIMENTAL GOAL INTENSITY TESTS PASSED!');
}

runExperimentalGoalIntensityTests();
