/**
 * Quantitative Probability Engine - Poisson & Dixon-Coles Models
 * 
 * Mathematically Corrected:
 * 1. Bounded events (Under 1.5, 2.5, 3.5) are computed directly from exact closed-form / grid events.
 * 2. Omitted probability mass outside the score matrix is explicitly quantified and tracked.
 * 3. Omitted tail mass (>maxGoals) is never incorrectly allocated to Under markets.
 * 4. BTTS No and BTTS Yes are calculated using exact complementary formulas.
 * 5. All mutually exclusive pairs (Over/Under, BTTS Yes/No, 1X2) strictly sum to 100.0%.
 */

import { MarketProbabilities, ScorelineProbability, SingleModelEvaluation } from '../types/football';

/** Factorial calculation */
export function factorial(n: number): number {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/** Poisson probability mass function P(X = k) = (lambda^k * e^-lambda) / k! */
export function poissonProb(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Dixon-Coles tau parameter adjusting for low-score dependence (0-0, 1-0, 0-1, 1-1).
 * Typically rho is empirically calibrated between -0.10 and -0.15 for European top leagues.
 */
export function dixonColesTau(
  h: number,
  a: number,
  lambdaH: number,
  lambdaA: number,
  rho: number = -0.11
): number {
  if (h === 0 && a === 0) {
    return 1 - lambdaH * lambdaA * rho;
  } else if (h === 0 && a === 1) {
    return 1 + lambdaH * rho;
  } else if (h === 1 && a === 0) {
    return 1 + lambdaA * rho;
  } else if (h === 1 && a === 1) {
    return 1 - rho;
  }
  return 1.0;
}

export interface PoissonCalculationResult {
  markets: MarketProbabilities;
  topScorelines: ScorelineProbability[];
  matrix: number[][]; // [homeGoals][awayGoals]
  gridSum: number;
  omittedProbabilityMass: number; // probability mass outside [0..maxGoals] x [0..maxGoals]
}

/**
 * Generate match market probabilities using mathematically bounded Dixon-Coles Poisson modeling.
 */
export function calculatePoissonProbabilities(
  homeXG: number,
  awayXG: number,
  maxGoals: number = 7,
  useDixonColes: boolean = true
): PoissonCalculationResult {
  // Safe bounds on expected goal rates
  const lambdaH = Math.max(0.3, Math.min(4.5, homeXG));
  const lambdaA = Math.max(0.2, Math.min(4.2, awayXG));

  const matrix: number[][] = [];
  const scorelines: ScorelineProbability[] = [];

  let homeWinRaw = 0;
  let drawRaw = 0;
  let awayWinRaw = 0;

  // Under sums: Since maxGoals >= 7, all outcomes with h+a <= 3 are strictly and fully contained in the grid
  let under15Raw = 0; // h + a <= 1: (0,0), (0,1), (1,0)
  let under25Raw = 0; // h + a <= 2: (0,0), (0,1), (1,0), (1,1), (2,0), (0,2)
  let under35Raw = 0; // h + a <= 3: all combinations summing to <= 3

  let totalGridMass = 0;

  // Build grid
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pH = poissonProb(h, lambdaH);
    for (let a = 0; a <= maxGoals; a++) {
      const pA = poissonProb(a, lambdaA);
      const tau = useDixonColes ? Math.max(0.01, dixonColesTau(h, a, lambdaH, lambdaA)) : 1.0;
      const jointProb = pH * pA * tau;

      matrix[h][a] = jointProb;
      totalGridMass += jointProb;

      scorelines.push({
        score: `${h} - ${a}`,
        homeGoals: h,
        awayGoals: a,
        probability: jointProb,
      });

      // 1X2 sums
      if (h > a) homeWinRaw += jointProb;
      else if (h === a) drawRaw += jointProb;
      else awayWinRaw += jointProb;

      // Exact bounded Under sums
      const totalGoals = h + a;
      if (totalGoals <= 1) under15Raw += jointProb;
      if (totalGoals <= 2) under25Raw += jointProb;
      if (totalGoals <= 3) under35Raw += jointProb;
    }
  }

  // Quantify omitted probability mass outside the score matrix
  // Theoretical total mass across [0..inf) x [0..inf) is identically 1.0
  const omittedProbabilityMass = Math.max(0, 1.0 - totalGridMass);

  // Exact 1X2 normalization over grid mass (tail > maxGoals is allocated proportionally between non-draw outcomes)
  const normHW = (homeWinRaw / totalGridMass) * 100;
  const normD = (drawRaw / totalGridMass) * 100;
  const normAW = (awayWinRaw / totalGridMass) * 100;

  // Bounded Under/Over calculation:
  // Under 1.5, 2.5, 3.5 are completely contained inside the grid.
  // The omitted tail mass (h+a >= 8) strictly belongs to the OVER markets!
  // Therefore: Under = underRaw * 100%, and Over = 100% - Under.
  const rawUnder15Pct = under15Raw * 100;
  const rawUnder25Pct = under25Raw * 100;
  const rawUnder35Pct = under35Raw * 100;

  const under15 = Math.round(rawUnder15Pct * 10) / 10;
  const over15 = Math.round((100 - under15) * 10) / 10;

  const under25 = Math.round(rawUnder25Pct * 10) / 10;
  const over25 = Math.round((100 - under25) * 10) / 10;

  const under35 = Math.round(rawUnder35Pct * 10) / 10;
  const over35 = Math.round((100 - under35) * 10) / 10;

  // Exact BTTS No calculation:
  // P(BTTS No) = P(H=0) + P(A=0) - P(0,0)
  // Under Dixon-Coles:
  // P(0,0) = tau(0,0) * e^-lambdaH * e^-lambdaA
  // P(H=0) = P(0,0) + P(0,1) + sum_{a=2}^inf P(0,a) = tau(0,0)*p00 + tau(0,1)*p01 + e^-lambdaH * (1 - e^-lambdaA - lambdaA*e^-lambdaA)
  // P(A=0) = P(0,0) + P(1,0) + sum_{h=2}^inf P(h,0) = tau(0,0)*p00 + tau(1,0)*p10 + e^-lambdaA * (1 - e^-lambdaH - lambdaH*e^-lambdaH)
  const p00 = poissonProb(0, lambdaH) * poissonProb(0, lambdaA);
  const p01 = poissonProb(0, lambdaH) * poissonProb(1, lambdaA);
  const p10 = poissonProb(1, lambdaH) * poissonProb(0, lambdaA);

  const tau00 = useDixonColes ? dixonColesTau(0, 0, lambdaH, lambdaA) : 1.0;
  const tau01 = useDixonColes ? dixonColesTau(0, 1, lambdaH, lambdaA) : 1.0;
  const tau10 = useDixonColes ? dixonColesTau(1, 0, lambdaH, lambdaA) : 1.0;

  const adjP00 = p00 * tau00;
  const adjP01 = p01 * tau01;
  const adjP10 = p10 * tau10;

  const expNegH = Math.exp(-lambdaH);
  const expNegA = Math.exp(-lambdaA);

  // Exact marginal probability of H=0 and A=0
  const pH0 = adjP00 + adjP01 + expNegH * Math.max(0, 1 - expNegA - lambdaA * expNegA);
  const pA0 = adjP00 + adjP10 + expNegA * Math.max(0, 1 - expNegH - lambdaH * expNegH);

  const pBTTSNoExact = pH0 + pA0 - adjP00;
  const bttsNo = Math.round(Math.min(99.9, Math.max(0.1, pBTTSNoExact * 100)) * 10) / 10;
  const bttsYes = Math.round((100 - bttsNo) * 10) / 10;

  // Round 1X2 ensuring exact 100.0% sum
  const homeWin = Math.round(normHW * 10) / 10;
  const draw = Math.round(normD * 10) / 10;
  const awayWin = Math.round((100 - homeWin - draw) * 10) / 10;

  // Double chance exact sums
  const homeOrDraw = Math.round((homeWin + draw) * 10) / 10;
  const awayOrDraw = Math.round((awayWin + draw) * 10) / 10;
  const homeOrAway = Math.round((homeWin + awayWin) * 10) / 10;

  // First half expectations (historically ~44% of expected goals occur in 1st half)
  const fhLambdaH = lambdaH * 0.44;
  const fhLambdaA = lambdaA * 0.44;

  let fhUnder05Raw = 0;
  let fhUnder15Raw = 0;
  let fhHomeWinRaw = 0;
  let fhDrawRaw = 0;
  let fhAwayWinRaw = 0;
  let fhGridMass = 0;

  for (let h = 0; h <= 4; h++) {
    const pH = poissonProb(h, fhLambdaH);
    for (let a = 0; a <= 4; a++) {
      const pA = poissonProb(a, fhLambdaA);
      const p = pH * pA;
      fhGridMass += p;

      if (h + a <= 0) fhUnder05Raw += p;
      if (h + a <= 1) fhUnder15Raw += p;

      if (h > a) fhHomeWinRaw += p;
      else if (h === a) fhDrawRaw += p;
      else fhAwayWinRaw += p;
    }
  }

  // FH Under 0.5 is bounded (0-0 scoreline), FH Under 1.5 is bounded (0-0, 0-1, 1-0)
  const fhUnder05 = Math.round(fhUnder05Raw * 100 * 10) / 10;
  const fhOver05 = Math.round((100 - fhUnder05) * 10) / 10;

  const fhUnder15 = Math.round(fhUnder15Raw * 100 * 10) / 10;
  const fhOver15 = Math.round((100 - fhUnder15) * 10) / 10;

  const totalFh1X2 = fhHomeWinRaw + fhDrawRaw + fhAwayWinRaw;
  const fhHomeWin = Math.round(((fhHomeWinRaw / totalFh1X2) * 100) * 10) / 10;
  const fhDraw = Math.round(((fhDrawRaw / totalFh1X2) * 100) * 10) / 10;
  const fhAwayWin = Math.round((100 - fhHomeWin - fhDraw) * 10) / 10;

  // Normalize scorelines by totalGridMass and sort descending
  const normalizedScorelines = scorelines.map((s) => ({
    ...s,
    probability: (s.probability / totalGridMass) * 100,
  }));
  normalizedScorelines.sort((a, b) => b.probability - a.probability);

  const topScorelines = normalizedScorelines.slice(0, 6).map((s) => ({
    ...s,
    probability: Math.round(s.probability * 10) / 10,
  }));

  return {
    markets: {
      homeWin,
      draw,
      awayWin,
      homeOrDraw,
      awayOrDraw,
      homeOrAway,
      over15,
      under15,
      over25,
      under25,
      over35,
      under35,
      bttsYes,
      bttsNo,
      firstHalfOver05: fhOver05,
      firstHalfUnder05: fhUnder05,
      firstHalfOver15: fhOver15,
      firstHalfUnder15: fhUnder15,
      firstHalfHomeWin: fhHomeWin,
      firstHalfDraw: fhDraw,
      firstHalfAwayWin: fhAwayWin,
    },
    topScorelines,
    matrix,
    gridSum: totalGridMass,
    omittedProbabilityMass,
  };
}

/**
 * Helper to compute an independent single evaluation for Dixon-Coles vs Poisson
 */
export function evaluateDixonColesComparison(
  homeXG: number,
  awayXG: number
): {
  poissonEval: SingleModelEvaluation;
  dixonColesEval: SingleModelEvaluation;
} {
  const purePoisson = calculatePoissonProbabilities(homeXG, awayXG, 7, false);
  const dcModel = calculatePoissonProbabilities(homeXG, awayXG, 7, true);

  return {
    poissonEval: {
      modelName: 'Poisson',
      homeWinProb: purePoisson.markets.homeWin,
      drawProb: purePoisson.markets.draw,
      awayWinProb: purePoisson.markets.awayWin,
      over25Prob: purePoisson.markets.over25,
      bttsProb: purePoisson.markets.bttsYes,
      projectedHomeGoals: homeXG,
      projectedAwayGoals: awayXG,
      notes: 'Classical bivariate Poisson with bounded cumulative goals.',
    },
    dixonColesEval: {
      modelName: 'Dixon-Coles',
      homeWinProb: dcModel.markets.homeWin,
      drawProb: dcModel.markets.draw,
      awayWinProb: dcModel.markets.awayWin,
      over25Prob: dcModel.markets.over25,
      bttsProb: dcModel.markets.bttsYes,
      projectedHomeGoals: homeXG,
      projectedAwayGoals: awayXG,
      notes: 'Calibrated tau parameter (rho = -0.11) with exact BTTS marginals.',
    },
  };
}
