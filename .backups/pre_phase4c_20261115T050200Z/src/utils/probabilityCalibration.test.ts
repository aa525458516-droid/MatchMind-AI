/**
 * Unit & Causality Tests for Causal Probability Calibration Layer
 */
import {
  calibrateMarketProbabilities,
  fitBinaryTemperature,
  fitOneXTwoTemperature,
  MIN_CALIBRATION_SAMPLES,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from './probabilityCalibration';
import { HistoryRecord, MarketProbabilities } from '../types/football';

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${label}`);
}

function makeRawMarkets(overrides: Partial<MarketProbabilities> = {}): MarketProbabilities {
  const over15 = overrides.over15 ?? 82.0;
  const over25 = overrides.over25 ?? 60.0;
  const bttsYes = overrides.bttsYes ?? 62.0;
  const homeWin = overrides.homeWin ?? 55.0;
  const draw = overrides.draw ?? 25.0;
  const awayWin = overrides.awayWin ?? 20.0;

  return {
    homeWin,
    draw,
    awayWin,
    homeOrDraw: Math.round((homeWin + draw) * 10) / 10,
    awayOrDraw: Math.round((awayWin + draw) * 10) / 10,
    homeOrAway: Math.round((homeWin + awayWin) * 10) / 10,
    over15,
    under15: Math.round((100 - over15) * 10) / 10,
    over25,
    under25: Math.round((100 - over25) * 10) / 10,
    over35: 35.0,
    under35: 65.0,
    bttsYes,
    bttsNo: Math.round((100 - bttsYes) * 10) / 10,
    firstHalfOver05: 70.0,
    firstHalfUnder05: 30.0,
    firstHalfOver15: 35.0,
    firstHalfUnder15: 65.0,
    firstHalfHomeWin: 38.0,
    firstHalfDraw: 42.0,
    firstHalfAwayWin: 20.0,
    ...overrides,
  };
}

function makeSyntheticHistoryRecord(
  idx: number,
  utcDate: string,
  rawMarkets: MarketProbabilities,
  actualGoals: [number, number]
): HistoryRecord {
  const [hg, ag] = actualGoals;
  const winner: 'HOME' | 'DRAW' | 'AWAY' = hg > ag ? 'HOME' : ag > hg ? 'AWAY' : 'DRAW';

  return {
    id: `test-hist-${idx}`,
    match: {
      id: `m-${idx}`,
      leagueId: 'test',
      leagueName: 'Test League',
      season: '2024',
      matchday: 1,
      homeTeam: {
        id: 'h',
        name: 'Home',
        shortName: 'HOM',
        code: 'HOM',
        crest: '',
        country: 'Test',
        stadium: null,
        leagueId: 'test',
        eloRating: 1500,
      },
      awayTeam: {
        id: 'a',
        name: 'Away',
        shortName: 'AWY',
        code: 'AWY',
        crest: '',
        country: 'Test',
        stadium: null,
        leagueId: 'test',
        eloRating: 1500,
      },
      utcDate,
      status: 'FINISHED',
      score: { home: hg, away: ag },
      venue: null,
      isDemoData: false,
      provenance: {
        source: 'Test',
        timestamp: utcDate,
        qualityIndicator: 'HIGH_FIDELITY',
        qualityScore: 80,
        sampleSizeMatches: 10,
      },
    },
    prediction: {
      matchId: `m-${idx}`,
      calculatedAt: utcDate,
      modelType: 'ENSEMBLE_VALIDATED',
      probabilities: rawMarkets,
      rawProbabilities: rawMarkets,
      expectedScore: { home: 1.5, away: 1.2, mostLikelyScore: '1 - 1', probability: 12 },
      topScorelines: [],
      modelEvaluations: [],
      confidence: 'HIGH',
      confidenceScore: 80,
      confidencePillars: {
        modelProbability: 80,
        historicalAccuracy: null,
        dataReliability: 80,
        modelAgreement: 80,
        decision: 'RECOMMENDED_ANALYSIS',
      },
      metricsExplanation: 'Test',
      isDemoData: false,
      provenance: {
        source: 'Test',
        timestamp: utcDate,
        qualityIndicator: 'HIGH_FIDELITY',
        qualityScore: 80,
        sampleSizeMatches: 10,
      },
    },
    actualResult: {
      finalScore: `${hg} - ${ag}`,
      homeGoals: hg,
      awayGoals: ag,
      winner,
      over15: hg + ag > 1.5,
      over25: hg + ag > 2.5,
      btts: hg > 0 && ag > 0,
    },
    modelAccuracyNotes: '',
    brierScoreContribution: 0.2,
  };
}

console.log('🧪 Running Causal Probability Calibration Unit Tests...');

// 1. Minimum sample threshold (< 100 -> untouched raw probabilities & NOT_TRAINED)
{
  const prior99: HistoryRecord[] = [];
  for (let i = 0; i < 99; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
    prior99.push(
      makeSyntheticHistoryRecord(i, `2024-${month}-${day}T15:00:00Z`, makeRawMarkets(), [1, 1])
    );
  }
  const rawTarget = makeRawMarkets({ over25: 77.3, over15: 88.4, homeWin: 61.2, draw: 21.8, awayWin: 17.0 });
  const res = calibrateMarketProbabilities(rawTarget, '2024-10-01T15:00:00Z', prior99);
  assert(
    res.status.applied === false &&
      res.status.status === 'NOT_TRAINED' &&
      res.status.sampleCount === 99 &&
      res.status.minRequired === MIN_CALIBRATION_SAMPLES,
    'Returns NOT_TRAINED when fewer than 100 prior evaluated records exist'
  );
  assert(
    JSON.stringify(res.probabilities) === JSON.stringify(rawTarget),
    'Returns exact raw probabilities untouched when sampleCount < 100'
  );
}

// 2. Strict causality check: target & future matches (>= T) MUST be ignored
{
  const records: HistoryRecord[] = [];
  // 110 strictly prior matches (< T = 2024-06-01T15:00:00Z)
  for (let i = 0; i < 110; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
    // Overconfident raw over25=85%, actual hit rate ~50% -> expects T > 1.0
    const hg = i % 2 === 0 ? 2 : 1;
    const ag = i % 2 === 0 ? 1 : 0;
    records.push(
      makeSyntheticHistoryRecord(
        i,
        `2024-${month}-${day}T15:00:00Z`,
        makeRawMarkets({ over25: 85.0, over15: 85.0, bttsYes: 80.0 }),
        [hg, ag]
      )
    );
  }

  const targetTime = '2024-06-01T15:00:00Z';
  const rawTarget = makeRawMarkets({ over25: 85.0, over15: 85.0, bttsYes: 80.0 });
  const baselineRes = calibrateMarketProbabilities(rawTarget, targetTime, records);

  // Now inject target match at EXACT same timestamp AND 500 extreme future matches (> T)
  const polluted = [...records];
  for (let j = 0; j < 500; j++) {
    polluted.push(
      makeSyntheticHistoryRecord(
        1000 + j,
        j === 0 ? targetTime : `2024-12-01T15:00:00Z`,
        makeRawMarkets({ over25: 90.0, over15: 90.0, bttsYes: 90.0 }),
        [5, 5] // 100% Over / BTTS in the future
      )
    );
  }

  const pollutedRes = calibrateMarketProbabilities(rawTarget, targetTime, polluted);
  assert(
    JSON.stringify(baselineRes) === JSON.stringify(pollutedRes),
    'ZERO LEAKAGE: simultaneous (=T) and future (>T) outcomes NEVER affect calibration for target T'
  );
  assert(
    pollutedRes.status.applied === true &&
      pollutedRes.status.status === 'CALIBRATED' &&
      pollutedRes.status.sampleCount === 110,
    'Causal filter strictly counts only the 110 prior (< T) matches'
  );
  assert(
    pollutedRes.probabilities.over25 < rawTarget.over25 &&
      (pollutedRes.status.temperatures?.over25 ?? 1) > 1.0 &&
      (pollutedRes.status.temperatures?.over25 ?? 1) <= TEMPERATURE_MAX,
    'Overconfident raw over25 (85% vs 50% hit) is softened downward with T > 1.0 within [0.7, 3.0]'
  );
}

// 3. Probability conservation & bounds checks
{
  const overConfSamples = Array.from({ length: 120 }, (_, i) => ({
    prob01: 0.85,
    actual: i % 2 === 0,
  }));
  const tBin = fitBinaryTemperature(overConfSamples);
  assert(tBin > 1.0 && tBin <= TEMPERATURE_MAX && tBin >= TEMPERATURE_MIN, 'fitBinaryTemperature returns softened bounded T');

  const multiSamples = Array.from({ length: 120 }, (_, i) => ({
    pH: 0.8,
    pD: 0.1,
    pA: 0.1,
    winner: (i % 3 === 0 ? 'HOME' : i % 3 === 1 ? 'DRAW' : 'AWAY') as 'HOME' | 'DRAW' | 'AWAY',
  }));
  const tMulti = fitOneXTwoTemperature(multiSamples);
  assert(tMulti > 1.0 && tMulti <= TEMPERATURE_MAX, 'fitOneXTwoTemperature increases temperature when 1X2 probabilities are overconfident');

  const syntheticRecords = overConfSamples.map((s, i) =>
    makeSyntheticHistoryRecord(
      i,
      `2024-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      makeRawMarkets({ homeWin: 80, draw: 10, awayWin: 10, over25: 85, over15: 88, bttsYes: 80 }),
      s.actual ? [2, 1] : [1, 0]
    )
  );
  const raw = makeRawMarkets({ homeWin: 80, draw: 10, awayWin: 10, over25: 85, over15: 88, bttsYes: 80 });
  const cal = calibrateMarketProbabilities(raw, '2025-01-01T00:00:00Z', syntheticRecords);
  const sum1x2 =
    Math.round((cal.probabilities.homeWin + cal.probabilities.draw + cal.probabilities.awayWin) * 10) / 10;
  assert(sum1x2 === 100, `Calibrated 1X2 sums strictly to 100.0% (got ${sum1x2})`);
  assert(
    Math.round((cal.probabilities.over15 + cal.probabilities.under15) * 10) / 10 === 100 &&
      Math.round((cal.probabilities.over25 + cal.probabilities.under25) * 10) / 10 === 100 &&
      Math.round((cal.probabilities.bttsYes + cal.probabilities.bttsNo) * 10) / 10 === 100,
    'Calibrated Over/Under & BTTS complementary markets strictly sum to 100.0%'
  );
}

console.log('\n🎉 All Causal Probability Calibration tests passed!\n');
