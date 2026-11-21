import { Match, MatchStatistics } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { extractVariantBProjection } from '../phase4/variantBExtractor';
import { BinaryCalibSample, calibratePhase5Binary } from './phase5Calibration';
import { Phase5CausalPriors, Phase5O25VariantComparison } from './phase5Types';

function logGamma(z: number): number {
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Exact Negative Binomial PMF P(X = k) with mean mu and dispersion r. */
export function exactNegBinPmf(k: number, mu: number, r: number): number {
  if (k < 0 || !Number.isFinite(mu) || mu <= 0 || !Number.isFinite(r) || r <= 0) return 0;
  const p = r / (r + mu);
  const logProb =
    logGamma(k + r) -
    logGamma(r) -
    logGamma(k + 1) +
    r * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logProb);
}

function dixonColesTau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return Math.max(0.01, 1 - lh * la * rho);
  if (h === 0 && a === 1) return Math.max(0.01, 1 + lh * rho);
  if (h === 1 && a === 0) return Math.max(0.01, 1 + la * rho);
  if (h === 1 && a === 1) return Math.max(0.01, 1 - rho);
  return 1.0;
}

/**
 * Compute strictly normalized bivariate Negative Binomial + Dixon-Coles market probabilities
 * on [0..14]^2 (covering >99.999% mass for football goal intensities <= 4.0).
 */
export function computeNormalizedBivariateNegBin(
  lambdaH: number,
  lambdaA: number,
  dispersionH: number,
  dispersionA: number,
  rho: number = -0.11
): {
  homeWin01: number;
  draw01: number;
  awayWin01: number;
  over15_01: number;
  over25_01: number;
  bttsYes01: number;
} {
  const MAX_G = 14;
  const pmfH = Array.from({ length: MAX_G + 1 }, (_, h) => exactNegBinPmf(h, lambdaH, dispersionH));
  const pmfA = Array.from({ length: MAX_G + 1 }, (_, a) => exactNegBinPmf(a, lambdaA, dispersionA));

  let totalMass = 0;
  let hw = 0;
  let dr = 0;
  let aw = 0;
  let u15 = 0;
  let u25 = 0;
  let bttsYes = 0;

  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      const cell = pmfH[h] * pmfA[a] * dixonColesTau(h, a, lambdaH, lambdaA, rho);
      totalMass += cell;
      if (h > a) hw += cell;
      else if (h === a) dr += cell;
      else aw += cell;

      const tot = h + a;
      if (tot <= 1) u15 += cell;
      if (tot <= 2) u25 += cell;
      if (h > 0 && a > 0) bttsYes += cell;
    }
  }

  const norm = totalMass > 0 ? totalMass : 1;
  return {
    homeWin01: hw / norm,
    draw01: dr / norm,
    awayWin01: aw / norm,
    over15_01: Math.max(0.01, Math.min(0.99, 1 - u15 / norm)),
    over25_01: Math.max(0.01, Math.min(0.99, 1 - u25 / norm)),
    bttsYes01: Math.max(0.01, Math.min(0.99, bttsYes / norm)),
  };
}

/**
 * Evaluate Phase 5B Over 2.5 Research Model comparing 4 variants strictly causally (< T):
 * A) Existing Phase 3 Poisson-DC
 * B) Normalized Negative Binomial with causal dispersion on Phase 3 lambdas
 * C) Hierarchical shrunk goal-rate (Variant-B) + NegBin + causal league O2.5 shrinkage
 * D) Causally calibrated O2.5 probability (< T)
 */
export function evaluatePhase5O25Model(params: {
  match: Match;
  stats: MatchStatistics;
  competitionMatches: Match[];
  priors: Phase5CausalPriors;
  o25History: BinaryCalibSample[];
}): Phase5O25VariantComparison {
  const { match, stats, competitionMatches, priors, o25History } = params;
  const p3H = stats.homeExpectedGoals;
  const p3A = stats.awayExpectedGoals;

  if (!priors.validTimestamp || p3H === null || p3A === null || !Number.isFinite(p3H) || !Number.isFinite(p3A)) {
    return {
      variantAPoissonPct: null,
      variantBNegBinPct: null,
      variantCShrunkPct: null,
      variantDCalibratedPct: null,
      selectedRawPct: null,
      selectedFinalPct: null,
      causalDispersionUsed: priors.causalDispersionHome,
      variantCLambdaHome: null,
      variantCLambdaAway: null,
      calibrationMethod: 'RAW_IDENTITY',
      calibrationStatus: 'NOT_TRAINED',
      calibrationSamplesUsed: 0,
      uncertainty: null,
    };
  }

  // Variant A: Existing Phase 3 Poisson + Dixon-Coles O2.5
  const variantA01 = calculatePoissonProbabilities(p3H, p3A, 7, true).markets.over25 / 100;

  // Variant B: Normalized NegBin + causal dispersion on Phase 3 lambdas
  const dispAvg = (priors.causalDispersionHome + priors.causalDispersionAway) / 2;
  const nbPhase3 = computeNormalizedBivariateNegBin(
    p3H,
    p3A,
    priors.causalDispersionHome,
    priors.causalDispersionAway
  );
  const variantB01 = nbPhase3.over25_01;

  // Variant C: Hierarchical shrunk goal-rate lambdas (strictly < T) + Normalized NegBin + gentle league O2.5 Bayes shrink
  const vbProj = extractVariantBProjection(match, stats, competitionMatches);
  const lambdaH = vbProj.lambdas?.homeExpectedGoals ?? p3H;
  const lambdaA = vbProj.lambdas?.awayExpectedGoals ?? p3A;
  const nbShrunk = computeNormalizedBivariateNegBin(
    lambdaH,
    lambdaA,
    priors.causalDispersionHome,
    priors.causalDispersionAway
  );

  // Epistemic posterior uncertainty over lambda quantiles (matches Variant-B prior K=12)
  const hPlayed = stats.homeTeamStats.overall.matchesPlayed;
  const aPlayed = stats.awayTeamStats.overall.matchesPlayed;
  const relStdH = 1 / Math.sqrt(Math.max(8, hPlayed + 12));
  const relStdA = 1 / Math.sqrt(Math.max(8, aPlayed + 12));
  const gridO25: number[] = [];
  for (const sH of [-1, 0, 1]) {
    for (const sA of [-1, 0, 1]) {
      const lH = Math.max(0.25, Math.min(4.2, lambdaH * (1 + sH * relStdH)));
      const lA = Math.max(0.25, Math.min(4.2, lambdaA * (1 + sA * relStdA)));
      gridO25.push(
        computeNormalizedBivariateNegBin(lH, lA, priors.causalDispersionHome, priors.causalDispersionAway)
          .over25_01
      );
    }
  }
  const meanGrid = gridO25.reduce((a, b) => a + b, 0) / gridO25.length;
  const varianceGrid = gridO25.reduce((a, x) => a + (x - meanGrid) ** 2, 0) / gridO25.length;
  const uncertainty = Math.round(Math.sqrt(varianceGrid) * 1000) / 1000;

  // Mild Bayes shrinkage toward league causal O2.5 base rate weighted by uncertainty
  const leagueO25Prior01 =
    priors.priorLeagueMatches >= 15 && priors.leagueOver25Rate !== null
      ? (priors.leagueOver25Rate * priors.priorLeagueMatches + 15 * 0.5) /
        (priors.priorLeagueMatches + 15)
      : 0.5;
  const uncWeight = Math.min(0.25, uncertainty * 1.4);
  const variantC01 = (1 - uncWeight) * nbShrunk.over25_01 + uncWeight * leagueO25Prior01;

  // Variant D: Causal Calibration (< T)
  const calOut = calibratePhase5Binary(variantC01, match.utcDate, o25History);
  const variantD01 = calOut.status === 'CALIBRATED' ? calOut.calibratedProb01 : null;
  const final01 = variantD01 ?? variantC01;

  return {
    variantAPoissonPct: Math.round(variantA01 * 1000) / 10,
    variantBNegBinPct: Math.round(variantB01 * 1000) / 10,
    variantCShrunkPct: Math.round(variantC01 * 1000) / 10,
    variantDCalibratedPct: variantD01 !== null ? Math.round(variantD01 * 1000) / 10 : null,
    selectedRawPct: Math.round(variantC01 * 1000) / 10,
    selectedFinalPct: Math.round(final01 * 1000) / 10,
    causalDispersionUsed: Math.round(dispAvg * 100) / 100,
    variantCLambdaHome: Math.round(lambdaH * 100) / 100,
    variantCLambdaAway: Math.round(lambdaA * 100) / 100,
    calibrationMethod: calOut.selectedMethod,
    calibrationStatus: calOut.status,
    calibrationSamplesUsed: calOut.sampleCount,
    uncertainty,
  };
}
