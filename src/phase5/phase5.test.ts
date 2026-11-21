/**
 * Phase 5 Experimental Research Verification & Leakage Audit Suite
 */
import { Match, MatchStatistics, Prediction } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { extractPhase5CausalPriors } from './phase5CausalPriors';
import {
  calibratePhase5Binary,
  calibratePhase5OneXTwo,
  MIN_BETA_SAMPLES,
  MIN_ISOTONIC_SAMPLES,
  MIN_TEMP_SAMPLES,
} from './phase5Calibration';
import { evaluatePhase5DrawModel } from './phase5DrawModel';
import { exactNegBinPmf, evaluatePhase5O25Model } from './phase5O25Model';
import { evaluatePhase5BttsModel } from './phase5BttsModel';
import { evaluatePhase5Match, runChronologicalPhase5Benchmark } from './phase5Pipeline';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Phase 5 Test Assertion Failed: ${msg}`);
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
    leagueId: 'test-p5',
    leagueName: 'Phase 5 Research League',
    season: '2025/26',
    matchday: 10,
    utcDate,
    status: hg !== null && ag !== null ? 'FINISHED' : 'SCHEDULED',
    venue: 'Research Arena',
    homeTeam: {
      id: homeId,
      name: `Team ${homeId}`,
      shortName: homeId,
      code: homeId.slice(0, 3).toUpperCase(),
      crest: '',
      country: 'Test',
      stadium: 'Arena',
      leagueId: 'test-p5',
      eloRating: 1600,
    },
    awayTeam: {
      id: awayId,
      name: `Team ${awayId}`,
      shortName: awayId,
      code: awayId.slice(0, 3).toUpperCase(),
      crest: '',
      country: 'Test',
      stadium: 'Away Arena',
      leagueId: 'test-p5',
      eloRating: 1550,
    },
    score: { home: hg, away: ag },
    provenance: {
      source: 'Phase 5 Synthetic Audit',
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
    recentForm: ['W', 'D', 'W', 'L', 'W'] as Array<'W' | 'D' | 'L'>,
    formMatches: Array.from({ length: Math.min(10, played) }).map((_, i) => ({
      opponent: `Opp-${i}`,
      opponentCode: `OP${i}`,
      opponentElo: 1500,
      isHome: i % 2 === 0,
      score: '2-1',
      result: 'W' as const,
      date: '2025-08-01',
      goalsFor: 2,
      goalsAgainst: 1,
      xG: null,
      xGA: null,
      restDays: 5,
    })),
    overall: {
      matchesPlayed: played,
      wins: Math.floor(played * 0.45),
      draws: Math.floor(played * 0.25),
      losses: Math.ceil(played * 0.3),
      goalsScored: gf,
      goalsConceded: ga,
      avgGoalsScored: played > 0 ? Math.round((gf / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 0 ? Math.round((ga / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.3),
      failedToScore: Math.floor(played * 0.2),
    },
    homeOrAwaySplit: {
      matchesPlayed: Math.floor(played / 2),
      wins: Math.floor(played * 0.25),
      draws: Math.floor(played * 0.12),
      losses: Math.floor(played * 0.13),
      goalsScored: Math.floor(gf / 2),
      goalsConceded: Math.floor(ga / 2),
      avgGoalsScored: played > 1 ? Math.round((gf / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 1 ? Math.round((ga / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.15),
      failedToScore: Math.floor(played * 0.1),
    },
    injuriesCount: null,
    confirmedLineupAvailable: null,
    keyPlayersMissing: [],
    restDays: 5,
    fixtureCongestionIndex: 20,
    provenance: {
      source: 'Phase 5 Synthetic Audit',
      timestamp: '2025-10-01T12:00:00Z',
      qualityIndicator: 'HIGH_FIDELITY' as const,
      qualityScore: 85,
      sampleSizeMatches: played,
    },
    isDemoData: false,
  };
}

function makeStats(m: Match, played: number, homeXG: number | null = 1.52, awayXG: number | null = 1.18): MatchStatistics {
  return {
    matchId: m.id,
    homeTeamStats: makeTeamStats(m.homeTeam.id, played, Math.round(played * 1.5), Math.round(played * 1.1), played >= 5 ? 1610 : null),
    awayTeamStats: makeTeamStats(m.awayTeam.id, played, Math.round(played * 1.2), Math.round(played * 1.3), played >= 5 ? 1560 : null),
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

export async function runPhase5Tests() {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    assert(cond, msg);
    passed++;
  };

  console.log('🧪 Starting Phase 5 Research Verification & Leakage Audit Suite...\n');

  // 1. Exact NegBin PMF normalization
  let nbSum = 0;
  for (let k = 0; k <= 25; k++) nbSum += exactNegBinPmf(k, 1.55, 10.0);
  check(Math.abs(nbSum - 1.0) < 0.0005, `NegBin PMF sums strictly to 1.0 (got ${nbSum.toFixed(6)})`);

  // 2. Calibration sample threshold & strict causality (< T) tests
  const baseBinary = Array.from({ length: 99 }).map((_, i) => ({
    timestampMs: Date.UTC(2025, 0, 1 + i, 15, 0, 0),
    rawProb01: 0.72,
    actual: i % 2 === 0,
  }));
  const targetIso = '2025-06-01T15:00:00Z';
  const cal99 = calibratePhase5Binary(0.72, targetIso, baseBinary);
  check(
    cal99.status === 'NOT_TRAINED' &&
      cal99.selectedMethod === 'RAW_IDENTITY' &&
      cal99.sampleCount === 99 &&
      Math.abs(cal99.calibratedProb01 - 0.72) < 1e-6,
    `Binary calibration returns NOT_TRAINED below ${MIN_TEMP_SAMPLES} causal samples`
  );

  const futurePoisonBinary = [
    ...baseBinary,
    ...Array.from({ length: 160 }).map((_, j) => ({
      timestampMs: j === 0 ? new Date(targetIso).getTime() : Date.UTC(2025, 8, 1 + j, 15, 0, 0),
      rawProb01: 0.9,
      actual: true,
    })),
  ];
  const calPoisoned = calibratePhase5Binary(0.72, targetIso, futurePoisonBinary);
  check(
    calPoisoned.status === 'NOT_TRAINED' && calPoisoned.sampleCount === 99,
    'ZERO LEAKAGE: Simultaneous (=T) and future (>T) calibration samples are strictly ignored'
  );

  // Monotonic sample availability thresholds (Temp >= 100, Beta >= 150, Isotonic >= 220)
  const makePriorBin = (n: number) =>
    Array.from({ length: n }).map((_, i) => ({
      timestampMs: Date.UTC(2024, 0, 1) + i * 3600_000,
      rawProb01: 0.2 + ((i % 7) * 0.1),
      actual: i % 2 === 0,
    }));

  const cal120 = calibratePhase5Binary(0.6, '2026-01-01T00:00:00Z', makePriorBin(120));
  const c120Temp = cal120.comparisons.find((c) => c.method === 'TEMPERATURE');
  const c120Beta = cal120.comparisons.find((c) => c.method === 'BETA');
  const c120Iso = cal120.comparisons.find((c) => c.method === 'ISOTONIC');
  check(
    Boolean(c120Temp?.available && !c120Beta?.available && !c120Iso?.available),
    `At n=120: Temperature available (>=${MIN_TEMP_SAMPLES}), Beta (<${MIN_BETA_SAMPLES}) & Isotonic (<${MIN_ISOTONIC_SAMPLES}) NOT_TRAINED`
  );

  const cal240 = calibratePhase5Binary(0.6, '2026-01-01T00:00:00Z', makePriorBin(240));
  check(
    cal240.comparisons.every((c) => c.available),
    'At n=240: Raw, Temperature, Beta, and PAV Isotonic are all eligible for causal selection'
  );

  const calMulti99 = calibratePhase5OneXTwo(
    0.5,
    0.25,
    0.25,
    '2026-01-01T00:00:00Z',
    Array.from({ length: 99 }).map((_, i) => ({
      timestampMs: Date.UTC(2024, 0, 1) + i * 3600_000,
      pH: 0.5,
      pD: 0.25,
      pA: 0.25,
      winner: 'HOME' as const,
    }))
  );
  check(calMulti99.status === 'NOT_TRAINED' && calMulti99.temperature === 1.0, '1X2 calibration returns NOT_TRAINED below 100 samples');

  // 3. Causal Priors & Draw/O2.5/BTTS Future Leakage Immunity Test
  const teamIds = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  const cleanSeason: Match[] = [];
  for (let i = 0; i < 40; i++) {
    const dt = new Date(Date.UTC(2025, 7, 1 + i * 2, 15, 0, 0)).toISOString();
    const h = teamIds[i % 6];
    const a = teamIds[(i + 1 + (i % 3)) % 6];
    cleanSeason.push(makeMatch(`m-${i}`, dt, h, a, (i % 4), ((i + 1) % 3)));
  }
  const targetMatch = makeMatch('target-match', '2025-11-15T15:00:00Z', 'T1', 'T2', 9, 9);
  const targetStatsClean = makeStats(targetMatch, 12, 1.5, 1.2);
  const targetStatsWithObsXG = {
    ...targetStatsClean,
    observedMatchXG: { homeXG: 8.5, awayXG: 0.1 },
  };
  const targetP3 = makePhase3Pred(targetMatch, targetStatsClean);

  const cleanEval = evaluatePhase5Match(targetMatch, targetStatsClean, {
    phase3Prediction: targetP3,
    competitionMatches: [...cleanSeason, targetMatch],
  });

  // Pollute with simultaneous (=T) match, extreme future (>T) matches, and observedMatchXG
  const pollutedSeason = [
    ...cleanSeason,
    makeMatch('same-ts', targetMatch.utcDate, 'T1', 'T2', 12, 0),
    makeMatch('future-1', '2025-12-01T15:00:00Z', 'T1', 'T2', 15, 0),
    makeMatch('future-2', '2025-12-08T15:00:00Z', 'T2', 'T1', 0, 15),
    { ...targetMatch, score: { home: 10, away: 0 } },
  ];
  const pollutedEval = evaluatePhase5Match(targetMatch, targetStatsWithObsXG, {
    phase3Prediction: targetP3,
    competitionMatches: pollutedSeason,
  });

  check(
    JSON.stringify(cleanEval.oneXTwo) === JSON.stringify(pollutedEval.oneXTwo) &&
      JSON.stringify(cleanEval.drawResearch) === JSON.stringify(pollutedEval.drawResearch) &&
      JSON.stringify(cleanEval.o25Research) === JSON.stringify(pollutedEval.o25Research) &&
      JSON.stringify(cleanEval.bttsResearch) === JSON.stringify(pollutedEval.bttsResearch),
    'ZERO LEAKAGE: target actual score, observedMatchXG, simultaneous (=T), and future (>T) outcomes NEVER alter Phase 5 predictions'
  );

  // Invalid target timestamp safety
  const badTsMatch = { ...targetMatch, utcDate: 'not-a-date' };
  const badPriors = extractPhase5CausalPriors(badTsMatch, cleanSeason);
  check(!badPriors.validTimestamp && badPriors.priorLeagueMatches === 0, 'Invalid target timestamp safely yields 0 causal priors');

  // 4. Global Phase 3 ABSTAIN preservation & independent market-specific abstention
  const abstainStats = makeStats(targetMatch, 3, null, null);
  const abstainP3 = makePhase3Pred(targetMatch, abstainStats);
  const p5GlobalAbstain = evaluatePhase5Match(targetMatch, abstainStats, {
    phase3Prediction: abstainP3,
    competitionMatches: cleanSeason,
  });
  check(
    p5GlobalAbstain.abstainScope === 'MATCH_ABSTAIN' &&
      p5GlobalAbstain.marketDecisions['1X2'].status === 'ABSTAIN' &&
      p5GlobalAbstain.marketDecisions.DRAW.status === 'ABSTAIN' &&
      p5GlobalAbstain.marketDecisions.OVER25.status === 'ABSTAIN' &&
      p5GlobalAbstain.marketDecisions.BTTS.status === 'ABSTAIN' &&
      p5GlobalAbstain.oneXTwo.homeWin === null,
    'Phase 5 preserves Phase 3 global ABSTAIN contract across all markets'
  );

  // Market-only abstention: missing Elo with sample=6 abstains 1X2 while OVER25/BTTS still PREDICT
  const lowSampleMatches = cleanSeason.slice(0, 8); // < 5 team games for causal Elo
  const statsSample6 = makeStats(targetMatch, 6, 1.75, 1.35);
  const p3ValidSample6 = makePhase3Pred(targetMatch, statsSample6);
  const p5Selective = evaluatePhase5Match(targetMatch, statsSample6, {
    phase3Prediction: p3ValidSample6,
    competitionMatches: lowSampleMatches,
  });
  check(
    p5Selective.marketDecisions['1X2'].status === 'ABSTAIN' &&
      p5Selective.marketDecisions.OVER25.status === 'PREDICT' &&
      p5Selective.marketDecisions.BTTS.status === 'PREDICT',
    'Independent market abstention: 1X2 abstains when causal Elo unavailable (<7 matches) while healthy O2.5 & BTTS predict'
  );

  // 5. Phase 5A/5B/5C probability integrity & bounds
  const sum1x2 =
    Math.round(
      ((cleanEval.oneXTwo.homeWin ?? 0) + (cleanEval.oneXTwo.draw ?? 0) + (cleanEval.oneXTwo.awayWin ?? 0)) *
        10
    ) / 10;
  check(sum1x2 === 100.0, `Phase 5 1X2 probabilities sum strictly to 100.0% (got ${sum1x2})`);
  check(
    cleanEval.drawResearch.finalDrawProbPct !== null &&
      cleanEval.o25Research.selectedFinalPct !== null &&
      cleanEval.bttsResearch.selectedFinalPct !== null,
    'Phase 5 produces valid finite Draw, O2.5, and BTTS research outputs'
  );

  // 6. Full Chronological Walk-Forward Benchmark Test (80 matches)
  const fullSeason: Match[] = Array.from({ length: 80 }).map((_, i) => {
    const dt = new Date(Date.UTC(2025, 7, 1 + Math.floor(i / 2) * 3, (i % 2) * 3 + 14, 0, 0)).toISOString();
    const h = teamIds[i % 6];
    const a = teamIds[(i + 1 + (i % 4)) % 6];
    return makeMatch(`wk-${i}`, dt, h, a, (i * 7) % 4, (i * 5 + 1) % 3);
  });

  const { report } = await runChronologicalPhase5Benchmark({
    datasetId: 'synthetic-audit',
    datasetName: 'Synthetic Zero-Leakage Audit Season',
    matches: fullSeason,
    getMatchStats: async (m) => {
      const idx = fullSeason.findIndex((x) => x.id === m.id);
      const priors = fullSeason.slice(0, idx);
      const hPrior = priors.filter((p) => p.homeTeam.id === m.homeTeam.id || p.awayTeam.id === m.homeTeam.id).length;
      const aPrior = priors.filter((p) => p.homeTeam.id === m.awayTeam.id || p.awayTeam.id === m.awayTeam.id).length;
      const minP = Math.min(hPrior, aPrior);
      return makeStats(m, minP, minP >= 5 ? 1.48 : null, minP >= 5 ? 1.19 : null);
    },
    calculatePhase3: async (m, s) => makePhase3Pred(m, s),
  });

  check(
    report.leakageCheck.verified &&
      report.leakageCheck.futureDataViolations === 0 &&
      report.leakageCheck.sameTimestampViolations === 0 &&
      report.leakageCheck.targetXgViolations === 0,
    'Chronological Phase 5 benchmark finishes with verified 0 leakage violations'
  );
  check(
    report.models.phase3Frozen.oneXTwo.sampleSize > 0 &&
      report.models.phase5Experimental.oneXTwo.sampleSize === report.models.phase3Frozen.oneXTwo.sampleSize &&
      report.baselines.oneXTwoHomeBias.accuracyPct !== null &&
      report.baselines.over25MajorityClass.accuracyPct !== null &&
      report.baselines.bttsMajorityClass.accuracyPct !== null,
    'Benchmark reports paired Phase 3/4/5 metrics and all naive baselines with matching sample coverage'
  );

  // Test Draw / O2.5 / BTTS module isolation directly
  const p3DrawDirect = evaluatePhase5DrawModel({
    match: targetMatch,
    stats: targetStatsClean,
    dixonColesDrawProbPct: 26.2,
    lambdaHome: 1.45,
    lambdaAway: 1.25,
    priors: extractPhase5CausalPriors(targetMatch, cleanSeason),
    drawHistory: [],
  });
  check(
    p3DrawDirect.causalAdjustmentApplied === false && p3DrawDirect.calibrationStatus === 'NOT_TRAINED',
    'Draw module refuses logistic/calibration adaptation below sample thresholds'
  );

  const o25Direct = evaluatePhase5O25Model({
    match: targetMatch,
    stats: targetStatsClean,
    competitionMatches: cleanSeason,
    priors: extractPhase5CausalPriors(targetMatch, cleanSeason),
    o25History: [],
  });
  check(
    o25Direct.variantAPoissonPct !== null &&
      o25Direct.variantBNegBinPct !== null &&
      o25Direct.variantCShrunkPct !== null &&
      o25Direct.variantDCalibratedPct === null,
    'O2.5 module outputs Variants A/B/C and marks Variant D NOT_TRAINED (null) below 100 causal priors'
  );

  const bttsDirect = evaluatePhase5BttsModel({
    match: targetMatch,
    stats: targetStatsClean,
    competitionMatches: cleanSeason,
    priors: extractPhase5CausalPriors(targetMatch, cleanSeason),
    bttsHistory: [],
  });
  check(
    bttsDirect.variantAExistingPct !== null &&
      bttsDirect.variantBIndependentPct !== null &&
      bttsDirect.variantCNegBinPct !== null &&
      bttsDirect.variantDCalibratedPct === null,
    'BTTS module outputs Variants A/B/C independently of O2.5 and marks Variant D NOT_TRAINED below 100 causal priors'
  );

  console.log(`\n🎉 All ${passed} Phase 5 verification & leakage tests passed!`);
}

runPhase5Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
