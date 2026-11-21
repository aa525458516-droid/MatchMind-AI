/**
 * MatchMind AI — Strict Blind External Validation Runner
 *
 * VALIDATION ONLY — ZERO parameter tuning, ZERO model modifications, ZERO holdout contamination.
 * Evaluates the frozen Phase 5 / Phase 5.1 candidate configuration across completely unseen
 * full-season competitions from StatsBomb Open Data (CC BY 4.0) and OpenLigaDB Free Public API.
 */

import { StatsBombProvider } from '../services/providers/statsBombProvider';
import { OpenLigaDbProvider } from '../services/providers/openLigaDbProvider';
import { HistoryRecord, Match, MatchStatistics, Prediction } from '../types/football';
import { evaluatePhase5Match } from '../phase5/phase5Pipeline';
import { BinaryCalibSample, MultiClassCalibSample } from '../phase5/phase5Calibration';
import { Phase5DrawHistoryEntry } from '../phase5/phase5DrawModel';
import { evaluatePhase5_1Match } from '../phase5_1/phase5_1Pipeline';
import {
  computeSixBinReliability,
  normalizeSimplex,
  summarizeThresholdRegion,
} from '../phase5_1/phase5_1Calibration';
import { FIXED_DRAW_THRESHOLD, Phase5_1DrawHistoryRecord } from '../phase5_1/phase5_1DrawModel';
import { Phase5_1CalibSample1X2, Phase5_1Status } from '../phase5_1/phase5_1Types';

// ---------------------------------------------------------------------------
// Strict Holdout & Prior-Research Exclusion Guard
// ---------------------------------------------------------------------------

export const PROTECTED_BLIND_HOLDOUT_IDS = new Set([
  'statsbomb-9-27', // Bundesliga 2015/2016
  'statsbomb-12-27', // Serie A 2015/2016
  'statsbomb-7-27', // Ligue 1 2015/2016
  'statsbomb-9-281', // Bundesliga 2023/2024
  'openliga-bl1-2015', // Duplicate season of statsbomb-9-27
  'openliga-bl1-2023', // Duplicate season of statsbomb-9-281
]);

export const PRIOR_DEV_DATASET_IDS = new Set([
  'statsbomb-2-27', // Premier League 2015/2016 (post-hoc diagnostic)
  'statsbomb-11-27', // La Liga 2015/2016 (Phase 5/5.1 dev)
  'statsbomb-1238-108', // Indian Super League 2021/2022 (Phase 5/5.1 dev)
]);

interface ExternalDatasetSpec {
  id: string;
  provider: 'statsbomb' | 'openliga';
  leagueId: string;
  season?: string;
  label: string;
  tier: string;
}

const EXTERNAL_DATASETS: ExternalDatasetSpec[] = [
  // StatsBomb Open Data — 5 unseen full-season leagues
  {
    id: 'statsbomb-182-281',
    provider: 'statsbomb',
    leagueId: 'statsbomb-182-281',
    label: 'Liga F (Spain Women 2023/2024)',
    tier: 'Women Tier 1',
  },
  {
    id: 'statsbomb-49-107',
    provider: 'statsbomb',
    leagueId: 'statsbomb-49-107',
    label: 'NWSL (USA Women 2023)',
    tier: 'Women Tier 1',
  },
  {
    id: 'statsbomb-37-281',
    provider: 'statsbomb',
    leagueId: 'statsbomb-37-281',
    label: "FA Women's Super League (England 2023/2024)",
    tier: 'Women Tier 1',
  },
  {
    id: 'statsbomb-135-281',
    provider: 'statsbomb',
    leagueId: 'statsbomb-135-281',
    label: 'Frauen Bundesliga (Germany Women 2023/2024)',
    tier: 'Women Tier 1',
  },
  {
    id: 'statsbomb-131-281',
    provider: 'statsbomb',
    leagueId: 'statsbomb-131-281',
    label: 'Serie A Women (Italy Women 2023/2024)',
    tier: 'Women Tier 1',
  },
  // OpenLigaDB Free Public API — 5 unseen full-season German leagues (2022–2025, excluding bl1-2023/bl1-2015)
  {
    id: 'openliga-bl1-2024',
    provider: 'openliga',
    leagueId: 'openliga-bl1',
    season: '2024',
    label: '1. Fußball-Bundesliga (2024/2025)',
    tier: 'Men Tier 1',
  },
  {
    id: 'openliga-bl1-2022',
    provider: 'openliga',
    leagueId: 'openliga-bl1',
    season: '2022',
    label: '1. Fußball-Bundesliga (2022/2023)',
    tier: 'Men Tier 1',
  },
  {
    id: 'openliga-bl2-2024',
    provider: 'openliga',
    leagueId: 'openliga-bl2',
    season: '2024',
    label: '2. Fußball-Bundesliga (2024/2025)',
    tier: 'Men Tier 2',
  },
  {
    id: 'openliga-bl2-2023',
    provider: 'openliga',
    leagueId: 'openliga-bl2',
    season: '2023',
    label: '2. Fußball-Bundesliga (2023/2024)',
    tier: 'Men Tier 2',
  },
  {
    id: 'openliga-bl3-2023',
    provider: 'openliga',
    leagueId: 'openliga-bl3',
    season: '2023',
    label: '3. Liga (2023/2024)',
    tier: 'Men Tier 3',
  },
];

// ---------------------------------------------------------------------------
// Raw Paired Observation Types (for Exact Per-Comp & Pooled Aggregation)
// ---------------------------------------------------------------------------

interface OneXTwoObs {
  pH01: number | null;
  pD01: number | null;
  pA01: number | null;
  winner: 'HOME' | 'DRAW' | 'AWAY';
  status: Phase5_1Status;
}

interface DrawObs {
  prob01: number | null;
  triggered: boolean;
  actual: boolean;
  status: Phase5_1Status;
  thresholdUsed01: number | null;
}

interface BinaryObs {
  prob01: number | null;
  actual: boolean;
  status: Phase5_1Status;
}

interface GoalsObs {
  p3H: number | null;
  p3A: number | null;
  p5H: number | null;
  p5A: number | null;
  priorH: number | null;
  priorA: number | null;
  actH: number;
  actA: number;
}

interface AbstentionCounts {
  totalFixtures: number;
  p3GlobalAbstain: number;
  p3AbstainLt5Team: number;
  p3AbstainLt10League: number;
  p3AbstainQualityOrUncertainty: number;
  p51OneXTwoExtraAbstain: number;
  p51DrawExtraAbstain: number;
  p51DrawVariantDNotTrained: number;
  p51DrawCausalThresholdNotTrained: number;
  p5O25ExtraAbstain: number;
  p5BttsExtraAbstain: number;
}

interface LeakageCounters {
  futureDataViolations: number;
  targetMatchViolations: number;
  sameTimestampViolations: number;
  targetXgViolations: number;
  targetEventsViolations: number;
  seasonEndRatingViolations: number;
  futureCalibrationViolations: number;
  futureThresholdViolations: number;
}

interface CompetitionBuffers {
  spec: ExternalDatasetSpec;
  dateRange: string;
  totalFixtures: number;
  teamCount: number;
  leakage: LeakageCounters;
  abstention: AbstentionCounts;

  // 1X2 observations
  onexTwo_p51B: OneXTwoObs[];
  onexTwo_p51D: OneXTwoObs[];
  onexTwo_p51D_selective: OneXTwoObs[];
  onexTwo_p3: OneXTwoObs[];
  onexTwo_p5A: OneXTwoObs[];
  onexTwo_p5Raw: OneXTwoObs[];
  onexTwo_empLeague: OneXTwoObs[];
  onexTwo_majority: OneXTwoObs[];
  onexTwo_homeBias: OneXTwoObs[];

  // Draw observations
  draw_varD_strict: DrawObs[];
  draw_sel_causalThresh: DrawObs[];
  draw_sel_fixed285: DrawObs[];
  draw_sel_argmax: DrawObs[];
  draw_sel_marketGate: DrawObs[];
  draw_p5_fixed285: DrawObs[];
  draw_p5_argmax: DrawObs[];
  draw_p3_fixed285: DrawObs[];
  draw_p3_argmax: DrawObs[];
  draw_empRate_fixed285: DrawObs[];
  draw_majority_noDraw: DrawObs[];

  // O2.5 observations
  o25_p5_all: BinaryObs[];
  o25_p5_raw: BinaryObs[];
  o25_p5_selective: BinaryObs[];
  o25_p3: BinaryObs[];
  o25_empLeague: BinaryObs[];
  o25_majority: BinaryObs[];

  // BTTS observations
  btts_p5_all: BinaryObs[];
  btts_p5_raw: BinaryObs[];
  btts_p5_selective: BinaryObs[];
  btts_p3: BinaryObs[];
  btts_empLeague: BinaryObs[];
  btts_majority: BinaryObs[];

  // Goals regression observations (evaluated on P3 non-abstained cohort for fair pairing)
  goals: GoalsObs[];
}

// ---------------------------------------------------------------------------
// Metric Computation Helpers
// ---------------------------------------------------------------------------

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function wilson95(hits: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.959964;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [r1(Math.max(0, center - half) * 100), r1(Math.min(1, center + half) * 100)];
}

function summarize1X2(items: OneXTwoObs[]) {
  const predicted = items.filter(
    (i) => i.status === 'PREDICT' && i.pH01 !== null && i.pD01 !== null && i.pA01 !== null
  );
  const n = predicted.length;
  const total = items.length;
  const coveragePct = total > 0 ? r1((n / total) * 100) : 0;

  if (n === 0) {
    return {
      n: 0,
      total,
      abstained: items.filter((i) => i.status === 'ABSTAIN').length,
      notTrained: items.filter((i) => i.status === 'NOT_TRAINED').length,
      coveragePct,
      accPct: null as number | null,
      accCi95: null as [number, number] | null,
      brier: null as number | null,
      logLoss: null as number | null,
      ecePct: null as number | null,
      tailEcePct: null as number | null,
      sixBinOutcome: computeSixBinReliability([]),
      sixBinTopConf: computeSixBinReliability([]),
      tailCum: {
        ge60: summarizeThresholdRegion([], '>=60%', 60),
        ge70: summarizeThresholdRegion([], '>=70%', 70),
        ge80: summarizeThresholdRegion([], '>=80%', 80),
        ge90: summarizeThresholdRegion([], '>=90%', 90),
      },
      predRates: { H: null as number | null, D: null as number | null, A: null as number | null },
      actRates: { H: null as number | null, D: null as number | null, A: null as number | null },
    };
  }

  let hits = 0;
  let sumBrier = 0;
  let sumLoss = 0;
  let sumPH = 0;
  let sumPD = 0;
  let sumPA = 0;
  let actH = 0;
  let actD = 0;
  let actA = 0;

  const outcomeEntries: Array<{ prob01: number; hit: boolean }> = [];
  const topEntries: Array<{ prob01: number; hit: boolean }> = [];

  for (const item of predicted) {
    const [pH, pD, pA] = normalizeSimplex(item.pH01!, item.pD01!, item.pA01!);
    sumPH += pH;
    sumPD += pD;
    sumPA += pA;
    const yH = item.winner === 'HOME';
    const yD = item.winner === 'DRAW';
    const yA = item.winner === 'AWAY';
    if (yH) actH++;
    else if (yD) actD++;
    else actA++;

    const predClass = pH >= pD && pH >= pA ? 'HOME' : pA >= pD && pA >= pH ? 'AWAY' : 'DRAW';
    const isHit = predClass === item.winner;
    if (isHit) hits++;

    sumBrier += (pH - (yH ? 1 : 0)) ** 2 + (pD - (yD ? 1 : 0)) ** 2 + (pA - (yA ? 1 : 0)) ** 2;
    const hitP = yH ? pH : yD ? pD : pA;
    sumLoss += -Math.log(Math.max(1e-6, hitP));

    outcomeEntries.push({ prob01: pH, hit: yH });
    outcomeEntries.push({ prob01: pD, hit: yD });
    outcomeEntries.push({ prob01: pA, hit: yA });
    topEntries.push({ prob01: Math.max(pH, pD, pA), hit: isHit });
  }

  const sixBinOutcome = computeSixBinReliability(outcomeEntries);
  let ece = 0;
  for (const b of sixBinOutcome) {
    if (b.count > 0 && b.calibrationErrorPct !== null) {
      ece += (b.count / outcomeEntries.length) * b.calibrationErrorPct;
    }
  }

  const sixBinTopConf = computeSixBinReliability(topEntries);
  const tailBins = [sixBinTopConf[3], sixBinTopConf[4], sixBinTopConf[5]];
  const tailCount = tailBins.reduce((s, b) => s + b.count, 0);
  let tailEcePct: number | null = null;
  if (tailCount > 0) {
    let te = 0;
    for (const b of tailBins) {
      if (b.count > 0 && b.calibrationErrorPct !== null) {
        te += (b.count / tailCount) * b.calibrationErrorPct;
      }
    }
    tailEcePct = r1(te);
  }

  return {
    n,
    total,
    abstained: items.filter((i) => i.status === 'ABSTAIN').length,
    notTrained: items.filter((i) => i.status === 'NOT_TRAINED').length,
    coveragePct,
    accPct: r1((hits / n) * 100),
    accCi95: wilson95(hits, n),
    brier: r3(sumBrier / n),
    logLoss: r3(sumLoss / n),
    ecePct: r1(ece),
    tailEcePct,
    sixBinOutcome,
    sixBinTopConf,
    tailCum: {
      ge60: summarizeThresholdRegion(topEntries, '>=60%', 60),
      ge70: summarizeThresholdRegion(topEntries, '>=70%', 70),
      ge80: summarizeThresholdRegion(topEntries, '>=80%', 80),
      ge90: summarizeThresholdRegion(topEntries, '>=90%', 90),
    },
    predRates: { H: r1((sumPH / n) * 100), D: r1((sumPD / n) * 100), A: r1((sumPA / n) * 100) },
    actRates: { H: r1((actH / n) * 100), D: r1((actD / n) * 100), A: r1((actA / n) * 100) },
  };
}

function summarizeDraw(items: DrawObs[]) {
  const predicted = items.filter((i) => i.status === 'PREDICT' && i.prob01 !== null);
  const n = predicted.length;
  const total = items.length;
  const abstained = items.filter((i) => i.status === 'ABSTAIN').length;
  const notTrained = items.filter((i) => i.status === 'NOT_TRAINED').length;
  const coveragePct = total > 0 ? r1((n / total) * 100) : 0;

  if (n === 0) {
    return {
      n: 0,
      total,
      abstained,
      notTrained,
      coveragePct,
      callRatePct: null as number | null,
      actualDrawPct: null as number | null,
      predMeanPct: null as number | null,
      precisionPct: null as number | null,
      recallPct: null as number | null,
      f1Pct: null as number | null,
      accPct: null as number | null,
      brier: null as number | null,
      logLoss: null as number | null,
      ecePct: null as number | null,
      meanThreshPct: null as number | null,
    };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let hits = 0;
  let calls = 0;
  let actDraws = 0;
  let sumP = 0;
  let sumBrier = 0;
  let sumLoss = 0;
  let sumT = 0;
  let tN = 0;

  const binDefs = [
    { min: 0, max: 0.2 },
    { min: 0.2, max: 0.25 },
    { min: 0.25, max: 0.3 },
    { min: 0.3, max: 0.4 },
    { min: 0.4, max: 1.0001 },
  ];
  const bins = binDefs.map((b) => ({ ...b, count: 0, sumP: 0, sumY: 0 }));

  for (const item of predicted) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, item.prob01!));
    const y = item.actual ? 1 : 0;
    if (item.triggered) calls++;
    if (item.triggered && item.actual) tp++;
    else if (item.triggered && !item.actual) fp++;
    else if (!item.triggered && item.actual) fn++;
    if (item.triggered === item.actual) hits++;
    actDraws += y;
    sumP += p;
    sumBrier += (p - y) * (p - y);
    sumLoss += item.actual ? -Math.log(p) : -Math.log(1 - p);
    if (item.thresholdUsed01 !== null) {
      sumT += item.thresholdUsed01;
      tN++;
    }
    for (const b of bins) {
      if (p >= b.min && p < b.max) {
        b.count++;
        b.sumP += p;
        b.sumY += y;
        break;
      }
    }
  }

  let ece = 0;
  for (const b of bins) {
    if (b.count > 0) {
      ece += (b.count / n) * Math.abs(b.sumP / b.count - b.sumY / b.count);
    }
  }

  const prec = tp + fp > 0 ? tp / (tp + fp) : null;
  const rec = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = prec !== null && rec !== null && prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : null;

  return {
    n,
    total,
    abstained,
    notTrained,
    coveragePct,
    callRatePct: r1((calls / n) * 100),
    actualDrawPct: r1((actDraws / n) * 100),
    predMeanPct: r1((sumP / n) * 100),
    precisionPct: prec !== null ? r1(prec * 100) : null,
    recallPct: rec !== null ? r1(rec * 100) : null,
    f1Pct: f1 !== null ? r1(f1 * 100) : null,
    accPct: r1((hits / n) * 100),
    brier: r3(sumBrier / n),
    logLoss: r3(sumLoss / n),
    ecePct: r1(ece * 100),
    meanThreshPct: tN > 0 ? r1((sumT / tN) * 100) : null,
  };
}

function summarizeBinary(items: BinaryObs[]) {
  const predicted = items.filter((i) => i.status === 'PREDICT' && i.prob01 !== null);
  const n = predicted.length;
  const total = items.length;
  const abstained = items.filter((i) => i.status === 'ABSTAIN').length;
  const notTrained = items.filter((i) => i.status === 'NOT_TRAINED').length;
  const coveragePct = total > 0 ? r1((n / total) * 100) : 0;

  if (n === 0) {
    return {
      n: 0,
      total,
      abstained,
      notTrained,
      coveragePct,
      actualPosPct: null as number | null,
      predMeanPct: null as number | null,
      accPct: null as number | null,
      accCi95: null as [number, number] | null,
      precisionPct: null as number | null,
      recallPct: null as number | null,
      f1Pct: null as number | null,
      brier: null as number | null,
      logLoss: null as number | null,
      ecePct: null as number | null,
    };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let hits = 0;
  let pos = 0;
  let sumP = 0;
  let sumBrier = 0;
  let sumLoss = 0;

  const binDefs = [
    { min: 0, max: 0.2 },
    { min: 0.2, max: 0.4 },
    { min: 0.4, max: 0.6 },
    { min: 0.6, max: 0.8 },
    { min: 0.8, max: 1.0001 },
  ];
  const bins = binDefs.map((b) => ({ ...b, count: 0, sumP: 0, sumY: 0 }));

  for (const item of predicted) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, item.prob01!));
    const y = item.actual ? 1 : 0;
    const call = p >= 0.5;
    if (call && item.actual) tp++;
    else if (call && !item.actual) fp++;
    else if (!call && item.actual) fn++;
    if (call === item.actual) hits++;
    pos += y;
    sumP += p;
    sumBrier += (p - y) * (p - y);
    sumLoss += item.actual ? -Math.log(p) : -Math.log(1 - p);

    for (const b of bins) {
      if (p >= b.min && p < b.max) {
        b.count++;
        b.sumP += p;
        b.sumY += y;
        break;
      }
    }
  }

  let ece = 0;
  for (const b of bins) {
    if (b.count > 0) {
      ece += (b.count / n) * Math.abs(b.sumP / b.count - b.sumY / b.count);
    }
  }

  const prec = tp + fp > 0 ? tp / (tp + fp) : null;
  const rec = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = prec !== null && rec !== null && prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : null;

  return {
    n,
    total,
    abstained,
    notTrained,
    coveragePct,
    actualPosPct: r1((pos / n) * 100),
    predMeanPct: r1((sumP / n) * 100),
    accPct: r1((hits / n) * 100),
    accCi95: wilson95(hits, n),
    precisionPct: prec !== null ? r1(prec * 100) : null,
    recallPct: rec !== null ? r1(rec * 100) : null,
    f1Pct: f1 !== null ? r1(f1 * 100) : null,
    brier: r3(sumBrier / n),
    logLoss: r3(sumLoss / n),
    ecePct: r1(ece * 100),
  };
}

function summarizeGoalsSet(rows: GoalsObs[]) {
  const calc = (pairs: Array<{ pred: number | null; act: number }>) => {
    const valid = pairs.filter((r) => r.pred !== null && Number.isFinite(r.pred));
    if (valid.length === 0) {
      return { n: 0, mae: null as number | null, rmse: null as number | null, bias: null as number | null };
    }
    let ae = 0;
    let se = 0;
    let sumErr = 0;
    for (const r of valid) {
      const e = r.pred! - r.act;
      ae += Math.abs(e);
      se += e * e;
      sumErr += e;
    }
    return {
      n: valid.length,
      mae: r3(ae / valid.length),
      rmse: r3(Math.sqrt(se / valid.length)),
      bias: r3(sumErr / valid.length),
    };
  };

  return {
    phase5: {
      home: calc(rows.map((r) => ({ pred: r.p5H, act: r.actH }))),
      away: calc(rows.map((r) => ({ pred: r.p5A, act: r.actA }))),
      total: calc(
        rows.map((r) => ({
          pred: r.p5H !== null && r.p5A !== null ? r.p5H + r.p5A : null,
          act: r.actH + r.actA,
        }))
      ),
    },
    phase3: {
      home: calc(rows.map((r) => ({ pred: r.p3H, act: r.actH }))),
      away: calc(rows.map((r) => ({ pred: r.p3A, act: r.actA }))),
      total: calc(
        rows.map((r) => ({
          pred: r.p3H !== null && r.p3A !== null ? r.p3H + r.p3A : null,
          act: r.actH + r.actA,
        }))
      ),
    },
    leaguePrior: {
      home: calc(rows.map((r) => ({ pred: r.priorH, act: r.actH }))),
      away: calc(rows.map((r) => ({ pred: r.priorA, act: r.actA }))),
      total: calc(
        rows.map((r) => ({
          pred: r.priorH !== null && r.priorA !== null ? r.priorH + r.priorA : null,
          act: r.actH + r.actA,
        }))
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Walk-Forward Runner for One Competition (0 Leakage Guaranteed)
// ---------------------------------------------------------------------------

async function evaluateExternalDataset(
  spec: ExternalDatasetSpec,
  sbProvider: StatsBombProvider,
  olProvider: OpenLigaDbProvider
): Promise<CompetitionBuffers> {
  if (PROTECTED_BLIND_HOLDOUT_IDS.has(spec.id) || PROTECTED_BLIND_HOLDOUT_IDS.has(spec.leagueId)) {
    throw new Error(`HOLDOUT VIOLATION BLOCKED: Refusing to touch protected blind holdout ${spec.id}`);
  }
  if (PRIOR_DEV_DATASET_IDS.has(spec.id) || PRIOR_DEV_DATASET_IDS.has(spec.leagueId)) {
    throw new Error(`DEV CONTAMINATION BLOCKED: Refusing prior dev dataset ${spec.id}`);
  }

  let rawMatches: Match[];
  if (spec.provider === 'statsbomb') {
    rawMatches = await sbProvider.getMatches({ leagueId: spec.leagueId });
  } else {
    rawMatches = await olProvider.getMatches({ leagueId: spec.leagueId, season: spec.season });
  }

  // Physically strip provider-attached full-season Elo ratings so NO post-match Elo exists in memory
  const sanitizedMatches: Match[] = rawMatches
    .filter((m) => m.score.home !== null && m.score.away !== null)
    .map((m) => ({
      ...m,
      homeTeam: { ...m.homeTeam, eloRating: null },
      awayTeam: { ...m.awayTeam, eloRating: null },
    }))
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const teamIds = new Set<string>();
  for (const m of sanitizedMatches) {
    teamIds.add(m.homeTeam.id);
    teamIds.add(m.awayTeam.id);
  }
  const dates = sanitizedMatches.map((m) => m.utcDate.split('T')[0]).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A';

  const buf: CompetitionBuffers = {
    spec,
    dateRange,
    totalFixtures: sanitizedMatches.length,
    teamCount: teamIds.size,
    leakage: {
      futureDataViolations: 0,
      targetMatchViolations: 0,
      sameTimestampViolations: 0,
      targetXgViolations: 0,
      targetEventsViolations: 0,
      seasonEndRatingViolations: 0,
      futureCalibrationViolations: 0,
      futureThresholdViolations: 0,
    },
    abstention: {
      totalFixtures: sanitizedMatches.length,
      p3GlobalAbstain: 0,
      p3AbstainLt5Team: 0,
      p3AbstainLt10League: 0,
      p3AbstainQualityOrUncertainty: 0,
      p51OneXTwoExtraAbstain: 0,
      p51DrawExtraAbstain: 0,
      p51DrawVariantDNotTrained: 0,
      p51DrawCausalThresholdNotTrained: 0,
      p5O25ExtraAbstain: 0,
      p5BttsExtraAbstain: 0,
    },
    onexTwo_p51B: [],
    onexTwo_p51D: [],
    onexTwo_p51D_selective: [],
    onexTwo_p3: [],
    onexTwo_p5A: [],
    onexTwo_p5Raw: [],
    onexTwo_empLeague: [],
    onexTwo_majority: [],
    onexTwo_homeBias: [],
    draw_varD_strict: [],
    draw_sel_causalThresh: [],
    draw_sel_fixed285: [],
    draw_sel_argmax: [],
    draw_sel_marketGate: [],
    draw_p5_fixed285: [],
    draw_p5_argmax: [],
    draw_p3_fixed285: [],
    draw_p3_argmax: [],
    draw_empRate_fixed285: [],
    draw_majority_noDraw: [],
    o25_p5_all: [],
    o25_p5_raw: [],
    o25_p5_selective: [],
    o25_p3: [],
    o25_empLeague: [],
    o25_majority: [],
    btts_p5_all: [],
    btts_p5_raw: [],
    btts_p5_selective: [],
    btts_p3: [],
    btts_empLeague: [],
    btts_majority: [],
    goals: [],
  };

  // Strictly causal < T buffers
  const p3History: HistoryRecord[] = [];
  const p5OneXTwoHistory: MultiClassCalibSample[] = [];
  const p5DrawHistory: Phase5DrawHistoryEntry[] = [];
  const p5O25History: BinaryCalibSample[] = [];
  const p5BttsHistory: BinaryCalibSample[] = [];

  const p51OneXTwoHistory: Phase5_1CalibSample1X2[] = [];
  const p51DrawHistory: Phase5_1DrawHistoryRecord[] = [];
  const p51ThresholdPriors: Array<{ timestampMs: number; prob01: number; isDraw: boolean }> = [];

  let priorCount = 0;
  let priorH = 0;
  let priorD = 0;
  let priorA = 0;
  let priorO25 = 0;
  let priorBtts = 0;
  let priorHomeGoals = 0;
  let priorAwayGoals = 0;

  let idx = 0;
  while (idx < sanitizedMatches.length) {
    const batchTs = new Date(sanitizedMatches[idx].utcDate).getTime();
    let endIdx = idx + 1;
    while (
      endIdx < sanitizedMatches.length &&
      new Date(sanitizedMatches[endIdx].utcDate).getTime() === batchTs
    ) {
      endIdx++;
    }
    const batch = sanitizedMatches.slice(idx, endIdx);
    const batchUpdates: Array<() => void> = [];

    for (const m of batch) {
      const mMs = new Date(m.utcDate).getTime();
      const hg = m.score.home!;
      const ag = m.score.away!;
      const actWinner: 'HOME' | 'DRAW' | 'AWAY' = hg > ag ? 'HOME' : ag > hg ? 'AWAY' : 'DRAW';
      const actDraw = actWinner === 'DRAW';
      const actO25 = hg + ag > 2;
      const actBtts = hg > 0 && ag > 0;

      // Leakage Audit Checks before prediction
      for (const s of p51OneXTwoHistory) {
        if (s.timestampMs > mMs) {
          buf.leakage.futureDataViolations++;
          buf.leakage.futureCalibrationViolations++;
        } else if (s.timestampMs === mMs) {
          buf.leakage.sameTimestampViolations++;
        }
      }
      for (const t of p51ThresholdPriors) {
        if (t.timestampMs > mMs) buf.leakage.futureThresholdViolations++;
        else if (t.timestampMs === mMs) buf.leakage.sameTimestampViolations++;
      }
      for (const h of p3History) {
        if (h.match.id === m.id) buf.leakage.targetMatchViolations++;
        const hMs = new Date(h.match.utcDate).getTime();
        if (hMs > mMs) buf.leakage.futureDataViolations++;
        else if (hMs === mMs) buf.leakage.sameTimestampViolations++;
      }
      if (m.homeTeam.eloRating !== null || m.awayTeam.eloRating !== null) {
        buf.leakage.seasonEndRatingViolations++;
      }

      const stats: MatchStatistics =
        spec.provider === 'statsbomb'
          ? await sbProvider.getMatchStatistics(m, { skipObservedXG: true })
          : await olProvider.getMatchStatistics(m);

      if (stats.observedMatchXG != null) {
        buf.leakage.targetXgViolations++;
      }
      if (
        stats.homeTeamStats.confirmedLineupAvailable === true ||
        stats.homeTeamStats.formMatches.some((f) => new Date(f.date).getTime() >= mMs) ||
        stats.awayTeamStats.formMatches.some((f) => new Date(f.date).getTime() >= mMs)
      ) {
        buf.leakage.targetEventsViolations++;
      }

      const p3: Prediction =
        spec.provider === 'statsbomb'
          ? await sbProvider.calculatePrediction(m, stats, {
              includeMonteCarlo: false,
              calibrationHistory: p3History,
            })
          : await olProvider.calculatePrediction(m, stats, {
              includeMonteCarlo: false,
              calibrationHistory: p3History,
            });

      const p5 = evaluatePhase5Match(m, stats, {
        phase3Prediction: p3,
        competitionMatches: sanitizedMatches,
        historyContext: {
          oneXTwoSamples: p5OneXTwoHistory,
          drawSamples: p5DrawHistory,
          o25Samples: p5O25History,
          bttsSamples: p5BttsHistory,
        },
      });

      const p51 = evaluatePhase5_1Match(m, stats, {
        phase3Prediction: p3,
        competitionMatches: sanitizedMatches,
        context: {
          oneXTwoSamples: p51OneXTwoHistory,
          drawHistory: p51DrawHistory,
          drawThresholdPriors: p51ThresholdPriors,
        },
      });

      if (
        p51.causalPriors.homeTeamPriors.played < 5 &&
        p51.causalPriors.homeEloCausal !== null
      ) {
        buf.leakage.seasonEndRatingViolations++;
      }

      const p3Abstain = p3.modelType === 'ABSTAIN' || p3.probabilities === null;
      const minTeamPlayed = Math.min(
        stats.homeTeamStats.overall.matchesPlayed,
        stats.awayTeamStats.overall.matchesPlayed
      );
      if (p3Abstain) {
        buf.abstention.p3GlobalAbstain++;
        if (minTeamPlayed < 5) {
          buf.abstention.p3AbstainLt5Team++;
        } else if (p51.causalPriors.priorLeagueMatches < 10) {
          buf.abstention.p3AbstainLt10League++;
        } else {
          buf.abstention.p3AbstainQualityOrUncertainty++;
        }
      }

      // ---- 1X2 ----
      const vB = p51.oneXTwoVariants.B_TEMPERATURE;
      const vD = p51.oneXTwoVariants.D_TAIL_SHRINKAGE;
      const vA = p51.oneXTwoVariants.A_EXISTING_PHASE5;
      const dec1x2 = p51.marketDecisions['1X2'];
      if (!p3Abstain && dec1x2.status !== 'PREDICT') {
        buf.abstention.p51OneXTwoExtraAbstain++;
      }

      buf.onexTwo_p51B.push({
        pH01: p3Abstain || vB.homeWin === null ? null : vB.homeWin / 100,
        pD01: p3Abstain || vB.draw === null ? null : vB.draw / 100,
        pA01: p3Abstain || vB.awayWin === null ? null : vB.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.onexTwo_p51D.push({
        pH01: p3Abstain || vD.homeWin === null ? null : vD.homeWin / 100,
        pD01: p3Abstain || vD.draw === null ? null : vD.draw / 100,
        pA01: p3Abstain || vD.awayWin === null ? null : vD.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.onexTwo_p51D_selective.push({
        pH01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.homeWin / 100 : null,
        pD01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.draw / 100 : null,
        pA01: dec1x2.status === 'PREDICT' && dec1x2.probs1X2 ? dec1x2.probs1X2.awayWin / 100 : null,
        winner: actWinner,
        status: dec1x2.status,
      });
      buf.onexTwo_p3.push({
        pH01: p3Abstain ? null : p3.probabilities!.homeWin / 100,
        pD01: p3Abstain ? null : p3.probabilities!.draw / 100,
        pA01: p3Abstain ? null : p3.probabilities!.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.onexTwo_p5A.push({
        pH01: p3Abstain || vA.homeWin === null ? null : vA.homeWin / 100,
        pD01: p3Abstain || vA.draw === null ? null : vA.draw / 100,
        pA01: p3Abstain || vA.awayWin === null ? null : vA.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.onexTwo_p5Raw.push({
        pH01: p3Abstain || p51.oneXTwoRaw.homeWin === null ? null : p51.oneXTwoRaw.homeWin / 100,
        pD01: p3Abstain || p51.oneXTwoRaw.draw === null ? null : p51.oneXTwoRaw.draw / 100,
        pA01: p3Abstain || p51.oneXTwoRaw.awayWin === null ? null : p51.oneXTwoRaw.awayWin / 100,
        winner: actWinner,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });

      if (!p3Abstain) {
        const den = priorCount + 3;
        const empH = (priorH + 1) / den;
        const empD = (priorD + 1) / den;
        const empA = (priorA + 1) / den;
        buf.onexTwo_empLeague.push({ pH01: empH, pD01: empD, pA01: empA, winner: actWinner, status: 'PREDICT' });

        // Majority-class causal baseline
        const maj =
          priorH >= priorD && priorH >= priorA ? 'HOME' : priorA >= priorD && priorA >= priorH ? 'AWAY' : 'DRAW';
        buf.onexTwo_majority.push({
          pH01: maj === 'HOME' ? 0.96 : 0.02,
          pD01: maj === 'DRAW' ? 0.96 : 0.02,
          pA01: maj === 'AWAY' ? 0.96 : 0.02,
          winner: actWinner,
          status: 'PREDICT',
        });
        buf.onexTwo_homeBias.push({ pH01: 0.96, pD01: 0.02, pA01: 0.02, winner: actWinner, status: 'PREDICT' });
      } else {
        buf.onexTwo_empLeague.push({ pH01: null, pD01: null, pA01: null, winner: actWinner, status: 'ABSTAIN' });
        buf.onexTwo_majority.push({ pH01: null, pD01: null, pA01: null, winner: actWinner, status: 'ABSTAIN' });
        buf.onexTwo_homeBias.push({ pH01: null, pD01: null, pA01: null, winner: actWinner, status: 'ABSTAIN' });
      }

      // ---- DRAW ----
      const dvD = p51.drawVariants.D_CAUSAL_ENSEMBLE;
      const selDrawP = p51.drawSelected.probPct !== null ? p51.drawSelected.probPct / 100 : null;
      const thA = p51.drawSelected.thresholds.ARGMAX;
      const thF = p51.drawSelected.thresholds.FIXED_THRESHOLD;
      const thC = p51.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD;
      const drawDec = p51.marketDecisions.DRAW;

      if (!p3Abstain && dvD.status === 'NOT_TRAINED') buf.abstention.p51DrawVariantDNotTrained++;
      if (!p3Abstain && thC.status === 'NOT_TRAINED') buf.abstention.p51DrawCausalThresholdNotTrained++;
      if (!p3Abstain && drawDec.status === 'ABSTAIN') buf.abstention.p51DrawExtraAbstain++;

      buf.draw_varD_strict.push({
        prob01: p3Abstain ? null : dvD.finalProb01,
        triggered:
          !p3Abstain && dvD.status === 'PREDICT' && dvD.finalProb01 !== null && dvD.finalProb01 >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : dvD.status,
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
      });
      buf.draw_sel_causalThresh.push({
        prob01: p3Abstain || thC.status !== 'PREDICT' ? null : selDrawP,
        triggered: !p3Abstain && thC.status === 'PREDICT' && thC.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thC.status,
        thresholdUsed01: thC.threshold01,
      });
      buf.draw_sel_fixed285.push({
        prob01: p3Abstain ? null : selDrawP,
        triggered: !p3Abstain && thF.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thF.status,
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
      });
      buf.draw_sel_argmax.push({
        prob01: p3Abstain ? null : selDrawP,
        triggered: !p3Abstain && thA.triggered,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : thA.status,
        thresholdUsed01: null,
      });
      buf.draw_sel_marketGate.push({
        prob01: drawDec.status === 'PREDICT' && drawDec.finalProbabilityPct !== null ? drawDec.finalProbabilityPct / 100 : null,
        triggered:
          drawDec.status === 'PREDICT' &&
          drawDec.finalProbabilityPct !== null &&
          drawDec.finalProbabilityPct / 100 >= (thC.threshold01 ?? FIXED_DRAW_THRESHOLD),
        actual: actDraw,
        status: drawDec.status,
        thresholdUsed01: thC.threshold01 ?? FIXED_DRAW_THRESHOLD,
      });

      const p5DrawP = p3Abstain ? null : (p5.drawResearch.finalDrawProbPct ?? 26) / 100;
      buf.draw_p5_fixed285.push({
        prob01: p5DrawP,
        triggered: p5DrawP !== null && p5DrawP >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
      });
      buf.draw_p5_argmax.push({
        prob01: p5DrawP,
        triggered:
          !p3Abstain &&
          p5.oneXTwo.draw! > p5.oneXTwo.homeWin! &&
          p5.oneXTwo.draw! > p5.oneXTwo.awayWin!,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: null,
      });

      const p3DrawP = p3Abstain ? null : p3.probabilities!.draw / 100;
      buf.draw_p3_fixed285.push({
        prob01: p3DrawP,
        triggered: p3DrawP !== null && p3DrawP >= FIXED_DRAW_THRESHOLD,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: FIXED_DRAW_THRESHOLD,
      });
      buf.draw_p3_argmax.push({
        prob01: p3DrawP,
        triggered:
          !p3Abstain &&
          p3.probabilities!.draw > p3.probabilities!.homeWin &&
          p3.probabilities!.draw > p3.probabilities!.awayWin,
        actual: actDraw,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
        thresholdUsed01: null,
      });

      if (!p3Abstain) {
        const empD = (priorD + 0.52) / (priorCount + 2);
        buf.draw_empRate_fixed285.push({
          prob01: empD,
          triggered: empD >= FIXED_DRAW_THRESHOLD,
          actual: actDraw,
          status: 'PREDICT',
          thresholdUsed01: FIXED_DRAW_THRESHOLD,
        });
        buf.draw_majority_noDraw.push({
          prob01: 0.02,
          triggered: false,
          actual: actDraw,
          status: 'PREDICT',
          thresholdUsed01: FIXED_DRAW_THRESHOLD,
        });
      } else {
        buf.draw_empRate_fixed285.push({ prob01: null, triggered: false, actual: actDraw, status: 'ABSTAIN', thresholdUsed01: null });
        buf.draw_majority_noDraw.push({ prob01: null, triggered: false, actual: actDraw, status: 'ABSTAIN', thresholdUsed01: null });
      }

      // ---- O2.5 ----
      const p5O25Dec = p5.marketDecisions.OVER25;
      if (!p3Abstain && p5O25Dec.status !== 'PREDICT') buf.abstention.p5O25ExtraAbstain++;

      buf.o25_p5_all.push({
        prob01: p3Abstain || p5.o25Research.selectedFinalPct === null ? null : p5.o25Research.selectedFinalPct / 100,
        actual: actO25,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.o25_p5_raw.push({
        prob01: p3Abstain || p5.o25Research.selectedRawPct === null ? null : p5.o25Research.selectedRawPct / 100,
        actual: actO25,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.o25_p5_selective.push({
        prob01:
          p5O25Dec.status === 'PREDICT' && p5O25Dec.finalProbabilityPct !== null
            ? p5O25Dec.finalProbabilityPct / 100
            : null,
        actual: actO25,
        status: p5O25Dec.status,
      });
      buf.o25_p3.push({
        prob01: p3Abstain ? null : p3.probabilities!.over25 / 100,
        actual: actO25,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      if (!p3Abstain) {
        const empO25 = (priorO25 + 1) / (priorCount + 2);
        const majO25 = empO25 >= 0.5 ? 0.95 : 0.05;
        buf.o25_empLeague.push({ prob01: empO25, actual: actO25, status: 'PREDICT' });
        buf.o25_majority.push({ prob01: majO25, actual: actO25, status: 'PREDICT' });
      } else {
        buf.o25_empLeague.push({ prob01: null, actual: actO25, status: 'ABSTAIN' });
        buf.o25_majority.push({ prob01: null, actual: actO25, status: 'ABSTAIN' });
      }

      // ---- BTTS ----
      const p5BttsDec = p5.marketDecisions.BTTS;
      if (!p3Abstain && p5BttsDec.status !== 'PREDICT') buf.abstention.p5BttsExtraAbstain++;

      buf.btts_p5_all.push({
        prob01: p3Abstain || p5.bttsResearch.selectedFinalPct === null ? null : p5.bttsResearch.selectedFinalPct / 100,
        actual: actBtts,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.btts_p5_raw.push({
        prob01: p3Abstain || p5.bttsResearch.selectedRawPct === null ? null : p5.bttsResearch.selectedRawPct / 100,
        actual: actBtts,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      buf.btts_p5_selective.push({
        prob01:
          p5BttsDec.status === 'PREDICT' && p5BttsDec.finalProbabilityPct !== null
            ? p5BttsDec.finalProbabilityPct / 100
            : null,
        actual: actBtts,
        status: p5BttsDec.status,
      });
      buf.btts_p3.push({
        prob01: p3Abstain ? null : p3.probabilities!.bttsYes / 100,
        actual: actBtts,
        status: p3Abstain ? 'ABSTAIN' : 'PREDICT',
      });
      if (!p3Abstain) {
        const empBtts = (priorBtts + 1) / (priorCount + 2);
        const majBtts = empBtts >= 0.5 ? 0.95 : 0.05;
        buf.btts_empLeague.push({ prob01: empBtts, actual: actBtts, status: 'PREDICT' });
        buf.btts_majority.push({ prob01: majBtts, actual: actBtts, status: 'PREDICT' });
      } else {
        buf.btts_empLeague.push({ prob01: null, actual: actBtts, status: 'ABSTAIN' });
        buf.btts_majority.push({ prob01: null, actual: actBtts, status: 'ABSTAIN' });
      }

      // ---- GOALS ----
      if (!p3Abstain) {
        const meanH = priorCount > 0 ? priorHomeGoals / priorCount : 1.4;
        const meanA = priorCount > 0 ? priorAwayGoals / priorCount : 1.1;
        buf.goals.push({
          p3H: p5.expectedGoals.phase3Home,
          p3A: p5.expectedGoals.phase3Away,
          p5H: p5.expectedGoals.shrunkHome,
          p5A: p5.expectedGoals.shrunkAway,
          priorH: meanH,
          priorA: meanA,
          actH: hg,
          actA: ag,
        });
      }

      // Queue post-kickoff causal updates ONLY after all batch fixtures have been evaluated
      batchUpdates.push(() => {
        priorCount++;
        priorHomeGoals += hg;
        priorAwayGoals += ag;
        if (actWinner === 'HOME') priorH++;
        else if (actWinner === 'DRAW') priorD++;
        else priorA++;
        if (actO25) priorO25++;
        if (actBtts) priorBtts++;

        const rec: HistoryRecord = {
          id: `ext-${m.id}`,
          match: m,
          prediction: p3,
          actualResult: {
            finalScore: `${hg} - ${ag}`,
            homeGoals: hg,
            awayGoals: ag,
            winner: actWinner,
            over15: hg + ag > 1.5,
            over25: actO25,
            btts: actBtts,
          },
          modelAccuracyNotes: '',
          brierScoreContribution: null,
        };
        p3History.push(rec);

        if (!p3Abstain) {
          p5OneXTwoHistory.push({
            timestampMs: mMs,
            pH: p5.oneXTwo.rawHomeWin! / 100,
            pD: p5.oneXTwo.rawDraw! / 100,
            pA: p5.oneXTwo.rawAwayWin! / 100,
            winner: actWinner,
          });
          p5DrawHistory.push({
            timestampMs: mMs,
            rawDixonColesDraw01: (p5.drawResearch.rawDixonColesDrawProbPct ?? 26) / 100,
            shrunkDraw01: (p5.drawResearch.shrunkDrawProbPct ?? 26) / 100,
            parityScore: p5.drawResearch.parityScore ?? 0.65,
            lowScoringIndex: p5.drawResearch.lowScoringIndex ?? 0.72,
            leagueDrawPrior01: (p5.drawResearch.empiricalLeagueDrawPriorPct ?? 26) / 100,
            isDraw: actDraw,
          });
          if (p5.o25Research.selectedRawPct !== null) {
            p5O25History.push({
              timestampMs: mMs,
              rawProb01: p5.o25Research.selectedRawPct / 100,
              actual: actO25,
            });
          }
          if (p5.bttsResearch.selectedRawPct !== null) {
            p5BttsHistory.push({
              timestampMs: mMs,
              rawProb01: p5.bttsResearch.selectedRawPct / 100,
              actual: actBtts,
            });
          }

          if (
            p51.oneXTwoRaw.homeWin !== null &&
            p51.oneXTwoRaw.draw !== null &&
            p51.oneXTwoRaw.awayWin !== null
          ) {
            p51OneXTwoHistory.push({
              timestampMs: mMs,
              pH: p51.oneXTwoRaw.homeWin / 100,
              pD: p51.oneXTwoRaw.draw / 100,
              pA: p51.oneXTwoRaw.awayWin / 100,
              winner: actWinner,
            });
          }

          p51DrawHistory.push({
            timestampMs: mMs,
            features: p51.drawSignals,
            probA01: p51.drawVariants.A_PHASE5.finalProb01,
            probB01: p51.drawVariants.B_POISSON_PRIOR.finalProb01,
            probC01: p51.drawVariants.C_STRENGTH_SYMMETRY.finalProb01,
            probEnsemble01: p51.drawVariants.D_CAUSAL_ENSEMBLE.rawProb01,
            phase5HistoryEntry: {
              timestampMs: mMs,
              rawDixonColesDraw01: (p5.drawResearch.rawDixonColesDrawProbPct ?? 26) / 100,
              shrunkDraw01: (p5.drawResearch.shrunkDrawProbPct ?? 26) / 100,
              parityScore: p5.drawResearch.parityScore ?? 0.65,
              lowScoringIndex: p5.drawResearch.lowScoringIndex ?? 0.72,
              leagueDrawPrior01: (p5.drawResearch.empiricalLeagueDrawPriorPct ?? 26) / 100,
              isDraw: actDraw,
            },
            isDraw: actDraw,
          });

          if (p51.drawSelected.probPct !== null) {
            p51ThresholdPriors.push({
              timestampMs: mMs,
              prob01: p51.drawSelected.probPct / 100,
              isDraw: actDraw,
            });
          }
        }
      });
    }

    for (const u of batchUpdates) u();
    idx = endIdx;
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Cross-Competition Summary Helper
// ---------------------------------------------------------------------------

function crossCompStats(values: Array<number | null>) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length === 0) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, x) => a + (x - mean) ** 2, 0) / valid.length;
  const sorted = [...valid].sort((a, b) => a - b);
  return {
    k: valid.length,
    mean: r3(mean),
    sd: r3(Math.sqrt(variance)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function formatCompetitionReport(b: CompetitionBuffers) {
  return {
    id: b.spec.id,
    label: b.spec.label,
    provider: b.spec.provider,
    tier: b.spec.tier,
    dateRange: b.dateRange,
    totalFixtures: b.totalFixtures,
    teamCount: b.teamCount,
    leakage: {
      ...b.leakage,
      allZero: Object.values(b.leakage).every((v) => v === 0),
    },
    abstention: b.abstention,
    oneXTwo: {
      p51_B_temp: summarize1X2(b.onexTwo_p51B),
      p51_D_tail: summarize1X2(b.onexTwo_p51D),
      p51_D_selective: summarize1X2(b.onexTwo_p51D_selective),
      p3_frozen: summarize1X2(b.onexTwo_p3),
      p5_A: summarize1X2(b.onexTwo_p5A),
      p5_raw: summarize1X2(b.onexTwo_p5Raw),
      empLeague: summarize1X2(b.onexTwo_empLeague),
      majority: summarize1X2(b.onexTwo_majority),
      homeBias: summarize1X2(b.onexTwo_homeBias),
    },
    draw: {
      varD_strict_fixed285: summarizeDraw(b.draw_varD_strict),
      sel_causalThresh: summarizeDraw(b.draw_sel_causalThresh),
      sel_fixed285: summarizeDraw(b.draw_sel_fixed285),
      sel_argmax: summarizeDraw(b.draw_sel_argmax),
      sel_marketGate: summarizeDraw(b.draw_sel_marketGate),
      p5_fixed285: summarizeDraw(b.draw_p5_fixed285),
      p5_argmax: summarizeDraw(b.draw_p5_argmax),
      p3_fixed285: summarizeDraw(b.draw_p3_fixed285),
      p3_argmax: summarizeDraw(b.draw_p3_argmax),
      empRate_fixed285: summarizeDraw(b.draw_empRate_fixed285),
      majority_noDraw: summarizeDraw(b.draw_majority_noDraw),
    },
    o25: {
      p5_all: summarizeBinary(b.o25_p5_all),
      p5_raw: summarizeBinary(b.o25_p5_raw),
      p5_selective: summarizeBinary(b.o25_p5_selective),
      p3_frozen: summarizeBinary(b.o25_p3),
      empLeague: summarizeBinary(b.o25_empLeague),
      majority: summarizeBinary(b.o25_majority),
    },
    btts: {
      p5_all: summarizeBinary(b.btts_p5_all),
      p5_raw: summarizeBinary(b.btts_p5_raw),
      p5_selective: summarizeBinary(b.btts_p5_selective),
      p3_frozen: summarizeBinary(b.btts_p3),
      empLeague: summarizeBinary(b.btts_empLeague),
      majority: summarizeBinary(b.btts_majority),
    },
    goals: summarizeGoalsSet(b.goals),
  };
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

async function main() {
  const sbProvider = new StatsBombProvider(
    'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
  );
  const olProvider = new OpenLigaDbProvider('https://api.openligadb.de');

  const compBuffers: CompetitionBuffers[] = [];

  for (const spec of EXTERNAL_DATASETS) {
    console.error(`[ExternalValidation] Running ${spec.id} — ${spec.label}...`);
    const buf = await evaluateExternalDataset(spec, sbProvider, olProvider);
    compBuffers.push(buf);
    const sB = summarize1X2(buf.onexTwo_p51B);
    const sD = summarize1X2(buf.onexTwo_p51D);
    const sP3 = summarize1X2(buf.onexTwo_p3);
    const lOk = Object.values(buf.leakage).every((v) => v === 0);
    console.error(
      `  Done ${spec.id}: N=${buf.totalFixtures}, Cov=${sD.coveragePct}%, ` +
        `1X2 Acc P3=${sP3.accPct}% / B=${sB.accPct}% / D=${sD.accPct}%, ` +
        `LL P3=${sP3.logLoss} / B=${sB.logLoss} / D=${sD.logLoss}, ` +
        `LeakageOK=${lOk}`
    );
  }

  // Pool all raw match-level paired predictions across the 10 external competitions
  const concat = <T>(getter: (b: CompetitionBuffers) => T[]): T[] =>
    compBuffers.flatMap(getter);

  const pooledLeakage: LeakageCounters = {
    futureDataViolations: compBuffers.reduce((s, b) => s + b.leakage.futureDataViolations, 0),
    targetMatchViolations: compBuffers.reduce((s, b) => s + b.leakage.targetMatchViolations, 0),
    sameTimestampViolations: compBuffers.reduce((s, b) => s + b.leakage.sameTimestampViolations, 0),
    targetXgViolations: compBuffers.reduce((s, b) => s + b.leakage.targetXgViolations, 0),
    targetEventsViolations: compBuffers.reduce((s, b) => s + b.leakage.targetEventsViolations, 0),
    seasonEndRatingViolations: compBuffers.reduce((s, b) => s + b.leakage.seasonEndRatingViolations, 0),
    futureCalibrationViolations: compBuffers.reduce((s, b) => s + b.leakage.futureCalibrationViolations, 0),
    futureThresholdViolations: compBuffers.reduce((s, b) => s + b.leakage.futureThresholdViolations, 0),
  };

  const pooledAbstention: AbstentionCounts = {
    totalFixtures: compBuffers.reduce((s, b) => s + b.abstention.totalFixtures, 0),
    p3GlobalAbstain: compBuffers.reduce((s, b) => s + b.abstention.p3GlobalAbstain, 0),
    p3AbstainLt5Team: compBuffers.reduce((s, b) => s + b.abstention.p3AbstainLt5Team, 0),
    p3AbstainLt10League: compBuffers.reduce((s, b) => s + b.abstention.p3AbstainLt10League, 0),
    p3AbstainQualityOrUncertainty: compBuffers.reduce(
      (s, b) => s + b.abstention.p3AbstainQualityOrUncertainty,
      0
    ),
    p51OneXTwoExtraAbstain: compBuffers.reduce((s, b) => s + b.abstention.p51OneXTwoExtraAbstain, 0),
    p51DrawExtraAbstain: compBuffers.reduce((s, b) => s + b.abstention.p51DrawExtraAbstain, 0),
    p51DrawVariantDNotTrained: compBuffers.reduce(
      (s, b) => s + b.abstention.p51DrawVariantDNotTrained,
      0
    ),
    p51DrawCausalThresholdNotTrained: compBuffers.reduce(
      (s, b) => s + b.abstention.p51DrawCausalThresholdNotTrained,
      0
    ),
    p5O25ExtraAbstain: compBuffers.reduce((s, b) => s + b.abstention.p5O25ExtraAbstain, 0),
    p5BttsExtraAbstain: compBuffers.reduce((s, b) => s + b.abstention.p5BttsExtraAbstain, 0),
  };

  const perCompetition = compBuffers.map(formatCompetitionReport);

  const pooled = {
    competitionsCount: compBuffers.length,
    totalFixtures: pooledAbstention.totalFixtures,
    leakage: {
      ...pooledLeakage,
      allZero: Object.values(pooledLeakage).every((v) => v === 0),
    },
    abstention: pooledAbstention,
    oneXTwo: {
      p51_B_temp: summarize1X2(concat((b) => b.onexTwo_p51B)),
      p51_D_tail: summarize1X2(concat((b) => b.onexTwo_p51D)),
      p51_D_selective: summarize1X2(concat((b) => b.onexTwo_p51D_selective)),
      p3_frozen: summarize1X2(concat((b) => b.onexTwo_p3)),
      p5_A: summarize1X2(concat((b) => b.onexTwo_p5A)),
      p5_raw: summarize1X2(concat((b) => b.onexTwo_p5Raw)),
      empLeague: summarize1X2(concat((b) => b.onexTwo_empLeague)),
      majority: summarize1X2(concat((b) => b.onexTwo_majority)),
      homeBias: summarize1X2(concat((b) => b.onexTwo_homeBias)),
    },
    draw: {
      varD_strict_fixed285: summarizeDraw(concat((b) => b.draw_varD_strict)),
      sel_causalThresh: summarizeDraw(concat((b) => b.draw_sel_causalThresh)),
      sel_fixed285: summarizeDraw(concat((b) => b.draw_sel_fixed285)),
      sel_argmax: summarizeDraw(concat((b) => b.draw_sel_argmax)),
      sel_marketGate: summarizeDraw(concat((b) => b.draw_sel_marketGate)),
      p5_fixed285: summarizeDraw(concat((b) => b.draw_p5_fixed285)),
      p5_argmax: summarizeDraw(concat((b) => b.draw_p5_argmax)),
      p3_fixed285: summarizeDraw(concat((b) => b.draw_p3_fixed285)),
      p3_argmax: summarizeDraw(concat((b) => b.draw_p3_argmax)),
      empRate_fixed285: summarizeDraw(concat((b) => b.draw_empRate_fixed285)),
      majority_noDraw: summarizeDraw(concat((b) => b.draw_majority_noDraw)),
    },
    o25: {
      p5_all: summarizeBinary(concat((b) => b.o25_p5_all)),
      p5_raw: summarizeBinary(concat((b) => b.o25_p5_raw)),
      p5_selective: summarizeBinary(concat((b) => b.o25_p5_selective)),
      p3_frozen: summarizeBinary(concat((b) => b.o25_p3)),
      empLeague: summarizeBinary(concat((b) => b.o25_empLeague)),
      majority: summarizeBinary(concat((b) => b.o25_majority)),
    },
    btts: {
      p5_all: summarizeBinary(concat((b) => b.btts_p5_all)),
      p5_raw: summarizeBinary(concat((b) => b.btts_p5_raw)),
      p5_selective: summarizeBinary(concat((b) => b.btts_p5_selective)),
      p3_frozen: summarizeBinary(concat((b) => b.btts_p3)),
      empLeague: summarizeBinary(concat((b) => b.btts_empLeague)),
      majority: summarizeBinary(concat((b) => b.btts_majority)),
    },
    goals: summarizeGoalsSet(concat((b) => b.goals)),
  };

  // Unweighted cross-competition generalization statistics
  const crossCompetition = {
    oneXTwo: {
      p3_acc: crossCompStats(perCompetition.map((c) => c.oneXTwo.p3_frozen.accPct)),
      p51B_acc: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_B_temp.accPct)),
      p51D_acc: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_D_tail.accPct)),
      p3_logLoss: crossCompStats(perCompetition.map((c) => c.oneXTwo.p3_frozen.logLoss)),
      p51B_logLoss: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_B_temp.logLoss)),
      p51D_logLoss: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_D_tail.logLoss)),
      p3_brier: crossCompStats(perCompetition.map((c) => c.oneXTwo.p3_frozen.brier)),
      p51B_brier: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_B_temp.brier)),
      p51D_brier: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_D_tail.brier)),
      p3_ece: crossCompStats(perCompetition.map((c) => c.oneXTwo.p3_frozen.ecePct)),
      p51B_ece: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_B_temp.ecePct)),
      p51D_ece: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_D_tail.ecePct)),
      p5Raw_tailEce: crossCompStats(perCompetition.map((c) => c.oneXTwo.p5_raw.tailEcePct)),
      p51B_tailEce: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_B_temp.tailEcePct)),
      p51D_tailEce: crossCompStats(perCompetition.map((c) => c.oneXTwo.p51_D_tail.tailEcePct)),
    },
    draw: {
      varD_f1: crossCompStats(perCompetition.map((c) => c.draw.varD_strict_fixed285.f1Pct)),
      varD_logLoss: crossCompStats(perCompetition.map((c) => c.draw.varD_strict_fixed285.logLoss)),
      selCausal_f1: crossCompStats(perCompetition.map((c) => c.draw.sel_causalThresh.f1Pct)),
      selFixed_f1: crossCompStats(perCompetition.map((c) => c.draw.sel_fixed285.f1Pct)),
      p3Fixed_f1: crossCompStats(perCompetition.map((c) => c.draw.p3_fixed285.f1Pct)),
      p5Fixed_f1: crossCompStats(perCompetition.map((c) => c.draw.p5_fixed285.f1Pct)),
    },
    o25: {
      p3_acc: crossCompStats(perCompetition.map((c) => c.o25.p3_frozen.accPct)),
      p5_acc: crossCompStats(perCompetition.map((c) => c.o25.p5_all.accPct)),
      p3_logLoss: crossCompStats(perCompetition.map((c) => c.o25.p3_frozen.logLoss)),
      p5_logLoss: crossCompStats(perCompetition.map((c) => c.o25.p5_all.logLoss)),
      p3_brier: crossCompStats(perCompetition.map((c) => c.o25.p3_frozen.brier)),
      p5_brier: crossCompStats(perCompetition.map((c) => c.o25.p5_all.brier)),
      p3_ece: crossCompStats(perCompetition.map((c) => c.o25.p3_frozen.ecePct)),
      p5_ece: crossCompStats(perCompetition.map((c) => c.o25.p5_all.ecePct)),
    },
    btts: {
      p3_acc: crossCompStats(perCompetition.map((c) => c.btts.p3_frozen.accPct)),
      p5_acc: crossCompStats(perCompetition.map((c) => c.btts.p5_all.accPct)),
      p3_logLoss: crossCompStats(perCompetition.map((c) => c.btts.p3_frozen.logLoss)),
      p5_logLoss: crossCompStats(perCompetition.map((c) => c.btts.p5_all.logLoss)),
      p3_brier: crossCompStats(perCompetition.map((c) => c.btts.p3_frozen.brier)),
      p5_btts_brier: crossCompStats(perCompetition.map((c) => c.btts.p5_all.brier)),
      p3_ece: crossCompStats(perCompetition.map((c) => c.btts.p3_frozen.ecePct)),
      p5_ece: crossCompStats(perCompetition.map((c) => c.btts.p5_all.ecePct)),
    },
    goals: {
      p3_maeTotal: crossCompStats(perCompetition.map((c) => c.goals.phase3.total.mae)),
      p5_maeTotal: crossCompStats(perCompetition.map((c) => c.goals.phase5.total.mae)),
      p3_rmseTotal: crossCompStats(perCompetition.map((c) => c.goals.phase3.total.rmse)),
      p5_rmseTotal: crossCompStats(perCompetition.map((c) => c.goals.phase5.total.rmse)),
    },
  };

  console.log(
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        candidateFrozen: {
          oneXTwo: 'Phase 5.1 Approach B (Blocked-CV Temperature Scaling) + Approach D (Tail Shrinkage)',
          draw: 'Phase 5.1 Draw Variant D (Causal Ensemble) + Causal Threshold (< T) & Fixed 28.5%',
          o25: 'Frozen Phase 5 O2.5 (Variant B NegBin+DC + Hierarchical Shrunk + Causal Cal)',
          btts: 'Frozen Phase 5 BTTS (50% Var B Independent + 50% Var C NegBin+DC + Causal Cal)',
          goals: 'Frozen Phase 5 Hierarchical Shrunk Lambdas',
        },
        excludedHoldouts: Array.from(PROTECTED_BLIND_HOLDOUT_IDS),
        excludedPriorDev: Array.from(PRIOR_DEV_DATASET_IDS),
        pooled,
        crossCompetition,
        perCompetition,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
