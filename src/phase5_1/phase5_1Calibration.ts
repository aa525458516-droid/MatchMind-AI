import {
  BinaryCalibSample,
  calibratePhase5Binary,
  calibratePhase5OneXTwo,
  fitBetaCalibration,
} from '../phase5/phase5Calibration';
import {
  ClassTailBreakdown,
  OneXTwoCalibrationApproach,
  Phase5_1CalibrationState,
  Phase5_1CalibSample1X2,
  Phase5_1OneXTwoCalibrationResult,
  ReliabilityBinDetail,
} from './phase5_1Types';

export const P51_MIN_TEMP_SAMPLES = 100;
export const P51_MIN_BETA_SAMPLES = 120;

const EPS = 1e-6;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.3333;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function normalizeSimplex(h: number, d: number, a: number): [number, number, number] {
  const cH = clamp01(h);
  const cD = clamp01(d);
  const cA = clamp01(a);
  const sum = Math.max(EPS, cH + cD + cA);
  return [cH / sum, cD / sum, cA / sum];
}

function applyMulticlassTemp(pH: number, pD: number, pA: number, T: number): [number, number, number] {
  const [bH, bD, bA] = normalizeSimplex(pH, pD, pA);
  const invT = 1 / Math.max(0.5, T);
  const sH = Math.pow(bH, invT);
  const sD = Math.pow(bD, invT);
  const sA = Math.pow(bA, invT);
  const sum = Math.max(EPS, sH + sD + sA);
  return [sH / sum, sD / sum, sA / sum];
}

export function multiclassLogLoss(samples: Phase5_1CalibSample1X2[], fn?: (s: Phase5_1CalibSample1X2) => [number, number, number]): number {
  if (samples.length === 0) return Infinity;
  let total = 0;
  for (const s of samples) {
    const [qH, qD, qA] = fn ? fn(s) : normalizeSimplex(s.pH, s.pD, s.pA);
    const hit = s.winner === 'HOME' ? qH : s.winner === 'DRAW' ? qD : qA;
    total += -Math.log(Math.max(EPS, hit));
  }
  return total / samples.length;
}

/**
 * Compute detailed 6-bin reliability diagnostics strictly on passed entries:
 * 0–50%, 50–60%, 60–70%, 70–80%, 80–90%, 90–100%.
 */
export function computeSixBinReliability(
  entries: Array<{ prob01: number; hit: boolean }>
): ReliabilityBinDetail[] {
  const defs = [
    { binLabel: '0-50%', minPct: 0, maxPct: 50 },
    { binLabel: '50-60%', minPct: 50, maxPct: 60 },
    { binLabel: '60-70%', minPct: 60, maxPct: 70 },
    { binLabel: '70-80%', minPct: 70, maxPct: 80 },
    { binLabel: '80-90%', minPct: 80, maxPct: 90 },
    { binLabel: '90-100%', minPct: 90, maxPct: 100.001 },
  ];

  return defs.map((d) => {
    const sub = entries.filter((e) => {
      const pct = e.prob01 * 100;
      return pct >= d.minPct && pct < d.maxPct;
    });
    if (sub.length === 0) {
      return {
        ...d,
        maxPct: Math.min(100, d.maxPct),
        count: 0,
        meanPredictedPct: null,
        observedFrequencyPct: null,
        calibrationErrorPct: null,
        signedBiasPct: null,
      };
    }
    const meanP = (sub.reduce((a, x) => a + x.prob01, 0) / sub.length) * 100;
    const obs = (sub.filter((x) => x.hit).length / sub.length) * 100;
    const diff = meanP - obs;
    return {
      binLabel: d.binLabel,
      minPct: d.minPct,
      maxPct: Math.min(100, d.maxPct),
      count: sub.length,
      meanPredictedPct: round1(meanP),
      observedFrequencyPct: round1(obs),
      calibrationErrorPct: round1(Math.abs(diff)),
      signedBiasPct: round1(diff),
    };
  });
}

export function summarizeThresholdRegion(
  entries: Array<{ prob01: number; hit: boolean }>,
  label: string,
  minPct: number,
  maxPct = 100
): ReliabilityBinDetail {
  const sub = entries.filter((e) => {
    const pct = e.prob01 * 100;
    return pct >= minPct && pct <= maxPct;
  });
  if (sub.length === 0) {
    return {
      binLabel: label,
      minPct,
      maxPct,
      count: 0,
      meanPredictedPct: null,
      observedFrequencyPct: null,
      calibrationErrorPct: null,
      signedBiasPct: null,
    };
  }
  const meanP = (sub.reduce((a, x) => a + x.prob01, 0) / sub.length) * 100;
  const obs = (sub.filter((x) => x.hit).length / sub.length) * 100;
  const diff = meanP - obs;
  return {
    binLabel: label,
    minPct,
    maxPct,
    count: sub.length,
    meanPredictedPct: round1(meanP),
    observedFrequencyPct: round1(obs),
    calibrationErrorPct: round1(Math.abs(diff)),
    signedBiasPct: round1(diff),
  };
}

export function computeClassTailBreakdown(
  entries: Array<{ prob01: number; hit: boolean }>,
  outcomeClass: 'HOME' | 'DRAW' | 'AWAY' | 'OVERALL_TOP'
): ClassTailBreakdown {
  const r70 = summarizeThresholdRegion(entries, '>=70%', 70);
  const r80 = summarizeThresholdRegion(entries, '>=80%', 80);
  const r85 = summarizeThresholdRegion(entries, '>=85%', 85);
  return {
    outcomeClass,
    totalCount: entries.length,
    ge70Count: r70.count,
    ge70MeanPredPct: r70.meanPredictedPct,
    ge70ObservedPct: r70.observedFrequencyPct,
    ge70CalErrorPct: r70.calibrationErrorPct,
    ge80Count: r80.count,
    ge80MeanPredPct: r80.meanPredictedPct,
    ge80ObservedPct: r80.observedFrequencyPct,
    ge80CalErrorPct: r80.calibrationErrorPct,
    ge85Count: r85.count,
    ge85MeanPredPct: r85.meanPredictedPct,
    ge85ObservedPct: r85.observedFrequencyPct,
    ge85CalErrorPct: r85.calibrationErrorPct,
  };
}

/**
 * Approach A: Existing Phase 5 1X2 scalar temperature scaling (isolated copy/wrapper).
 */
export function calibrate1XTwoApproachA_Existing(
  rawH01: number,
  rawD01: number,
  rawA01: number,
  targetUtc: string,
  allSamples: Phase5_1CalibSample1X2[]
): Phase5_1OneXTwoCalibrationResult {
  const out = calibratePhase5OneXTwo(rawH01, rawD01, rawA01, targetUtc, allSamples);
  return {
    approach: 'A_EXISTING_PHASE5',
    homeWin01: out.pH,
    draw01: out.pD,
    awayWin01: out.pA,
    status: out.status,
    sampleCount: out.sampleCount,
    temperature: out.temperature,
    tailShrinkage: null,
    reason:
      out.status === 'NOT_TRAINED'
        ? `Existing Phase 5 1X2 calibration NOT_TRAINED (${out.sampleCount}/${P51_MIN_TEMP_SAMPLES} causal priors).`
        : `Existing Phase 5 scalar temperature T=${out.temperature.toFixed(3)} (${out.selectedMethod}).`,
  };
}

/**
 * Fit regularized multiclass Temperature Scaling via 3-fold blocked causal CV strictly on < T priors.
 */
export function fitCausal1XTwoTemperature(prior: Phase5_1CalibSample1X2[]): {
  T: number;
  applied: boolean;
  cvRawLoss: number | null;
  cvCalLoss: number | null;
} {
  if (prior.length < P51_MIN_TEMP_SAMPLES) {
    return { T: 1.0, applied: false, cvRawLoss: null, cvCalLoss: null };
  }

  const fitOn = (rows: Phase5_1CalibSample1X2[]): number => {
    let bestT = 1.0;
    let bestObj = multiclassLogLoss(rows);
    for (let grid = 0.75; grid <= 2.801; grid += 0.04) {
      const T = Math.round(grid * 100) / 100;
      const loss =
        multiclassLogLoss(rows, (s) => applyMulticlassTemp(s.pH, s.pD, s.pA, T)) +
        0.0004 * (T - 1.0) * (T - 1.0);
      if (loss < bestObj - 1e-5) {
        bestObj = loss;
        bestT = T;
      }
    }
    return bestT;
  };

  // 3-fold chronological blocked validation strictly within prior (< T)
  const k = 3;
  const foldSize = Math.floor(prior.length / k);
  let cvRawTotal = 0;
  let cvCalTotal = 0;
  let cvCount = 0;

  for (let fold = 0; fold < k; fold++) {
    const start = fold * foldSize;
    const end = fold === k - 1 ? prior.length : (fold + 1) * foldSize;
    const val = prior.slice(start, end);
    const train = [...prior.slice(0, start), ...prior.slice(end)];
    const tFold = fitOn(train);
    for (const s of val) {
      const [rH, rD, rA] = normalizeSimplex(s.pH, s.pD, s.pA);
      const [cH, cD, cA] = applyMulticlassTemp(s.pH, s.pD, s.pA, tFold);
      const rHit = s.winner === 'HOME' ? rH : s.winner === 'DRAW' ? rD : rA;
      const cHit = s.winner === 'HOME' ? cH : s.winner === 'DRAW' ? cD : cA;
      cvRawTotal += -Math.log(Math.max(EPS, rHit));
      cvCalTotal += -Math.log(Math.max(EPS, cHit));
      cvCount++;
    }
  }

  const cvRawLoss = cvCount > 0 ? cvRawTotal / cvCount : null;
  const cvCalLoss = cvCount > 0 ? cvCalTotal / cvCount : null;

  if (cvRawLoss !== null && cvCalLoss !== null && cvCalLoss < cvRawLoss - 0.0002) {
    const fullT = fitOn(prior);
    return {
      T: Math.round(fullT * 1000) / 1000,
      applied: Math.abs(fullT - 1.0) > 1e-3,
      cvRawLoss,
      cvCalLoss,
    };
  }

  return { T: 1.0, applied: false, cvRawLoss, cvCalLoss };
}

/**
 * Approach B: Regularized Blocked-CV Temperature Scaling (< T).
 */
export function calibrate1XTwoApproachB_Temperature(
  rawH01: number,
  rawD01: number,
  rawA01: number,
  targetUtc: string,
  allSamples: Phase5_1CalibSample1X2[]
): Phase5_1OneXTwoCalibrationResult {
  const [bH, bD, bA] = normalizeSimplex(rawH01, rawD01, rawA01);
  const targetMs = new Date(targetUtc).getTime();
  const prior = Number.isFinite(targetMs)
    ? allSamples
        .filter((s) => Number.isFinite(s.timestampMs) && s.timestampMs < targetMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  if (prior.length < P51_MIN_TEMP_SAMPLES) {
    return {
      approach: 'B_TEMPERATURE',
      homeWin01: bH,
      draw01: bD,
      awayWin01: bA,
      status: 'NOT_TRAINED',
      sampleCount: prior.length,
      temperature: 1.0,
      tailShrinkage: null,
      reason: `Temperature scaling NOT_TRAINED (${prior.length}/${P51_MIN_TEMP_SAMPLES} causal priors).`,
    };
  }

  const fit = fitCausal1XTwoTemperature(prior);
  const [qH, qD, qA] = fit.applied ? applyMulticlassTemp(bH, bD, bA, fit.T) : [bH, bD, bA];

  return {
    approach: 'B_TEMPERATURE',
    homeWin01: qH,
    draw01: qD,
    awayWin01: qA,
    status: 'CALIBRATED',
    sampleCount: prior.length,
    temperature: fit.T,
    tailShrinkage: null,
    reason: fit.applied
      ? `Blocked-CV regularized temperature T=${fit.T.toFixed(3)} reduced causal CV log loss (${fit.cvRawLoss?.toFixed(4)} -> ${fit.cvCalLoss?.toFixed(4)}).`
      : `Blocked-CV checked temperature scaling; identity T=1.000 retained (${prior.length} priors).`,
  };
}

/**
 * Fit 3-class OvR Beta calibration strictly on < T prior samples and normalize to simplex.
 */
export function fitCausal1XTwoBeta(prior: Phase5_1CalibSample1X2[]): {
  applied: boolean;
  apply: (pH: number, pD: number, pA: number) => [number, number, number];
  cvRawLoss: number | null;
  cvBetaLoss: number | null;
} {
  const fitOn = (rows: Phase5_1CalibSample1X2[]) => {
    const mH = fitBetaCalibration(
      rows.map((r) => ({ timestampMs: r.timestampMs, rawProb01: r.pH, actual: r.winner === 'HOME' }))
    );
    const mD = fitBetaCalibration(
      rows.map((r) => ({ timestampMs: r.timestampMs, rawProb01: r.pD, actual: r.winner === 'DRAW' }))
    );
    const mA = fitBetaCalibration(
      rows.map((r) => ({ timestampMs: r.timestampMs, rawProb01: r.pA, actual: r.winner === 'AWAY' }))
    );
    return (pH: number, pD: number, pA: number): [number, number, number] =>
      normalizeSimplex(mH.apply(pH), mD.apply(pD), mA.apply(pA));
  };

  if (prior.length < P51_MIN_BETA_SAMPLES) {
    return {
      applied: false,
      apply: (h, d, a) => normalizeSimplex(h, d, a),
      cvRawLoss: null,
      cvBetaLoss: null,
    };
  }

  const k = 3;
  const foldSize = Math.floor(prior.length / k);
  let cvRawTotal = 0;
  let cvBetaTotal = 0;
  let cvCount = 0;

  for (let fold = 0; fold < k; fold++) {
    const start = fold * foldSize;
    const end = fold === k - 1 ? prior.length : (fold + 1) * foldSize;
    const val = prior.slice(start, end);
    const train = [...prior.slice(0, start), ...prior.slice(end)];
    const fnFold = fitOn(train);
    for (const s of val) {
      const [rH, rD, rA] = normalizeSimplex(s.pH, s.pD, s.pA);
      const [bH, bD, bA] = fnFold(s.pH, s.pD, s.pA);
      const rHit = s.winner === 'HOME' ? rH : s.winner === 'DRAW' ? rD : rA;
      const bHit = s.winner === 'HOME' ? bH : s.winner === 'DRAW' ? bD : bA;
      cvRawTotal += -Math.log(Math.max(EPS, rHit));
      cvBetaTotal += -Math.log(Math.max(EPS, bHit));
      cvCount++;
    }
  }

  const cvRawLoss = cvCount > 0 ? cvRawTotal / cvCount : null;
  const cvBetaLoss = cvCount > 0 ? cvBetaTotal / cvCount : null;

  if (cvRawLoss !== null && cvBetaLoss !== null && cvBetaLoss < cvRawLoss - 0.0008) {
    return {
      applied: true,
      apply: fitOn(prior),
      cvRawLoss,
      cvBetaLoss,
    };
  }

  return {
    applied: false,
    apply: (h, d, a) => normalizeSimplex(h, d, a),
    cvRawLoss,
    cvBetaLoss,
  };
}

/**
 * Approach C: Causal OvR Beta Calibration for 1X2 (< T).
 */
export function calibrate1XTwoApproachC_Beta(
  rawH01: number,
  rawD01: number,
  rawA01: number,
  targetUtc: string,
  allSamples: Phase5_1CalibSample1X2[]
): Phase5_1OneXTwoCalibrationResult {
  const [bH, bD, bA] = normalizeSimplex(rawH01, rawD01, rawA01);
  const targetMs = new Date(targetUtc).getTime();
  const prior = Number.isFinite(targetMs)
    ? allSamples
        .filter((s) => Number.isFinite(s.timestampMs) && s.timestampMs < targetMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  if (prior.length < P51_MIN_BETA_SAMPLES) {
    return {
      approach: 'C_BETA',
      homeWin01: bH,
      draw01: bD,
      awayWin01: bA,
      status: 'NOT_TRAINED',
      sampleCount: prior.length,
      temperature: null,
      tailShrinkage: null,
      reason: `1X2 Beta calibration NOT_TRAINED (${prior.length}/${P51_MIN_BETA_SAMPLES} causal priors).`,
    };
  }

  const fit = fitCausal1XTwoBeta(prior);
  const [qH, qD, qA] = fit.applied ? fit.apply(bH, bD, bA) : [bH, bD, bA];

  return {
    approach: 'C_BETA',
    homeWin01: qH,
    draw01: qD,
    awayWin01: qA,
    status: 'CALIBRATED',
    sampleCount: prior.length,
    temperature: null,
    tailShrinkage: null,
    reason: fit.applied
      ? `Causal OvR Beta calibration improved 1X2 CV log loss (${fit.cvRawLoss?.toFixed(4)} -> ${fit.cvBetaLoss?.toFixed(4)}).`
      : `Causal OvR Beta calibration did not beat identity in blocked CV (${prior.length} priors); identity retained.`,
  };
}

export function calibratePhase5_1Binary(
  rawProb01: number,
  targetUtc: string,
  allSamples: BinaryCalibSample[]
): {
  prob01: number;
  status: Phase5_1CalibrationState;
  method: string;
  sampleCount: number;
} {
  const res = calibratePhase5Binary(rawProb01, targetUtc, allSamples);
  return {
    prob01: res.calibratedProb01,
    status: res.status,
    method: res.selectedMethod,
    sampleCount: res.sampleCount,
  };
}

export type { OneXTwoCalibrationApproach };
