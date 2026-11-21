/**
 * Phase 6 Safety, Causality, Data Hygiene, and Modeling Test Suite
 *
 * Verifies:
 * 1. Protected holdout, external validation, and Chain B rejection guards
 * 2. skipObservedXG: true enforcement
 * 3. No future-match access & exact-timestamp batch integrity
 * 4. Season-keyed cache isolation
 * 5. Relegation playoff & invalid/epoch timestamp filtering with explicit exclusion ledger
 * 6. Promoted-team tier adjustment & explicit provenance rules
 * 7. Cross-season decay (0.65) & Elo mean regression
 * 8. Draw & BTTS acceptance gates against causal league priors
 * 9. Canonical ABSTAIN contract preservation
 */

import { Match, MatchStatistics } from '../types/football';
import {
  CHAIN_B_CONFIRMATORY_IDS,
  EXTERNAL_VALIDATION_IDS,
  PROTECTED_BLIND_HOLDOUT_IDS,
  assertApprovedPhase6Dataset,
  assertTimestampBatchIntegrity,
  enforceSkipObservedXG,
  makeSeasonCacheKey,
} from './phase6Guards';
import {
  Phase6CrossSeasonLoader,
  groupMatchesByExactTimestamp,
  sanitizeSeasonMatches,
} from './crossSeasonLoader';
import {
  Phase6HierarchicalEngine,
  buildCanonicalAbstainContract,
} from './crossSeasonState';
import {
  Phase6PrunedDrawTracker,
  computeEloSymmetry,
  evaluateDrawAcceptanceGate,
} from './phase6DrawModel';
import {
  evaluateBttsAcceptanceGate,
  evaluatePhase6BttsMatch,
} from './phase6BttsModel';
import {
  PHASE6_INTER_SEASON_DECAY,
  PHASE6_PROMOTED_ELO_ADJUSTMENT,
  PHASE6_PROMOTED_GOAL_SCALE,
  Phase6CleanMatch,
} from './phase6Types';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Phase 6 Test Assertion Failed: ${msg}`);
  }
}

function assertThrows(fn: () => unknown, expectedSubstring: string, msg: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    const text = err instanceof Error ? err.message : String(err);
    assert(
      text.toLowerCase().includes(expectedSubstring.toLowerCase()),
      `${msg}: expected error containing "${expectedSubstring}", got "${text}"`
    );
  }
  assert(threw, `${msg}: expected function to throw`);
}

async function assertRejects(fn: () => Promise<unknown>, expectedSubstring: string, msg: string): Promise<void> {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    rejected = true;
    const text = err instanceof Error ? err.message : String(err);
    assert(
      text.toLowerCase().includes(expectedSubstring.toLowerCase()),
      `${msg}: expected rejection containing "${expectedSubstring}", got "${text}"`
    );
  }
  assert(rejected, `${msg}: expected promise to reject`);
}

function makeCleanMatch(
  id: string,
  utcDate: string,
  homeTeamId: string,
  awayTeamId: string,
  homeGoals: number,
  awayGoals: number,
  seasonKey = 'p6:openliga:bl1:t1:s_2017',
  tier = 1
): Phase6CleanMatch {
  return {
    id,
    provider: 'openliga',
    competitionKey: 'openliga-bl1',
    tier,
    seasonLabel: '2017',
    seasonKey,
    utcDate,
    timestampMs: new Date(utcDate).getTime(),
    matchday: 1,
    groupName: '1. Spieltag',
    homeTeamId,
    awayTeamId,
    homeTeamName: homeTeamId,
    awayTeamName: awayTeamId,
    homeGoals,
    awayGoals,
    htHomeGoals: null,
    htAwayGoals: null,
  };
}

async function runTests() {
  let passed = 0;

  // 1. Protected holdout, external validation & Chain B rejection
  for (const id of PROTECTED_BLIND_HOLDOUT_IDS) {
    assertThrows(
      () => assertApprovedPhase6Dataset(id),
      'PROTECTED HOLDOUT GUARD',
      `Holdout ${id} must be rejected`
    );
    assertThrows(
      () => assertApprovedPhase6Dataset(id, { allowChainB: true }),
      'PROTECTED HOLDOUT GUARD',
      `Holdout ${id} must remain rejected even if allowChainB=true`
    );
  }
  for (const id of EXTERNAL_VALIDATION_IDS) {
    assertThrows(
      () => assertApprovedPhase6Dataset(id),
      'EXTERNAL VALIDATION GUARD',
      `External set ${id} must be rejected`
    );
  }
  for (const id of CHAIN_B_CONFIRMATORY_IDS) {
    assertThrows(
      () => assertApprovedPhase6Dataset(id),
      'STEP 1-3 GUARD',
      `Chain B ${id} must be blocked in Steps 1-3`
    );
  }
  assertApprovedPhase6Dataset('openliga-bl1-2016');
  assertApprovedPhase6Dataset('openliga-bl2-2015');
  assertApprovedPhase6Dataset('statsbomb-37-4');
  passed++;

  // 2. skipObservedXG: true enforcement
  const enforcedDefault = enforceSkipObservedXG();
  assert(enforcedDefault.skipObservedXG === true, 'Default options must force skipObservedXG=true');
  assertThrows(
    () => enforceSkipObservedXG({ skipObservedXG: false }),
    'LEAKAGE GUARD',
    'Passing skipObservedXG=false must throw'
  );
  const mockSbProvider = {
    getMatches: async () => [],
    getMatchStatistics: async (_m: Match, opts?: { skipObservedXG?: boolean }): Promise<MatchStatistics> => {
      assert(opts?.skipObservedXG === true, 'StatsBomb provider must receive skipObservedXG=true');
      return {
        matchId: 'm1',
        homeTeamStats: {} as any,
        awayTeamStats: {} as any,
        headToHead: [],
        headToHeadSummary: { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, totalGoals: 0, avgGoals: null },
        homeExpectedGoals: null,
        awayExpectedGoals: null,
        totalExpectedGoals: null,
        observedMatchXG: null,
        hasSufficientData: false,
        isDemoData: false,
        provenance: {} as any,
      };
    },
  } as any;
  const loaderWithMock = new Phase6CrossSeasonLoader(undefined, mockSbProvider);
  await loaderWithMock.fetchStatsBombStatisticsStrict({ id: 'x', leagueId: 'statsbomb-37-4' } as Match);
  await assertRejects(
    () => loaderWithMock.fetchStatsBombStatisticsStrict({ id: 'x', leagueId: 'statsbomb-9-27' } as Match),
    'PROTECTED HOLDOUT GUARD',
    'Loader stats fetch must reject protected holdout'
  );
  passed++;

  // 3. Season-keyed cache isolation
  const k1 = makeSeasonCacheKey('openliga', 'bl1', '2016', 1);
  const k2 = makeSeasonCacheKey('openliga', 'bl1', '2017', 1);
  const k3 = makeSeasonCacheKey('openliga', 'bl2', '2016', 2);
  assert(k1 !== k2 && k1 !== k3 && k2 !== k3, 'Season cache keys must cleanly separate seasons and tiers');
  passed++;

  // 4. Explicit Exclusion Ledger (Relegation, Epoch 1970, Null Scores, Invalid Teams, Duplicates)
  const sanitized = sanitizeSeasonMatches({
    provider: 'openliga',
    competitionKey: 'openliga-bl1',
    tier: 1,
    seasonLabel: '2008',
    rawMatches: [
      { id: 'ok-1', utcDate: '2016-08-27T13:30:00Z', status: 'FINISHED', groupName: '1. Spieltag', homeTeamId: 't1', awayTeamId: 't2', homeGoals: 2, awayGoals: 1 },
      { id: 'ok-1', utcDate: '2016-08-27T13:30:00Z', status: 'FINISHED', groupName: '1. Spieltag', homeTeamId: 't1', awayTeamId: 't2', homeGoals: 2, awayGoals: 1 },
      { id: 'rel-1', utcDate: '2016-05-25T18:30:00Z', status: 'FINISHED', groupName: 'Relegation, Hinspiel', homeTeamId: 't1', awayTeamId: 't3', homeGoals: 1, awayGoals: 0 },
      { id: 'epoch-1', utcDate: '1970-01-01T00:00:00Z', status: 'FINISHED', groupName: '1. Spieltag', homeTeamId: 't1', awayTeamId: 't4', homeGoals: 0, awayGoals: 0 },
      { id: 'unfin-1', utcDate: '2016-09-01T13:30:00Z', status: 'SCHEDULED', groupName: '2. Spieltag', homeTeamId: 't1', awayTeamId: 't5', homeGoals: null, awayGoals: null },
      { id: 'badteam-1', utcDate: '2016-09-02T13:30:00Z', status: 'FINISHED', groupName: '2. Spieltag', homeTeamId: 't1', awayTeamId: 't1', homeGoals: 1, awayGoals: 1 },
    ],
  });
  assert(sanitized.exclusions.rawMatchCount === 6, 'Raw match count must be recorded');
  assert(sanitized.exclusions.retainedMatchCount === 1, 'Only 1 valid match retained');
  assert(sanitized.exclusions.excludedTotal === 5, '5 exclusions explicitly counted');
  assert(sanitized.exclusions.countsByReason.DUPLICATE_MATCH_ID === 1, 'Duplicate logged');
  assert(sanitized.exclusions.countsByReason.RELEGATION_PLAYOFF === 1, 'Relegation logged');
  assert(sanitized.exclusions.countsByReason.INVALID_OR_EPOCH_TIMESTAMP === 1, 'Epoch logged');
  assert(sanitized.exclusions.countsByReason.UNFINISHED_OR_NULL_SCORE === 1, 'Unfinished logged');
  assert(sanitized.exclusions.countsByReason.INVALID_TEAM_ID === 1, 'Invalid team ID logged');
  passed++;

  // 5. Exact-timestamp batch causality & no future-match access
  const mA = makeCleanMatch('mA', '2017-08-19T13:30:00Z', 'team-A', 'team-B', 5, 0);
  const mB = makeCleanMatch('mB', '2017-08-19T13:30:00Z', 'team-C', 'team-D', 0, 4);
  const mLater = makeCleanMatch('mL', '2017-08-26T13:30:00Z', 'team-A', 'team-C', 1, 1);
  const batches = groupMatchesByExactTimestamp([mLater, mB, mA]);
  assert(batches.length === 2, 'Simultaneous matches grouped into 1 batch');
  assert(batches[0].matches.length === 2, 'First batch contains both simultaneous kickoffs');

  const eng = new Phase6HierarchicalEngine({ mode: 'CROSS_SEASON' });
  eng.startSeason({ seasonKey: 's1', tier: 1 });
  const eval0 = eng.evaluateBatch(batches[0]);
  assert(eval0[0].homeEloCausal === 1500 && eval0[1].homeEloCausal === 1500, 'Simultaneous matches must not see each other outcomes');
  assert(eval0[0].matchProvenance === 'LEAGUE_PRIOR_ONLY', 'Cold team with no prior data gets LEAGUE_PRIOR_ONLY provenance');
  eng.commitBatch(batches[0], eval0);

  // Attempting to evaluate earlier/equal timestamp must throw
  assertThrows(
    () => eng.evaluateBatch(batches[0]),
    'CAUSALITY GUARD',
    'Re-evaluating already committed timestamp batch must fail'
  );
  assertThrows(
    () =>
      assertTimestampBatchIntegrity(batches[1].timestampMs, batches[0].timestampMs, [
        { id: 'x', timestampMs: batches[0].timestampMs },
      ]),
    'CAUSALITY GUARD',
    'Mixed-timestamp batch must fail'
  );

  // Verify future matches have zero influence on past evaluations
  const engFuture = new Phase6HierarchicalEngine({ mode: 'CROSS_SEASON' });
  engFuture.startSeason({ seasonKey: 's1', tier: 1 });
  const mA2 = makeCleanMatch('mA', '2017-08-19T13:30:00Z', 'team-A', 'team-B', 5, 0);
  const mB2 = makeCleanMatch('mB', '2017-08-19T13:30:00Z', 'team-C', 'team-D', 0, 4);
  const batchesNoFuture = groupMatchesByExactTimestamp([mA2, mB2]);
  const evalNoFuture = engFuture.evaluateBatch(batchesNoFuture[0]);
  assert(eval0[0].lambdaHome === evalNoFuture[0].lambdaHome, 'Future matches must not alter earlier lambda');
  passed++;

  // 6. Cross-season decay (0.65) & Promoted-team tier adjustment (-100 Elo, 0.85 goal scale)
  const feederMatches = [
    makeCleanMatch('f1', '2016-09-01T13:30:00Z', 'promo-1', 'other-2', 4, 0, 'p6:openliga:bl2:t2:s_2016', 2),
    makeCleanMatch('f2', '2016-09-08T13:30:00Z', 'other-2', 'promo-1', 0, 3, 'p6:openliga:bl2:t2:s_2016', 2),
  ];
  const feederEnd = Phase6HierarchicalEngine.replayFeederSeasonEndStates(
    groupMatchesByExactTimestamp(feederMatches),
    'p6:openliga:bl2:t2:s_2016',
    2
  );
  const rawFeederPromo = feederEnd.get('promo-1')!;
  assert(rawFeederPromo.eloRaw > 1500, 'Winning feeder matches increases raw Elo');

  const engPromo = new Phase6HierarchicalEngine({ mode: 'CROSS_SEASON' });
  engPromo.startSeason({ seasonKey: 'p6:openliga:bl1:t1:s_2016', tier: 1 });
  // Simulate returning bl1 club with 10 wins
  for (let i = 0; i < 6; i++) {
    const dt = `2016-10-${String(i + 1).padStart(2, '0')}T13:30:00Z`;
    const b = groupMatchesByExactTimestamp([makeCleanMatch(`r${i}`, dt, 'stay-1', 'stay-2', 2, 0)])[0];
    const p = engPromo.evaluateBatch(b);
    engPromo.commitBatch(b, p);
  }
  const stayRawEloBeforeBreak = engPromo.exportEndOfSeasonTeamStates().get('stay-1')!.eloRaw;

  engPromo.startSeason({
    seasonKey: 'p6:openliga:bl1:t1:s_2017',
    tier: 1,
    feederEndStates: feederEnd,
  });

  const md1Batch = groupMatchesByExactTimestamp([
    makeCleanMatch('md1', '2017-08-20T13:30:00Z', 'promo-1', 'stay-1', 1, 2),
  ])[0];
  const md1Proj = engPromo.evaluateBatch(md1Batch)[0];

  assert(
    md1Proj.homeProvenance === 'PROMOTED_TEAM_TIER_ADJUSTED',
    `Expected promoted home provenance PROMOTED_TEAM_TIER_ADJUSTED, got ${md1Proj.homeProvenance}`
  );
  assert(
    md1Proj.awayProvenance === 'CROSS_SEASON_PRIOR',
    `Expected returning away provenance CROSS_SEASON_PRIOR, got ${md1Proj.awayProvenance}`
  );
  assert(
    md1Proj.matchProvenance === 'PROMOTED_TEAM_TIER_ADJUSTED',
    'Match provenance must highlight promoted adjustment'
  );

  // Check exact decay & promoted adjustment math
  const expectedStayElo = Math.round(1500 + PHASE6_INTER_SEASON_DECAY * (stayRawEloBeforeBreak - 1500));
  const expectedPromoElo = Math.round(
    1500 + PHASE6_INTER_SEASON_DECAY * (rawFeederPromo.eloRaw - 1500) + PHASE6_PROMOTED_ELO_ADJUSTMENT
  );
  assert(
    Math.abs(md1Proj.awayEloCausal - expectedStayElo) <= 1,
    `Expected decayed returning Elo ${expectedStayElo}, got ${md1Proj.awayEloCausal}`
  );
  assert(
    Math.abs(md1Proj.homeEloCausal - expectedPromoElo) <= 1,
    `Expected promoted Elo ${expectedPromoElo}, got ${md1Proj.homeEloCausal}`
  );
  assert(
    Math.abs(md1Proj.homeTeamState.weightedScored - 7 * PHASE6_INTER_SEASON_DECAY * PHASE6_PROMOTED_GOAL_SCALE) < 1e-6,
    'Promoted team scored goals must carry decay * 0.85 scale'
  );

  // Verify Draw and BTTS modules operate cleanly on projection & gates enforce >= 0.005 edge
  const drawTracker = new Phase6PrunedDrawTracker();
  const drawOut = drawTracker.evaluateMatch(md1Proj);
  assert(drawOut.prunedModelProb01 > 0 && drawOut.prunedModelProb01 < 1, 'Draw probability bounded');
  const bttsOut = evaluatePhase6BttsMatch(md1Proj);
  assert(bttsOut.decoupledFtsCsProb01 > 0 && bttsOut.lightlyShrunkPoissonDcProb01 > 0, 'BTTS probabilities bounded');

  const drawFail = evaluateDrawAcceptanceGate({
    combinedEvalFixtureCount: 1500,
    priorLogLoss: 0.560,
    candidateLogLoss: 0.558,
  });
  assert(!drawFail.passed && drawFail.assignedStatus === 'INFORMATIONAL_PRIOR_ONLY', 'Draw <0.005 improvement must downgrade to INFORMATIONAL_PRIOR_ONLY');
  const bttsPass = evaluateBttsAcceptanceGate({
    combinedEvalFixtureCount: 1500,
    priorLogLoss: 0.685,
    decoupledFtsCsLogLoss: 0.678,
    lightPoissonDcLogLoss: 0.680,
  });
  assert(bttsPass.passed && bttsPass.assignedStatus === 'PREDICT', 'BTTS >=0.005 improvement must pass');
  passed++;

  // 7. Canonical ABSTAIN contract preservation
  const abst = buildCanonicalAbstainContract('Test canonical abstain');
  assert(
    abst.modelType === 'ABSTAIN' &&
      abst.confidence === null &&
      abst.confidenceScore === null &&
      abst.probabilities === null &&
      abst.expectedScore === null,
    'Canonical ABSTAIN contract must preserve exact null fields'
  );
  passed++;

  console.log(`Phase 6 Test Suite Passed: ${passed}/7 verification suites green.`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
