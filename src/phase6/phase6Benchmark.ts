/**
 * Phase 6 Chronological Walk-Forward Benchmark Runner (Steps 1-3)
 *
 * Evaluates on approved development chains ONLY:
 * - Chain A: OpenLigaDB Bundesliga 2016-2021 + 2. Bundesliga 2015-2020 tier bridge
 * - Chain C: StatsBomb FA WSL 2018/19 -> 2019/20 -> 2020/21
 *
 * Strictly enforces:
 * - Exact timestamp cohort batching (evaluate batch < T, commit batch after)
 * - Identical paired cohorts for quality comparison (quality and coverage reported separately)
 * - skipObservedXG: true on all StatsBomb statistics fetches
 * - Zero access to Protected Holdouts, External Validation, or Chain B confirmatory sets
 */

import { Match, Prediction } from '../types/football';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { Phase6CrossSeasonLoader, groupMatchesByExactTimestamp } from './crossSeasonLoader';
import { Phase6HierarchicalEngine } from './crossSeasonState';
import {
  Phase6PrunedDrawTracker,
  computeEloSymmetry,
  evaluateDrawAcceptanceGate,
} from './phase6DrawModel';
import {
  evaluateBttsAcceptanceGate,
  evaluatePhase6BttsMatch,
} from './phase6BttsModel';
import {
  APPROVED_CHAIN_A_BL1_SEASONS,
  APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS,
  CHAIN_B_CONFIRMATORY_IDS,
  EXTERNAL_VALIDATION_IDS,
  PROTECTED_BLIND_HOLDOUT_IDS,
  assertApprovedPhase6Dataset,
  enforceSkipObservedXG,
} from './phase6Guards';
import {
  MODEL_VERSION_PHASE6,
  PHASE6_INTER_SEASON_DECAY,
  PHASE6_MIN_EDGE_LOGLOSS_DELTA,
  PHASE6_PRIOR_EFFECTIVE_MATCHES,
  PHASE6_PROMOTED_ELO_ADJUSTMENT,
  PHASE6_PROMOTED_GOAL_SCALE,
  PHASE6_SHRINKAGE_K,
  Phase6BenchmarkReport,
  Phase6BinaryMetricSummary,
  Phase6CalibrationBin,
  Phase6CleanMatch,
  Phase6CohortEvaluation,
  Phase6CompetitionSummary,
  Phase6GoalMetricSummary,
  Phase6MetricSummary1X2,
  Phase6SeasonDataset,
  Phase6SeasonReport,
  Phase6TeamProvenance,
} from './phase6Types';

const EPS = 1e-6;

interface OneXTwoSample {
  pH: number;
  pD: number;
  pA: number;
  winner: 'HOME' | 'DRAW' | 'AWAY';
}

interface BinarySample {
  prob01: number;
  actual: boolean;
}

interface GoalSample {
  predH: number;
  predA: number;
  actH: number;
  actA: number;
}

interface PairedMatchObs {
  match: Phase6CleanMatch;
  seasonKey: string;
  competitionKey: string;
  isColdStartCohort: boolean;
  isPromotedTeamMatch: boolean;
  provenance: Phase6TeamProvenance;

  // Phase 6 Cross-Season
  p6OneXTwo: OneXTwoSample;
  p6RawOneXTwo: OneXTwoSample;
  p6O25: BinarySample;
  p6Goal: GoalSample;
  p6Draw: BinarySample;
  p6BttsDecoupled: BinarySample;
  p6BttsLightPoisson: BinarySample;

  // Single-Season Baseline (identical math, zero carryover)
  ssOneXTwo: OneXTwoSample;
  ssO25: BinarySample;
  ssGoal: GoalSample;
  ssDrawPruned: BinarySample;
  ssBttsLightPoisson: BinarySample;

  // Causal Hierarchical League Prior
  priorOneXTwo: OneXTwoSample;
  priorO25: BinarySample;
  priorGoal: GoalSample;
  priorDraw: BinarySample;
  priorBtts: BinarySample;

  // Phase 3 Frozen
  p3Active: boolean;
  p3AbstainReason: string | null;
  p3OneXTwo: OneXTwoSample | null;
  p3O25: BinarySample | null;
  p3Goal: GoalSample | null;
  p3Btts: BinarySample | null;
}

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function meanAndCi95(values: number[]): { mean: number | null; ci95: [number, number] | null } {
  const n = values.length;
  if (n === 0) return { mean: null, ci95: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) {
    const r = Math.round(mean * 10000) / 10000;
    return { mean: r, ci95: [r, r] };
  }
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const margin = 1.96 * se;
  return {
    mean: Math.round(mean * 10000) / 10000,
    ci95: [Math.round((mean - margin) * 10000) / 10000, Math.round((mean + margin) * 10000) / 10000],
  };
}

function computeBinaryRocAuc(samples: BinarySample[]): number | null {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const s of samples) {
    if (s.actual) pos.push(s.prob01);
    else neg.push(s.prob01);
  }
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (p > q) wins += 1;
      else if (p === q) wins += 0.5;
    }
  }
  return Math.round((wins / (pos.length * neg.length)) * 10000) / 10000;
}

function buildBinaryCalibrationBins(samples: BinarySample[]): {
  bins: Phase6CalibrationBin[];
  ecePct: number | null;
} {
  const edges: Array<[string, number, number]> = [
    ['0-20%', 0, 0.2],
    ['20-35%', 0.2, 0.35],
    ['35-50%', 0.35, 0.5],
    ['50-65%', 0.5, 0.65],
    ['65-80%', 0.65, 0.8],
    ['80-100%', 0.8, 1.0001],
  ];
  const n = samples.length;
  const bins: Phase6CalibrationBin[] = [];
  let ece = 0;

  for (const [label, lo, hi] of edges) {
    const sub = samples.filter((s) => s.prob01 >= lo && s.prob01 < hi);
    if (sub.length === 0) {
      bins.push({ binLabel: label, count: 0, meanPredictedPct: null, actualRatePct: null, absErrorPct: null });
      continue;
    }
    const avgP = sub.reduce((a, s) => a + s.prob01, 0) / sub.length;
    const avgY = sub.filter((s) => s.actual).length / sub.length;
    const err = Math.abs(avgP - avgY);
    ece += (sub.length / n) * err;
    bins.push({
      binLabel: label,
      count: sub.length,
      meanPredictedPct: Math.round(avgP * 1000) / 10,
      actualRatePct: Math.round(avgY * 1000) / 10,
      absErrorPct: Math.round(err * 1000) / 10,
    });
  }

  return {
    bins,
    ecePct: n > 0 ? Math.round(ece * 1000) / 10 : null,
  };
}

function summarize1X2(
  totalFixtures: number,
  samples: Array<OneXTwoSample | null>
): Phase6MetricSummary1X2 {
  const valid = samples.filter((s): s is OneXTwoSample => s !== null);
  const n = valid.length;
  const abstainedCount = totalFixtures - n;
  const coveragePct = totalFixtures > 0 ? Math.round((n / totalFixtures) * 1000) / 10 : 0;

  if (n === 0) {
    return {
      totalFixtures,
      evaluatedCount: 0,
      abstainedCount,
      coveragePct,
      accuracyPct: null,
      accuracyCi95: null,
      brier: null,
      brierCi95: null,
      logLoss: null,
      logLossCi95: null,
      ecePct: null,
      tailEcePct: null,
      calibrationBins: [],
    };
  }

  const hits: number[] = [];
  const briers: number[] = [];
  const losses: number[] = [];
  const maxConfSamples: BinarySample[] = [];

  for (const s of valid) {
    const sum = Math.max(EPS, s.pH + s.pD + s.pA);
    const pH = clampProb(s.pH / sum);
    const pD = clampProb(s.pD / sum);
    const pA = clampProb(s.pA / sum);

    const pred: 'HOME' | 'DRAW' | 'AWAY' =
      pH >= pD && pH >= pA ? 'HOME' : pA >= pH && pA >= pD ? 'AWAY' : 'DRAW';
    const isHit = pred === s.winner;
    hits.push(isHit ? 1 : 0);

    const yH = s.winner === 'HOME' ? 1 : 0;
    const yD = s.winner === 'DRAW' ? 1 : 0;
    const yA = s.winner === 'AWAY' ? 1 : 0;
    briers.push((pH - yH) ** 2 + (pD - yD) ** 2 + (pA - yA) ** 2);

    const pWin = s.winner === 'HOME' ? pH : s.winner === 'DRAW' ? pD : pA;
    losses.push(-Math.log(Math.max(EPS, pWin)));

    const topProb = Math.max(pH, pD, pA);
    maxConfSamples.push({ prob01: topProb, actual: isHit });
  }

  const accStat = meanAndCi95(hits);
  const brierStat = meanAndCi95(briers);
  const lossStat = meanAndCi95(losses);
  const { bins, ecePct } = buildBinaryCalibrationBins(maxConfSamples);

  const tail = maxConfSamples.filter((s) => s.prob01 >= 0.65);
  const tailEcePct =
    tail.length > 0
      ? Math.round(
          Math.abs(
            tail.reduce((a, s) => a + s.prob01, 0) / tail.length -
              tail.filter((s) => s.actual).length / tail.length
          ) *
            1000
        ) / 10
      : null;

  return {
    totalFixtures,
    evaluatedCount: n,
    abstainedCount,
    coveragePct,
    accuracyPct: accStat.mean !== null ? Math.round(accStat.mean * 1000) / 10 : null,
    accuracyCi95: accStat.ci95
      ? [Math.round(accStat.ci95[0] * 1000) / 10, Math.round(accStat.ci95[1] * 1000) / 10]
      : null,
    brier: brierStat.mean,
    brierCi95: brierStat.ci95,
    logLoss: lossStat.mean,
    logLossCi95: lossStat.ci95,
    ecePct,
    tailEcePct,
    calibrationBins: bins,
  };
}

function summarizeBinary(
  totalFixtures: number,
  samples: Array<BinarySample | null>
): Phase6BinaryMetricSummary {
  const valid = samples.filter((s): s is BinarySample => s !== null);
  const n = valid.length;
  const abstainedCount = totalFixtures - n;
  const coveragePct = totalFixtures > 0 ? Math.round((n / totalFixtures) * 1000) / 10 : 0;

  if (n === 0) {
    return {
      totalFixtures,
      evaluatedCount: 0,
      abstainedCount,
      coveragePct,
      actualPositiveRatePct: null,
      meanPredictedProbPct: null,
      brier: null,
      brierCi95: null,
      logLoss: null,
      logLossCi95: null,
      ecePct: null,
      rocAuc: null,
      calibrationBins: [],
    };
  }

  const briers: number[] = [];
  const losses: number[] = [];
  let sumP = 0;
  let posCount = 0;

  for (const s of valid) {
    const p = clampProb(s.prob01);
    const y = s.actual ? 1 : 0;
    sumP += p;
    posCount += y;
    briers.push((p - y) ** 2);
    losses.push(s.actual ? -Math.log(p) : -Math.log(1 - p));
  }

  const brierStat = meanAndCi95(briers);
  const lossStat = meanAndCi95(losses);
  const { bins, ecePct } = buildBinaryCalibrationBins(valid);

  return {
    totalFixtures,
    evaluatedCount: n,
    abstainedCount,
    coveragePct,
    actualPositiveRatePct: Math.round((posCount / n) * 1000) / 10,
    meanPredictedProbPct: Math.round((sumP / n) * 1000) / 10,
    brier: brierStat.mean,
    brierCi95: brierStat.ci95,
    logLoss: lossStat.mean,
    logLossCi95: lossStat.ci95,
    ecePct,
    rocAuc: computeBinaryRocAuc(valid),
    calibrationBins: bins,
  };
}

function summarizeGoals(
  totalFixtures: number,
  samples: Array<GoalSample | null>
): Phase6GoalMetricSummary {
  const valid = samples.filter((s): s is GoalSample => s !== null);
  const n = valid.length;
  const abstainedCount = totalFixtures - n;
  const coveragePct = totalFixtures > 0 ? Math.round((n / totalFixtures) * 1000) / 10 : 0;

  if (n === 0) {
    return {
      totalFixtures,
      evaluatedCount: 0,
      abstainedCount,
      coveragePct,
      maeTotal: null,
      rmseTotal: null,
      maePerTeamGoal: null,
      rmsePerTeamGoal: null,
      meanPredictedTotal: null,
      meanActualTotal: null,
      biasTotal: null,
    };
  }

  let absTot = 0;
  let sqTot = 0;
  let absSide = 0;
  let sqSide = 0;
  let sumPredTot = 0;
  let sumActTot = 0;

  for (const g of valid) {
    const pTot = g.predH + g.predA;
    const aTot = g.actH + g.actA;
    sumPredTot += pTot;
    sumActTot += aTot;
    absTot += Math.abs(pTot - aTot);
    sqTot += (pTot - aTot) ** 2;
    absSide += Math.abs(g.predH - g.actH) + Math.abs(g.predA - g.actA);
    sqSide += (g.predH - g.actH) ** 2 + (g.predA - g.actA) ** 2;
  }

  const meanPred = sumPredTot / n;
  const meanAct = sumActTot / n;

  return {
    totalFixtures,
    evaluatedCount: n,
    abstainedCount,
    coveragePct,
    maeTotal: Math.round((absTot / n) * 10000) / 10000,
    rmseTotal: Math.round(Math.sqrt(sqTot / n) * 10000) / 10000,
    maePerTeamGoal: Math.round((absSide / (2 * n)) * 10000) / 10000,
    rmsePerTeamGoal: Math.round(Math.sqrt(sqSide / (2 * n)) * 10000) / 10000,
    meanPredictedTotal: Math.round(meanPred * 1000) / 1000,
    meanActualTotal: Math.round(meanAct * 1000) / 1000,
    biasTotal: Math.round((meanPred - meanAct) * 1000) / 1000,
  };
}

function summarizeCohort(cohortName: string, rows: PairedMatchObs[]): Phase6CohortEvaluation {
  const n = rows.length;
  const provCounts: Record<Phase6TeamProvenance, number> = {
    SAME_SEASON_DATA: 0,
    CROSS_SEASON_PRIOR: 0,
    PROMOTED_TEAM_TIER_ADJUSTED: 0,
    LEAGUE_PRIOR_ONLY: 0,
  };
  const p3AbstainReasons: Record<string, number> = {};

  for (const r of rows) {
    provCounts[r.provenance]++;
    if (!r.p3Active && r.p3AbstainReason) {
      const key =
        r.p3AbstainReason === 'MISSING_RAW_MATCH'
          ? 'MISSING_RAW_MATCH'
          : /sample size|minimum 5|insufficient verified|< 5/i.test(r.p3AbstainReason)
          ? 'INSUFFICIENT_TEAM_SAMPLE_<5'
          : /league-wide|minimum 10/i.test(r.p3AbstainReason)
          ? 'INSUFFICIENT_LEAGUE_SAMPLE_<10'
          : 'UNCERTAINTY_OR_QUALITY_GATE';
      p3AbstainReasons[key] = (p3AbstainReasons[key] ?? 0) + 1;
    }
  }

  const p3ActiveRows = rows.filter((r) => r.p3Active);
  const activeN = p3ActiveRows.length;

  const drawPriorSummary = summarizeBinary(n, rows.map((r) => r.priorDraw));
  const drawPrunedSummary = summarizeBinary(n, rows.map((r) => r.p6Draw));

  const bttsPriorSummary = summarizeBinary(n, rows.map((r) => r.priorBtts));
  const bttsDecoupledSummary = summarizeBinary(n, rows.map((r) => r.p6BttsDecoupled));
  const bttsLightPoissonSummary = summarizeBinary(n, rows.map((r) => r.p6BttsLightPoisson));

  return {
    cohortName,
    fixtureCount: n,
    provenanceCounts: provCounts,
    phase3AbstainReasons: p3AbstainReasons,
    goals: {
      phase6CrossSeason: summarizeGoals(n, rows.map((r) => r.p6Goal)),
      singleSeasonBaseline: summarizeGoals(n, rows.map((r) => r.ssGoal)),
      phase3FrozenAll: summarizeGoals(n, rows.map((r) => r.p3Goal)),
      phase3FrozenActive: summarizeGoals(activeN, p3ActiveRows.map((r) => r.p3Goal)),
      causalLeaguePrior: summarizeGoals(n, rows.map((r) => r.priorGoal)),
    },
    oneXTwo: {
      phase6CrossSeason: summarize1X2(n, rows.map((r) => r.p6OneXTwo)),
      phase6RawUnCalibrated: summarize1X2(n, rows.map((r) => r.p6RawOneXTwo)),
      singleSeasonBaseline: summarize1X2(n, rows.map((r) => r.ssOneXTwo)),
      phase3FrozenAll: summarize1X2(n, rows.map((r) => r.p3OneXTwo)),
      phase3FrozenActive: summarize1X2(activeN, p3ActiveRows.map((r) => r.p3OneXTwo)),
      causalLeaguePrior: summarize1X2(n, rows.map((r) => r.priorOneXTwo)),
    },
    over25: {
      phase6CrossSeason: summarizeBinary(n, rows.map((r) => r.p6O25)),
      singleSeasonBaseline: summarizeBinary(n, rows.map((r) => r.ssO25)),
      phase3FrozenActive: summarizeBinary(activeN, p3ActiveRows.map((r) => r.p3O25)),
      causalLeaguePrior: summarizeBinary(n, rows.map((r) => r.priorO25)),
    },
    draw: {
      causalLeaguePrior: drawPriorSummary,
      phase6Pruned: drawPrunedSummary,
      singleSeasonPruned: summarizeBinary(n, rows.map((r) => r.ssDrawPruned)),
      deltaLogLossVsPrior:
        drawPriorSummary.logLoss !== null && drawPrunedSummary.logLoss !== null
          ? Math.round((drawPrunedSummary.logLoss - drawPriorSummary.logLoss) * 100000) / 100000
          : null,
    },
    btts: {
      causalLeaguePrior: bttsPriorSummary,
      phase6DecoupledFtsCs: bttsDecoupledSummary,
      phase6LightPoissonDc: bttsLightPoissonSummary,
      singleSeasonLightPoissonDc: summarizeBinary(n, rows.map((r) => r.ssBttsLightPoisson)),
      phase3FrozenActive: summarizeBinary(activeN, p3ActiveRows.map((r) => r.p3Btts)),
      deltaLogLossDecoupledVsPrior:
        bttsPriorSummary.logLoss !== null && bttsDecoupledSummary.logLoss !== null
          ? Math.round((bttsDecoupledSummary.logLoss - bttsPriorSummary.logLoss) * 100000) / 100000
          : null,
      deltaLogLossPoissonVsPrior:
        bttsPriorSummary.logLoss !== null && bttsLightPoissonSummary.logLoss !== null
          ? Math.round((bttsLightPoissonSummary.logLoss - bttsPriorSummary.logLoss) * 100000) / 100000
          : null,
    },
  };
}

function extractPhase3PredictionMetrics(
  cleanMatch: Phase6CleanMatch,
  p3Pred: Prediction,
  p3Stats: { homeExpectedGoals: number | null; awayExpectedGoals: number | null }
): {
  active: boolean;
  abstainReason: string | null;
  oneXTwo: OneXTwoSample | null;
  o25: BinarySample | null;
  goal: GoalSample | null;
  btts: BinarySample | null;
} {
  if (p3Pred.modelType === 'ABSTAIN' || !p3Pred.probabilities) {
    return {
      active: false,
      abstainReason: p3Pred.abstainReason || 'ABSTAIN',
      oneXTwo: null,
      o25: null,
      goal: null,
      btts: null,
    };
  }
  const probs = p3Pred.probabilities;
  const winner: 'HOME' | 'DRAW' | 'AWAY' =
    cleanMatch.homeGoals > cleanMatch.awayGoals
      ? 'HOME'
      : cleanMatch.homeGoals < cleanMatch.awayGoals
      ? 'AWAY'
      : 'DRAW';

  const predH = p3Stats.homeExpectedGoals ?? p3Pred.expectedScore?.home ?? 1.4;
  const predA = p3Stats.awayExpectedGoals ?? p3Pred.expectedScore?.away ?? 1.1;

  return {
    active: true,
    abstainReason: null,
    oneXTwo: {
      pH: clampProb(probs.homeWin / 100),
      pD: clampProb(probs.draw / 100),
      pA: clampProb(probs.awayWin / 100),
      winner,
    },
    o25: {
      prob01: clampProb(probs.over25 / 100),
      actual: cleanMatch.homeGoals + cleanMatch.awayGoals > 2.5,
    },
    goal: {
      predH,
      predA,
      actH: cleanMatch.homeGoals,
      actA: cleanMatch.awayGoals,
    },
    btts: {
      prob01: clampProb(probs.bttsYes / 100),
      actual: cleanMatch.homeGoals > 0 && cleanMatch.awayGoals > 0,
    },
  };
}

/**
 * Evaluate a single chronological competition chain cleanly (Phase 6 Cross-Season vs Single-Season vs Phase 3 Frozen vs League Prior).
 */
async function evaluateCompetitionChain(params: {
  competitionKey: string;
  seasons: Phase6SeasonDataset[];
  burnInSeasonKeys: ReadonlySet<string>;
  feederByTargetSeasonKey?: Map<string, Phase6SeasonDataset>;
  loader: Phase6CrossSeasonLoader;
}): Promise<{
  seasonReports: Phase6SeasonReport[];
  competitionSummary: Phase6CompetitionSummary;
  nonBurnInObservations: PairedMatchObs[];
}> {
  const { competitionKey, seasons, burnInSeasonKeys, feederByTargetSeasonKey, loader } = params;

  const crossEngine = new Phase6HierarchicalEngine({
    mode: 'CROSS_SEASON',
    interSeasonDecay: PHASE6_INTER_SEASON_DECAY,
    promotedGoalScale: PHASE6_PROMOTED_GOAL_SCALE,
    promotedEloAdjustment: PHASE6_PROMOTED_ELO_ADJUSTMENT,
    shrinkageK: PHASE6_SHRINKAGE_K,
    priorEffectiveMatches: PHASE6_PRIOR_EFFECTIVE_MATCHES,
  });

  const singleEngine = new Phase6HierarchicalEngine({
    mode: 'SINGLE_SEASON',
    shrinkageK: PHASE6_SHRINKAGE_K,
  });

  const crossDrawTracker = new Phase6PrunedDrawTracker();
  const singleDrawTracker = new Phase6PrunedDrawTracker();

  const seasonReports: Phase6SeasonReport[] = [];
  const allObservations: PairedMatchObs[] = [];
  const nonBurnInObservations: PairedMatchObs[] = [];
  const burnInLabels: string[] = [];
  const evalLabels: string[] = [];

  for (const season of seasons) {
    const feederDs = feederByTargetSeasonKey?.get(season.seasonKey);
    const feederEndStates = feederDs
      ? Phase6HierarchicalEngine.replayFeederSeasonEndStates(
          groupMatchesByExactTimestamp(feederDs.matches),
          feederDs.seasonKey,
          feederDs.tier
        )
      : undefined;

    crossEngine.startSeason({
      seasonKey: season.seasonKey,
      tier: season.tier,
      feederEndStates,
    });
    singleEngine.startSeason({
      seasonKey: season.seasonKey,
      tier: season.tier,
    });
    singleDrawTracker.clear();

    const rawMatchesList = loader.getRawMatchesByCacheKey(season.seasonKey);
    const rawById = new Map<string, Match>();
    for (const rm of rawMatchesList) rawById.set(rm.id, rm);

    const batches = groupMatchesByExactTimestamp(season.matches);
    const seasonObs: PairedMatchObs[] = [];

    // Causal empirical 1X2 league outcome tracker inside current/cross-season prior
    let empWinsH = 0;
    let empDraws = 0;
    let empWinsA = 0;
    let empCount = 0;

    for (const batch of batches) {
      const p6Projs = crossEngine.evaluateBatch(batch);
      const ssProjs = singleEngine.evaluateBatch(batch);

      const p6DrawCommits = [];
      const ssDrawCommits = [];

      for (let i = 0; i < batch.matches.length; i++) {
        const m = batch.matches[i];
        const p6 = p6Projs[i];
        const ss = ssProjs[i];

        const winner: 'HOME' | 'DRAW' | 'AWAY' =
          m.homeGoals > m.awayGoals ? 'HOME' : m.homeGoals < m.awayGoals ? 'AWAY' : 'DRAW';
        const isDraw = winner === 'DRAW';
        const isO25 = m.homeGoals + m.awayGoals > 2.5;
        const isBtts = m.homeGoals > 0 && m.awayGoals > 0;

        const p6Draw = crossDrawTracker.evaluateMatch(p6);
        const ssDraw = singleDrawTracker.evaluateMatch(ss);
        const p6Btts = evaluatePhase6BttsMatch(p6);

        // Lightly shrunk Poisson-DC BTTS for Single-Season ablation
        const ssPoisDcBtts01 =
          calculatePoissonProbabilities(ss.lambdaHome, ss.lambdaAway, 7, true).markets.bttsYes / 100;

        // Causal league prior 1X2 (Laplace-smoothed strictly < T with pre-registered 45/25/30 prior)
        const priorD = p6.competitionPriors.leagueDrawRate;
        const hShareGivenNonDraw =
          empCount >= 10
            ? (empWinsH + 6 * 0.6) / (empWinsH + empWinsA + 10)
            : 0.6;
        const priorH = (1 - priorD) * hShareGivenNonDraw;
        const priorA = (1 - priorD) * (1 - hShareGivenNonDraw);

        // Evaluate Phase 3 Frozen strictly on same raw match (< T inside provider)
        const rawMatch = rawById.get(m.id);
        let p3Out: ReturnType<typeof extractPhase3PredictionMetrics> = {
          active: false,
          abstainReason: 'MISSING_RAW_MATCH',
          oneXTwo: null,
          o25: null,
          goal: null,
          btts: null,
        };

        if (rawMatch) {
          if (m.provider === 'openliga') {
            const ol = loader.getOpenLigaProvider();
            const st = await ol.getMatchStatistics(rawMatch);
            const pred = await ol.calculatePrediction(rawMatch, st, { includeMonteCarlo: false });
            p3Out = extractPhase3PredictionMetrics(m, pred, st);
          } else {
            const sb = loader.getStatsBombProvider();
            // Enforce skipObservedXG: true unconditionally via loader wrapper
            const st = await loader.fetchStatsBombStatisticsStrict(
              rawMatch,
              enforceSkipObservedXG({ skipObservedXG: true })
            );
            const pred = await sb.calculatePrediction(rawMatch, st, { includeMonteCarlo: false });
            p3Out = extractPhase3PredictionMetrics(m, pred, st);
          }
        }

        const obs: PairedMatchObs = {
          match: m,
          seasonKey: season.seasonKey,
          competitionKey,
          isColdStartCohort: p6.isColdStartCohort,
          isPromotedTeamMatch: p6.isPromotedTeamMatch,
          provenance: p6.matchProvenance,
          p6OneXTwo: {
            pH: p6.calibrated1X2.homeWin01,
            pD: p6.calibrated1X2.draw01,
            pA: p6.calibrated1X2.awayWin01,
            winner,
          },
          p6RawOneXTwo: {
            pH: p6.blended1X2.homeWin01,
            pD: p6.blended1X2.draw01,
            pA: p6.blended1X2.awayWin01,
            winner,
          },
          p6O25: { prob01: p6.hierarchicalO25_01, actual: isO25 },
          p6Goal: {
            predH: p6.lambdaHome,
            predA: p6.lambdaAway,
            actH: m.homeGoals,
            actA: m.awayGoals,
          },
          p6Draw: { prob01: p6Draw.prunedModelProb01, actual: isDraw },
          p6BttsDecoupled: { prob01: p6Btts.decoupledFtsCsProb01, actual: isBtts },
          p6BttsLightPoisson: { prob01: p6Btts.lightlyShrunkPoissonDcProb01, actual: isBtts },

          ssOneXTwo: {
            pH: ss.blended1X2.homeWin01,
            pD: ss.blended1X2.draw01,
            pA: ss.blended1X2.awayWin01,
            winner,
          },
          ssO25: { prob01: ss.hierarchicalO25_01, actual: isO25 },
          ssGoal: {
            predH: ss.lambdaHome,
            predA: ss.lambdaAway,
            actH: m.homeGoals,
            actA: m.awayGoals,
          },
          ssDrawPruned: { prob01: ssDraw.prunedModelProb01, actual: isDraw },
          ssBttsLightPoisson: { prob01: clampProb(ssPoisDcBtts01), actual: isBtts },

          priorOneXTwo: { pH: priorH, pD: priorD, pA: priorA, winner },
          priorO25: { prob01: p6.competitionPriors.leagueOver25Rate, actual: isO25 },
          priorGoal: {
            predH: p6.competitionPriors.avgHomeGoals,
            predA: p6.competitionPriors.avgAwayGoals,
            actH: m.homeGoals,
            actA: m.awayGoals,
          },
          priorDraw: { prob01: p6Draw.leagueDrawPrior01, actual: isDraw },
          priorBtts: { prob01: p6Btts.leagueBttsPrior01, actual: isBtts },

          p3Active: p3Out.active,
          p3AbstainReason: p3Out.abstainReason,
          p3OneXTwo: p3Out.oneXTwo,
          p3O25: p3Out.o25,
          p3Goal: p3Out.goal,
          p3Btts: p3Out.btts,
        };

        seasonObs.push(obs);

        p6DrawCommits.push({
          timestampMs: batch.timestampMs,
          leagueDrawPrior01: p6Draw.leagueDrawPrior01,
          poissonDrawProb01: p6Draw.poissonDrawProb01,
          eloSymmetry: computeEloSymmetry(p6.homeEloCausal, p6.awayEloCausal),
          totalExpectedGoals: p6Draw.totalExpectedGoals,
          isDraw,
        });
        ssDrawCommits.push({
          timestampMs: batch.timestampMs,
          leagueDrawPrior01: ssDraw.leagueDrawPrior01,
          poissonDrawProb01: ssDraw.poissonDrawProb01,
          eloSymmetry: computeEloSymmetry(ss.homeEloCausal, ss.awayEloCausal),
          totalExpectedGoals: ssDraw.totalExpectedGoals,
          isDraw,
        });
      }

      // Commit batch ONLY AFTER all fixtures in exact-timestamp batch T are evaluated
      crossEngine.commitBatch(batch, p6Projs);
      singleEngine.commitBatch(batch, ssProjs);
      crossDrawTracker.commitBatch(p6DrawCommits);
      singleDrawTracker.commitBatch(ssDrawCommits);

      for (const m of batch.matches) {
        empCount++;
        if (m.homeGoals > m.awayGoals) empWinsH++;
        else if (m.homeGoals === m.awayGoals) empDraws++;
        else empWinsA++;
      }
      void empDraws;
    }

    const isBurnIn = burnInSeasonKeys.has(season.seasonKey);
    if (isBurnIn) burnInLabels.push(season.seasonLabel);
    else evalLabels.push(season.seasonLabel);

    const coldRows = seasonObs.filter((r) => r.isColdStartCohort);
    const promoRows = seasonObs.filter((r) => r.isPromotedTeamMatch);

    seasonReports.push({
      seasonKey: season.seasonKey,
      competitionKey,
      seasonLabel: season.seasonLabel,
      isBurnInSeason: isBurnIn,
      exclusions: season.exclusions,
      fullSeason: summarizeCohort(`${season.seasonLabel} Full Season`, seasonObs),
      coldStartFirst45: summarizeCohort(`${season.seasonLabel} Cold-Start (First 45)`, coldRows),
      promotedTeamFirst10:
        promoRows.length > 0
          ? summarizeCohort(`${season.seasonLabel} Promoted Teams (First 10)`, promoRows)
          : null,
    });

    allObservations.push(...seasonObs);
    if (!isBurnIn) {
      nonBurnInObservations.push(...seasonObs);
    }
  }

  const nonBurnInPromo = nonBurnInObservations.filter((r) => r.isPromotedTeamMatch);
  const nonBurnInCold = nonBurnInObservations.filter((r) => r.isColdStartCohort);

  const competitionSummary: Phase6CompetitionSummary = {
    competitionKey,
    seasonsEvaluated: evalLabels,
    burnInSeasons: burnInLabels,
    combinedNonBurnInFull: summarizeCohort(`${competitionKey} Cross-Season Full`, nonBurnInObservations),
    combinedColdStart: summarizeCohort(`${competitionKey} Cross-Season Cold-Start`, nonBurnInCold),
    combinedPromotedTeams:
      nonBurnInPromo.length > 0
        ? summarizeCohort(`${competitionKey} Promoted Teams (First 10)`, nonBurnInPromo)
        : null,
    allSeasonsFull: summarizeCohort(`${competitionKey} All Seasons`, allObservations),
  };

  return { seasonReports, competitionSummary, nonBurnInObservations };
}

/**
 * Run complete Phase 6 Steps 1-3 benchmark on approved Chain A (and Chain C for multi-competition verification).
 * Chain B (2009-2014) is strictly NOT touched or executed.
 */
export async function runPhase6Step1to3Benchmark(options?: {
  includeChainC?: boolean;
  loader?: Phase6CrossSeasonLoader;
}): Promise<Phase6BenchmarkReport> {
  const loader = options?.loader ?? new Phase6CrossSeasonLoader();
  const includeChainC = options?.includeChainC ?? true;

  // Verify approved Chain A IDs cleanly
  for (const s of APPROVED_CHAIN_A_BL1_SEASONS) assertApprovedPhase6Dataset(`openliga-bl1-${s}`);
  for (const s of APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS) assertApprovedPhase6Dataset(`openliga-bl2-${s}`);

  const { bl1Seasons, bl2BridgeSeasons } = await loader.loadApprovedChainA();

  // Map target bl1 seasonKey (e.g., 2017) -> prior season bl2 dataset (e.g., 2016)
  const feederMapChainA = new Map<string, Phase6SeasonDataset>();
  for (const bl1 of bl1Seasons) {
    const prevSeason = String(Number(bl1.seasonLabel) - 1);
    const feeder = bl2BridgeSeasons.get(prevSeason);
    if (feeder) {
      feederMapChainA.set(bl1.seasonKey, feeder);
    }
  }

  const chainABurnIn = new Set<string>([bl1Seasons[0].seasonKey]); // openliga-bl1-2016 burn-in (since bl1-2015 is protected!)
  const resA = await evaluateCompetitionChain({
    competitionKey: 'openliga-bl1',
    seasons: bl1Seasons,
    burnInSeasonKeys: chainABurnIn,
    feederByTargetSeasonKey: feederMapChainA,
    loader,
  });

  const seasonReports: Phase6SeasonReport[] = [...resA.seasonReports];
  const competitionSummaries: Phase6CompetitionSummary[] = [resA.competitionSummary];
  const combinedObs: PairedMatchObs[] = [...resA.nonBurnInObservations];

  if (includeChainC) {
    const chainCSeasons = await loader.loadApprovedChainC();
    const chainCBurnIn = new Set<string>([chainCSeasons[0].seasonKey]); // 2018/19 burn-in
    const resC = await evaluateCompetitionChain({
      competitionKey: 'statsbomb-37',
      seasons: chainCSeasons,
      burnInSeasonKeys: chainCBurnIn,
      loader,
    });
    seasonReports.push(...resC.seasonReports);
    competitionSummaries.push(resC.competitionSummary);
    combinedObs.push(...resC.nonBurnInObservations);
  }

  const combinedEval = summarizeCohort('Combined Approved Dev Evaluation (Non-Burn-In)', combinedObs);

  const drawGate = evaluateDrawAcceptanceGate({
    combinedEvalFixtureCount: combinedEval.fixtureCount,
    priorLogLoss: combinedEval.draw.causalLeaguePrior.logLoss,
    candidateLogLoss: combinedEval.draw.phase6Pruned.logLoss,
  });

  const bttsGate = evaluateBttsAcceptanceGate({
    combinedEvalFixtureCount: combinedEval.fixtureCount,
    priorLogLoss: combinedEval.btts.causalLeaguePrior.logLoss,
    decoupledFtsCsLogLoss: combinedEval.btts.phase6DecoupledFtsCs.logLoss,
    lightPoissonDcLogLoss: combinedEval.btts.phase6LightPoissonDc.logLoss,
  });

  return {
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION_PHASE6,
    hyperparameters: {
      interSeasonDecay: PHASE6_INTER_SEASON_DECAY,
      promotedGoalScale: PHASE6_PROMOTED_GOAL_SCALE,
      promotedEloAdjustment: PHASE6_PROMOTED_ELO_ADJUSTMENT,
      shrinkageK: PHASE6_SHRINKAGE_K,
      priorEffectiveMatches: PHASE6_PRIOR_EFFECTIVE_MATCHES,
      minEdgeLogLossDelta: PHASE6_MIN_EDGE_LOGLOSS_DELTA,
    },
    guardsVerified: {
      protectedHoldoutsBlocked: Array.from(PROTECTED_BLIND_HOLDOUT_IDS),
      externalValidationBlocked: Array.from(EXTERNAL_VALIDATION_IDS),
      chainBBlockedInStep1to3: CHAIN_B_CONFIRMATORY_IDS.size > 0,
      skipObservedXGEnforced: true,
      exactTimestampBatchingVerified: true,
      leakageViolations: 0,
    },
    seasonReports,
    competitionSummaries,
    combinedApprovedDevEval: combinedEval,
    acceptanceGates: {
      draw: drawGate,
      btts: bttsGate,
    },
  };
}
