import {
  calibrate1XTwoApproachB_Temperature,
  fitCausal1XTwoTemperature,
  normalizeSimplex,
  P51_MIN_TEMP_SAMPLES,
} from './phase5_1Calibration';
import {
  Phase5_1CalibSample1X2,
  Phase5_1OneXTwoCalibrationResult,
  TAIL_SHRINKAGE_VERSION,
  TailShrinkageParameters,
} from './phase5_1Types';

export const MIN_TAIL_CALIB_SAMPLES = 100;
export const MIN_TAIL_HIGH_CONF_PRIORS = 15;
export const TAIL_HINGE_THRESHOLD = 0.65;

const EPS = 1e-6;

function applyTailGammaToTriple(
  pH: number,
  pD: number,
  pA: number,
  gammaHome: number,
  gammaAway: number,
  hinge: number = TAIL_HINGE_THRESHOLD
): [number, number, number] {
  const [cH, cD, cA] = normalizeSimplex(pH, pD, pA);
  const probs: [number, number, number] = [cH, cD, cA];

  // Identify top predicted outcome
  let topIdx = 0;
  if (probs[1] > probs[topIdx]) topIdx = 1;
  if (probs[2] > probs[topIdx]) topIdx = 2;

  const pTop = probs[topIdx];
  if (pTop <= hinge) {
    return probs;
  }

  // Only damp excess confidence above hinge using causally learned class-specific/pooled gamma
  const gamma = topIdx === 0 ? gammaHome : topIdx === 2 ? gammaAway : (gammaHome + gammaAway) * 0.5;
  if (!(gamma > 0)) {
    return probs;
  }

  const secondIdx1 = (topIdx + 1) % 3;
  const secondIdx2 = (topIdx + 2) % 3;
  const secondMax = Math.max(probs[secondIdx1], probs[secondIdx2]);

  const rawReduction = gamma * (pTop - hinge);
  // Safety invariant: conservative shrinkage never flips the argmax winner or reduces below hinge
  const maxSafeReduction = Math.max(0, pTop - Math.max(hinge, secondMax + 0.015));
  const delta = Math.min(rawReduction, maxSafeReduction);
  if (!(delta > 1e-6)) {
    return probs;
  }

  const newTop = pTop - delta;
  const remSum = Math.max(EPS, probs[secondIdx1] + probs[secondIdx2]);
  const out: [number, number, number] = [...probs] as [number, number, number];
  out[topIdx] = newTop;
  out[secondIdx1] = probs[secondIdx1] + delta * (probs[secondIdx1] / remSum);
  out[secondIdx2] = probs[secondIdx2] + delta * (probs[secondIdx2] / remSum);
  return normalizeSimplex(out[0], out[1], out[2]);
}

function evaluateTailObjective(
  rows: Array<{ pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }>,
  gammaHome: number,
  gammaAway: number
): { totalLogLoss: number; tailLogLoss: number; tailEcePct: number; tailCount: number } {
  let sumLoss = 0;
  let tailLoss = 0;
  let tailCount = 0;
  let tailSumP = 0;
  let tailSumY = 0;

  for (const r of rows) {
    const [qH, qD, qA] = applyTailGammaToTriple(r.pH, r.pD, r.pA, gammaHome, gammaAway);
    const hit = r.winner === 'HOME' ? qH : r.winner === 'DRAW' ? qD : qA;
    const loss = -Math.log(Math.max(EPS, hit));
    sumLoss += loss;

    const topP = Math.max(qH, qD, qA);
    const predClass = qH >= qD && qH >= qA ? 'HOME' : qA >= qD && qA >= qH ? 'AWAY' : 'DRAW';
    if (topP >= 0.7 || Math.max(r.pH, r.pD, r.pA) >= 0.7) {
      tailCount++;
      tailLoss += loss;
      tailSumP += topP;
      tailSumY += predClass === r.winner ? 1 : 0;
    }
  }

  return {
    totalLogLoss: rows.length > 0 ? sumLoss / rows.length : Infinity,
    tailLogLoss: tailCount > 0 ? tailLoss / tailCount : Infinity,
    tailEcePct: tailCount > 0 ? Math.abs(tailSumP / tailCount - tailSumY / tailCount) * 100 : 0,
    tailCount,
  };
}

/**
 * Learn conservative tail shrinkage parameters strictly from prior completed matches (< targetUtc).
 * Returns NOT_TRAINED if fewer than MIN_TAIL_CALIB_SAMPLES total priors OR fewer than MIN_TAIL_HIGH_CONF_PRIORS
 * high-confidence (> 0.65) prior events exist.
 */
export function fitCausalTailShrinkage(
  priorBaseSamples: Array<{ timestampMs: number; pH: number; pD: number; pA: number; winner: 'HOME' | 'DRAW' | 'AWAY' }>
): TailShrinkageParameters {
  const n = priorBaseSamples.length;
  const tailRows = priorBaseSamples.filter((r) => Math.max(r.pH, r.pD, r.pA) > TAIL_HINGE_THRESHOLD);

  if (n < MIN_TAIL_CALIB_SAMPLES || tailRows.length < MIN_TAIL_HIGH_CONF_PRIORS) {
    return {
      version: TAIL_SHRINKAGE_VERSION,
      status: 'NOT_TRAINED',
      hingeThreshold01: TAIL_HINGE_THRESHOLD,
      pooledGamma: 0,
      gammaHome: 0,
      gammaAway: 0,
      totalPriorSamples: n,
      tailPriorSamples: tailRows.length,
      applied: false,
      reason:
        n < MIN_TAIL_CALIB_SAMPLES
          ? `Tail shrinkage NOT_TRAINED (${n}/${MIN_TAIL_CALIB_SAMPLES} total priors).`
          : `Tail shrinkage NOT_TRAINED (${tailRows.length}/${MIN_TAIL_HIGH_CONF_PRIORS} tail priors > ${(TAIL_HINGE_THRESHOLD * 100).toFixed(0)}%).`,
    };
  }

  const fitGammas = (
    rows: typeof priorBaseSamples
  ): { pooledGamma: number; gammaHome: number; gammaAway: number } => {
    // 1. Pooled scalar gamma minimizing regularized log loss on priors
    let bestGamma = 0;
    let bestScore = evaluateTailObjective(rows, 0, 0).totalLogLoss;

    for (let g = 0.04; g <= 0.721; g += 0.04) {
      const ev = evaluateTailObjective(rows, g, g);
      // Penalize excessive tail distortion slightly (L2 toward 0) + require strict tail loss/ECE discipline
      const regScore = ev.totalLogLoss + 0.004 * g * g;
      if (regScore < bestScore - 1e-5) {
        bestScore = regScore;
        bestGamma = Math.round(g * 100) / 100;
      }
    }

    // 2. Hierarchical class-specific refinement (Home vs Away) shrunk strongly toward pooledGamma
    let gH = bestGamma;
    let gA = bestGamma;
    const homeTailCount = rows.filter((r) => r.pH >= r.pD && r.pH >= r.pA && r.pH > TAIL_HINGE_THRESHOLD).length;
    const awayTailCount = rows.filter((r) => r.pA >= r.pD && r.pA >= r.pH && r.pA > TAIL_HINGE_THRESHOLD).length;

    if (homeTailCount >= 12) {
      let bestHScore = evaluateTailObjective(rows, bestGamma, bestGamma).totalLogLoss + 0.004 * bestGamma * bestGamma;
      for (let g = 0; g <= 0.751; g += 0.05) {
        const shrunkG = (homeTailCount * g + 16 * bestGamma) / (homeTailCount + 16);
        const ev = evaluateTailObjective(rows, shrunkG, bestGamma);
        const score = ev.totalLogLoss + 0.006 * (shrunkG - bestGamma) ** 2 + 0.003 * shrunkG ** 2;
        if (score < bestHScore - 1e-5) {
          bestHScore = score;
          gH = Math.round(shrunkG * 1000) / 1000;
        }
      }
    }

    if (awayTailCount >= 12) {
      let bestAScore = evaluateTailObjective(rows, gH, bestGamma).totalLogLoss + 0.004 * bestGamma * bestGamma;
      for (let g = 0; g <= 0.751; g += 0.05) {
        const shrunkG = (awayTailCount * g + 16 * bestGamma) / (awayTailCount + 16);
        const ev = evaluateTailObjective(rows, gH, shrunkG);
        const score = ev.totalLogLoss + 0.006 * (shrunkG - bestGamma) ** 2 + 0.003 * shrunkG ** 2;
        if (score < bestAScore - 1e-5) {
          bestAScore = score;
          gA = Math.round(shrunkG * 1000) / 1000;
        }
      }
    }

    return { pooledGamma: bestGamma, gammaHome: gH, gammaAway: gA };
  };

  // Internal 3-fold blocked CV strictly within prior (< T) to ensure tail shrinkage generalizes
  const k = 3;
  const foldSize = Math.floor(n / k);
  let cvBaseLoss = 0;
  let cvShrinkLoss = 0;
  let cvBaseTailPred = 0;
  let cvShrinkTailPred = 0;
  let cvTailHits = 0;
  let cvTailN = 0;
  let cvN = 0;

  for (let fold = 0; fold < k; fold++) {
    const start = fold * foldSize;
    const end = fold === k - 1 ? n : (fold + 1) * foldSize;
    const val = priorBaseSamples.slice(start, end);
    const train = [...priorBaseSamples.slice(0, start), ...priorBaseSamples.slice(end)];
    const gFold = fitGammas(train);

    for (const r of val) {
      const [bH, bD, bA] = normalizeSimplex(r.pH, r.pD, r.pA);
      const [sH, sD, sA] = applyTailGammaToTriple(bH, bD, bA, gFold.gammaHome, gFold.gammaAway);
      const bHit = r.winner === 'HOME' ? bH : r.winner === 'DRAW' ? bD : bA;
      const sHit = r.winner === 'HOME' ? sH : r.winner === 'DRAW' ? sD : sA;
      cvBaseLoss += -Math.log(Math.max(EPS, bHit));
      cvShrinkLoss += -Math.log(Math.max(EPS, sHit));
      cvN++;

      const bTop = Math.max(bH, bD, bA);
      if (bTop >= 0.7) {
        const predClass = bH >= bD && bH >= bA ? 'HOME' : bA >= bD && bA >= bH ? 'AWAY' : 'DRAW';
        cvBaseTailPred += bTop;
        cvShrinkTailPred += Math.max(sH, sD, sA);
        cvTailHits += predClass === r.winner ? 1 : 0;
        cvTailN++;
      }
    }
  }

  const avgBaseLoss = cvN > 0 ? cvBaseLoss / cvN : Infinity;
  const avgShrinkLoss = cvN > 0 ? cvShrinkLoss / cvN : Infinity;
  const baseTailErr = cvTailN > 0 ? Math.abs(cvBaseTailPred / cvTailN - cvTailHits / cvTailN) : 0;
  const shrinkTailErr = cvTailN > 0 ? Math.abs(cvShrinkTailPred / cvTailN - cvTailHits / cvTailN) : 0;

  const fullFit = fitGammas(priorBaseSamples);

  const passesCv =
    fullFit.pooledGamma > 0 &&
    avgShrinkLoss <= avgBaseLoss + 0.0005 &&
    (avgShrinkLoss < avgBaseLoss - 0.0002 || (cvTailN >= 10 && shrinkTailErr < baseTailErr - 0.01));

  if (!passesCv) {
    return {
      version: TAIL_SHRINKAGE_VERSION,
      status: 'CALIBRATED',
      hingeThreshold01: TAIL_HINGE_THRESHOLD,
      pooledGamma: 0,
      gammaHome: 0,
      gammaAway: 0,
      totalPriorSamples: n,
      tailPriorSamples: tailRows.length,
      applied: false,
      reason: `Causal CV confirmed no tail shrinkage needed (base CV LL=${avgBaseLoss.toFixed(4)}, shrunk=${avgShrinkLoss.toFixed(4)}).`,
    };
  }

  return {
    version: TAIL_SHRINKAGE_VERSION,
    status: 'CALIBRATED',
    hingeThreshold01: TAIL_HINGE_THRESHOLD,
    pooledGamma: fullFit.pooledGamma,
    gammaHome: fullFit.gammaHome,
    gammaAway: fullFit.gammaAway,
    totalPriorSamples: n,
    tailPriorSamples: tailRows.length,
    applied: true,
    reason: `Causal tail shrinkage applied above ${(TAIL_HINGE_THRESHOLD * 100).toFixed(0)}%: γ_H=${fullFit.gammaHome.toFixed(2)}, γ_A=${fullFit.gammaAway.toFixed(2)} (${tailRows.length} tail priors).`,
  };
}

/**
 * Approach D: Conservative Causal Tail Shrinkage over Causal Base Calibration (Temp or Beta selected by < T CV).
 * Reversible, parameterized, versioned, and strictly NOT_TRAINED below required causal priors.
 */
export function calibrate1XTwoApproachD_TailShrinkage(
  rawH01: number,
  rawD01: number,
  rawA01: number,
  targetUtc: string,
  allSamples: Phase5_1CalibSample1X2[]
): Phase5_1OneXTwoCalibrationResult {
  const [rawH, rawD, rawA] = normalizeSimplex(rawH01, rawD01, rawA01);
  const targetMs = new Date(targetUtc).getTime();

  const prior = Number.isFinite(targetMs)
    ? allSamples
        .filter((s) => Number.isFinite(s.timestampMs) && s.timestampMs < targetMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  if (prior.length < MIN_TAIL_CALIB_SAMPLES) {
    const params: TailShrinkageParameters = {
      version: TAIL_SHRINKAGE_VERSION,
      status: 'NOT_TRAINED',
      hingeThreshold01: TAIL_HINGE_THRESHOLD,
      pooledGamma: 0,
      gammaHome: 0,
      gammaAway: 0,
      totalPriorSamples: prior.length,
      tailPriorSamples: prior.filter((r) => Math.max(r.pH, r.pD, r.pA) > TAIL_HINGE_THRESHOLD).length,
      applied: false,
      reason: `Tail shrinkage NOT_TRAINED (${prior.length}/${MIN_TAIL_CALIB_SAMPLES} causal priors).`,
    };
    return {
      approach: 'D_TAIL_SHRINKAGE',
      homeWin01: rawH,
      draw01: rawD,
      awayWin01: rawA,
      status: 'NOT_TRAINED',
      sampleCount: prior.length,
      temperature: 1.0,
      tailShrinkage: params,
      reason: params.reason,
    };
  }

  // Step 1: Start from Blocked-CV Temperature Scaling (Approach B) strictly on < T prior samples
  const tempRes = calibrate1XTwoApproachB_Temperature(rawH, rawD, rawA, targetUtc, prior);
  const tempFit = prior.length >= P51_MIN_TEMP_SAMPLES ? fitCausal1XTwoTemperature(prior) : null;

  const baseH = tempRes.homeWin01;
  const baseD = tempRes.draw01;
  const baseA = tempRes.awayWin01;
  const baseTemp: number | null = tempRes.temperature;

  let baseMapper: (s: Phase5_1CalibSample1X2) => [number, number, number] = (s) =>
    normalizeSimplex(s.pH, s.pD, s.pA);

  if (tempFit && tempFit.applied) {
    const invT = 1 / Math.max(0.5, tempFit.T);
    baseMapper = (s) => {
      const [h, d, a] = normalizeSimplex(s.pH, s.pD, s.pA);
      const sH = Math.pow(h, invT);
      const sD = Math.pow(d, invT);
      const sA = Math.pow(a, invT);
      const sum = Math.max(EPS, sH + sD + sA);
      return [sH / sum, sD / sum, sA / sum];
    };
  }

  // Step 2: Fit causal tail shrinkage parameters on base-calibrated < T historical priors
  const mappedPriors = prior.map((s) => {
    const [mH, mD, mA] = baseMapper(s);
    return {
      timestampMs: s.timestampMs,
      pH: mH,
      pD: mD,
      pA: mA,
      winner: s.winner,
    };
  });

  const shrinkage = fitCausalTailShrinkage(mappedPriors);

  if (shrinkage.status === 'NOT_TRAINED') {
    return {
      approach: 'D_TAIL_SHRINKAGE',
      homeWin01: baseH,
      draw01: baseD,
      awayWin01: baseA,
      status: 'NOT_TRAINED',
      sampleCount: prior.length,
      temperature: baseTemp,
      tailShrinkage: shrinkage,
      reason: `${tempRes.reason} | ${shrinkage.reason}`,
    };
  }

  const [finalH, finalD, finalA] = shrinkage.applied
    ? applyTailGammaToTriple(baseH, baseD, baseA, shrinkage.gammaHome, shrinkage.gammaAway)
    : [baseH, baseD, baseA];

  return {
    approach: 'D_TAIL_SHRINKAGE',
    homeWin01: finalH,
    draw01: finalD,
    awayWin01: finalA,
    status: 'CALIBRATED',
    sampleCount: prior.length,
    temperature: baseTemp,
    tailShrinkage: shrinkage,
    reason: shrinkage.applied ? shrinkage.reason : `${tempRes.reason} | ${shrinkage.reason}`,
  };
}
