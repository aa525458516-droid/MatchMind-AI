import { Match, MatchStatistics } from '../types/football';
import {
  BinaryCalibSample,
  calibratePhase5Binary,
} from './phase5Calibration';
import { Phase5CausalPriors, Phase5DrawResearch } from './phase5Types';

export const PHASE5_MIN_DRAW_CAUSAL_SAMPLES = 80;
const EPS = 1e-6;

export interface Phase5DrawHistoryEntry {
  timestampMs: number;
  rawDixonColesDraw01: number;
  shrunkDraw01: number;
  parityScore: number;
  lowScoringIndex: number;
  leagueDrawPrior01: number;
  isDraw: boolean;
}

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

function binaryLogLoss(samples: Array<{ p: number; y: boolean }>): number {
  if (samples.length === 0) return Infinity;
  let sum = 0;
  for (const s of samples) {
    const p = clamp01(s.p);
    sum += s.y ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / samples.length;
}

/**
 * Compute causal draw parity & low-scoring propensity strictly from pre-match estimates (< T).
 * Never inspects target match outcomes or season-end Elo ratings.
 */
export function computeDrawStructuralFeatures(
  lambdaHome: number,
  lambdaAway: number,
  eloHomeCausal: number | null,
  eloAwayCausal: number | null,
  homePlayed: number,
  awayPlayed: number
): {
  parityScore: number;
  lowScoringIndex: number;
  strengthUncertainty: number;
  eloDiffCausal: number | null;
} {
  const lambdaParity = Math.exp(-Math.abs(lambdaHome - lambdaAway) / 0.65);
  let parityScore = lambdaParity;
  let eloDiffCausal: number | null = null;

  if (
    typeof eloHomeCausal === 'number' &&
    typeof eloAwayCausal === 'number' &&
    Number.isFinite(eloHomeCausal) &&
    Number.isFinite(eloAwayCausal)
  ) {
    eloDiffCausal = Math.round(eloHomeCausal - eloAwayCausal);
    const eloSymmetry = Math.exp(-Math.pow(eloDiffCausal / 260, 2));
    parityScore = 0.55 * lambdaParity + 0.45 * eloSymmetry;
  }

  const totalLambda = Math.max(0.5, lambdaHome + lambdaAway);
  const lowScoringIndex = Math.exp(-0.55 * Math.max(0, totalLambda - 2.0));
  const minPlayed = Math.max(0, Math.min(homePlayed, awayPlayed));
  const strengthUncertainty = 1 / Math.sqrt(minPlayed + 4);

  return {
    parityScore: Math.round(parityScore * 1000) / 1000,
    lowScoringIndex: Math.round(lowScoringIndex * 1000) / 1000,
    strengthUncertainty: Math.round(strengthUncertainty * 1000) / 1000,
    eloDiffCausal,
  };
}

/**
 * Fit a heavily regularized causal logistic refinement over logit(shrunkDraw) + parity/intensity
 * strictly on prior matches (< T). Only activates if causal out-of-sample CV improves log loss.
 */
function fitCausalDrawLogisticModel(
  prior: Phase5DrawHistoryEntry[]
): ((entry: Omit<Phase5DrawHistoryEntry, 'timestampMs' | 'isDraw'>) => number) | null {
  if (prior.length < PHASE5_MIN_DRAW_CAUSAL_SAMPLES) return null;

  // Regularized toward pure identity: b = 0, wBase = 1, wParity = 0, wLow = 0, wLeague = 0
  const fitOn = (rows: Phase5DrawHistoryEntry[]) => {
    let b = 0;
    let wBase = 1.0;
    let wParity = 0.0;
    let wLow = 0.0;
    let wLeague = 0.0;

    const regBias = 20.0;
    const regSlope = 35.0;
    const lr = 0.12;
    const n = rows.length;

    for (let iter = 0; iter < 40; iter++) {
      let gB = (regBias * b) / n;
      let gBase = (regSlope * (wBase - 1.0)) / n;
      let gParity = (regSlope * wParity) / n;
      let gLow = (regSlope * wLow) / n;
      let gLeague = (regSlope * wLeague) / n;

      for (const r of rows) {
        const xBase = logit(r.shrunkDraw01);
        const xParity = r.parityScore - 0.65;
        const xLow = r.lowScoringIndex - 0.72;
        const xLeague = r.leagueDrawPrior01 - 0.26;
        const z = b + wBase * xBase + wParity * xParity + wLow * xLow + wLeague * xLeague;
        const p = sigmoid(z);
        const err = p - (r.isDraw ? 1 : 0);

        gB += err / n;
        gBase += (err * xBase) / n;
        gParity += (err * xParity) / n;
        gLow += (err * xLow) / n;
        gLeague += (err * xLeague) / n;
      }

      const step = lr / (1 + iter * 0.05);
      b = Math.max(-0.5, Math.min(0.5, b - step * gB));
      wBase = Math.max(0.5, Math.min(1.5, wBase - step * gBase));
      wParity = Math.max(-0.5, Math.min(0.6, wParity - step * gParity));
      wLow = Math.max(-0.5, Math.min(0.6, wLow - step * gLow));
      wLeague = Math.max(-0.5, Math.min(0.8, wLeague - step * gLeague));
    }

    return (e: Omit<Phase5DrawHistoryEntry, 'timestampMs' | 'isDraw'>): number => {
      const z =
        b +
        wBase * logit(e.shrunkDraw01) +
        wParity * (e.parityScore - 0.65) +
        wLow * (e.lowScoringIndex - 0.72) +
        wLeague * (e.leagueDrawPrior01 - 0.26);
      return clamp01(sigmoid(z));
    };
  };

  // Causal internal validation on last 35% of prior history
  const split = Math.floor(prior.length * 0.65);
  const train = prior.slice(0, split);
  const val = prior.slice(split);
  if (train.length >= 45 && val.length >= 20) {
    const cvFn = fitOn(train);
    const baseLoss = binaryLogLoss(val.map((v) => ({ p: v.shrunkDraw01, y: v.isDraw })));
    const modelLoss = binaryLogLoss(val.map((v) => ({ p: cvFn(v), y: v.isDraw })));
    if (modelLoss >= baseLoss - 0.0005) {
      return null; // Reject adjustment if causal validation doesn't beat shrunk prior
    }
  }

  return fitOn(prior);
}

/**
 * Evaluate Phase 5A Causal Draw Research Model.
 * Strictly zero hardcoded draw boosts and zero access to target or future outcomes.
 */
export function evaluatePhase5DrawModel(params: {
  match: Match;
  stats: MatchStatistics;
  dixonColesDrawProbPct: number | null;
  lambdaHome: number | null;
  lambdaAway: number | null;
  priors: Phase5CausalPriors;
  drawHistory: Phase5DrawHistoryEntry[];
  drawUncertainty?: number | null;
}): Phase5DrawResearch {
  const {
    match,
    stats,
    dixonColesDrawProbPct,
    lambdaHome,
    lambdaAway,
    priors,
    drawHistory,
    drawUncertainty = null,
  } = params;

  if (
    !priors.validTimestamp ||
    dixonColesDrawProbPct === null ||
    lambdaHome === null ||
    lambdaAway === null ||
    !Number.isFinite(dixonColesDrawProbPct)
  ) {
    return {
      status: 'ABSTAIN',
      rawDixonColesDrawProbPct: null,
      empiricalLeagueDrawPriorPct:
        priors.leagueDrawRate !== null ? Math.round(priors.leagueDrawRate * 1000) / 10 : null,
      shrunkDrawProbPct: null,
      logisticAdjustedDrawProbPct: null,
      calibratedDrawProbPct: null,
      finalDrawProbPct: null,
      parityScore: null,
      lowScoringIndex: null,
      strengthUncertainty: null,
      eloDiffCausal: null,
      causalAdjustmentApplied: false,
      causalSamplesUsed: 0,
      drawSignalActive: false,
      drawSignalThreshold: 0.285,
      calibrationMethod: 'RAW_IDENTITY',
      calibrationStatus: 'NOT_TRAINED',
      uncertainty: null,
      notes: 'Insufficient pre-match causal inputs for draw estimation.',
    };
  }

  const targetMs = new Date(match.utcDate).getTime();
  const causalPriorEntries = drawHistory
    .filter((d) => Number.isFinite(d.timestampMs) && d.timestampMs < targetMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const rawDc01 = clamp01(dixonColesDrawProbPct / 100);

  // Hierarchical shrinkage of league draw rate toward weak empirical prior (0.26 with K=20)
  const K_LEAGUE_DRAW = 20;
  const empiricalLeagueDrawPrior01 =
    priors.priorLeagueMatches > 0 && priors.leagueDrawRate !== null
      ? (priors.leagueDrawRate * priors.priorLeagueMatches + K_LEAGUE_DRAW * 0.26) /
        (priors.priorLeagueMatches + K_LEAGUE_DRAW)
      : 0.26;

  const homePlayed = stats.homeTeamStats.overall.matchesPlayed;
  const awayPlayed = stats.awayTeamStats.overall.matchesPlayed;
  const feat = computeDrawStructuralFeatures(
    lambdaHome,
    lambdaAway,
    priors.homeEloCausal,
    priors.awayEloCausal,
    homePlayed,
    awayPlayed
  );

  // Team-strength uncertainty shrinkage: when team samples are small/uncertain, pull toward shrunk league draw prior
  const shrinkageWeight = feat.strengthUncertainty / (feat.strengthUncertainty + 0.65);
  const shrunkDraw01 = clamp01(
    (1 - shrinkageWeight) * rawDc01 + shrinkageWeight * empiricalLeagueDrawPrior01
  );

  const logisticFn = fitCausalDrawLogisticModel(causalPriorEntries);
  const logisticDraw01 = logisticFn
    ? logisticFn({
        rawDixonColesDraw01: rawDc01,
        shrunkDraw01,
        parityScore: feat.parityScore,
        lowScoringIndex: feat.lowScoringIndex,
        leagueDrawPrior01: empiricalLeagueDrawPrior01,
      })
    : shrunkDraw01;

  // Binary calibration strictly < T
  const binSamples: BinaryCalibSample[] = causalPriorEntries.map((d) => ({
    timestampMs: d.timestampMs,
    rawProb01: d.shrunkDraw01,
    actual: d.isDraw,
  }));
  const calOut = calibratePhase5Binary(logisticDraw01, match.utcDate, binSamples);

  const final01 = calOut.status === 'CALIBRATED' ? calOut.calibratedProb01 : logisticDraw01;
  const finalPct = Math.round(final01 * 1000) / 10;

  // Dynamic causal draw signal threshold anchored slightly above league draw prior (un-tuned)
  const drawSignalThreshold = Math.round(Math.min(0.35, Math.max(0.26, empiricalLeagueDrawPrior01 + 0.03)) * 1000) / 1000;

  return {
    status: 'PREDICT',
    rawDixonColesDrawProbPct: Math.round(rawDc01 * 1000) / 10,
    empiricalLeagueDrawPriorPct: Math.round(empiricalLeagueDrawPrior01 * 1000) / 10,
    shrunkDrawProbPct: Math.round(shrunkDraw01 * 1000) / 10,
    logisticAdjustedDrawProbPct: Math.round(logisticDraw01 * 1000) / 10,
    calibratedDrawProbPct: calOut.status === 'CALIBRATED' ? Math.round(calOut.calibratedProb01 * 1000) / 10 : null,
    finalDrawProbPct: finalPct,
    parityScore: feat.parityScore,
    lowScoringIndex: feat.lowScoringIndex,
    strengthUncertainty: feat.strengthUncertainty,
    eloDiffCausal: feat.eloDiffCausal,
    causalAdjustmentApplied: logisticFn !== null,
    causalSamplesUsed: causalPriorEntries.length,
    drawSignalActive: final01 >= drawSignalThreshold,
    drawSignalThreshold,
    calibrationMethod: calOut.selectedMethod,
    calibrationStatus: calOut.status,
    uncertainty: drawUncertainty,
    notes:
      calOut.status === 'CALIBRATED'
        ? `Hierarchical draw prior (${(empiricalLeagueDrawPrior01 * 100).toFixed(1)}%) + ${calOut.selectedMethod} causal calibration (${calOut.sampleCount} priors).`
        : `Hierarchical draw prior (${(empiricalLeagueDrawPrior01 * 100).toFixed(1)}%) + uncertainty shrinkage (calibration NOT_TRAINED: ${calOut.sampleCount}/100 priors).`,
  };
}
