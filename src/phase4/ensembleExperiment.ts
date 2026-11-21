import {
  HistoryRecord,
  MarketProbabilities,
  SingleModelEvaluation,
} from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { evaluateEloModel } from '../utils/eloRating';
import { CausalEnsembleWeights } from './phase4Types';
import { NegBinGoalModelResult } from './goalMarketExperiment';

export const MIN_ENSEMBLE_CAUSAL_SAMPLES = 30;

export interface EnsemblePriorSample {
  utcDate: string;
  actualWinner: 'HOME' | 'DRAW' | 'AWAY';
  modelEvaluations: SingleModelEvaluation[];
}

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic, mobile-optimized Monte Carlo evaluation seeded strictly from pre-match inputs.
 */
export function runSeededMonteCarlo(
  matchId: string,
  homeXG: number,
  awayXG: number,
  iterations: number = 2500
): SingleModelEvaluation {
  const rng = mulberry32(hashSeed(`${matchId}:${homeXG.toFixed(2)}:${awayXG.toFixed(2)}`));
  let hw = 0;
  let d = 0;
  let aw = 0;
  let over25 = 0;
  let btts = 0;

  const samplePoisson = (lambda: number): number => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  };

  for (let i = 0; i < iterations; i++) {
    const tempoH = 1 + (rng() - 0.5) * 0.14;
    const tempoA = 1 + (rng() - 0.5) * 0.14;
    const gH = samplePoisson(Math.max(0.1, homeXG * tempoH));
    const gA = samplePoisson(Math.max(0.1, awayXG * tempoA));
    if (gH > gA) hw++;
    else if (gH === gA) d++;
    else aw++;
    if (gH + gA > 2.5) over25++;
    if (gH > 0 && gA > 0) btts++;
  }

  return {
    modelName: 'Monte Carlo',
    homeWinProb: Math.round((hw / iterations) * 1000) / 10,
    drawProb: Math.round((d / iterations) * 1000) / 10,
    awayWinProb: Math.round((aw / iterations) * 1000) / 10,
    over25Prob: Math.round((over25 / iterations) * 1000) / 10,
    bttsProb: Math.round((btts / iterations) * 1000) / 10,
    projectedHomeGoals: Math.round(homeXG * 100) / 100,
    projectedAwayGoals: Math.round(awayXG * 100) / 100,
    notes: `Deterministic ${iterations.toLocaleString()}-run stochastic variance check.`,
  };
}

/**
 * Learn transparent 5-model weights strictly from causal (< targetKickoffUtc) outcomes
 * using bounded Hedge / Exponentiated Gradient updates on 1X2 Log Loss.
 */
export function learnCausalEnsembleWeights(
  targetKickoffUtc: string,
  hasElo: boolean,
  causalHistory: HistoryRecord[] = [],
  variantBSamples: EnsemblePriorSample[] = []
): CausalEnsembleWeights {
  const targetMs = new Date(targetKickoffUtc).getTime();

  const sourceList: EnsemblePriorSample[] =
    variantBSamples.length > 0
      ? variantBSamples
      : causalHistory
          .filter((r) => r.prediction.modelType !== 'ABSTAIN' && r.prediction.modelEvaluations.length >= 2)
          .map((r) => ({
            utcDate: r.match.utcDate,
            actualWinner: r.actualResult.winner,
            modelEvaluations: r.prediction.modelEvaluations,
          }));

  const priorSamples = !Number.isFinite(targetMs)
    ? []
    : sourceList.filter((s) => {
        const t = new Date(s.utcDate).getTime();
        return Number.isFinite(t) && t < targetMs;
      });

  if (priorSamples.length < MIN_ENSEMBLE_CAUSAL_SAMPLES) {
    const activeCount = hasElo ? 5 : 4;
    const eq = Math.round((1 / activeCount) * 1000) / 1000;
    const weights = hasElo
      ? {
          poisson: eq,
          dixonColes: eq,
          elo: eq,
          monteCarlo: eq,
          variantBNegBin: Math.round((1 - eq * 4) * 1000) / 1000,
        }
      : {
          poisson: eq,
          dixonColes: eq,
          elo: 0,
          monteCarlo: eq,
          variantBNegBin: Math.round((1 - eq * 3) * 1000) / 1000,
        };
    return {
      ...weights,
      learnedFromSamples: priorSamples.length,
      isUniformFallback: true,
      method: 'UNIFORM_PRIOR',
    };
  }

  // Hedge over model loss sums across strictly prior samples
  const lossSums = {
    poisson: 0,
    dixonColes: 0,
    elo: 0,
    monteCarlo: 0,
    variantBNegBin: 0,
  };
  const counts = {
    poisson: 0,
    dixonColes: 0,
    elo: 0,
    monteCarlo: 0,
    variantBNegBin: 0,
  };

  const probLoss = (ev: SingleModelEvaluation | undefined, winner: 'HOME' | 'DRAW' | 'AWAY'): number | null => {
    if (!ev) return null;
    const raw =
      winner === 'HOME' ? ev.homeWinProb : winner === 'DRAW' ? ev.drawProb : ev.awayWinProb;
    if (!Number.isFinite(raw)) return null;
    const p = Math.max(0.01, Math.min(0.99, raw / 100));
    return -Math.log(p);
  };

  for (const s of priorSamples) {
    const byName = new Map(s.modelEvaluations.map((m) => [m.modelName, m]));
    const lP = probLoss(byName.get('Poisson'), s.actualWinner);
    const lDC = probLoss(byName.get('Dixon-Coles'), s.actualWinner);
    const lElo = probLoss(byName.get('Elo'), s.actualWinner);
    const lMC = probLoss(byName.get('Monte Carlo'), s.actualWinner);
    const lVB = probLoss(byName.get('xG Regression'), s.actualWinner);

    if (lP !== null) {
      lossSums.poisson += lP;
      counts.poisson++;
    }
    if (lDC !== null) {
      lossSums.dixonColes += lDC;
      counts.dixonColes++;
    }
    if (lElo !== null) {
      lossSums.elo += lElo;
      counts.elo++;
    }
    if (lMC !== null) {
      lossSums.monteCarlo += lMC;
      counts.monteCarlo++;
    }
    if (lVB !== null) {
      lossSums.variantBNegBin += lVB;
      counts.variantBNegBin++;
    }
  }

  const eta = 2.0;
  const keys = hasElo
    ? (['poisson', 'dixonColes', 'elo', 'monteCarlo', 'variantBNegBin'] as const)
    : (['poisson', 'dixonColes', 'monteCarlo', 'variantBNegBin'] as const);

  const meanLosses: Record<string, number> = {};
  let minLoss = Infinity;
  for (const k of keys) {
    const ml = counts[k] > 0 ? lossSums[k] / counts[k] : 1.08;
    meanLosses[k] = ml;
    if (ml < minLoss) minLoss = ml;
  }

  const rawWeights: Record<string, number> = {};
  let sumW = 0;
  for (const k of keys) {
    // Bounded exponentiated gradient weight with floor >= 0.08
    const w = Math.max(0.08, Math.exp(-eta * (meanLosses[k] - minLoss)));
    rawWeights[k] = w;
    sumW += w;
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const poisson = round3(rawWeights.poisson / sumW);
  const dixonColes = round3(rawWeights.dixonColes / sumW);
  const elo = hasElo ? round3(rawWeights.elo / sumW) : 0;
  const monteCarlo = round3(rawWeights.monteCarlo / sumW);
  const variantBNegBin = round3(Math.max(0.05, 1 - (poisson + dixonColes + elo + monteCarlo)));

  return {
    poisson,
    dixonColes,
    elo,
    monteCarlo,
    variantBNegBin,
    learnedFromSamples: priorSamples.length,
    isUniformFallback: false,
    method: 'CAUSAL_EXPONENTIATED_GRADIENT_LOGLOSS',
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Blend active model evaluations using strictly causal weights + Variant-B NegBin goal markets.
 */
export function combineCausalEnsemble(
  matchId: string,
  phase3HomeXG: number,
  phase3AwayXG: number,
  variantBHomeXG: number,
  variantBAwayXG: number,
  homeElo: number | null,
  awayElo: number | null,
  negBinResult: NegBinGoalModelResult,
  weights: CausalEnsembleWeights,
  monteCarloIterations: number = 2500
): {
  combinedMarkets: MarketProbabilities;
  evaluations: SingleModelEvaluation[];
} {
  const purePoisson = calculatePoissonProbabilities(phase3HomeXG, phase3AwayXG, 7, false);
  const dcModel = calculatePoissonProbabilities(phase3HomeXG, phase3AwayXG, 7, true);
  const mcEval = runSeededMonteCarlo(matchId, variantBHomeXG, variantBAwayXG, monteCarloIterations);

  const evaluations: SingleModelEvaluation[] = [
    {
      modelName: 'Poisson',
      homeWinProb: purePoisson.markets.homeWin,
      drawProb: purePoisson.markets.draw,
      awayWinProb: purePoisson.markets.awayWin,
      over25Prob: purePoisson.markets.over25,
      bttsProb: purePoisson.markets.bttsYes,
      projectedHomeGoals: phase3HomeXG,
      projectedAwayGoals: phase3AwayXG,
      notes: 'Phase 3 classical bivariate Poisson.',
    },
    {
      modelName: 'Dixon-Coles',
      homeWinProb: dcModel.markets.homeWin,
      drawProb: dcModel.markets.draw,
      awayWinProb: dcModel.markets.awayWin,
      over25Prob: dcModel.markets.over25,
      bttsProb: dcModel.markets.bttsYes,
      projectedHomeGoals: phase3HomeXG,
      projectedAwayGoals: phase3AwayXG,
      notes: 'Phase 3 Dixon-Coles low-score dependence (rho=-0.11).',
    },
  ];

  let eloEval: SingleModelEvaluation | null = null;
  if (typeof homeElo === 'number' && typeof awayElo === 'number' && Number.isFinite(homeElo) && Number.isFinite(awayElo)) {
    eloEval = evaluateEloModel(homeElo, awayElo);
    evaluations.push(eloEval);
  }
  evaluations.push(mcEval);
  evaluations.push(negBinResult.evaluation);

  const wP = weights.poisson;
  const wDC = weights.dixonColes;
  const wElo = eloEval ? weights.elo : 0;
  const wMC = weights.monteCarlo;
  const wVB = weights.variantBNegBin;
  const wTotal = Math.max(1e-6, wP + wDC + wElo + wMC + wVB);

  const blend1X2Home =
    (wP * purePoisson.markets.homeWin +
      wDC * dcModel.markets.homeWin +
      (eloEval ? wElo * eloEval.homeWinProb : 0) +
      wMC * mcEval.homeWinProb +
      wVB * negBinResult.markets.homeWin) /
    wTotal;

  const blend1X2Draw =
    (wP * purePoisson.markets.draw +
      wDC * dcModel.markets.draw +
      (eloEval ? wElo * eloEval.drawProb : 0) +
      wMC * mcEval.drawProb +
      wVB * negBinResult.markets.draw) /
    wTotal;

  const homeWin = round1(blend1X2Home);
  const draw = round1(blend1X2Draw);
  const awayWin = round1(Math.max(0.1, 100 - homeWin - draw));

  // Goals markets prioritize Negative-Binomial Variant-B distribution (better tail dispersion)
  // softly stabilized with Dixon-Coles & Monte Carlo (never Elo goal-approximation heuristic).
  const goalWTotal = wDC + wMC * 0.5 + wVB * 1.5;
  const over15 = round1(
    (wDC * dcModel.markets.over15 +
      wMC * 0.5 * negBinResult.markets.over15 +
      wVB * 1.5 * negBinResult.markets.over15) /
      goalWTotal
  );
  const over25 = round1(
    (wDC * dcModel.markets.over25 +
      wMC * 0.5 * mcEval.over25Prob +
      wVB * 1.5 * negBinResult.markets.over25) /
      goalWTotal
  );
  const over35 = round1(
    (wDC * dcModel.markets.over35 + (wVB * 1.5 + wMC * 0.5) * negBinResult.markets.over35) /
      goalWTotal
  );
  const bttsYes = round1(
    (wDC * dcModel.markets.bttsYes +
      wMC * 0.5 * mcEval.bttsProb +
      wVB * 1.5 * negBinResult.markets.bttsYes) /
      goalWTotal
  );

  const combinedMarkets: MarketProbabilities = {
    homeWin,
    draw,
    awayWin,
    homeOrDraw: round1(homeWin + draw),
    awayOrDraw: round1(awayWin + draw),
    homeOrAway: round1(homeWin + awayWin),
    over15,
    under15: round1(100 - over15),
    over25,
    under25: round1(100 - over25),
    over35,
    under35: round1(100 - over35),
    bttsYes,
    bttsNo: round1(100 - bttsYes),
    firstHalfOver05: negBinResult.markets.firstHalfOver05,
    firstHalfUnder05: negBinResult.markets.firstHalfUnder05,
    firstHalfOver15: negBinResult.markets.firstHalfOver15,
    firstHalfUnder15: negBinResult.markets.firstHalfUnder15,
    firstHalfHomeWin: negBinResult.markets.firstHalfHomeWin,
    firstHalfDraw: negBinResult.markets.firstHalfDraw,
    firstHalfAwayWin: negBinResult.markets.firstHalfAwayWin,
  };

  return {
    combinedMarkets,
    evaluations,
  };
}
