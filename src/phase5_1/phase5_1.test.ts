/**
 * Phase 5.1 Experimental Research Verification, Calibration & Leakage Test Suite
 */
import { Match, MatchStatistics, Prediction } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import {
  calibrate1XTwoApproachA_Existing,
  calibrate1XTwoApproachB_Temperature,
  calibrate1XTwoApproachC_Beta,
  computeSixBinReliability,
  P51_MIN_BETA_SAMPLES,
  P51_MIN_TEMP_SAMPLES,
} from './phase5_1Calibration';
import {
  calibrate1XTwoApproachD_TailShrinkage,
  fitCausalTailShrinkage,
  MIN_TAIL_CALIB_SAMPLES,
  MIN_TAIL_HIGH_CONF_PRIORS,
} from './phase5_1TailCalibration';
import { auditDrawFeatureUsefulness, extractPhase5_1DrawSignals } from './phase5_1DrawSignals';
import {
  evaluateDrawThresholds,
  evaluatePhase5_1DrawVariants,
  MIN_CAUSAL_THRESHOLD_SAMPLES,
  MIN_VARIANT_C_SYMMETRY_SAMPLES,
  MIN_VARIANT_D_ENSEMBLE_SAMPLES,
  Phase5_1DrawHistoryRecord,
} from './phase5_1DrawModel';
import { evaluatePhase5_1Match, runChronologicalPhase5_1Benchmark } from './phase5_1Pipeline';
import { BLIND_HOLDOUT_IDS, runServicePhase5_1Benchmark } from './phase5_1Service';
import { extractPhase5CausalPriors } from '../phase5/phase5CausalPriors';
import { Phase5_1CalibSample1X2 } from './phase5_1Types';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Phase 5.1 Test Assertion Failed: ${msg}`);
  }
}

function makeMatch(
  id: string,
  utcDate: string,
  homeId: string,
  awayId: string,
  hg: number | null,
  ag: number | null
): Match {
  return {
    id,
    leagueId: 'test-p51',
    leagueName: 'Phase 5.1 Test League',
    season: '2025/26',
    matchday: 12,
    utcDate,
    status: hg !== null && ag !== null ? 'FINISHED' : 'SCHEDULED',
    venue: 'Research Park',
    homeTeam: {
      id: homeId,
      name: `Team ${homeId}`,
      shortName: homeId,
      code: homeId.slice(0, 3).toUpperCase(),
      crest: '',
      country: 'Test',
      stadium: 'Arena',
      leagueId: 'test-p51',
      eloRating: 1850, // high season-end mock value that must NEVER leak before 5 games
    },
    awayTeam: {
      id: awayId,
      name: `Team ${awayId}`,
      shortName: awayId,
      code: awayId.slice(0, 3).toUpperCase(),
      crest: '',
      country: 'Test',
      stadium: 'Away Arena',
      leagueId: 'test-p51',
      eloRating: 1450,
    },
    score: { home: hg, away: ag },
    provenance: {
      source: 'Phase 5.1 Synthetic Audit',
      timestamp: utcDate,
      cached: false,
      qualityIndicator: 'HIGH_FIDELITY',
      qualityScore: 85,
      sampleSizeMatches: 12,
      sourceType: 'RESEARCH_OPEN_DATA',
    },
    isDemoData: false,
    matchCategory: 'HISTORICAL',
  };
}

function makeTeamStats(teamId: string, played: number, gf: number, ga: number, elo: number | null) {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    eloRating: elo,
    opponentStrengthIndex: elo,
    recentForm: ['W', 'D', 'W', 'L', 'D'] as Array<'W' | 'D' | 'L'>,
    formMatches: Array.from({ length: Math.min(10, played) }).map((_, i) => ({
      opponent: `Opp-${i}`,
      opponentCode: `OP${i}`,
      opponentElo: 1500,
      isHome: i % 2 === 0,
      score: '1-1',
      result: 'D' as const,
      date: '2025-08-01',
      goalsFor: 1,
      goalsAgainst: 1,
      xG: null,
      xGA: null,
      restDays: 5,
    })),
    overall: {
      matchesPlayed: played,
      wins: Math.floor(played * 0.4),
      draws: Math.floor(played * 0.28),
      losses: Math.ceil(played * 0.32),
      goalsScored: gf,
      goalsConceded: ga,
      avgGoalsScored: played > 0 ? Math.round((gf / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 0 ? Math.round((ga / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.28),
      failedToScore: Math.floor(played * 0.24),
    },
    homeOrAwaySplit: {
      matchesPlayed: Math.floor(played / 2),
      wins: Math.floor(played * 0.22),
      draws: Math.floor(played * 0.14),
      losses: Math.floor(played * 0.14),
      goalsScored: Math.floor(gf / 2),
      goalsConceded: Math.floor(ga / 2),
      avgGoalsScored: played > 1 ? Math.round((gf / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 1 ? Math.round((ga / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.14),
      failedToScore: Math.floor(played * 0.12),
    },
    injuriesCount: null,
    confirmedLineupAvailable: null,
    keyPlayersMissing: [],
    restDays: 5,
    fixtureCongestionIndex: 20,
    provenance: {
      source: 'Phase 5.1 Synthetic Audit',
      timestamp: '2025-10-01T12:00:00Z',
      qualityIndicator: 'HIGH_FIDELITY' as const,
      qualityScore: 85,
      sampleSizeMatches: played,
    },
    isDemoData: false,
  };
}

function makeStats(
  m: Match,
  played: number,
  homeXG: number | null = 1.55,
  awayXG: number | null = 1.15
): MatchStatistics {
  return {
    matchId: m.id,
    homeTeamStats: makeTeamStats(
      m.homeTeam.id,
      played,
      Math.round(played * 1.5),
      Math.round(played * 1.1),
      played >= 5 ? 1610 : null
    ),
    awayTeamStats: makeTeamStats(
      m.awayTeam.id,
      played,
      Math.round(played * 1.2),
      Math.round(played * 1.3),
      played >= 5 ? 1560 : null
    ),
    headToHead: [],
    headToHeadSummary: { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, totalGoals: 0, avgGoals: null },
    homeExpectedGoals: homeXG,
    awayExpectedGoals: awayXG,
    totalExpectedGoals: homeXG !== null && awayXG !== null ? homeXG + awayXG : null,
    hasSufficientData: played >= 5 && homeXG !== null && awayXG !== null,
    provenance: m.provenance,
    isDemoData: false,
  };
}

function makePhase3Pred(m: Match, s: MatchStatistics): Prediction {
  if (!s.hasSufficientData || s.homeExpectedGoals === null || s.awayExpectedGoals === null) {
    return {
      matchId: m.id,
      calculatedAt: m.utcDate,
      modelType: 'ABSTAIN',
      probabilities: null,
      rawProbabilities: null,
      expectedScore: null,
      topScorelines: [],
      modelEvaluations: [],
      confidence: null,
      confidenceScore: null,
      confidencePillars: {
        modelProbability: null,
        historicalAccuracy: null,
        dataReliability: 30,
        modelAgreement: null,
        decision: 'ABSTAIN_DATA_DEFICIT',
        abstainReason: 'Insufficient pre-match sample (<5)',
      },
      metricsExplanation: 'ABSTAIN',
      abstainReason: 'Insufficient pre-match sample (<5)',
      sampleSizeMatches: s.homeTeamStats.overall.matchesPlayed,
      provenance: m.provenance,
      isDemoData: false,
    };
  }
  const dc = calculatePoissonProbabilities(s.homeExpectedGoals, s.awayExpectedGoals, 7, true);
  return {
    matchId: m.id,
    calculatedAt: m.utcDate,
    modelType: 'ENSEMBLE_VALIDATED',
    probabilities: dc.markets,
    rawProbabilities: dc.markets,
    expectedScore: {
      home: s.homeExpectedGoals,
      away: s.awayExpectedGoals,
      mostLikelyScore: dc.topScorelines[0].score,
      probability: dc.topScorelines[0].probability,
    },
    topScorelines: dc.topScorelines,
    modelEvaluations: [],
    confidence: 'HIGH',
    confidenceScore: 76,
    confidencePillars: {
      modelProbability: Math.max(dc.markets.homeWin, dc.markets.draw, dc.markets.awayWin),
      historicalAccuracy: null,
      dataReliability: 80,
      modelAgreement: 80,
      decision: 'RECOMMENDED_ANALYSIS',
    },
    metricsExplanation: 'Phase 3 test prediction',
    sampleSizeMatches: s.homeTeamStats.overall.matchesPlayed,
    provenance: m.provenance,
    isDemoData: false,
  };
}

export async function runPhase5_1Tests() {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    assert(cond, msg);
    passed++;
  };

  console.log('🧪 Starting Phase 5.1 Calibration, Draw Discrimination & Zero-Leakage Audit Suite...\n');

  // 1. 6-bin reliability diagnostics check
  const rel = computeSixBinReliability([
    { prob01: 0.25, hit: false },
    { prob01: 0.55, hit: true },
    { prob01: 0.74, hit: true },
    { prob01: 0.85, hit: false },
    { prob01: 0.93, hit: true },
  ]);
  check(
    rel.length === 6 &&
      rel[0].binLabel === '0-50%' &&
      rel[3].binLabel === '70-80%' &&
      rel[4].binLabel === '80-90%' &&
      rel[5].binLabel === '90-100%',
    '6-bin reliability covers 0-50%, 50-60%, 60-70%, 70-80%, 80-90%, 90-100%'
  );

  // 2. NOT_TRAINED rules below causal thresholds for 1X2 Approaches A, B, C, D
  const samples99: Phase5_1CalibSample1X2[] = Array.from({ length: 99 }).map((_, i) => ({
    timestampMs: Date.UTC(2025, 0, 1) + i * 3600_000,
    pH: 0.78,
    pD: 0.14,
    pA: 0.08,
    winner: i % 2 === 0 ? 'HOME' : 'DRAW',
  }));
  const targetIso = '2025-06-01T15:00:00Z';
  const rA99 = calibrate1XTwoApproachA_Existing(0.78, 0.14, 0.08, targetIso, samples99);
  const rB99 = calibrate1XTwoApproachB_Temperature(0.78, 0.14, 0.08, targetIso, samples99);
  const rC99 = calibrate1XTwoApproachC_Beta(0.78, 0.14, 0.08, targetIso, samples99);
  const rD99 = calibrate1XTwoApproachD_TailShrinkage(0.78, 0.14, 0.08, targetIso, samples99);
  check(
    rA99.status === 'NOT_TRAINED' &&
      rB99.status === 'NOT_TRAINED' &&
      rC99.status === 'NOT_TRAINED' &&
      rD99.status === 'NOT_TRAINED',
    `All 1X2 calibrators enforce NOT_TRAINED below thresholds (Temp/Tail >=${P51_MIN_TEMP_SAMPLES}, Beta >=${P51_MIN_BETA_SAMPLES})`
  );

  // Tail shrinkage also returns NOT_TRAINED when n >= 100 but < 15 tail events (> 65%)
  const nonTail120: Phase5_1CalibSample1X2[] = Array.from({ length: 120 }).map((_, i) => ({
    timestampMs: Date.UTC(2025, 0, 1) + i * 3600_000,
    pH: 0.45,
    pD: 0.30,
    pA: 0.25,
    winner: i % 3 === 0 ? 'HOME' : i % 3 === 1 ? 'DRAW' : 'AWAY',
  }));
  const tailNoTail = fitCausalTailShrinkage(nonTail120);
  check(
    tailNoTail.status === 'NOT_TRAINED' && tailNoTail.tailPriorSamples < MIN_TAIL_HIGH_CONF_PRIORS,
    `Tail shrinkage returns NOT_TRAINED when tail priors < ${MIN_TAIL_HIGH_CONF_PRIORS}`
  );

  // 3. Causal Tail Shrinkage detects genuine overconfident historical tail and shrinks only > 65%, leaving <= 65% untouched
  const overconfTailSamples: Phase5_1CalibSample1X2[] = Array.from({ length: 140 }).map((_, i) => {
    const isTail = i % 3 === 0;
    const nonTailMod = i % 10;
    const nonTailWinner: 'HOME' | 'DRAW' | 'AWAY' =
      nonTailMod < 5 ? 'HOME' : nonTailMod < 8 ? 'DRAW' : 'AWAY';
    return {
      timestampMs: Date.UTC(2024, 0, 1) + i * 3600_000,
      pH: isTail ? 0.86 : 0.48,
      pD: isTail ? 0.08 : 0.29,
      pA: isTail ? 0.06 : 0.23,
      // Non-tail is well-calibrated (~50/30/20); tail predicts 86% HOME but only hits ~55%!
      winner: isTail ? (i % 6 === 0 || i % 9 === 0 ? 'HOME' : 'DRAW') : nonTailWinner,
    };
  });
  const tailTrainedLow = calibrate1XTwoApproachD_TailShrinkage(0.45, 0.30, 0.25, '2026-01-01T00:00:00Z', overconfTailSamples);
  const tailTrainedHigh = calibrate1XTwoApproachD_TailShrinkage(0.86, 0.08, 0.06, '2026-01-01T00:00:00Z', overconfTailSamples);
  check(
    tailTrainedHigh.status === 'CALIBRATED' &&
      (tailTrainedHigh.tailShrinkage?.pooledGamma ?? 0) > 0 &&
      tailTrainedHigh.homeWin01 < 0.84 &&
      Math.abs(tailTrainedLow.homeWin01 + tailTrainedLow.draw01 + tailTrainedLow.awayWin01 - 1) < 1e-5,
    'Causal Tail Shrinkage learns gamma > 0 from overconfident priors and keeps simplex sum strictly 1.0'
  );

  // 4. Future Calibration Sample Leakage & Same Timestamp Leakage Tests
  const futurePoisonedSamples: Phase5_1CalibSample1X2[] = [
    ...samples99,
    ...Array.from({ length: 180 }).map((_, j) => ({
      timestampMs: j === 0 ? new Date(targetIso).getTime() : Date.UTC(2025, 8, 1 + j, 15, 0, 0),
      pH: 0.90,
      pD: 0.06,
      pA: 0.04,
      winner: 'AWAY' as const,
    })),
  ];
  const calFutureTest = calibrate1XTwoApproachD_TailShrinkage(0.78, 0.14, 0.08, targetIso, futurePoisonedSamples);
  check(
    calFutureTest.status === 'NOT_TRAINED' && calFutureTest.sampleCount === 99,
    'ZERO LEAKAGE (Calibration & Same-Timestamp): =T and >T calibration samples are strictly excluded'
  );

  // 5. All 8 Leakage Audits in full evaluation call (target match, future match, same timestamp, target xG, target events, season-end rating)
  const teamIds = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  const cleanSeason: Match[] = Array.from({ length: 40 }).map((_, i) =>
    makeMatch(
      `m-${i}`,
      new Date(Date.UTC(2025, 7, 1 + i * 2, 15, 0, 0)).toISOString(),
      teamIds[i % 6],
      teamIds[(i + 1 + (i % 3)) % 6],
      i % 4,
      (i + 1) % 3
    )
  );
  const targetMatch = makeMatch('target-match', '2025-11-15T15:00:00Z', 'T1', 'T2', 9, 9);
  const targetStatsClean = makeStats(targetMatch, 12, 1.5, 1.2);
  const targetStatsPolluted: MatchStatistics = {
    ...targetStatsClean,
    observedMatchXG: { homeXG: 7.5, awayXG: 0.1 },
    homeTeamStats: {
      ...targetStatsClean.homeTeamStats,
      confirmedLineupAvailable: true,
      injuriesCount: 6,
    },
  };
  const p3Clean = makePhase3Pred(targetMatch, targetStatsClean);
  const cleanPred = evaluatePhase5_1Match(targetMatch, targetStatsClean, {
    phase3Prediction: p3Clean,
    competitionMatches: cleanSeason,
  });

  const pollutedSeason = [
    ...cleanSeason,
    { ...targetMatch, score: { home: 11, away: 0 } }, // target match leakage
    makeMatch('same-ts', targetMatch.utcDate, 'T1', 'T2', 12, 0), // same timestamp leakage
    makeMatch('future-1', '2025-12-01T15:00:00Z', 'T1', 'T2', 14, 0), // future match leakage
    makeMatch('future-2', '2025-12-08T15:00:00Z', 'T2', 'T1', 0, 14),
  ];
  const pollutedPred = evaluatePhase5_1Match(targetMatch, targetStatsPolluted, {
    phase3Prediction: p3Clean,
    competitionMatches: pollutedSeason,
  });

  check(
    JSON.stringify(cleanPred.oneXTwoRaw) === JSON.stringify(pollutedPred.oneXTwoRaw) &&
      JSON.stringify(cleanPred.oneXTwoSelected) === JSON.stringify(pollutedPred.oneXTwoSelected) &&
      JSON.stringify(cleanPred.drawSignals) === JSON.stringify(pollutedPred.drawSignals) &&
      JSON.stringify(cleanPred.drawVariants) === JSON.stringify(pollutedPred.drawVariants),
    'ZERO LEAKAGE: target score, target xG, target events, same-timestamp (=T), and future (>T) outcomes NEVER alter Phase 5.1'
  );

  // Season-end rating leakage guard (< 5 games)
  const fewGamesSeason = cleanSeason.slice(0, 4);
  const earlyPriors = extractPhase5CausalPriors(targetMatch, fewGamesSeason);
  check(
    earlyPriors.homeEloCausal === null && earlyPriors.awayEloCausal === null,
    'ZERO LEAKAGE (Season-End Rating): team.eloRating is NEVER used when causal prior games < 5'
  );

  // 6. Draw Model Variants C/D & Threshold NOT_TRAINED enforcement + zero future threshold leakage
  const smallDrawHistory: Phase5_1DrawHistoryRecord[] = Array.from({ length: 50 }).map((_, i) => ({
    timestampMs: Date.UTC(2025, 7, 1) + i * 3600_000,
    features: cleanPred.drawSignals,
    probA01: 0.27,
    probB01: 0.26,
    probC01: null,
    probEnsemble01: null,
    phase5HistoryEntry: {
      timestampMs: Date.UTC(2025, 7, 1) + i * 3600_000,
      rawDixonColesDraw01: 0.26,
      shrunkDraw01: 0.26,
      parityScore: 0.7,
      lowScoringIndex: 0.7,
      leagueDrawPrior01: 0.26,
      isDraw: i % 4 === 0,
    },
    isDraw: i % 4 === 0,
  }));
  const drawOutSmall = evaluatePhase5_1DrawVariants({
    match: targetMatch,
    stats: targetStatsClean,
    dixonColesMixDrawProbPct: 27.2,
    lambdaHome: 1.45,
    lambdaAway: 1.25,
    priors: cleanPred.causalPriors,
    features: cleanPred.drawSignals,
    drawHistory: smallDrawHistory,
    drawUncertainty: 0.03,
  });
  check(
    drawOutSmall.variants.C_STRENGTH_SYMMETRY.status === 'NOT_TRAINED' &&
      drawOutSmall.variants.D_CAUSAL_ENSEMBLE.status === 'NOT_TRAINED',
    `Draw Variants C (>=${MIN_VARIANT_C_SYMMETRY_SAMPLES}) and D (>=${MIN_VARIANT_D_ENSEMBLE_SAMPLES}) enforce NOT_TRAINED below thresholds`
  );

  const thSmall = evaluateDrawThresholds({
    p1x2Home01: 0.44,
    p1x2Draw01: 0.28,
    p1x2Away01: 0.28,
    selectedDrawProb01: 0.29,
    priorRowsForThreshold: Array.from({ length: 79 }).map((_, i) => ({ prob01: 0.28, isDraw: i % 4 === 0 })),
  });
  check(
    thSmall.CAUSAL_LEARNED_THRESHOLD.status === 'NOT_TRAINED' &&
      thSmall.CAUSAL_LEARNED_THRESHOLD.threshold01 === null,
    `Causal Draw Threshold strictly enforces NOT_TRAINED below ${MIN_CAUSAL_THRESHOLD_SAMPLES} priors (zero future threshold optimization)`
  );

  // Future threshold leakage test: polluting future threshold priors (>= T) must not affect causal threshold
  const validThPriors = Array.from({ length: 90 }).map((_, i) => ({
    timestampMs: Date.UTC(2025, 7, 1) + i * 3600_000,
    prob01: i % 4 === 0 ? 0.31 : 0.23,
    isDraw: i % 4 === 0,
  }));
  const pollutedThPriors = [
    ...validThPriors,
    ...Array.from({ length: 120 }).map((_, i) => ({
      timestampMs: new Date(targetMatch.utcDate).getTime() + (i === 0 ? 0 : i * 3600_000),
      prob01: 0.35,
      isDraw: false,
    })),
  ];
  const ctxCleanTh = evaluatePhase5_1Match(targetMatch, targetStatsClean, {
    phase3Prediction: p3Clean,
    competitionMatches: cleanSeason,
    context: { oneXTwoSamples: [], drawHistory: [], drawThresholdPriors: validThPriors },
  });
  const ctxPollutedTh = evaluatePhase5_1Match(targetMatch, targetStatsClean, {
    phase3Prediction: p3Clean,
    competitionMatches: cleanSeason,
    context: { oneXTwoSamples: [], drawHistory: [], drawThresholdPriors: pollutedThPriors },
  });
  check(
    ctxCleanTh.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.threshold01 ===
      ctxPollutedTh.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.threshold01 &&
      ctxCleanTh.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.trainingSamples ===
        ctxPollutedTh.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.trainingSamples,
    'ZERO LEAKAGE (Future Threshold): simultaneous (=T) and future (>T) outcomes never change causal threshold'
  );

  // 7. Global Phase 3 ABSTAIN preservation
  const abstainStats = makeStats(targetMatch, 3, null, null);
  const abstainPred = evaluatePhase5_1Match(targetMatch, abstainStats, {
    phase3Prediction: makePhase3Pred(targetMatch, abstainStats),
    competitionMatches: cleanSeason,
  });
  check(
    abstainPred.abstainScope === 'MATCH_ABSTAIN' &&
      abstainPred.marketDecisions['1X2'].status === 'ABSTAIN' &&
      abstainPred.marketDecisions.DRAW.status === 'ABSTAIN',
    'Phase 5.1 preserves Frozen Phase 3 global ABSTAIN contract'
  );

  // 8. Independent Feature Usefulness Audit sanity
  const auditRows = Array.from({ length: 45 }).map((_, i) => {
    const sig = extractPhase5_1DrawSignals({
      stats: targetStatsClean,
      priors: cleanPred.causalPriors,
      shrunkLambdaHome: i % 3 === 0 ? 1.15 : 1.85,
      shrunkLambdaAway: i % 3 === 0 ? 1.12 : 0.95,
    });
    return { features: sig, isDraw: i % 3 === 0, leaguePrior01: 0.26 };
  });
  const featAudit = auditDrawFeatureUsefulness(auditRows);
  check(featAudit.length >= 8 && featAudit.some((f) => f.featureName === 'poissonDrawProb01'), 'Feature usefulness audit evaluates all draw signals independently');

  // 9. Blind Holdout Protection runtime test
  let holdoutBlocked = false;
  try {
    await runServicePhase5_1Benchmark({ leagueId: 'statsbomb-9-27' });
  } catch {
    holdoutBlocked = true;
  }
  check(
    holdoutBlocked && BLIND_HOLDOUT_IDS.has('statsbomb-9-27') && BLIND_HOLDOUT_IDS.has('statsbomb-9-281'),
    'Blind Holdout seasons are strictly protected at runtime'
  );

  // 10. Full Chronological Walk-Forward Benchmark (175 fixtures so Variant C, Variant D, Temp, Beta, Tail Shrinkage, and Causal Threshold all activate causally!)
  const longSeason: Match[] = Array.from({ length: 175 }).map((_, i) => {
    const dt = new Date(Date.UTC(2025, 7, 1 + Math.floor(i / 2) * 3, (i % 2) * 3 + 14, 0, 0)).toISOString();
    const h = teamIds[i % 6];
    const a = teamIds[(i + 1 + (i % 4)) % 6];
    const hg = i % 5 === 0 ? 1 : (i * 7) % 4;
    const ag = i % 5 === 0 ? 1 : (i * 5 + 1) % 3;
    return makeMatch(`wk51-${i}`, dt, h, a, hg, ag);
  });

  const rep = await runChronologicalPhase5_1Benchmark({
    datasetId: 'synthetic-p51',
    datasetName: 'Synthetic Zero-Leakage Phase 5.1 Season',
    matches: longSeason,
    getMatchStats: async (m) => {
      const idx = longSeason.findIndex((x) => x.id === m.id);
      const prior = longSeason.slice(0, idx);
      const hPrior = prior.filter((p) => p.homeTeam.id === m.homeTeam.id || p.awayTeam.id === m.homeTeam.id).length;
      const aPrior = prior.filter((p) => p.homeTeam.id === m.awayTeam.id || p.awayTeam.id === m.awayTeam.id).length;
      const minP = Math.min(hPrior, aPrior);
      return makeStats(m, minP, minP >= 5 ? (idx % 3 === 0 ? 2.1 : 1.35) : null, minP >= 5 ? (idx % 3 === 0 ? 0.8 : 1.25) : null);
    },
    calculatePhase3: async (m, s) => makePhase3Pred(m, s),
  });

  check(
    rep.leakageCheck.verified &&
      rep.leakageCheck.futureDataViolations === 0 &&
      rep.leakageCheck.targetMatchViolations === 0 &&
      rep.leakageCheck.sameTimestampViolations === 0 &&
      rep.leakageCheck.targetXgViolations === 0 &&
      rep.leakageCheck.targetEventsViolations === 0 &&
      rep.leakageCheck.seasonEndRatingViolations === 0 &&
      rep.leakageCheck.futureCalibrationViolations === 0 &&
      rep.leakageCheck.futureThresholdViolations === 0,
    'Chronological Phase 5.1 benchmark passes ALL 8 leakage counters with 0 violations'
  );
  check(
    rep.oneXTwo.phase5_1Approaches.D_tailShrinkage.sampleSize > 0 &&
      rep.draw.variants.variantC_strengthSymmetry.sampleSize > 0 &&
      rep.draw.variants.variantD_causalEnsemble.sampleSize > 0 &&
      rep.draw.thresholdComparison.causalLearnedThreshold.sampleSize > 0,
    'Full chronological run activates Tail Shrinkage, Draw Variants A/B/C/D, and Causal Threshold cleanly'
  );

  console.log(`\n🎉 All ${passed} Phase 5.1 verification, calibration, draw & leakage tests passed!`);
}

runPhase5_1Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
