import {
  Phase5CalibrationComparisonEntry,
  Phase5CalibrationMethod,
  Phase5CalibrationState,
} from './phase5Types';

export const MIN_TEMP_SAMPLES = 100;
export const MIN_BETA_SAMPLES = 150;
export const MIN_ISOTONIC_SAMPLES = 220;

const EPS = 1e-6;

export interface BinaryCalibSample {
  timestampMs: number;
  rawProb01: number;
  actual: boolean;
}

export interface MultiClassCalibSample {
  timestampMs: number;
  pH: number;
  pD: number;
  pA: number;
  winner: 'HOME' | 'DRAW' | 'AWAY';
}

export interface BinaryCalibrationOutput {
  calibratedProb01: number;
  selectedMethod: Phase5CalibrationMethod;
  status: Phase5CalibrationState;
  sampleCount: number;
  variantProbabilities: {
    rawProb01: number;
    temperatureProb01: number | null;
    betaProb01: number | null;
    isotonicProb01: number | null;
  };
  comparisons: Phase5CalibrationComparisonEntry[];
}

export interface MultiClassCalibrationOutput {
  pH: number;
  pD: number;
  pA: number;
  selectedMethod: Phase5CalibrationMethod;
  status: Phase5CalibrationState;
  sampleCount: number;
  temperature: number;
  comparisons: Phase5CalibrationComparisonEntry[];
}

function clampProb01(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function logit(p: number): number {
  const c = clampProb01(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z > 35) return 1 - EPS;
  if (z < -35) return EPS;
  return 1 / (1 + Math.exp(-z));
}

function binaryLogLoss(samples: Array<{ p: number; y: boolean }>): number {
  if (samples.length === 0) return Infinity;
  let total = 0;
  for (const s of samples) {
    const p = clampProb01(s.p);
    total += s.y ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / samples.length;
}

/** Fit binary Temperature scaling (T in [0.65, 3.5]) minimizing regularized log loss. */
export function fitBinaryTemp(samples: BinaryCalibSample[]): { T: number; apply: (p: number) => number } {
  const identityLoss = binaryLogLoss(samples.map((s) => ({ p: s.rawProb01, y: s.actual })));
  let bestT = 1.0;
  let bestLoss = identityLoss;

  // Coarse + golden-section refinement
  for (let grid = 0.65; grid <= 3.501; grid += 0.05) {
    const T = Math.round(grid * 100) / 100;
    let loss = 0;
    for (const s of samples) {
      const p = clampProb01(sigmoid(logit(s.rawProb01) / T));
      loss += s.actual ? -Math.log(p) : -Math.log(1 - p);
    }
    const avg = loss / samples.length + 0.0005 * (T - 1) * (T - 1);
    if (avg < bestLoss - 1e-5) {
      bestLoss = avg;
      bestT = T;
    }
  }

  let lo = Math.max(0.65, bestT - 0.08);
  let hi = Math.min(3.5, bestT + 0.08);
  const phi = (Math.sqrt(5) - 1) / 2;
  const evalObj = (T: number) => {
    let loss = 0;
    for (const s of samples) {
      const p = clampProb01(sigmoid(logit(s.rawProb01) / T));
      loss += s.actual ? -Math.log(p) : -Math.log(1 - p);
    }
    return loss / samples.length + 0.0005 * (T - 1) * (T - 1);
  };

  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = evalObj(x1);
  let f2 = evalObj(x2);
  for (let i = 0; i < 20; i++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = evalObj(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = evalObj(x2);
    }
  }
  const candT = (lo + hi) / 2;
  if (evalObj(candT) < bestLoss) {
    bestT = candT;
  }

  // Only accept if genuine log-loss improvement without penalty
  const pureLoss = binaryLogLoss(
    samples.map((s) => ({ p: sigmoid(logit(s.rawProb01) / bestT), y: s.actual }))
  );
  if (pureLoss >= identityLoss - 0.0005) {
    bestT = 1.0;
  }

  return {
    T: bestT,
    apply: (p: number) => clampProb01(sigmoid(logit(p) / bestT)),
  };
}

/**
 * Beta Calibration (Kull et al. 2017):
 * logit(p_cal) = a * log(p) - b * log(1 - p) + c, with a >= 0.15, b >= 0.15.
 * Regularized gently toward identity (a=1, b=1, c=0) to prevent overfitting tail regions.
 */
export function fitBetaCalibration(samples: BinaryCalibSample[]): {
  a: number;
  b: number;
  c: number;
  apply: (p: number) => number;
} {
  let a = 1.0;
  let b = 1.0;
  let c = 0.0;
  const reg = 0.025;
  const lr = 0.08;
  const n = samples.length;

  for (let iter = 0; iter < 120; iter++) {
    let gradA = 2 * reg * (a - 1);
    let gradB = 2 * reg * (b - 1);
    let gradC = 2 * reg * c;

    for (const s of samples) {
      const p = clampProb01(s.rawProb01);
      const lp = Math.log(p);
      const l1mp = Math.log(1 - p);
      const z = a * lp - b * l1mp + c;
      const q = sigmoid(z);
      const err = q - (s.actual ? 1 : 0);
      gradA += (err * lp) / n;
      gradB += (err * -l1mp) / n;
      gradC += err / n;
    }

    const step = lr / (1 + iter * 0.03);
    a = Math.max(0.15, Math.min(4.0, a - step * gradA));
    b = Math.max(0.15, Math.min(4.0, b - step * gradB));
    c = Math.max(-2.5, Math.min(2.5, c - step * gradC));
  }

  const apply = (rawP: number): number => {
    const p = clampProb01(rawP);
    return clampProb01(sigmoid(a * Math.log(p) - b * Math.log(1 - p) + c));
  };

  return { a, b, c, apply };
}

interface IsotonicBlock {
  minX: number;
  maxX: number;
  sumY: number;
  count: number;
  value: number;
}

/**
 * Smoothed Pool-Adjacent-Violators (PAV) Isotonic Regression.
 * Enforces monotonic non-decreasing mapping + Laplace smoothing ((y + 0.5) / (n + 1)) to protect extreme tails.
 */
export function fitPavIsotonic(samples: BinaryCalibSample[]): {
  blocks: IsotonicBlock[];
  apply: (p: number) => number;
} {
  const sorted = [...samples]
    .map((s) => ({ x: clampProb01(s.rawProb01), y: s.actual ? 1 : 0 }))
    .sort((a, b) => a.x - b.x);

  const blocks: IsotonicBlock[] = sorted.map((pt) => ({
    minX: pt.x,
    maxX: pt.x,
    sumY: pt.y,
    count: 1,
    value: pt.y,
  }));

  let idx = 0;
  while (idx < blocks.length - 1) {
    if (blocks[idx].value > blocks[idx + 1].value) {
      const merged: IsotonicBlock = {
        minX: blocks[idx].minX,
        maxX: blocks[idx + 1].maxX,
        sumY: blocks[idx].sumY + blocks[idx + 1].sumY,
        count: blocks[idx].count + blocks[idx + 1].count,
        value:
          (blocks[idx].sumY + blocks[idx + 1].sumY) /
          (blocks[idx].count + blocks[idx + 1].count),
      };
      blocks.splice(idx, 2, merged);
      if (idx > 0) idx--;
    } else {
      idx++;
    }
  }

  // Apply gentle Laplace shrinkage toward raw midpoint to protect sparse bins
  const smoothed = blocks.map((blk) => {
    const rawMid = (blk.minX + blk.maxX) / 2;
    return {
      ...blk,
      value: clampProb01((blk.sumY + 2 * rawMid) / (blk.count + 2)),
    };
  });

  const apply = (rawP: number): number => {
    const x = clampProb01(rawP);
    if (smoothed.length === 0) return x;
    if (x <= smoothed[0].maxX) return smoothed[0].value;
    if (x >= smoothed[smoothed.length - 1].minX) return smoothed[smoothed.length - 1].value;

    for (let i = 0; i < smoothed.length - 1; i++) {
      const b1 = smoothed[i];
      const b2 = smoothed[i + 1];
      if (x >= b1.minX && x <= b1.maxX) return b1.value;
      if (x > b1.maxX && x < b2.minX) {
        const span = Math.max(1e-6, b2.minX - b1.maxX);
        const t = (x - b1.maxX) / span;
        return clampProb01(b1.value + t * (b2.value - b1.value));
      }
    }
    return x;
  };

  return { blocks: smoothed, apply };
}

/**
 * 3-fold blocked causal validation strictly within prior (< T) to avoid noisy single-split rejections.
 * Each fold trains on the other two chronological blocks and evaluates out-of-fold log loss.
 */
function evaluateBlockedCausalCV(
  sortedPrior: BinaryCalibSample[],
  method: Phase5CalibrationMethod
): number | null {
  if (sortedPrior.length < 90) return null;
  const k = 3;
  const foldSize = Math.floor(sortedPrior.length / k);
  if (foldSize < 25) return null;

  let totalLoss = 0;
  let totalCount = 0;

  for (let fold = 0; fold < k; fold++) {
    const start = fold * foldSize;
    const end = fold === k - 1 ? sortedPrior.length : (fold + 1) * foldSize;
    const val = sortedPrior.slice(start, end);
    const train = [...sortedPrior.slice(0, start), ...sortedPrior.slice(end)];

    let fn: (p: number) => number;
    if (method === 'RAW_IDENTITY') {
      fn = (p) => clampProb01(p);
    } else if (method === 'TEMPERATURE') {
      fn = fitBinaryTemp(train).apply;
    } else if (method === 'BETA') {
      fn = fitBetaCalibration(train).apply;
    } else {
      fn = fitPavIsotonic(train).apply;
    }

    for (const s of val) {
      const p = clampProb01(fn(s.rawProb01));
      totalLoss += s.actual ? -Math.log(p) : -Math.log(1 - p);
      totalCount++;
    }
  }

  return totalCount > 0 ? totalLoss / totalCount : null;
}

/**
 * Calibrate a binary market probability strictly from prior outcomes (< targetUtc).
 * Evaluates Raw vs Temperature vs Beta vs PAV Isotonic monotonically by sample thresholds
 * using regularized Temperature Scaling (n >= 100) and 3-fold blocked causal CV (Beta >= 150, Isotonic >= 220).
 */
export function calibratePhase5Binary(
  rawProb01: number,
  targetUtc: string,
  allSamples: BinaryCalibSample[]
): BinaryCalibrationOutput {
  const targetMs = new Date(targetUtc).getTime();
  const cleanRaw = clampProb01(rawProb01);

  if (!Number.isFinite(targetMs)) {
    return {
      calibratedProb01: cleanRaw,
      selectedMethod: 'RAW_IDENTITY',
      status: 'NOT_TRAINED',
      sampleCount: 0,
      variantProbabilities: {
        rawProb01: cleanRaw,
        temperatureProb01: null,
        betaProb01: null,
        isotonicProb01: null,
      },
      comparisons: [
        { method: 'RAW_IDENTITY', available: true, minRequired: 0, sampleCount: 0, causalValidationLogLoss: null, applied: true },
        { method: 'TEMPERATURE', available: false, minRequired: MIN_TEMP_SAMPLES, sampleCount: 0, causalValidationLogLoss: null, applied: false },
        { method: 'BETA', available: false, minRequired: MIN_BETA_SAMPLES, sampleCount: 0, causalValidationLogLoss: null, applied: false },
        { method: 'ISOTONIC', available: false, minRequired: MIN_ISOTONIC_SAMPLES, sampleCount: 0, causalValidationLogLoss: null, applied: false },
      ],
    };
  }

  const prior = allSamples
    .filter((s) => Number.isFinite(s.timestampMs) && s.timestampMs < targetMs && Number.isFinite(s.rawProb01))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const n = prior.length;
  if (n < MIN_TEMP_SAMPLES) {
    return {
      calibratedProb01: cleanRaw,
      selectedMethod: 'RAW_IDENTITY',
      status: 'NOT_TRAINED',
      sampleCount: n,
      variantProbabilities: {
        rawProb01: cleanRaw,
        temperatureProb01: null,
        betaProb01: null,
        isotonicProb01: null,
      },
      comparisons: [
        { method: 'RAW_IDENTITY', available: true, minRequired: 0, sampleCount: n, causalValidationLogLoss: null, applied: true },
        { method: 'TEMPERATURE', available: false, minRequired: MIN_TEMP_SAMPLES, sampleCount: n, causalValidationLogLoss: null, applied: false },
        { method: 'BETA', available: false, minRequired: MIN_BETA_SAMPLES, sampleCount: n, causalValidationLogLoss: null, applied: false },
        { method: 'ISOTONIC', available: false, minRequired: MIN_ISOTONIC_SAMPLES, sampleCount: n, causalValidationLogLoss: null, applied: false },
      ],
    };
  }

  const rawValLoss = evaluateBlockedCausalCV(prior, 'RAW_IDENTITY');
  const tempModel = fitBinaryTemp(prior);
  const tempProb01 = tempModel.apply(cleanRaw);
  const tempValLoss = evaluateBlockedCausalCV(prior, 'TEMPERATURE');

  let betaProb01: number | null = null;
  let betaValLoss: number | null = null;
  if (n >= MIN_BETA_SAMPLES) {
    const betaModel = fitBetaCalibration(prior);
    betaProb01 = betaModel.apply(cleanRaw);
    betaValLoss = evaluateBlockedCausalCV(prior, 'BETA');
  }

  let isotonicProb01: number | null = null;
  let isotonicValLoss: number | null = null;
  if (n >= MIN_ISOTONIC_SAMPLES) {
    const isoModel = fitPavIsotonic(prior);
    isotonicProb01 = isoModel.apply(cleanRaw);
    isotonicValLoss = evaluateBlockedCausalCV(prior, 'ISOTONIC');
  }

  // Strictly causal selection (< T): 1-param regularized Temperature wins if CV improves or matches Raw with T != 1
  let selectedMethod: Phase5CalibrationMethod = 'RAW_IDENTITY';
  let bestVal = rawValLoss ?? Infinity;
  let calibratedProb01 = cleanRaw;

  if (tempValLoss !== null && tempValLoss < bestVal - 0.0002) {
    bestVal = tempValLoss;
    selectedMethod = 'TEMPERATURE';
    calibratedProb01 = tempProb01;
  } else if (tempModel.T !== 1.0 && rawValLoss !== null && tempValLoss !== null && tempValLoss <= rawValLoss + 0.0005) {
    bestVal = tempValLoss;
    selectedMethod = 'TEMPERATURE';
    calibratedProb01 = tempProb01;
  }

  if (betaValLoss !== null && betaProb01 !== null && betaValLoss < bestVal - 0.002) {
    bestVal = betaValLoss;
    selectedMethod = 'BETA';
    calibratedProb01 = betaProb01;
  }
  if (isotonicValLoss !== null && isotonicProb01 !== null && isotonicValLoss < bestVal - 0.004) {
    bestVal = isotonicValLoss;
    selectedMethod = 'ISOTONIC';
    calibratedProb01 = isotonicProb01;
  }

  const status: Phase5CalibrationState = 'CALIBRATED';

  return {
    calibratedProb01,
    selectedMethod,
    status,
    sampleCount: n,
    variantProbabilities: {
      rawProb01: cleanRaw,
      temperatureProb01: tempProb01,
      betaProb01,
      isotonicProb01,
    },
    comparisons: [
      {
        method: 'RAW_IDENTITY',
        available: true,
        minRequired: 0,
        sampleCount: n,
        causalValidationLogLoss: rawValLoss !== null ? Math.round(rawValLoss * 10000) / 10000 : null,
        applied: selectedMethod === 'RAW_IDENTITY',
      },
      {
        method: 'TEMPERATURE',
        available: true,
        minRequired: MIN_TEMP_SAMPLES,
        sampleCount: n,
        causalValidationLogLoss: tempValLoss !== null ? Math.round(tempValLoss * 10000) / 10000 : null,
        applied: selectedMethod === 'TEMPERATURE',
      },
      {
        method: 'BETA',
        available: n >= MIN_BETA_SAMPLES,
        minRequired: MIN_BETA_SAMPLES,
        sampleCount: n,
        causalValidationLogLoss: betaValLoss !== null ? Math.round(betaValLoss * 10000) / 10000 : null,
        applied: selectedMethod === 'BETA',
      },
      {
        method: 'ISOTONIC',
        available: n >= MIN_ISOTONIC_SAMPLES,
        minRequired: MIN_ISOTONIC_SAMPLES,
        sampleCount: n,
        causalValidationLogLoss: isotonicValLoss !== null ? Math.round(isotonicValLoss * 10000) / 10000 : null,
        applied: selectedMethod === 'ISOTONIC',
      },
    ],
  };
}

function applyMulticlassTemp(pH: number, pD: number, pA: number, T: number): [number, number, number] {
  const cH = clampProb01(pH);
  const cD = clampProb01(pD);
  const cA = clampProb01(pA);
  const invT = 1 / Math.max(0.5, T);
  const sH = Math.pow(cH, invT);
  const sD = Math.pow(cD, invT);
  const sA = Math.pow(cA, invT);
  const sum = sH + sD + sA;
  return [sH / sum, sD / sum, sA / sum];
}

function multiclassLogLoss(samples: MultiClassCalibSample[], T: number): number {
  if (samples.length === 0) return Infinity;
  let total = 0;
  for (const s of samples) {
    const [qH, qD, qA] = applyMulticlassTemp(s.pH, s.pD, s.pA, T);
    const hit = s.winner === 'HOME' ? qH : s.winner === 'DRAW' ? qD : qA;
    total += -Math.log(Math.max(EPS, hit));
  }
  return total / samples.length;
}

export function calibratePhase5OneXTwo(
  rawH01: number,
  rawD01: number,
  rawA01: number,
  targetUtc: string,
  allSamples: MultiClassCalibSample[]
): MultiClassCalibrationOutput {
  const sum = Math.max(EPS, rawH01 + rawD01 + rawA01);
  const baseH = clampProb01(rawH01 / sum);
  const baseD = clampProb01(rawD01 / sum);
  const baseA = clampProb01(rawA01 / sum);
  const targetMs = new Date(targetUtc).getTime();

  const prior = Number.isFinite(targetMs)
    ? allSamples
        .filter((s) => Number.isFinite(s.timestampMs) && s.timestampMs < targetMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  const n = prior.length;
  if (n < MIN_TEMP_SAMPLES) {
    return {
      pH: baseH,
      pD: baseD,
      pA: baseA,
      selectedMethod: 'RAW_IDENTITY',
      status: 'NOT_TRAINED',
      sampleCount: n,
      temperature: 1.0,
      comparisons: [
        { method: 'RAW_IDENTITY', available: true, minRequired: 0, sampleCount: n, causalValidationLogLoss: null, applied: true },
        { method: 'TEMPERATURE', available: false, minRequired: MIN_TEMP_SAMPLES, sampleCount: n, causalValidationLogLoss: null, applied: false },
      ],
    };
  }

  const split = Math.floor(n * 0.65);
  const train = prior.slice(0, split);
  const val = prior.slice(split);

  let bestT = 1.0;
  let bestTrainLoss = multiclassLogLoss(train.length >= 40 ? train : prior, 1.0);
  for (let grid = 0.7; grid <= 3.001; grid += 0.05) {
    const T = Math.round(grid * 100) / 100;
    const loss = multiclassLogLoss(train.length >= 40 ? train : prior, T);
    if (loss < bestTrainLoss - 0.0005) {
      bestTrainLoss = loss;
      bestT = T;
    }
  }

  const rawValLoss = val.length >= 15 ? multiclassLogLoss(val, 1.0) : null;
  const tempValLoss = val.length >= 15 ? multiclassLogLoss(val, bestT) : null;

  let chosenT = 1.0;
  let method: Phase5CalibrationMethod = 'RAW_IDENTITY';
  if (tempValLoss !== null && rawValLoss !== null) {
    if (tempValLoss < rawValLoss - 0.0008) {
      chosenT = bestT;
      method = 'TEMPERATURE';
    }
  } else if (bestT !== 1.0) {
    chosenT = bestT;
    method = 'TEMPERATURE';
  }

  const [qH, qD, qA] = applyMulticlassTemp(baseH, baseD, baseA, chosenT);
  return {
    pH: qH,
    pD: qD,
    pA: qA,
    selectedMethod: method,
    status: 'CALIBRATED',
    sampleCount: n,
    temperature: Math.round(chosenT * 1000) / 1000,
    comparisons: [
      {
        method: 'RAW_IDENTITY',
        available: true,
        minRequired: 0,
        sampleCount: n,
        causalValidationLogLoss: rawValLoss !== null ? Math.round(rawValLoss * 10000) / 10000 : null,
        applied: method === 'RAW_IDENTITY',
      },
      {
        method: 'TEMPERATURE',
        available: true,
        minRequired: MIN_TEMP_SAMPLES,
        sampleCount: n,
        causalValidationLogLoss: tempValLoss !== null ? Math.round(tempValLoss * 10000) / 10000 : null,
        applied: method === 'TEMPERATURE',
      },
    ],
  };
}
