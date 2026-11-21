import { HistoryRecord } from '../types/football';
import { DrawExperimentResult } from './phase4Types';

export const DRAW_SIGNAL_THRESHOLD = 0.285;
export const MIN_DRAW_CAUSAL_SAMPLES = 80;

function clamp01(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

function logit(p: number): number {
  const c = clamp01(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export interface DrawFeatureVector {
  rawDrawProb01: number;
  parityScore: number; // [0..1]
  lowScoringIndex: number; // [0..1]
  totalLambdaCentered: number;
}

export function extractDrawFeatures(
  rawDrawProbPct: number,
  lambdaH: number,
  lambdaA: number,
  homeElo: number | null,
  awayElo: number | null
): DrawFeatureVector {
  const rawDrawProb01 = clamp01(rawDrawProbPct / 100);

  let parityScore: number;
  if (typeof homeElo === 'number' && typeof awayElo === 'number' && Number.isFinite(homeElo) && Number.isFinite(awayElo)) {
    const eloDiff = homeElo + 55 - awayElo;
    parityScore = Math.exp(-Math.pow(eloDiff / 320, 2));
  } else {
    parityScore = Math.exp((-2.2 * Math.abs(lambdaH - lambdaA)) / Math.max(0.6, lambdaH + lambdaA));
  }

  const totalLambda = lambdaH + lambdaA;
  const lowScoringIndex = Math.exp(-0.45 * totalLambda);
  const totalLambdaCentered = (totalLambda - 2.65) * 0.25;

  return {
    rawDrawProb01,
    parityScore,
    lowScoringIndex,
    totalLambdaCentered,
  };
}

/**
 * Strictly causal (< targetKickoffUtc) L2-regularized Draw log-odds residual experiment.
 * - Zero hardcoded draw inflation: weights start at [0, 0, 0] and only adapt
 *   when >= MIN_DRAW_CAUSAL_SAMPLES finished prior fixtures precede target kickoff.
 */
export function evaluateDrawExperiment(
  rawDrawProbPct: number,
  lambdaH: number,
  lambdaA: number,
  homeElo: number | null,
  awayElo: number | null,
  targetKickoffUtc: string,
  causalHistory: HistoryRecord[] = []
): DrawExperimentResult {
  const targetMs = new Date(targetKickoffUtc).getTime();
  const feats = extractDrawFeatures(rawDrawProbPct, lambdaH, lambdaA, homeElo, awayElo);

  const validPriors = !Number.isFinite(targetMs)
    ? []
    : causalHistory.filter((r) => {
        if (r.prediction.modelType === 'ABSTAIN' || !r.prediction.probabilities) return false;
        const t = new Date(r.match.utcDate).getTime();
        return Number.isFinite(t) && t < targetMs;
      });

  if (validPriors.length < MIN_DRAW_CAUSAL_SAMPLES) {
    const probPct = Math.round(feats.rawDrawProb01 * 1000) / 10;
    return {
      drawProb: probPct,
      rawDixonColesDrawProb: Math.round(rawDrawProbPct * 10) / 10,
      parityScore: Math.round(feats.parityScore * 1000) / 1000,
      lowScoringIndex: Math.round(feats.lowScoringIndex * 1000) / 1000,
      drawSignal: feats.rawDrawProb01 >= DRAW_SIGNAL_THRESHOLD,
      drawThreshold: DRAW_SIGNAL_THRESHOLD,
      causalAdjustmentApplied: false,
      causalSamplesUsed: validPriors.length,
    };
  }

  // Fit tiny L2-regularized residual adjustment (w0=bias, w1=parity, w2=lowScoring) strictly on validPriors (< T)
  let w0 = 0;
  let w1 = 0;
  let w2 = 0;
  const reg = 30.0;
  const lr = 0.08;
  const n = validPriors.length;

  const samples = validPriors.map((r) => {
    const raw = (r.prediction.rawProbabilities ?? r.prediction.probabilities)!;
    const pD = clamp01(raw.draw / 100);
    const lH = r.prediction.expectedScore?.home ?? 1.35;
    const lA = r.prediction.expectedScore?.away ?? 1.15;
    const f = extractDrawFeatures(
      pD * 100,
      lH,
      lA,
      r.match.homeTeam.eloRating,
      r.match.awayTeam.eloRating
    );
    return {
      baseLogit: logit(f.rawDrawProb01),
      x1: f.parityScore - 0.72,
      x2: f.lowScoringIndex - 0.31,
      y: r.actualResult.winner === 'DRAW' ? 1 : 0,
    };
  });

  for (let iter = 0; iter < 15; iter++) {
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    for (const s of samples) {
      const pred = sigmoid(s.baseLogit + w0 + w1 * s.x1 + w2 * s.x2);
      const err = pred - s.y;
      g0 += err;
      g1 += err * s.x1;
      g2 += err * s.x2;
    }
    w0 = Math.max(-0.25, Math.min(0.25, w0 - lr * (g0 / n + (reg / n) * w0)));
    w1 = Math.max(-0.35, Math.min(0.35, w1 - lr * (g1 / n + (reg / n) * w1)));
    w2 = Math.max(-0.35, Math.min(0.35, w2 - lr * (g2 / n + (reg / n) * w2)));
  }

  const adjustedProb01 = sigmoid(
    logit(feats.rawDrawProb01) +
      w0 +
      w1 * (feats.parityScore - 0.72) +
      w2 * (feats.lowScoringIndex - 0.31)
  );
  const drawProbPct = Math.max(5.0, Math.min(48.0, Math.round(adjustedProb01 * 1000) / 10));

  return {
    drawProb: drawProbPct,
    rawDixonColesDrawProb: Math.round(rawDrawProbPct * 10) / 10,
    parityScore: Math.round(feats.parityScore * 1000) / 1000,
    lowScoringIndex: Math.round(feats.lowScoringIndex * 1000) / 1000,
    drawSignal: adjustedProb01 >= DRAW_SIGNAL_THRESHOLD,
    drawThreshold: DRAW_SIGNAL_THRESHOLD,
    causalAdjustmentApplied: true,
    causalSamplesUsed: validPriors.length,
  };
}
