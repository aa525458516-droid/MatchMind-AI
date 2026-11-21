import { Match, MatchStatistics } from '../types/football';
import { BinaryCalibSample } from '../phase5/phase5Calibration';
import { evaluatePhase5DrawModel, Phase5DrawHistoryEntry } from '../phase5/phase5DrawModel';
import { Phase5CausalPriors } from '../phase5/phase5Types';
import { calibratePhase5_1Binary, P51_MIN_TEMP_SAMPLES } from './phase5_1Calibration';
import {
  DrawDecisionRule,
  DrawThresholdDecision,
  DrawVariantKey,
  DrawVariantOutput,
  Phase5_1DrawSignalFeatures,
} from './phase5_1Types';

export const MIN_VARIANT_B_LEARN_SAMPLES = 50;
export const MIN_VARIANT_C_SYMMETRY_SAMPLES = 60;
export const MIN_VARIANT_D_ENSEMBLE_SAMPLES = 80;
export const MIN_CAUSAL_THRESHOLD_SAMPLES = 80;
export const FIXED_DRAW_THRESHOLD = 0.285;

const EPS = 1e-6;

export interface Phase5_1DrawHistoryRecord {
  timestampMs: number;
  features: Phase5_1DrawSignalFeatures;
  probA01: number | null;
  probB01: number | null;
  probC01: number | null;
  probEnsemble01: number | null;
  phase5HistoryEntry: Phase5DrawHistoryEntry;
  isDraw: boolean;
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.26;
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

function binaryLogLoss(rows: Array<{ p: number; y: boolean }>): number {
  if (rows.length === 0) return Infinity;
  let sum = 0;
  for (const r of rows) {
    const p = clamp01(r.p);
    sum += r.y ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / rows.length;
}

/**
 * Variant B: Poisson/DC Draw Probability + Causal League Prior.
 * Combines Poisson-DC draw probability with causal empirical league draw rate prior
 * using uncertainty shrinkage (< MIN_VARIANT_B_LEARN_SAMPLES) and causally learned blend weight (>= 50 priors).
 */
function evaluateVariantB_PoissonPrior(
  features: Phase5_1DrawSignalFeatures,
  targetUtc: string,
  priorHistory: Phase5_1DrawHistoryRecord[]
): DrawVariantOutput {
  if (!features.valid || features.poissonDrawProb01 === null || features.historicalLeagueDrawRate01 === null) {
    return {
      variant: 'B_POISSON_PRIOR',
      status: 'ABSTAIN',
      rawProb01: null,
      finalProb01: null,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: 0,
      reason: 'Missing pre-match Poisson or league prior inputs.',
    };
  }

  const pPois = clamp01(features.poissonDrawProb01);
  const pPrior = clamp01(features.historicalLeagueDrawRate01);
  const unc = features.teamStrengthUncertainty ?? 0.25;
  const fallbackPriorW = unc / (unc + 0.55);

  const validPriors = priorHistory.filter(
    (h) =>
      h.features.valid &&
      h.features.poissonDrawProb01 !== null &&
      h.features.historicalLeagueDrawRate01 !== null
  );

  if (validPriors.length < MIN_VARIANT_B_LEARN_SAMPLES) {
    const raw = clamp01((1 - fallbackPriorW) * pPois + fallbackPriorW * pPrior);
    return {
      variant: 'B_POISSON_PRIOR',
      status: 'PREDICT',
      rawProb01: raw,
      finalProb01: raw,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: validPriors.length,
      learnedWeights: { priorWeightB: Math.round(fallbackPriorW * 1000) / 1000 },
      reason: `Analytic Poisson+Prior blend (causal learner NOT_TRAINED: ${validPriors.length}/${MIN_VARIANT_B_LEARN_SAMPLES}).`,
    };
  }

  // Learn optimal causal prior shrinkage weight wPrior in [0.05, 0.85] minimizing regularized log loss < T
  let bestW = fallbackPriorW;
  let bestLoss = Infinity;
  for (let w = 0.05; w <= 0.851; w += 0.05) {
    const loss =
      binaryLogLoss(
        validPriors.map((r) => ({
          p: (1 - w) * r.features.poissonDrawProb01! + w * r.features.historicalLeagueDrawRate01!,
          y: r.isDraw,
        }))
      ) +
      0.002 * (w - 0.35) * (w - 0.35);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestW = Math.round(w * 1000) / 1000;
    }
  }

  const rawBlend = clamp01((1 - bestW) * pPois + bestW * pPrior);

  // Optional causal binary calibration once >= 100 prior observations exist
  const binSamples: BinaryCalibSample[] = validPriors
    .filter((h) => h.probB01 !== null)
    .map((h) => ({
      timestampMs: h.timestampMs,
      rawProb01: h.probB01!,
      actual: h.isDraw,
    }));
  const cal = calibratePhase5_1Binary(rawBlend, targetUtc, binSamples);

  return {
    variant: 'B_POISSON_PRIOR',
    status: 'PREDICT',
    rawProb01: rawBlend,
    finalProb01: cal.status === 'CALIBRATED' ? cal.prob01 : rawBlend,
    calibrationStatus: cal.status,
    samplesUsed: validPriors.length,
    learnedWeights: { priorWeightB: bestW },
    reason:
      cal.status === 'CALIBRATED'
        ? `Poisson+Prior (causal wPrior=${bestW.toFixed(2)}) + ${cal.method} calibration (${cal.sampleCount} priors).`
        : `Poisson+Prior (causal wPrior=${bestW.toFixed(2)}; binary cal NOT_TRAINED ${cal.sampleCount}/${P51_MIN_TEMP_SAMPLES}).`,
  };
}

/**
 * Variant C: Strength-Symmetry Draw Model.
 * Strictly requires >= MIN_VARIANT_C_SYMMETRY_SAMPLES (60) prior matches (< T); otherwise returns NOT_TRAINED.
 */
function evaluateVariantC_StrengthSymmetry(
  features: Phase5_1DrawSignalFeatures,
  targetUtc: string,
  priorHistory: Phase5_1DrawHistoryRecord[]
): DrawVariantOutput {
  if (!features.valid || features.historicalLeagueDrawRate01 === null) {
    return {
      variant: 'C_STRENGTH_SYMMETRY',
      status: 'ABSTAIN',
      rawProb01: null,
      finalProb01: null,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: 0,
      reason: 'Missing pre-match draw symmetry features.',
    };
  }

  const validPriors = priorHistory.filter(
    (h) =>
      h.features.valid &&
      h.features.absExpectedGoalDiff !== null &&
      h.features.totalExpectedGoals !== null &&
      h.features.venueNormalizedStrengthDiff !== null &&
      h.features.teamStrengthUncertainty !== null &&
      h.features.historicalLeagueDrawRate01 !== null
  );

  if (validPriors.length < MIN_VARIANT_C_SYMMETRY_SAMPLES) {
    return {
      variant: 'C_STRENGTH_SYMMETRY',
      status: 'NOT_TRAINED',
      rawProb01: null,
      finalProb01: null,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: validPriors.length,
      reason: `Strength-symmetry draw model NOT_TRAINED (${validPriors.length}/${MIN_VARIANT_C_SYMMETRY_SAMPLES} causal priors).`,
    };
  }

  // Extract standardized non-redundant symmetry feature vector strictly from < T priors
  const extractVec = (f: Phase5_1DrawSignalFeatures): [number, number, number, number, number, number] => [
    f.absExpectedGoalDiff ?? 0.4,
    f.totalExpectedGoals ?? 2.6,
    f.venueNormalizedStrengthDiff ?? 0.35,
    f.eloSymmetry ?? f.shrunkAttackDefenseSymmetry ?? 0.6,
    f.teamStrengthUncertainty ?? 0.25,
    ((f.homeDrawRateCausal ?? 0.26) + (f.awayDrawRateCausal ?? 0.26)) / 2,
  ];

  const trainVecs = validPriors.map((r) => ({
    vec: extractVec(r.features),
    baseLogit: logit(r.features.historicalLeagueDrawRate01!),
    y: r.isDraw ? 1 : 0,
  }));

  const dims = 6;
  const means = new Array<number>(dims).fill(0);
  const stds = new Array<number>(dims).fill(1);
  for (let d = 0; d < dims; d++) {
    means[d] = trainVecs.reduce((a, r) => a + r.vec[d], 0) / trainVecs.length;
    const v = trainVecs.reduce((a, r) => a + (r.vec[d] - means[d]) ** 2, 0) / trainVecs.length;
    stds[d] = Math.max(1e-3, Math.sqrt(v));
  }

  const fitOn = (sub: typeof trainVecs) => {
    let b0 = 0;
    const w = new Array<number>(dims).fill(0);
    const regB = 6.0;
    const regW = 12.0;
    const lr = 0.14;
    const n = sub.length;

    for (let it = 0; it < 65; it++) {
      let gB = (regB * b0) / n;
      const gW = w.map((wj) => (regW * wj) / n);

      for (const row of sub) {
        let z = row.baseLogit + b0;
        const stdX = new Array<number>(dims);
        for (let d = 0; d < dims; d++) {
          stdX[d] = Math.max(-3.0, Math.min(3.0, (row.vec[d] - means[d]) / stds[d]));
          z += w[d] * stdX[d];
        }
        const err = sigmoid(z) - row.y;
        gB += err / n;
        for (let d = 0; d < dims; d++) gW[d] += (err * stdX[d]) / n;
      }

      const step = lr / (1 + it * 0.04);
      b0 = Math.max(-0.7, Math.min(0.7, b0 - step * gB));
      for (let d = 0; d < dims; d++) {
        w[d] = Math.max(-0.9, Math.min(0.9, w[d] - step * gW[d]));
      }
    }

    return (f: Phase5_1DrawSignalFeatures): number => {
      const vec = extractVec(f);
      let z = logit(f.historicalLeagueDrawRate01 ?? 0.26) + b0;
      for (let d = 0; d < dims; d++) {
        const stdX = Math.max(-3.0, Math.min(3.0, (vec[d] - means[d]) / stds[d]));
        z += w[d] * stdX;
      }
      return clamp01(sigmoid(z));
    };
  };

  // Internal causal CV gate vs league prior (< T)
  const split = Math.floor(trainVecs.length * 0.65);
  const trSub = trainVecs.slice(0, split);
  const valSub = trainVecs.slice(split);
  let predRaw: number;
  let useSymmetryModel = true;

  if (trSub.length >= 35 && valSub.length >= 20) {
    const fnFold = fitOn(trSub);
    const valFeatures = validPriors.slice(split);
    const baseLoss = binaryLogLoss(
      valFeatures.map((r) => ({ p: r.features.historicalLeagueDrawRate01!, y: r.isDraw }))
    );
    const symLoss = binaryLogLoss(
      valFeatures.map((r) => ({ p: fnFold(r.features), y: r.isDraw }))
    );
    if (symLoss > baseLoss + 0.002) {
      useSymmetryModel = false;
    }
  }

  if (useSymmetryModel) {
    predRaw = fitOn(trainVecs)(features);
  } else {
    // Shrink smoothly toward league draw prior if internal causal CV flagged high noise
    const fullFn = fitOn(trainVecs);
    predRaw = clamp01(0.45 * fullFn(features) + 0.55 * features.historicalLeagueDrawRate01);
  }

  const binSamples: BinaryCalibSample[] = validPriors
    .filter((h) => h.probC01 !== null)
    .map((h) => ({
      timestampMs: h.timestampMs,
      rawProb01: h.probC01!,
      actual: h.isDraw,
    }));
  const cal = calibratePhase5_1Binary(predRaw, targetUtc, binSamples);

  return {
    variant: 'C_STRENGTH_SYMMETRY',
    status: 'PREDICT',
    rawProb01: predRaw,
    finalProb01: cal.status === 'CALIBRATED' ? cal.prob01 : predRaw,
    calibrationStatus: cal.status,
    samplesUsed: validPriors.length,
    reason: `L2 Strength-Symmetry causal logistic (${validPriors.length} priors${useSymmetryModel ? '' : ', high-noise damped'}).`,
  };
}

/**
 * Variant D: Causal Ensemble of Variants A / B / C.
 * Learns simplex weights (wA, wB, wC) strictly from prior completed matches (< T) once >= 80 priors
 * exist where A, B, and C all produced valid causal predictions. Otherwise returns NOT_TRAINED.
 */
function evaluateVariantD_CausalEnsemble(
  outA: DrawVariantOutput,
  outB: DrawVariantOutput,
  outC: DrawVariantOutput,
  targetUtc: string,
  priorHistory: Phase5_1DrawHistoryRecord[]
): DrawVariantOutput {
  if (
    outA.status === 'ABSTAIN' ||
    outB.status === 'ABSTAIN' ||
    outA.finalProb01 === null ||
    outB.finalProb01 === null
  ) {
    return {
      variant: 'D_CAUSAL_ENSEMBLE',
      status: 'ABSTAIN',
      rawProb01: null,
      finalProb01: null,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: 0,
      reason: 'Abstained: insufficient pre-match draw components.',
    };
  }

  const eligible = priorHistory.filter(
    (h) => h.probA01 !== null && h.probB01 !== null && h.probC01 !== null
  );

  if (eligible.length < MIN_VARIANT_D_ENSEMBLE_SAMPLES || outC.finalProb01 === null) {
    return {
      variant: 'D_CAUSAL_ENSEMBLE',
      status: 'NOT_TRAINED',
      rawProb01: null,
      finalProb01: null,
      calibrationStatus: 'NOT_TRAINED',
      samplesUsed: eligible.length,
      reason: `Causal draw ensemble NOT_TRAINED (${eligible.length}/${MIN_VARIANT_D_ENSEMBLE_SAMPLES} complete A/B/C priors).`,
    };
  }

  // Simplex grid + Dirichlet regularization toward uniform [1/3, 1/3, 1/3] strictly on < T priors
  let bestW: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
  let bestObj = Infinity;

  for (let wA = 0; wA <= 1.001; wA += 0.1) {
    for (let wB = 0; wB <= 1.001 - wA; wB += 0.1) {
      const wC = Math.max(0, 1 - wA - wB);
      let loss = 0;
      for (const h of eligible) {
        const p = clamp01(wA * h.probA01! + wB * h.probB01! + wC * h.probC01!);
        loss += h.isDraw ? -Math.log(p) : -Math.log(1 - p);
      }
      const reg =
        0.002 * ((wA - 1 / 3) ** 2 + (wB - 1 / 3) ** 2 + (wC - 1 / 3) ** 2);
      const obj = loss / eligible.length + reg;
      if (obj < bestObj) {
        bestObj = obj;
        bestW = [
          Math.round(wA * 100) / 100,
          Math.round(wB * 100) / 100,
          Math.round(wC * 100) / 100,
        ];
      }
    }
  }

  const rawEns = clamp01(
    bestW[0] * outA.finalProb01 +
      bestW[1] * outB.finalProb01 +
      bestW[2] * outC.finalProb01
  );

  const binSamples: BinaryCalibSample[] = priorHistory
    .filter((h) => h.probEnsemble01 !== null)
    .map((h) => ({
      timestampMs: h.timestampMs,
      rawProb01: h.probEnsemble01!,
      actual: h.isDraw,
    }));
  const cal = calibratePhase5_1Binary(rawEns, targetUtc, binSamples);

  return {
    variant: 'D_CAUSAL_ENSEMBLE',
    status: 'PREDICT',
    rawProb01: rawEns,
    finalProb01: cal.status === 'CALIBRATED' ? cal.prob01 : rawEns,
    calibrationStatus: cal.status,
    samplesUsed: eligible.length,
    learnedWeights: {
      wA: bestW[0],
      wB: bestW[1],
      wC: bestW[2],
    },
    reason: `Causal A/B/C weights (${bestW[0].toFixed(2)}/${bestW[1].toFixed(2)}/${bestW[2].toFixed(2)}) learned on ${eligible.length} priors.`,
  };
}

/**
 * Evaluate Draw Decision Thresholds strictly causally (< T) and compare:
 * - ARGMAX
 * - FIXED_THRESHOLD (0.285)
 * - CAUSAL_LEARNED_THRESHOLD (learned & frozen strictly on < T prior matches, NOT_TRAINED below 80 priors)
 */
export function evaluateDrawThresholds(params: {
  p1x2Home01: number | null;
  p1x2Draw01: number | null;
  p1x2Away01: number | null;
  selectedDrawProb01: number | null;
  priorRowsForThreshold: Array<{ prob01: number; isDraw: boolean }>;
}): Record<DrawDecisionRule, DrawThresholdDecision> {
  const { p1x2Home01, p1x2Draw01, p1x2Away01, selectedDrawProb01, priorRowsForThreshold } = params;

  const argmaxTriggered =
    p1x2Home01 !== null &&
    p1x2Draw01 !== null &&
    p1x2Away01 !== null &&
    p1x2Draw01 > p1x2Home01 &&
    p1x2Draw01 > p1x2Away01;

  const fixedTriggered = selectedDrawProb01 !== null && selectedDrawProb01 >= FIXED_DRAW_THRESHOLD;

  let causalDecision: DrawThresholdDecision;
  if (selectedDrawProb01 === null) {
    causalDecision = {
      rule: 'CAUSAL_LEARNED_THRESHOLD',
      status: 'ABSTAIN',
      threshold01: null,
      triggered: false,
      trainingSamples: priorRowsForThreshold.length,
    };
  } else if (priorRowsForThreshold.length < MIN_CAUSAL_THRESHOLD_SAMPLES) {
    causalDecision = {
      rule: 'CAUSAL_LEARNED_THRESHOLD',
      status: 'NOT_TRAINED',
      threshold01: null,
      triggered: false,
      trainingSamples: priorRowsForThreshold.length,
    };
  } else {
    const n = priorRowsForThreshold.length;
    const priorDrawRate = priorRowsForThreshold.filter((r) => r.isDraw).length / n;
    let bestT = FIXED_DRAW_THRESHOLD;
    let bestScore = -Infinity;

    for (let t = 0.22; t <= 0.365; t += 0.005) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let calls = 0;
      for (const r of priorRowsForThreshold) {
        const hit = r.prob01 >= t;
        if (hit) calls++;
        if (hit && r.isDraw) tp++;
        else if (hit && !r.isDraw) fp++;
        else if (!hit && r.isDraw) fn++;
      }
      const callRate = calls / n;
      if (callRate < 0.08 || callRate > 0.45) continue;

      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      if (precision < Math.max(0.24, priorDrawRate * 0.9)) continue;

      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      // Penalize excessive deviation from empirical base draw rate + slight threshold regularization toward 0.285
      const score =
        f1 - 0.08 * Math.abs(callRate - priorDrawRate) - 0.015 * Math.abs(t - FIXED_DRAW_THRESHOLD);
      if (score > bestScore) {
        bestScore = score;
        bestT = Math.round(t * 1000) / 1000;
      }
    }

    causalDecision = {
      rule: 'CAUSAL_LEARNED_THRESHOLD',
      status: 'PREDICT',
      threshold01: bestT,
      triggered: selectedDrawProb01 >= bestT,
      trainingSamples: n,
    };
  }

  return {
    ARGMAX: {
      rule: 'ARGMAX',
      status: p1x2Draw01 !== null ? 'PREDICT' : 'ABSTAIN',
      threshold01: null,
      triggered: argmaxTriggered,
      trainingSamples: 0,
    },
    FIXED_THRESHOLD: {
      rule: 'FIXED_THRESHOLD',
      status: selectedDrawProb01 !== null ? 'PREDICT' : 'ABSTAIN',
      threshold01: FIXED_DRAW_THRESHOLD,
      triggered: fixedTriggered,
      trainingSamples: 0,
    },
    CAUSAL_LEARNED_THRESHOLD: causalDecision,
  };
}

/**
 * Evaluate all Phase 5.1 Draw Variants (A, B, C, D) strictly causally (< T).
 */
export function evaluatePhase5_1DrawVariants(params: {
  match: Match;
  stats: MatchStatistics;
  dixonColesMixDrawProbPct: number | null;
  lambdaHome: number | null;
  lambdaAway: number | null;
  priors: Phase5CausalPriors;
  features: Phase5_1DrawSignalFeatures;
  drawHistory: Phase5_1DrawHistoryRecord[];
  drawUncertainty: number | null;
}): {
  variants: Record<DrawVariantKey, DrawVariantOutput>;
  selectedVariant: DrawVariantKey;
} {
  const {
    match,
    stats,
    dixonColesMixDrawProbPct,
    lambdaHome,
    lambdaAway,
    priors,
    features,
    drawHistory,
    drawUncertainty,
  } = params;

  const targetMs = new Date(match.utcDate).getTime();
  const causalPriors = Number.isFinite(targetMs)
    ? drawHistory
        .filter((d) => Number.isFinite(d.timestampMs) && d.timestampMs < targetMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  // Variant A: Current Phase 5 draw model (untouched Phase 5 logic)
  const p5Draw = evaluatePhase5DrawModel({
    match,
    stats,
    dixonColesDrawProbPct: dixonColesMixDrawProbPct,
    lambdaHome,
    lambdaAway,
    priors,
    drawHistory: causalPriors.map((c) => c.phase5HistoryEntry),
    drawUncertainty,
  });

  const variantA: DrawVariantOutput = {
    variant: 'A_PHASE5',
    status: p5Draw.finalDrawProbPct !== null ? 'PREDICT' : 'ABSTAIN',
    rawProb01: p5Draw.shrunkDrawProbPct !== null ? clamp01(p5Draw.shrunkDrawProbPct / 100) : null,
    finalProb01: p5Draw.finalDrawProbPct !== null ? clamp01(p5Draw.finalDrawProbPct / 100) : null,
    calibrationStatus: p5Draw.calibrationStatus,
    samplesUsed: p5Draw.causalSamplesUsed,
    reason: p5Draw.notes,
  };

  // Variant B: Poisson Draw Probability + Causal League Prior
  const variantB = evaluateVariantB_PoissonPrior(features, match.utcDate, causalPriors);

  // Variant C: Strength-Symmetry Draw Model
  const variantC = evaluateVariantC_StrengthSymmetry(features, match.utcDate, causalPriors);

  // Variant D: Causal Ensemble of A / B / C
  const variantD = evaluateVariantD_CausalEnsemble(
    variantA,
    variantB,
    variantC,
    match.utcDate,
    causalPriors
  );

  // Selected Draw variant: prefer Variant D once causally trained (>= 80 priors), else Variant B
  const selectedVariant: DrawVariantKey =
    variantD.status === 'PREDICT' && variantD.finalProb01 !== null
      ? 'D_CAUSAL_ENSEMBLE'
      : variantB.status === 'PREDICT' && variantB.finalProb01 !== null
      ? 'B_POISSON_PRIOR'
      : 'A_PHASE5';

  return {
    variants: {
      A_PHASE5: variantA,
      B_POISSON_PRIOR: variantB,
      C_STRENGTH_SYMMETRY: variantC,
      D_CAUSAL_ENSEMBLE: variantD,
    },
    selectedVariant,
  };
}
