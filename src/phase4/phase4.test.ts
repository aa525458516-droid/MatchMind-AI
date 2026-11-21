/**
 * Phase 4 Comprehensive Experimental & Productization Verification Suite
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  HistoryRecord,
  Match,
  MatchStatistics,
  Prediction,
} from '../types/football';
import {
  MODEL_VERSION_PHASE3,
  MODEL_VERSION_PHASE4,
} from './phase4Types';
import { computeCausalLeaguePriorFromMatches, extractVariantBProjection } from './variantBExtractor';
import { negativeBinomialProb, evaluateGoalMarketExperiment } from './goalMarketExperiment';
import { evaluateDrawExperiment, MIN_DRAW_CAUSAL_SAMPLES } from './drawExperiment';
import {
  runSeededMonteCarlo,
  learnCausalEnsembleWeights,
  MIN_ENSEMBLE_CAUSAL_SAMPLES,
} from './ensembleExperiment';
import { assessMarketAbstentions } from './marketAbstainEngine';
import { buildTransparentExplanation } from './explanationEngine';
import { evaluatePhase4Match, runChronologicalPhase4Comparison } from './phase4Pipeline';
import {
  clearVersionedHistory,
  loadVersionedHistory,
  recordVersionedPrediction,
} from './phase4HistoryStore';
import {
  clearAllFavorites,
  loadFavorites,
  toggleFavoriteLeague,
  toggleFavoriteMatch,
  toggleFavoriteTeam,
} from '../utils/favoritesStore';
import { calculatePoissonProbabilities } from '../utils/poissonModel';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Phase 4 Assertion Failed: ${message}`);
  }
}

function makeTeamStats(teamId: string, name: string, played: number, goalsFor: number, goalsAg: number, elo: number | null) {
  const formMatches = Array.from({ length: Math.min(played, 10) }).map((_, i) => ({
    matchId: `hist-${teamId}-${i}`,
    date: `2025-07-${String(i + 1).padStart(2, '0')}T15:00:00Z`,
    opponent: `Opponent-${i}`,
    opponentCode: `OP${i}`,
    opponentElo: 1550,
    isHome: i % 2 === 0,
    goalsFor: Math.round(goalsFor / Math.max(1, played)),
    goalsAgainst: Math.round(goalsAg / Math.max(1, played)),
    xG: null,
    xGA: null,
    result: 'W' as const,
    score: '2 - 1',
    restDays: 5,
  }));

  return {
    teamId,
    teamName: name,
    eloRating: elo,
    opponentStrengthIndex: elo,
    recentForm: formMatches.map((f) => f.result),
    formMatches,
    overall: {
      matchesPlayed: played,
      wins: Math.round(played * 0.5),
      draws: Math.round(played * 0.25),
      losses: Math.max(0, played - Math.round(played * 0.75)),
      goalsScored: goalsFor,
      goalsConceded: goalsAg,
      avgGoalsScored: played > 0 ? Math.round((goalsFor / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 0 ? Math.round((goalsAg / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.3),
      failedToScore: Math.floor(played * 0.2),
    },
    homeOrAwaySplit: {
      matchesPlayed: Math.floor(played / 2),
      wins: Math.floor(played / 4),
      draws: Math.floor(played / 8),
      losses: Math.floor(played / 8),
      goalsScored: Math.floor(goalsFor / 2),
      goalsConceded: Math.floor(goalsAg / 2),
      avgGoalsScored: played > 1 ? Math.round((goalsFor / played) * 100) / 100 : 0,
      avgGoalsConceded: played > 1 ? Math.round((goalsAg / played) * 100) / 100 : 0,
      avgXG: null,
      avgXGA: null,
      cleanSheets: Math.floor(played * 0.15),
      failedToScore: Math.floor(played * 0.1),
    },
    injuriesCount: null,
    confirmedLineupAvailable: false,
    keyPlayersMissing: [],
    restDays: null,
    fixtureCongestionIndex: null,
    provenance: {
      source: 'StatsBomb Test Fixture',
      timestamp: '2025-11-01T12:00:00Z',
      cached: false,
      qualityIndicator: 'HIGH_FIDELITY' as const,
      qualityScore: 80,
      sampleSizeMatches: played,
      sourceType: 'RESEARCH_OPEN_DATA' as const,
    },
    isDemoData: false,
  };
}

function makeMatch(id: string, utcDate: string, homeG: number | null = 2, awayG: number | null = 1): Match {
  return {
    id,
    leagueId: 'test-league',
    leagueName: 'Test League',
    season: '2025/26',
    matchday: 12,
    utcDate,
    status: homeG !== null ? 'FINISHED' : 'SCHEDULED',
    venue: 'Test Stadium',
    homeTeam: {
      id: 'T1',
      name: 'Alpha FC',
      shortName: 'Alpha',
      code: 'ALP',
      crest: '',
      country: 'England',
      founded: 1900,
      stadium: 'Alpha Park',
      leagueId: 'test-league',
      eloRating: 1620,
    },
    awayTeam: {
      id: 'T2',
      name: 'Beta United',
      shortName: 'Beta',
      code: 'BET',
      crest: '',
      country: 'England',
      founded: 1905,
      stadium: 'Beta Bowl',
      leagueId: 'test-league',
      eloRating: 1580,
    },
    score: { home: homeG, away: awayG },
    provenance: {
      source: 'StatsBomb Test Fixture',
      timestamp: '2025-11-01T12:00:00Z',
      cached: false,
      qualityIndicator: 'HIGH_FIDELITY',
      qualityScore: 80,
      sampleSizeMatches: 12,
      sourceType: 'RESEARCH_OPEN_DATA',
    },
    isDemoData: false,
    matchCategory: 'HISTORICAL',
  };
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
  (globalThis as unknown as { window?: { localStorage: typeof mockStorage } }).window = {
    localStorage: mockStorage,
  };
}

export async function runPhase4Tests() {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    assert(cond, msg);
    passed++;
  };

  console.log('🧪 Starting Phase 4 Verification Test Suite...');
  installLocalStorageMock();

  // 1. Negative Binomial PMF normalization check
  let nbSum = 0;
  for (let k = 0; k <= 20; k++) {
    nbSum += negativeBinomialProb(k, 1.45, 16);
  }
  check(Math.abs(nbSum - 1.0) < 0.001, `NegBin PMF sums to ~1.0 (got ${nbSum.toFixed(6)})`);

  // 2. Goal market evaluation complements & uncertainty
  const gmRes = evaluateGoalMarketExperiment(1.55, 1.15, 14, 14);
  check(
    Math.abs(gmRes.markets.over15 + gmRes.markets.under15 - 100) < 0.2,
    'Over/Under 1.5 sums to 100%'
  );
  check(
    Math.abs(gmRes.markets.over25 + gmRes.markets.under25 - 100) < 0.2,
    'Over/Under 2.5 sums to 100%'
  );
  check(
    Math.abs(gmRes.markets.bttsYes + gmRes.markets.bttsNo - 100) < 0.2,
    'BTTS Yes/No sums to 100%'
  );
  check(
    gmRes.uncertainties.over25 > 0 && gmRes.uncertainties.over25 < 0.2,
    'Goal market epistemic uncertainty is finite and bounded'
  );

  // 3. Draw Experiment: No hardcoded draw boost when causal priors < 80, strictly ignores future (>= T)
  const targetUtc = '2025-11-10T15:00:00Z';
  const futureDraws: HistoryRecord[] = Array.from({ length: 95 }).map((_, idx) => ({
    id: `fut-${idx}`,
    match: makeMatch(`fm-${idx}`, '2025-12-01T15:00:00Z', 1, 1),
    prediction: {
      matchId: `fm-${idx}`,
      calculatedAt: '2025-11-30T10:00:00Z',
      modelType: 'ENSEMBLE_VALIDATED',
      probabilities: calculatePoissonProbabilities(1.2, 1.1).markets,
      rawProbabilities: calculatePoissonProbabilities(1.2, 1.1).markets,
      modelEvaluations: [],
      expectedScore: { home: 1.2, away: 1.1, mostLikelyScore: '1 - 1', probability: 13 },
      confidence: 'MEDIUM',
      confidenceScore: 68,
      confidencePillars: {
        modelProbability: 40,
        historicalAccuracy: null,
        dataReliability: 80,
        modelAgreement: 75,
        decision: 'RECOMMENDED_ANALYSIS',
      },
      topScorelines: [],
      metricsExplanation: 'Test prediction metrics explanation',
      preMatchXGAvailable: false,
      historicalValidationAvailable: false,
      sampleSizeMatches: 12,
      provenance: makeMatch(`fm-${idx}`, '2025-12-01T15:00:00Z').provenance,
      isDemoData: false,
    },
    actualResult: {
      finalScore: '1 - 1',
      homeGoals: 1,
      awayGoals: 1,
      winner: 'DRAW',
      over15: true,
      over25: false,
      btts: true,
    },
    modelAccuracyNotes: '',
    brierScoreContribution: 0.4,
  }));

  const drawNoFuture = evaluateDrawExperiment(27.4, 1.25, 1.1, 1600, 1590, targetUtc, futureDraws);
  check(
    !drawNoFuture.causalAdjustmentApplied && drawNoFuture.causalSamplesUsed === 0,
    'Draw experiment must strictly ignore all future (>= T) records'
  );
  check(
    Math.abs((drawNoFuture.drawProb ?? 0) - 27.4) < 0.05,
    'Zero hardcoded draw boost: raw draw probability preserved when causal priors < 80'
  );
  check(MIN_DRAW_CAUSAL_SAMPLES === 80, 'Draw experiment requires >= 80 causal samples before adapting');

  // 4. Deterministic seeded Monte Carlo & Causal Ensemble Hedge weights
  const mcA = runSeededMonteCarlo('match-xyz', 1.45, 1.2, 1500);
  const mcB = runSeededMonteCarlo('match-xyz', 1.45, 1.2, 1500);
  check(
    mcA.homeWinProb === mcB.homeWinProb && mcA.drawProb === mcB.drawProb,
    'Seeded Monte Carlo must be deterministic for same match + lambdas'
  );
  const weightsUnderMin = learnCausalEnsembleWeights(targetUtc, true, futureDraws);
  check(
    weightsUnderMin.isUniformFallback && weightsUnderMin.learnedFromSamples === 0,
    `Ensemble falls back to UNIFORM_PRIOR below ${MIN_ENSEMBLE_CAUSAL_SAMPLES} causal samples`
  );

  // 5. Phase 3 Abstain Preservation + Market-Specific ABSTAIN checks
  const testMatch = makeMatch('m-test-1', targetUtc, null, null);
  const baseStats: MatchStatistics = {
    matchId: testMatch.id,
    homeTeamStats: makeTeamStats('T1', 'Alpha', 14, 24, 14, 1620),
    awayTeamStats: makeTeamStats('T2', 'Beta', 14, 19, 18, 1580),
    headToHead: [],
    headToHeadSummary: { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, totalGoals: 0, avgGoals: null },
    homeExpectedGoals: 1.55,
    awayExpectedGoals: 1.15,
    totalExpectedGoals: 2.7,
    hasSufficientData: true,
    provenance: testMatch.provenance,
    isDemoData: false,
  };
  const abstainP3: Prediction = {
    matchId: testMatch.id,
    calculatedAt: targetUtc,
    modelType: 'ABSTAIN',
    probabilities: null,
    modelEvaluations: [],
    expectedScore: null,
    confidence: null,
    confidenceScore: null,
    confidencePillars: {
      modelProbability: null,
      historicalAccuracy: null,
      dataReliability: 35,
      modelAgreement: null,
      decision: 'ABSTAIN_DATA_DEFICIT',
      abstainReason: 'Insufficient sample (<5)',
    },
    topScorelines: [],
    metricsExplanation: 'Insufficient sample (<5)',
    abstainReason: 'Insufficient sample (<5)',
    preMatchXGAvailable: false,
    historicalValidationAvailable: false,
    sampleSizeMatches: 3,
    provenance: testMatch.provenance,
    isDemoData: false,
  };

  const p4Abstain = evaluatePhase4Match(testMatch, { ...baseStats, hasSufficientData: false }, {
    phase3Prediction: abstainP3,
  });
  check(
    p4Abstain.abstainScope === 'MATCH_ABSTAIN' &&
      p4Abstain.goalMarkets.oneXTwo.status === 'MATCH_ABSTAIN' &&
      p4Abstain.goalMarkets.over25.status === 'MATCH_ABSTAIN' &&
      p4Abstain.ensemble.probabilities === null,
    'Phase 4 strictly preserves Phase 3 MATCH_ABSTAIN contract'
  );

  // 6. Per-market abstention check without blocking healthy markets
  const validP3: Prediction = {
    ...abstainP3,
    modelType: 'ENSEMBLE_VALIDATED',
    probabilities: calculatePoissonProbabilities(1.55, 1.15).markets,
    expectedScore: { home: 1.55, away: 1.15, mostLikelyScore: '1 - 1', probability: 13 },
    confidence: 'HIGH',
    confidenceScore: 76,
    confidencePillars: {
      modelProbability: 62,
      historicalAccuracy: null,
      dataReliability: 78,
      modelAgreement: 82,
      decision: 'RECOMMENDED_ANALYSIS',
    },
    metricsExplanation: 'Valid ensemble prediction',
    abstainReason: undefined,
    sampleSizeMatches: 6,
  };
  const marketAssess = assessMarketAbstentions({
    phase3Prediction: validP3,
    rawMarkets: validP3.probabilities,
    calibratedMarkets: validP3.probabilities,
    negBinResult: gmRes,
    calibrationStatus: 'NOT_TRAINED',
    sampleSize: 6,
    homePlayed: 6,
    awayPlayed: 6,
    hasElo: false,
    agreementScore: 82,
  });
  check(
    marketAssess.oneXTwo.status === 'MARKET_ABSTAIN' &&
      marketAssess.doubleChance.status === 'AVAILABLE',
    'Missing Elo with small sample abstains 1X2 specifically while Double Chance remains AVAILABLE'
  );

  // 7. Explanation Engine non-fabrication test
  const explanation = buildTransparentExplanation({
    match: testMatch,
    stats: baseStats,
    phase3Prediction: validP3,
    variantBHome: 1.5,
    variantBAway: 1.15,
    drawExperiment: drawNoFuture,
    marketAssessment: marketAssess,
    calibrationStatus: 'NOT_TRAINED',
    calibrationSampleCount: 0,
  });
  const lineupFactor = explanation.factors.find((f) => f.key === 'lineups_injuries');
  const xgFactor = explanation.factors.find((f) => f.key === 'prematch_xg');
  const h2hFactor = explanation.factors.find((f) => f.key === 'h2h');
  check(
    lineupFactor?.value === 'Not available' &&
      xgFactor?.value === 'Not available' &&
      h2hFactor?.value === 'Not available',
    'Explanation engine explicitly outputs "Not available" for untracked lineups, xG, and empty H2H'
  );

  // 8. Model Versioned History Store isolation (Phase 4 NEVER overwrites Phase 3)
  clearVersionedHistory();
  recordVersionedPrediction(testMatch, validP3, MODEL_VERSION_PHASE3);
  const p4Live = evaluatePhase4Match(testMatch, baseStats, {
    phase3Prediction: validP3,
    competitionMatches: Array.from({ length: 14 }).map((_, k) =>
      makeMatch(`c-${k}`, `2025-10-${String(k + 1).padStart(2, '0')}T15:00:00Z`, 2, 1)
    ),
  });
  recordVersionedPrediction(testMatch, p4Live, MODEL_VERSION_PHASE4);
  const archived = loadVersionedHistory();
  check(
    archived.length === 2 &&
      archived.some((a) => a.modelVersion === MODEL_VERSION_PHASE3 && a.matchId === testMatch.id) &&
      archived.some((a) => a.modelVersion === MODEL_VERSION_PHASE4 && a.matchId === testMatch.id),
    'Versioned history keeps Phase 3 and Phase 4 records separately without overwriting Phase 3'
  );

  // 9. Favorites Store test
  clearAllFavorites();
  toggleFavoriteTeam('T1');
  toggleFavoriteLeague('test-league');
  toggleFavoriteMatch('m-test-1');
  const fav = loadFavorites();
  check(
    fav.teamIds.includes('T1') && fav.leagueIds.includes('test-league') && fav.matchIds.includes('m-test-1'),
    'Favorites store toggles and persists team, league, and match favorites'
  );
  toggleFavoriteTeam('T1');
  check(!loadFavorites().teamIds.includes('T1'), 'Favorites toggle cleanly removes an existing item');

  // 10. Causal Chronological Comparison pipeline & zero-leakage test across 40 fixtures
  const chronoMatches: Match[] = Array.from({ length: 40 }).map((_, idx) => {
    const dt = new Date(Date.UTC(2025, 7, 1 + idx * 3, 15, 0, 0)).toISOString();
    const hG = (idx % 3);
    const aG = ((idx + 1) % 3);
    const m = makeMatch(`chrono-${idx}`, dt, hG, aG);
    m.homeTeam.id = idx % 2 === 0 ? 'T1' : 'T2';
    m.awayTeam.id = idx % 2 === 0 ? 'T2' : 'T1';
    return m;
  });

  // Verify extractVariantBProjection strictly excludes target date
  const priorRes = computeCausalLeaguePriorFromMatches(chronoMatches, chronoMatches[20].id, chronoMatches[20].utcDate);
  check(priorRes !== null && priorRes.priorLeagueCount === 20, 'Causal league prior counts strictly < target kickoff');
  const vbProj = extractVariantBProjection(chronoMatches[20], baseStats, chronoMatches);
  check(vbProj.lambdas !== null && !vbProj.usedFallbackLeagueBaseline, 'Variant B extractor uses real causal league prior');

  const benchmark = await runChronologicalPhase4Comparison({
    datasetName: 'Synthetic Zero-Leakage Chronological Audit',
    leagueId: 'test-league',
    dataSource: 'Unit Test Suite',
    matches: chronoMatches,
    getMatchStats: async (m) => ({
      ...baseStats,
      matchId: m.id,
      hasSufficientData: chronoMatches.indexOf(m) >= 8,
      homeTeamStats: makeTeamStats(m.homeTeam.id, m.homeTeam.name, chronoMatches.indexOf(m), chronoMatches.indexOf(m) * 1.4, chronoMatches.indexOf(m) * 1.1, 1600),
      awayTeamStats: makeTeamStats(m.awayTeam.id, m.awayTeam.name, chronoMatches.indexOf(m), chronoMatches.indexOf(m) * 1.2, chronoMatches.indexOf(m) * 1.3, 1580),
    }),
    calculatePhase3: async (m, s) => {
      if (!s.hasSufficientData) return abstainP3;
      return {
        ...validP3,
        matchId: m.id,
        sampleSizeMatches: s.homeTeamStats.overall.matchesPlayed,
      };
    },
  });

  check(
    benchmark.leakageChecks.verified &&
      benchmark.leakageChecks.futureDataViolations === 0 &&
      benchmark.phase4.evaluatedMatches === 32 &&
      benchmark.phase4.abstainedMatches === 8 &&
      benchmark.phase4.oneXTwo.sampleSize > 0,
    'Chronological Phase 3 vs Phase 4 benchmark completes with 0 leakage violations and explicit sample sizes'
  );

  // 11. PWA-only configuration checks (Android/Capacitor cleanly removed)
  const rootDir = process.cwd();
  const requiredIcons = [
    'public/icon.svg',
    'public/pwa-192x192.png',
    'public/pwa-512x512.png',
    'public/pwa-maskable-512x512.png',
    'public/apple-touch-icon.png',
  ];
  for (const rel of requiredIcons) {
    const abs = path.join(rootDir, rel);
    check(fs.existsSync(abs) && fs.statSync(abs).size > 200, `PWA asset exists and non-empty: ${rel}`);
  }
  const viteText = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  check(
    viteText.includes('VitePWA') &&
      viteText.includes("registerType: 'autoUpdate'") &&
      viteText.includes("display: 'standalone'") &&
      viteText.includes("purpose: 'any'") &&
      viteText.includes("purpose: 'maskable'") &&
      viteText.includes('NetworkOnly') &&
      (viteText.includes('/api/') || viteText.includes('\\/api\\/')),
    'vite.config.ts defines standalone autoUpdate PWA manifest, separate any/maskable icons, and NetworkOnly /api guard'
  );
  const indexHtmlText = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  check(
    indexHtmlText.includes('apple-touch-icon') &&
      indexHtmlText.includes('mobile-web-app-capable') &&
      indexHtmlText.includes('apple-mobile-web-app-capable') &&
      indexHtmlText.includes('viewport-fit=cover'),
    'index.html includes iOS/Android PWA installability meta tags and apple-touch-icon'
  );
  const pkgText = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
  check(
    !fs.existsSync(path.join(rootDir, 'capacitor.config.ts')) &&
      !fs.existsSync(path.join(rootDir, 'android')) &&
      !pkgText.includes('@capacitor') &&
      !pkgText.includes('"cap:'),
    'Capacitor and native Android packaging are cleanly removed from workspace and package.json'
  );

  console.log(`✅ All ${passed} Phase 4 checks passed!`);
}

runPhase4Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
