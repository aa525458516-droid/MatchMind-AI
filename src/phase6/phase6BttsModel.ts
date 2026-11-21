/**
 * Phase 6 Honest BTTS Experimental Model (Step 3)
 *
 * Compares non-redundant candidates strictly < T:
 * 1. Causal hierarchical league BTTS prior
 * 2. Cross-season decoupled FTS (failed-to-score) / CS (clean-sheet) model
 * 3. Lightly-shrunk Poisson-DC BTTS probability (direct from cross-season k=6 lambdas)
 *
 * Avoids Phase 5's redundant blending of models derived from identical lambdas.
 * Acceptance requirement: >= 0.005 LogLoss improvement over causal league BTTS prior;
 * otherwise marks BTTS as INFORMATIONAL_PRIOR_ONLY / ABSTAIN.
 */

import { dixonColesTau } from '../utils/poissonModel';
import {
  PHASE6_MIN_EDGE_LOGLOSS_DELTA,
  Phase6AcceptanceGateVerdict,
  Phase6BttsCandidateOutput,
  Phase6CrossSeasonProjection,
} from './phase6Types';

const EPS = 1e-6;
const FTS_CS_SHRINKAGE_K = 8;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0.02, Math.min(0.98, p));
}

function logit(p: number): number {
  const c = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z > 30) return 1 - EPS;
  if (z < -30) return EPS;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Evaluate non-redundant BTTS candidates strictly from < T hierarchical state.
 */
export function evaluatePhase6BttsMatch(
  projection: Phase6CrossSeasonProjection
): Phase6BttsCandidateOutput {
  const comp = projection.competitionPriors;
  const h = projection.homeTeamState;
  const a = projection.awayTeamState;

  const leagueBttsPrior01 = clamp01(comp.leagueBttsRate);
  const baseHomeScoreRate = clamp01(comp.leagueHomeScoredAnyRate);
  const baseAwayScoreRate = clamp01(comp.leagueAwayScoredAnyRate);

  // 1) Decoupled cross-season FTS/CS scoring & conceding tendency (independent of Poisson lambda intensity)
  // Shrink overall scoring (1 - FTS) and conceding (1 - CS) rates cleanly toward venue-specific league scoring baseline.
  const K = FTS_CS_SHRINKAGE_K;

  // Home team scoring tendency (blend overall & home-venue rate when available)
  const hOvScoredRate =
    (h.weightedPlayed - h.weightedFts + K * baseHomeScoreRate) / (h.weightedPlayed + K);
  const hVenScoredRate =
    (h.weightedHomePlayed - h.weightedHomeFts + K * baseHomeScoreRate) / (h.weightedHomePlayed + K);
  const wVenH = h.weightedHomePlayed / (h.weightedHomePlayed + K);
  const homeAttackScoreRate = wVenH * hVenScoredRate + (1 - wVenH) * hOvScoredRate;

  // Away team conceding tendency (1 - CS)
  const aOvConcedeRate =
    (a.weightedPlayed - a.weightedCs + K * baseHomeScoreRate) / (a.weightedPlayed + K);
  const aVenConcedeRate =
    (a.weightedAwayPlayed - a.weightedAwayCs + K * baseHomeScoreRate) / (a.weightedAwayPlayed + K);
  const wVenA = a.weightedAwayPlayed / (a.weightedAwayPlayed + K);
  const awayDefConcedeRate = wVenA * aVenConcedeRate + (1 - wVenA) * aOvConcedeRate;

  // Away team scoring tendency
  const aOvScoredRate =
    (a.weightedPlayed - a.weightedFts + K * baseAwayScoreRate) / (a.weightedPlayed + K);
  const aVenScoredRate =
    (a.weightedAwayPlayed - a.weightedAwayFts + K * baseAwayScoreRate) / (a.weightedAwayPlayed + K);
  const awayAttackScoreRate = wVenA * aVenScoredRate + (1 - wVenA) * aOvScoredRate;

  // Home team conceding tendency
  const hOvConcedeRate =
    (h.weightedPlayed - h.weightedCs + K * baseAwayScoreRate) / (h.weightedPlayed + K);
  const hVenConcedeRate =
    (h.weightedHomePlayed - h.weightedHomeCs + K * baseAwayScoreRate) / (h.weightedHomePlayed + K);
  const homeDefConcedeRate = wVenH * hVenConcedeRate + (1 - wVenH) * hOvConcedeRate;

  // Combine offensive scoring & defensive conceding symmetrically in logit space (balanced around league anchor)
  const homeScoringProb01 = clamp01(
    sigmoid(0.5 * logit(homeAttackScoreRate) + 0.5 * logit(awayDefConcedeRate))
  );
  const awayScoringProb01 = clamp01(
    sigmoid(0.5 * logit(awayAttackScoreRate) + 0.5 * logit(homeDefConcedeRate))
  );

  // Small low-score (0,0)/(1,0)/(0,1) Dixon-Coles adjustment consistent with Poisson-DC dependence
  const lamH = projection.lambdaHome;
  const lamA = projection.lambdaAway;
  const expH = Math.exp(-lamH);
  const expA = Math.exp(-lamA);
  const p00Indep = expH * expA;
  const p01Indep = expH * lamA * expA;
  const p10Indep = lamH * expH * expA;
  const dcBttsDelta =
    p00Indep * (1 - dixonColesTau(0, 0, lamH, lamA, -0.11)) +
    p01Indep * (1 - dixonColesTau(0, 1, lamH, lamA, -0.11)) +
    p10Indep * (1 - dixonColesTau(1, 0, lamH, lamA, -0.11));

  // Direct Poisson-DC exact BTTS probability
  const pH0Dc =
    p00Indep * dixonColesTau(0, 0, lamH, lamA, -0.11) +
    p01Indep * dixonColesTau(0, 1, lamH, lamA, -0.11) +
    expH * Math.max(0, 1 - expA - lamA * expA);
  const pA0Dc =
    p00Indep * dixonColesTau(0, 0, lamH, lamA, -0.11) +
    p10Indep * dixonColesTau(1, 0, lamH, lamA, -0.11) +
    expA * Math.max(0, 1 - expH - lamH * expH);
  const p00Adj = p00Indep * dixonColesTau(0, 0, lamH, lamA, -0.11);
  const lightlyShrunkPoissonDcProb01 = clamp01(1 - (pH0Dc + pA0Dc - p00Adj));

  const decoupledFtsCsProb01 = clamp01(
    homeScoringProb01 * awayScoringProb01 + dcBttsDelta * 0.5
  );

  return {
    leagueBttsPrior01,
    decoupledFtsCsProb01,
    lightlyShrunkPoissonDcProb01,
    homeScoringProb01,
    awayScoringProb01,
    recommendedStatus: 'PREDICT',
    notes: 'Non-redundant decoupled FTS/CS vs lightly shrunk Poisson-DC (< T).',
  };
}

export function evaluateBttsAcceptanceGate(params: {
  combinedEvalFixtureCount: number;
  priorLogLoss: number | null;
  decoupledFtsCsLogLoss: number | null;
  lightPoissonDcLogLoss: number | null;
}): Phase6AcceptanceGateVerdict {
  const {
    combinedEvalFixtureCount,
    priorLogLoss,
    decoupledFtsCsLogLoss,
    lightPoissonDcLogLoss,
  } = params;

  const candidates: Array<{ name: string; ll: number | null }> = [
    { name: 'decoupledFtsCs', ll: decoupledFtsCsLogLoss },
    { name: 'lightlyShrunkPoissonDc', ll: lightPoissonDcLogLoss },
  ];

  let best = candidates[0];
  for (const c of candidates) {
    if (c.ll !== null && (best.ll === null || c.ll < best.ll)) {
      best = c;
    }
  }

  const delta =
    priorLogLoss !== null && best.ll !== null
      ? Math.round((best.ll - priorLogLoss) * 100000) / 100000
      : null;
  const passed = delta !== null && delta <= -PHASE6_MIN_EDGE_LOGLOSS_DELTA;

  return {
    market: 'BTTS',
    bestCandidateName: best.name,
    combinedEvalFixtureCount,
    priorLogLoss,
    candidateLogLoss: best.ll,
    deltaLogLoss: delta,
    requiredDelta: -PHASE6_MIN_EDGE_LOGLOSS_DELTA,
    passed,
    assignedStatus: passed ? 'PREDICT' : 'INFORMATIONAL_PRIOR_ONLY',
    rationale: passed
      ? `Passed pre-registered gate via ${best.name}: delta LogLoss=${delta} <= -${PHASE6_MIN_EDGE_LOGLOSS_DELTA}.`
      : `Failed pre-registered gate: best candidate (${best.name}) delta LogLoss=${delta ?? 'N/A'} did not reach -${PHASE6_MIN_EDGE_LOGLOSS_DELTA}; marked INFORMATIONAL_PRIOR_ONLY.`,
  };
}
