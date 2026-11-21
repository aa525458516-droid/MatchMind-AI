/**
 * Leakage-Safe Causal Probability Calibration Layer
 *
 * Implements strictly causal, single-scalar temperature scaling as a separate
 * post-processing layer without mutating the pure Poisson / Dixon-Coles engine.
 *
 * Design invariants:
 * 1. Strictly Causal (< T): Only finished, non-abstained historical predictions whose
 *    kickoff timestamp is strictly before the target match kickoff (< T) may enter fitting.
 * 2. Minimum Sample Threshold: Requires >= 100 prior evaluated predictions before
 *    applying learned temperatures. Below 100, raw probabilities are returned untouched
 *    and calibrationStatus explicitly reports `status: 'NOT_TRAINED'`.
 * 3. Single Scalar Temperature per Market (never per-bin):
 *    - Binary markets (Double Chance, Over 1.5, Over 2.5, BTTS): p_cal = sigmoid(logit(p_raw) / T_m)
 *    - Multi-class 1X2: softmax((log p_raw) / T_1x2)
 *    Temperatures are bounded conservatively in [0.7, 3.0] and optimized strictly via
 *    convex 1D minimization of historical Log Loss on prior samples.
 * 4. Always trains against `rawProbabilities` when present to prevent recursive drift.
 */

import { CalibrationStatus, HistoryRecord, MarketProbabilities } from '../types/football';

export const MIN_CALIBRATION_SAMPLES = 100;
export const TEMPERATURE_MIN = 0.7;
export const TEMPERATURE_MAX = 3.0;

const PROB_EPS = 1e-4;
const GOLDEN_PHI = (Math.sqrt(5) - 1) / 2;

function clampProb01(p: number): number {
  return Math.max(PROB_EPS, Math.min(1 - PROB_EPS, p));
}

function logit(p01: number): number {
  const c = clampProb01(p01);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

/**
 * Convex 1D golden-section search for inverse temperature beta = 1 / T in [betaMin, betaMax].
 */
function minimizeConvexBeta(
  lossFn: (beta: number) => number,
  betaMin: number = 1 / TEMPERATURE_MAX,
  betaMax: number = 1 / TEMPERATURE_MIN,
  iterations: number = 35
): number {
  let a = betaMin;
  let b = betaMax;
  let c = b - GOLDEN_PHI * (b - a);
  let d = a + GOLDEN_PHI * (b - a);
  let fc = lossFn(c);
  let fd = lossFn(d);

  for (let i = 0; i < iterations; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN_PHI * (b - a);
      fc = lossFn(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN_PHI * (b - a);
      fd = lossFn(d);
    }
  }

  const betaStar = (a + b) / 2;
  const starLoss = lossFn(betaStar);
  const identityLoss = lossFn(1.0);
  // Keep exact identity T = 1.0 unless causal fitting strictly improves historical Log Loss
  if (identityLoss <= starLoss + 1e-12) {
    return 1.0;
  }
  return betaStar;
}

/**
 * Fit single scalar temperature T for a binary market minimizing historical binary Log Loss.
 */
export function fitBinaryTemperature(
  samples: Array<{ prob01: number; actual: boolean }>
): number {
  if (samples.length < MIN_CALIBRATION_SAMPLES) {
    return 1.0;
  }

  const logits = samples.map((s) => logit(s.prob01));
  const betaStar = minimizeConvexBeta((beta) => {
    let totalLoss = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = clampProb01(sigmoid(logits[i] * beta));
      totalLoss += samples[i].actual ? -Math.log(p) : -Math.log(1 - p);
    }
    return totalLoss / samples.length;
  });

  return 1 / betaStar;
}

/**
 * Fit single scalar temperature T for 3-class 1X2 softmax minimizing categorical Log Loss.
 */
export function fitOneXTwoTemperature(
  samples: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }>
): number {
  if (samples.length < MIN_CALIBRATION_SAMPLES) {
    return 1.0;
  }

  const logTriples = samples.map((s) => {
    const lH = Math.log(clampProb01(s.pH));
    const lD = Math.log(clampProb01(s.pD));
    const lA = Math.log(clampProb01(s.pA));
    const targetIdx = s.winner === 'HOME' ? 0 : s.winner === 'DRAW' ? 1 : 2;
    return { logs: [lH, lD, lA] as const, targetIdx };
  });

  const betaStar = minimizeConvexBeta((beta) => {
    let totalLoss = 0;
    for (let i = 0; i < logTriples.length; i++) {
      const { logs, targetIdx } = logTriples[i];
      const s0 = logs[0] * beta;
      const s1 = logs[1] * beta;
      const s2 = logs[2] * beta;
      const maxS = Math.max(s0, s1, s2);
      const e0 = Math.exp(s0 - maxS);
      const e1 = Math.exp(s1 - maxS);
      const e2 = Math.exp(s2 - maxS);
      const sumE = e0 + e1 + e2;
      const targetProb = clampProb01((targetIdx === 0 ? e0 : targetIdx === 1 ? e1 : e2) / sumE);
      totalLoss += -Math.log(targetProb);
    }
    return totalLoss / logTriples.length;
  });

  return 1 / betaStar;
}

function applyBinaryTempPct(rawPct: number, temperature: number): number {
  const scaled01 = sigmoid(logit(rawPct / 100) / temperature);
  return Math.max(0.1, Math.min(99.9, round1(scaled01 * 100)));
}

function applyOneXTwoTempPct(
  homeWinPct: number,
  drawPct: number,
  awayWinPct: number,
  temperature: number
): { homeWin: number; draw: number; awayWin: number } {
  const beta = 1 / temperature;
  const s0 = Math.log(clampProb01(homeWinPct / 100)) * beta;
  const s1 = Math.log(clampProb01(drawPct / 100)) * beta;
  const s2 = Math.log(clampProb01(awayWinPct / 100)) * beta;
  const maxS = Math.max(s0, s1, s2);
  const e0 = Math.exp(s0 - maxS);
  const e1 = Math.exp(s1 - maxS);
  const e2 = Math.exp(s2 - maxS);
  const sum = e0 + e1 + e2;

  let homeWin = Math.max(0.1, Math.min(99.8, round1((e0 / sum) * 100)));
  let draw = Math.max(0.1, Math.min(99.8 - homeWin, round1((e1 / sum) * 100)));
  let awayWin = round1(100 - homeWin - draw);

  if (awayWin < 0.1) {
    awayWin = 0.1;
    if (homeWin >= draw) homeWin = round1(100 - draw - awayWin);
    else draw = round1(100 - homeWin - awayWin);
  }

  return { homeWin, draw, awayWin };
}

export interface CausalCalibrationResult {
  probabilities: MarketProbabilities;
  status: CalibrationStatus;
}

/**
 * Filter historical records strictly prior to `targetKickoffUtc` (< T), fit single scalar
 * market temperatures when >= 100 prior evaluated records exist, and calibrate raw market probabilities.
 */
export function calibrateMarketProbabilities(
  rawMarkets: MarketProbabilities,
  targetKickoffUtc: string,
  historicalRecords: HistoryRecord[] = []
): CausalCalibrationResult {
  const targetTimeMs = new Date(targetKickoffUtc).getTime();

  const causalSamples = !Number.isFinite(targetTimeMs)
    ? []
    : historicalRecords.filter((r) => {
        if (r.prediction.modelType === 'ABSTAIN') return false;
        const raw = r.prediction.rawProbabilities ?? r.prediction.probabilities;
        if (!raw) return false;
        if (
          !Number.isFinite(raw.homeWin) ||
          !Number.isFinite(raw.draw) ||
          !Number.isFinite(raw.awayWin) ||
          !Number.isFinite(raw.homeOrDraw) ||
          !Number.isFinite(raw.awayOrDraw) ||
          !Number.isFinite(raw.homeOrAway) ||
          !Number.isFinite(raw.over15) ||
          !Number.isFinite(raw.over25) ||
          !Number.isFinite(raw.bttsYes)
        ) {
          return false;
        }
        if (
          typeof r.actualResult?.homeGoals !== 'number' ||
          typeof r.actualResult?.awayGoals !== 'number' ||
          !Number.isFinite(r.actualResult.homeGoals) ||
          !Number.isFinite(r.actualResult.awayGoals) ||
          r.actualResult.homeGoals < 0 ||
          r.actualResult.awayGoals < 0
        ) {
          return false;
        }
        const t = new Date(r.match.utcDate).getTime();
        return Number.isFinite(t) && t < targetTimeMs;
      });

  if (causalSamples.length < MIN_CALIBRATION_SAMPLES) {
    return {
      probabilities: { ...rawMarkets },
      status: {
        applied: false,
        status: 'NOT_TRAINED',
        method: 'CAUSAL_TEMPERATURE_SCALING',
        sampleCount: causalSamples.length,
        minRequired: MIN_CALIBRATION_SAMPLES,
      },
    };
  }

  const oneXTwoSamples = causalSamples.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    return {
      pH: raw.homeWin / 100,
      pD: raw.draw / 100,
      pA: raw.awayWin / 100,
      winner: r.actualResult.winner,
    };
  });

  const dcSamples = causalSamples.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    const pick1X = raw.homeOrDraw >= raw.awayOrDraw;
    const favProb = pick1X ? raw.homeOrDraw : raw.awayOrDraw;
    const actualHit = pick1X
      ? r.actualResult.winner === 'HOME' || r.actualResult.winner === 'DRAW'
      : r.actualResult.winner === 'AWAY' || r.actualResult.winner === 'DRAW';
    return { prob01: favProb / 100, actual: actualHit };
  });

  const over15Samples = causalSamples.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    return { prob01: raw.over15 / 100, actual: r.actualResult.over15 };
  });

  const over25Samples = causalSamples.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    return { prob01: raw.over25 / 100, actual: r.actualResult.over25 };
  });

  const bttsSamples = causalSamples.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    return { prob01: raw.bttsYes / 100, actual: r.actualResult.btts };
  });

  const t1x2 = fitOneXTwoTemperature(oneXTwoSamples);
  const tDC = fitBinaryTemperature(dcSamples);
  const tOver15 = fitBinaryTemperature(over15Samples);
  const tOver25 = fitBinaryTemperature(over25Samples);
  const tBTTS = fitBinaryTemperature(bttsSamples);

  const calibrated1X2 = applyOneXTwoTempPct(
    rawMarkets.homeWin,
    rawMarkets.draw,
    rawMarkets.awayWin,
    t1x2
  );

  const homeOrDraw = applyBinaryTempPct(rawMarkets.homeOrDraw, tDC);
  const awayOrDraw = applyBinaryTempPct(rawMarkets.awayOrDraw, tDC);
  const homeOrAway = applyBinaryTempPct(rawMarkets.homeOrAway, tDC);

  const over15 = applyBinaryTempPct(rawMarkets.over15, tOver15);
  const under15 = round1(100 - over15);

  const over25 = applyBinaryTempPct(rawMarkets.over25, tOver25);
  const under25 = round1(100 - over25);

  const bttsYes = applyBinaryTempPct(rawMarkets.bttsYes, tBTTS);
  const bttsNo = round1(100 - bttsYes);

  return {
    probabilities: {
      ...rawMarkets,
      homeWin: calibrated1X2.homeWin,
      draw: calibrated1X2.draw,
      awayWin: calibrated1X2.awayWin,
      homeOrDraw,
      awayOrDraw,
      homeOrAway,
      over15,
      under15,
      over25,
      under25,
      bttsYes,
      bttsNo,
    },
    status: {
      applied: true,
      status: 'CALIBRATED',
      method: 'CAUSAL_TEMPERATURE_SCALING',
      sampleCount: causalSamples.length,
      minRequired: MIN_CALIBRATION_SAMPLES,
      temperatures: {
        oneXTwo: round3(t1x2),
        doubleChance: round3(tDC),
        over15: round3(tOver15),
        over25: round3(tOver25),
        btts: round3(tBTTS),
      },
    },
  };
}
