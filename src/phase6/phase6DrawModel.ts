/**
 * Phase 6 Pruned Experimental Draw Model (Step 3)
 *
 * Strictly uses ONLY:
 * 1. Logit of Poisson draw probability
 * 2. Elo symmetry: exp(-((homeElo - awayElo) / 260)^2)
 * 3. Total expected goals: lambdaHome + lambdaAway
 * 4. Causal hierarchical league draw prior as the anchor (baseLogit)
 *
 * Explicitly EXCLUDES:
 * - avgTeamDrawRateCausal (verified r = 0.045 noise)
 * - teamStrengthUncertainty
 * - Variant C / Variant D ensembles
 * - Fixed 0.285 draw threshold
 * - Target-match outcomes or post-kickoff stats
 *
 * Uses fixed pre-registered heavy ridge regularization (lambda = 45) across
 * multi-season < T priors (minimum 120 samples; never fits unstable per-season small models).
 */

import {
  PHASE6_MIN_EDGE_LOGLOSS_DELTA,
  Phase6AcceptanceGateVerdict,
  Phase6CrossSeasonProjection,
  Phase6DrawCandidateOutput,
} from './phase6Types';

export interface Phase6DrawHistorySample {
  timestampMs: number;
  leagueDrawPrior01: number;
  poissonDrawProb01: number;
  eloSymmetry: number;
  totalExpectedGoals: number;
  isDraw: boolean;
}

const EPS = 1e-6;
export const DRAW_PRUNED_MIN_TRAIN_SAMPLES = 120;
export const DRAW_PRUNED_RIDGE_W = 45.0;
export const DRAW_PRUNED_RIDGE_B = 30.0;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.25;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function logit(p: number): number {
  const c = clamp01(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z > 30) return 1 - EPS;
  if (z < -30) return EPS;
  return 1 / (1 + Math.exp(-z));
}

export function computeEloSymmetry(homeElo: number, awayElo: number): number {
  const diff = homeElo - awayElo;
  return Math.round(Math.exp(-Math.pow(diff / 260, 2)) * 10000) / 10000;
}

interface FittedPrunedDrawWeights {
  b0: number;
  w: [number, number, number];
  means: [number, number, number];
  stds: [number, number, number];
}

function fitPrunedRidgeDrawModel(rows: Phase6DrawHistorySample[]): FittedPrunedDrawWeights {
  const feats: Array<[number, number, number]> = rows.map((r) => [
    logit(r.poissonDrawProb01),
    r.eloSymmetry,
    r.totalExpectedGoals,
  ]);

  const means: [number, number, number] = [0, 0, 0];
  const stds: [number, number, number] = [1, 1, 1];
  const n = feats.length;

  for (let d = 0; d < 3; d++) {
    means[d] = feats.reduce((s, f) => s + f[d], 0) / n;
    const variance = feats.reduce((s, f) => s + (f[d] - means[d]) ** 2, 0) / n;
    stds[d] = Math.max(1e-3, Math.sqrt(variance));
  }

  let b0 = 0;
  const w: [number, number, number] = [0, 0, 0];
  const lr = 0.10;

  for (let iter = 0; iter < 60; iter++) {
    let gB = (DRAW_PRUNED_RIDGE_B * b0) / n;
    const gW: [number, number, number] = [
      (DRAW_PRUNED_RIDGE_W * w[0]) / n,
      (DRAW_PRUNED_RIDGE_W * w[1]) / n,
      (DRAW_PRUNED_RIDGE_W * w[2]) / n,
    ];

    for (let i = 0; i < n; i++) {
      const f = feats[i];
      const base = logit(rows[i].leagueDrawPrior01);
      const sx0 = Math.max(-3, Math.min(3, (f[0] - means[0]) / stds[0]));
      const sx1 = Math.max(-3, Math.min(3, (f[1] - means[1]) / stds[1]));
      const sx2 = Math.max(-3, Math.min(3, (f[2] - means[2]) / stds[2]));
      const p = sigmoid(base + b0 + w[0] * sx0 + w[1] * sx1 + w[2] * sx2);
      const err = p - (rows[i].isDraw ? 1 : 0);
      gB += err / n;
      gW[0] += (err * sx0) / n;
      gW[1] += (err * sx1) / n;
      gW[2] += (err * sx2) / n;
    }

    const step = lr / (1 + iter * 0.04);
    b0 = Math.max(-0.35, Math.min(0.35, b0 - step * gB));
    for (let d = 0; d < 3; d++) {
      w[d] = Math.max(-0.45, Math.min(0.45, w[d] - step * gW[d]));
    }
  }

  return { b0, w, means, stds };
}

function predictWithPrunedWeights(
  weights: FittedPrunedDrawWeights,
  leagueDrawPrior01: number,
  poissonDrawProb01: number,
  eloSymmetry: number,
  totalExpectedGoals: number
): number {
  const f: [number, number, number] = [
    logit(poissonDrawProb01),
    eloSymmetry,
    totalExpectedGoals,
  ];
  const sx0 = Math.max(-3, Math.min(3, (f[0] - weights.means[0]) / weights.stds[0]));
  const sx1 = Math.max(-3, Math.min(3, (f[1] - weights.means[1]) / weights.stds[1]));
  const sx2 = Math.max(-3, Math.min(3, (f[2] - weights.means[2]) / weights.stds[2]));
  const z =
    logit(leagueDrawPrior01) +
    weights.b0 +
    weights.w[0] * sx0 +
    weights.w[1] * sx1 +
    weights.w[2] * sx2;
  return clamp01(sigmoid(z));
}

/**
 * Evaluate the Phase 6 pruned draw model strictly from < T history.
 * Notice: when history spans batches, callers may cache fitted weights per timestamp batch for speed.
 */
export class Phase6PrunedDrawTracker {
  private history: Phase6DrawHistorySample[] = [];
  private cachedAtTimestampMs: number | null = null;
  private cachedWeights: FittedPrunedDrawWeights | null = null;
  private cachedSampleCount = 0;

  clear(): void {
    this.history = [];
    this.cachedAtTimestampMs = null;
    this.cachedWeights = null;
    this.cachedSampleCount = 0;
  }

  evaluateMatch(projection: Phase6CrossSeasonProjection): Phase6DrawCandidateOutput {
    const leagueDrawPrior01 = clamp01(projection.competitionPriors.leagueDrawRate);
    const poissonDrawProb01 = clamp01(projection.poissonDc1X2.draw01);
    const eloSymmetry = computeEloSymmetry(projection.homeEloCausal, projection.awayEloCausal);
    const totalExpectedGoals = Math.round((projection.lambdaHome + projection.lambdaAway) * 1000) / 1000;

    if (this.cachedAtTimestampMs !== projection.timestampMs) {
      const priorRows = this.history.filter((h) => h.timestampMs < projection.timestampMs);
      this.cachedSampleCount = priorRows.length;
      if (priorRows.length >= DRAW_PRUNED_MIN_TRAIN_SAMPLES) {
        this.cachedWeights = fitPrunedRidgeDrawModel(priorRows);
      } else {
        this.cachedWeights = null;
      }
      this.cachedAtTimestampMs = projection.timestampMs;
    }

    let prunedModelProb01: number;
    let notes: string;
    if (this.cachedWeights) {
      prunedModelProb01 = predictWithPrunedWeights(
        this.cachedWeights,
        leagueDrawPrior01,
        poissonDrawProb01,
        eloSymmetry,
        totalExpectedGoals
      );
      notes = `Pruned 3-feature ridge Draw model (reg=${DRAW_PRUNED_RIDGE_W}, n=${this.cachedSampleCount} < T).`;
    } else {
      // Below multi-season 120-sample warmup threshold: conservative structural shrink toward league draw prior
      prunedModelProb01 = clamp01(0.2 * poissonDrawProb01 + 0.8 * leagueDrawPrior01);
      notes = `Warmup shrinkage 0.20*Poisson + 0.80*LeaguePrior (${this.cachedSampleCount}/${DRAW_PRUNED_MIN_TRAIN_SAMPLES} priors).`;
    }

    return {
      leagueDrawPrior01,
      poissonDrawProb01,
      eloSymmetry,
      totalExpectedGoals,
      prunedModelProb01,
      prunedLearnerActive: this.cachedWeights !== null,
      prunedSamplesUsed: this.cachedSampleCount,
      recommendedStatus: 'PREDICT',
      notes,
    };
  }

  commitBatch(records: Phase6DrawHistorySample[]): void {
    for (const r of records) {
      this.history.push(r);
    }
    this.cachedAtTimestampMs = null;
  }
}

export function evaluateDrawAcceptanceGate(params: {
  combinedEvalFixtureCount: number;
  priorLogLoss: number | null;
  candidateLogLoss: number | null;
}): Phase6AcceptanceGateVerdict {
  const { combinedEvalFixtureCount, priorLogLoss, candidateLogLoss } = params;
  const delta =
    priorLogLoss !== null && candidateLogLoss !== null
      ? Math.round((candidateLogLoss - priorLogLoss) * 100000) / 100000
      : null;
  const passed = delta !== null && delta <= -PHASE6_MIN_EDGE_LOGLOSS_DELTA;
  return {
    market: 'DRAW',
    bestCandidateName: 'phase6Pruned3FeatureDraw',
    combinedEvalFixtureCount,
    priorLogLoss,
    candidateLogLoss,
    deltaLogLoss: delta,
    requiredDelta: -PHASE6_MIN_EDGE_LOGLOSS_DELTA,
    passed,
    assignedStatus: passed ? 'PREDICT' : 'INFORMATIONAL_PRIOR_ONLY',
    rationale: passed
      ? `Passed pre-registered gate: delta LogLoss=${delta} <= -${PHASE6_MIN_EDGE_LOGLOSS_DELTA} over causal league draw prior.`
      : `Failed pre-registered gate: delta LogLoss=${delta ?? 'N/A'} did not improve by at least ${PHASE6_MIN_EDGE_LOGLOSS_DELTA}; downgraded to INFORMATIONAL_PRIOR_ONLY.`,
  };
}
