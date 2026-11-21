import {
  MarketProbabilities,
  ScorelineProbability,
  SingleModelEvaluation,
} from '../types/football';
import { dixonColesTau } from '../utils/poissonModel';

export interface NegBinGoalModelResult {
  markets: MarketProbabilities;
  topScorelines: ScorelineProbability[];
  evaluation: SingleModelEvaluation;
  dispersionHome: number;
  dispersionAway: number;
  uncertainties: {
    over15: number; // epistemic std dev [0..1]
    over25: number;
    btts: number;
    doubleChance: number;
  };
}

/**
 * Log-Gamma approximation (Lanczos) for exact Negative Binomial PMF calculation.
 */
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zz = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (zz + i);
  }
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Negative-Binomial PMF arising as Gamma-Poisson mixture:
 * lambda ~ Gamma(shape=r, rate=r/mu), G | lambda ~ Poisson(lambda)
 * => E[G] = mu, Var(G) = mu + mu^2 / r
 */
export function negativeBinomialProb(k: number, meanMu: number, shapeR: number): number {
  const mu = Math.max(0.05, meanMu);
  const r = Math.max(1.5, shapeR);
  const p = r / (r + mu);
  const logProb =
    logGamma(k + r) -
    logGamma(k + 1) -
    logGamma(r) +
    r * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logProb);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function computeScoreGrid(
  lambdaH: number,
  lambdaA: number,
  dispersionH: number,
  dispersionA: number,
  maxGoals: number = 8
): {
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;
  over25: number;
  over35: number;
  bttsYes: number;
  scorelines: ScorelineProbability[];
} {
  const pHArr: number[] = [];
  const pAArr: number[] = [];
  for (let k = 0; k <= maxGoals; k++) {
    pHArr.push(negativeBinomialProb(k, lambdaH, dispersionH));
    pAArr.push(negativeBinomialProb(k, lambdaA, dispersionA));
  }

  let totalMass = 0;
  let homeWinRaw = 0;
  let drawRaw = 0;
  let awayWinRaw = 0;
  let under15Raw = 0;
  let under25Raw = 0;
  let under35Raw = 0;
  let bttsYesRaw = 0;
  const rawScorelines: ScorelineProbability[] = [];

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const tau = Math.max(0.01, dixonColesTau(h, a, lambdaH, lambdaA, -0.11));
      const p = pHArr[h] * pAArr[a] * tau;
      totalMass += p;
      rawScorelines.push({
        score: `${h} - ${a}`,
        homeGoals: h,
        awayGoals: a,
        probability: p,
      });
      if (h > a) homeWinRaw += p;
      else if (h === a) drawRaw += p;
      else awayWinRaw += p;

      const totalG = h + a;
      if (totalG <= 1) under15Raw += p;
      if (totalG <= 2) under25Raw += p;
      if (totalG <= 3) under35Raw += p;
      if (h >= 1 && a >= 1) bttsYesRaw += p;
    }
  }

  // Since maxGoals = 8, omitted tail mass (>8 goals for a single side) belongs to Overs & BTTS
  const norm = Math.max(1e-9, totalMass);
  const tailMass = Math.max(0, 1 - totalMass);

  return {
    homeWin: (homeWinRaw / norm) * 100,
    draw: (drawRaw / norm) * 100,
    awayWin: (awayWinRaw / norm) * 100,
    over15: Math.max(0.1, Math.min(99.9, (1 - under15Raw) * 100)),
    over25: Math.max(0.1, Math.min(99.9, (1 - under25Raw) * 100)),
    over35: Math.max(0.1, Math.min(99.9, (1 - under35Raw) * 100)),
    bttsYes: Math.max(0.1, Math.min(99.9, (bttsYesRaw + tailMass * 0.65) * 100)),
    scorelines: rawScorelines
      .map((s) => ({ ...s, probability: (s.probability / norm) * 100 }))
      .sort((a, b) => b.probability - a.probability),
  };
}

/**
 * Evaluate Phase 4 Negative-Binomial (Gamma-Poisson) predictive goal distribution
 * with deterministic epistemic uncertainty bounds from prior team sample sizes.
 */
export function evaluateGoalMarketExperiment(
  lambdaH: number,
  lambdaA: number,
  homePlayed: number,
  awayPlayed: number
): NegBinGoalModelResult {
  const safeH = Math.max(0.35, Math.min(4.0, lambdaH));
  const safeA = Math.max(0.35, Math.min(4.0, lambdaA));

  // Bayesian Gamma-Poisson effective shape: prior weight (12) + matches played
  const dispersionHome = Math.max(5.0, 12 + homePlayed * 0.85);
  const dispersionAway = Math.max(5.0, 12 + awayPlayed * 0.85);

  const central = computeScoreGrid(safeH, safeA, dispersionHome, dispersionAway, 8);

  // Compute deterministic epistemic uncertainty across 3x3 Gauss-style quantile grid
  // Posterior std dev of Gamma mean ~ mu / sqrt(alpha_eff)
  const relStdH = 1 / Math.sqrt(Math.max(4, homePlayed + 6));
  const relStdA = 1 / Math.sqrt(Math.max(4, awayPlayed + 6));
  const offsets = [-1.0, 0.0, 1.0];

  const o15Samples: number[] = [];
  const o25Samples: number[] = [];
  const bttsSamples: number[] = [];
  const dcSamples: number[] = [];

  for (const oh of offsets) {
    for (const oa of offsets) {
      const hPert = Math.max(0.35, Math.min(4.0, safeH * (1 + oh * relStdH)));
      const aPert = Math.max(0.35, Math.min(4.0, safeA * (1 + oa * relStdA)));
      const grid = computeScoreGrid(hPert, aPert, dispersionHome, dispersionAway, 7);
      o15Samples.push(grid.over15 / 100);
      o25Samples.push(grid.over25 / 100);
      bttsSamples.push(grid.bttsYes / 100);
      dcSamples.push(Math.max(grid.homeWin + grid.draw, grid.awayWin + grid.draw) / 100);
    }
  }

  const std01 = (arr: number[]): number => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / arr.length;
    return Math.round(Math.sqrt(variance) * 1000) / 1000;
  };

  // First-half NegBin approximations (~44% of full-match goals)
  const fhGrid = computeScoreGrid(safeH * 0.44, safeA * 0.44, dispersionHome, dispersionAway, 4);

  const homeWin = round1(central.homeWin);
  const draw = round1(central.draw);
  const awayWin = round1(100 - homeWin - draw);

  const over15 = round1(central.over15);
  const over25 = round1(central.over25);
  const over35 = round1(central.over35);
  const bttsYes = round1(central.bttsYes);

  const fhUnder05 = round1(100 - fhGrid.over15 * 0.55); // fallback unused directly; compute exact below
  void fhUnder05;
  const p00_fh =
    negativeBinomialProb(0, safeH * 0.44, dispersionHome) *
    negativeBinomialProb(0, safeA * 0.44, dispersionAway);
  const exactFhUnder05 = Math.max(0.1, Math.min(99.9, round1(p00_fh * 100)));
  const exactFhOver05 = round1(100 - exactFhUnder05);
  const exactFhOver15 = round1(fhGrid.over15);
  const exactFhUnder15 = round1(100 - exactFhOver15);

  const fhHW = round1(fhGrid.homeWin);
  const fhD = round1(fhGrid.draw);
  const fhAW = round1(100 - fhHW - fhD);

  const markets: MarketProbabilities = {
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
    firstHalfOver05: exactFhOver05,
    firstHalfUnder05: exactFhUnder05,
    firstHalfOver15: exactFhOver15,
    firstHalfUnder15: exactFhUnder15,
    firstHalfHomeWin: fhHW,
    firstHalfDraw: fhD,
    firstHalfAwayWin: fhAW,
  };

  const topScorelines = central.scorelines.slice(0, 6).map((s) => ({
    ...s,
    probability: round1(s.probability),
  }));

  return {
    markets,
    topScorelines,
    evaluation: {
      modelName: 'xG Regression',
      homeWinProb: homeWin,
      drawProb: draw,
      awayWinProb: awayWin,
      over25Prob: over25,
      bttsProb: bttsYes,
      projectedHomeGoals: Math.round(safeH * 100) / 100,
      projectedAwayGoals: Math.round(safeA * 100) / 100,
      notes: `Variant-B Hierarchical Negative-Binomial (dispersion r=${dispersionHome.toFixed(1)}/${dispersionAway.toFixed(1)})`,
    },
    dispersionHome,
    dispersionAway,
    uncertainties: {
      over15: std01(o15Samples),
      over25: std01(o25Samples),
      btts: std01(bttsSamples),
      doubleChance: std01(dcSamples),
    },
  };
}
