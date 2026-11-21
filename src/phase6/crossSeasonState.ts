/**
 * Phase 6 Cross-Season Hierarchical State Engine (Step 2)
 *
 * Strictly isolated under src/phase6/.
 * Features:
 * - Time-decayed team attack/defense goal rates (decay = 0.65)
 * - Causal Elo carryover + mean regression toward 1500
 * - Decoupled FTS (failed-to-score) & CS (clean-sheet) historical rates
 * - Promoted/relegated team tier bridging (goalScale = 0.85, Elo -= 100) using persistent provider IDs
 * - Hierarchical competition priors combining prior seasons (capped at M = 30 matches) + current causal observations
 * - Explicit provenance assignment: SAME_SEASON_DATA | CROSS_SEASON_PRIOR | PROMOTED_TEAM_TIER_ADJUSTED | LEAGUE_PRIOR_ONLY
 * - Blocked-CV causal temperature calibration for 1X2 on same-tier < T priors
 * - Strict batch-by-exact-timestamp causality
 */

import { calculateEloProbabilities } from '../utils/eloRating';
import { calculatePoissonProbabilities } from '../utils/poissonModel';
import { computeNormalizedBivariateNegBin } from '../phase5/phase5O25Model';
import { assertTimestampBatchIntegrity } from './phase6Guards';
import {
  PHASE6_INTER_SEASON_DECAY,
  PHASE6_PRIOR_EFFECTIVE_MATCHES,
  PHASE6_PROMOTED_ELO_ADJUSTMENT,
  PHASE6_PROMOTED_GOAL_SCALE,
  PHASE6_SHRINKAGE_K,
  Phase6CleanMatch,
  Phase6CompetitionPriorSnapshot,
  Phase6CrossSeasonProjection,
  Phase6TeamAggregateState,
  Phase6TeamProvenance,
  Phase6TimestampBatch,
} from './phase6Types';

export type Phase6StateMode = 'CROSS_SEASON' | 'SINGLE_SEASON';

export interface Phase6OneXTwoCalibSample {
  timestampMs: number;
  pH: number;
  pD: number;
  pA: number;
  winner: 'HOME' | 'DRAW' | 'AWAY';
}

interface InternalTeamState extends Phase6TeamAggregateState {}

interface CompetitionStatsCarry {
  avgHomeGoals: number;
  avgAwayGoals: number;
  varHomeGoals: number;
  varAwayGoals: number;
  drawRate: number;
  over25Rate: number;
  bttsRate: number;
  homeScoredAnyRate: number;
  awayScoredAnyRate: number;
  rawMatches: number;
}

const EPS = 1e-6;
const BASE_ELO = 1500;
const ELO_K_FACTOR = 32;
const ELO_HOME_ADV_UPDATE = 55;
const MIN_TEMP_CALIB_SAMPLES = 100;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 1 / 3;
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function normalizeSimplex3(pH: number, pD: number, pA: number): { homeWin01: number; draw01: number; awayWin01: number } {
  const sum = Math.max(EPS, pH + pD + pA);
  return {
    homeWin01: clamp01(pH / sum),
    draw01: clamp01(pD / sum),
    awayWin01: clamp01(pA / sum),
  };
}

function applyMulticlassTemperature(
  probs: { homeWin01: number; draw01: number; awayWin01: number },
  T: number
): { homeWin01: number; draw01: number; awayWin01: number } {
  const invT = 1 / Math.max(0.6, Math.min(3.0, T));
  const h = Math.pow(clamp01(probs.homeWin01), invT);
  const d = Math.pow(clamp01(probs.draw01), invT);
  const a = Math.pow(clamp01(probs.awayWin01), invT);
  return normalizeSimplex3(h, d, a);
}

function multiclassLogLoss(rows: Phase6OneXTwoCalibSample[], T: number): number {
  if (rows.length === 0) return Infinity;
  let sum = 0;
  for (const r of rows) {
    const q = applyMulticlassTemperature({ homeWin01: r.pH, draw01: r.pD, awayWin01: r.pA }, T);
    const p = r.winner === 'HOME' ? q.homeWin01 : r.winner === 'DRAW' ? q.draw01 : q.awayWin01;
    sum += -Math.log(Math.max(EPS, p));
  }
  return sum / rows.length;
}

/**
 * Strictly causal 3-fold blocked-CV temperature selector (< batch timestamp T).
 */
function selectCausalOneXTwoTemperature(priorSamples: Phase6OneXTwoCalibSample[]): {
  applied: boolean;
  T: number;
} {
  const n = priorSamples.length;
  if (n < MIN_TEMP_CALIB_SAMPLES) {
    return { applied: false, T: 1.0 };
  }

  const k = 3;
  const foldSize = Math.floor(n / k);
  if (foldSize < 25) {
    return { applied: false, T: 1.0 };
  }

  const gridTemps: number[] = [];
  for (let t = 0.85; t <= 2.401; t += 0.05) {
    gridTemps.push(Math.round(t * 100) / 100);
  }

  let bestT = 1.0;
  let bestCvLoss = multiclassLogLoss(priorSamples, 1.0); // reference placeholder replaced below
  let rawCvLoss = 0;
  const cvLossByT = new Map<number, number>();
  for (const T of gridTemps) cvLossByT.set(T, 0);

  for (let fold = 0; fold < k; fold++) {
    const start = fold * foldSize;
    const end = fold === k - 1 ? n : (fold + 1) * foldSize;
    const val = priorSamples.slice(start, end);
    const train = [...priorSamples.slice(0, start), ...priorSamples.slice(end)];

    let foldBestT = 1.0;
    let foldBestLoss = multiclassLogLoss(train, 1.0);
    for (const T of gridTemps) {
      const l = multiclassLogLoss(train, T) + 0.0004 * (T - 1) * (T - 1);
      if (l < foldBestLoss - 1e-5) {
        foldBestLoss = l;
        foldBestT = T;
      }
    }

    rawCvLoss += multiclassLogLoss(val, 1.0);
    for (const T of gridTemps) {
      cvLossByT.set(T, (cvLossByT.get(T) ?? 0) + multiclassLogLoss(val, T));
    }
    void foldBestT;
  }

  rawCvLoss /= k;
  bestCvLoss = rawCvLoss;
  for (const T of gridTemps) {
    const avg = (cvLossByT.get(T) ?? Infinity) / k;
    if (avg < bestCvLoss - 0.0005) {
      bestCvLoss = avg;
      bestT = T;
    }
  }

  if (bestT === 1.0 || bestCvLoss >= rawCvLoss - 0.0005) {
    return { applied: false, T: 1.0 };
  }
  return { applied: true, T: bestT };
}

function estimateCausalNegBinDispersion(mean: number, variance: number, sampleCount: number): number {
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || mean <= 0.1 || sampleCount < 20 || variance <= mean * 1.03) {
    return 35.0;
  }
  const rawR = (mean * mean) / (variance - mean);
  const w = sampleCount / (sampleCount + 60);
  const blended = w * rawR + (1 - w) * 22.0;
  return Math.max(3.0, Math.min(40.0, blended));
}

function createNeutralTeamState(teamId: string, teamName: string, tier: number): InternalTeamState {
  return {
    teamId,
    teamName,
    currentTier: tier,
    originTier: tier,
    wasPromotedThisSeason: false,
    currentSeasonPlayed: 0,
    currentSeasonHomePlayed: 0,
    currentSeasonAwayPlayed: 0,
    weightedPlayed: 0,
    weightedHomePlayed: 0,
    weightedAwayPlayed: 0,
    weightedScored: 0,
    weightedConceded: 0,
    weightedHomeScored: 0,
    weightedHomeConceded: 0,
    weightedAwayScored: 0,
    weightedAwayConceded: 0,
    weightedFts: 0,
    weightedCs: 0,
    weightedHomeFts: 0,
    weightedHomeCs: 0,
    weightedAwayFts: 0,
    weightedAwayCs: 0,
    eloRaw: BASE_ELO,
    lastMatchTimestampMs: null,
  };
}

function resolveTeamProvenance(team: InternalTeamState): Phase6TeamProvenance {
  if (team.currentSeasonPlayed >= 5) {
    return 'SAME_SEASON_DATA';
  }
  if (team.wasPromotedThisSeason && team.weightedPlayed > 0) {
    return 'PROMOTED_TEAM_TIER_ADJUSTED';
  }
  if (team.weightedPlayed > 0) {
    return 'CROSS_SEASON_PRIOR';
  }
  return 'LEAGUE_PRIOR_ONLY';
}

function resolveMatchProvenance(
  homeProv: Phase6TeamProvenance,
  awayProv: Phase6TeamProvenance
): Phase6TeamProvenance {
  if (homeProv === 'PROMOTED_TEAM_TIER_ADJUSTED' || awayProv === 'PROMOTED_TEAM_TIER_ADJUSTED') {
    return 'PROMOTED_TEAM_TIER_ADJUSTED';
  }
  if (homeProv === 'SAME_SEASON_DATA' && awayProv === 'SAME_SEASON_DATA') {
    return 'SAME_SEASON_DATA';
  }
  if (homeProv === 'LEAGUE_PRIOR_ONLY' && awayProv === 'LEAGUE_PRIOR_ONLY') {
    return 'LEAGUE_PRIOR_ONLY';
  }
  return 'CROSS_SEASON_PRIOR';
}

export interface Phase6EngineConfig {
  mode: Phase6StateMode;
  interSeasonDecay?: number;
  promotedGoalScale?: number;
  promotedEloAdjustment?: number;
  shrinkageK?: number;
  priorEffectiveMatches?: number;
}

/**
 * Strictly causal hierarchical cross-season state engine.
 */
export class Phase6HierarchicalEngine {
  readonly mode: Phase6StateMode;
  readonly interSeasonDecay: number;
  readonly promotedGoalScale: number;
  readonly promotedEloAdjustment: number;
  readonly shrinkageK: number;
  readonly priorEffectiveMatches: number;

  private currentSeasonKey: string = 'uninitialized';
  private currentTier: number = 1;
  private highWaterTimestampMs: number | null = null;
  private seasonMatchCounter: number = 0;

  private teams = new Map<string, InternalTeamState>();
  private oneXTwoCalibHistory: Phase6OneXTwoCalibSample[] = [];

  // Current season empirical competition accumulators
  private curMatches = 0;
  private curHomeGoals = 0;
  private curAwayGoals = 0;
  private curHomeGoalsSq = 0;
  private curAwayGoalsSq = 0;
  private curDraws = 0;
  private curOver25 = 0;
  private curBtts = 0;
  private curHomeScoredAny = 0;
  private curAwayScoredAny = 0;

  // Prior-season hierarchical competition baseline (neutral defaults used only before any prior season exists)
  private priorCompCarry: CompetitionStatsCarry = {
    avgHomeGoals: 1.5,
    avgAwayGoals: 1.2,
    varHomeGoals: 1.6,
    varAwayGoals: 1.3,
    drawRate: 0.25,
    over25Rate: 0.52,
    bttsRate: 0.52,
    homeScoredAnyRate: 0.74,
    awayScoredAnyRate: 0.67,
    rawMatches: 0,
  };

  constructor(config: Phase6EngineConfig) {
    this.mode = config.mode;
    this.interSeasonDecay = config.interSeasonDecay ?? PHASE6_INTER_SEASON_DECAY;
    this.promotedGoalScale = config.promotedGoalScale ?? PHASE6_PROMOTED_GOAL_SCALE;
    this.promotedEloAdjustment = config.promotedEloAdjustment ?? PHASE6_PROMOTED_ELO_ADJUSTMENT;
    this.shrinkageK = config.shrinkageK ?? PHASE6_SHRINKAGE_K;
    this.priorEffectiveMatches = config.priorEffectiveMatches ?? PHASE6_PRIOR_EFFECTIVE_MATCHES;
  }

  getHighWaterTimestampMs(): number | null {
    return this.highWaterTimestampMs;
  }

  /**
   * Build an immutable summary of all teams at the end of a feeder season (e.g., 2. Bundesliga)
   * without contaminating the primary Tier-1 engine's calibration/league priors.
   */
  exportEndOfSeasonTeamStates(): Map<string, InternalTeamState> {
    const copy = new Map<string, InternalTeamState>();
    for (const [id, st] of this.teams.entries()) {
      copy.set(id, { ...st });
    }
    return copy;
  }

  /**
   * Transition engine cleanly to a new season.
   * Applies pre-registered decay (0.65), Elo mean-regression, hierarchical prior blend (M=30),
   * and optional feeder-tier bridge scaling for newly promoted clubs.
   */
  startSeason(params: {
    seasonKey: string;
    tier: number;
    feederEndStates?: Map<string, InternalTeamState>;
  }): void {
    const { seasonKey, tier, feederEndStates } = params;

    if (this.mode === 'SINGLE_SEASON') {
      this.currentSeasonKey = seasonKey;
      this.currentTier = tier;
      this.seasonMatchCounter = 0;
      this.teams.clear();
      this.oneXTwoCalibHistory = [];
      this.resetCurrentSeasonCompetitionAccumulators();
      this.priorCompCarry = {
        avgHomeGoals: 1.5,
        avgAwayGoals: 1.2,
        varHomeGoals: 1.6,
        varAwayGoals: 1.3,
        drawRate: 0.25,
        over25Rate: 0.52,
        bttsRate: 0.52,
        homeScoredAnyRate: 0.74,
        awayScoredAnyRate: 0.67,
        rawMatches: 0,
      };
      return;
    }

    // Roll previous season's competition baseline into hierarchical carry (only if matches were played)
    if (this.curMatches > 0) {
      const snap = this.getCompetitionPriorsSnapshot();
      this.priorCompCarry = {
        avgHomeGoals: snap.avgHomeGoals,
        avgAwayGoals: snap.avgAwayGoals,
        varHomeGoals: snap.varHomeGoals,
        varAwayGoals: snap.varAwayGoals,
        drawRate: snap.leagueDrawRate,
        over25Rate: snap.leagueOver25Rate,
        bttsRate: snap.leagueBttsRate,
        homeScoredAnyRate: snap.leagueHomeScoredAnyRate,
        awayScoredAnyRate: snap.leagueAwayScoredAnyRate,
        rawMatches: Math.min(this.priorEffectiveMatches, this.priorCompCarry.rawMatches + this.curMatches),
      };
    }

    // Decay existing team states across inter-season break
    const nextTeams = new Map<string, InternalTeamState>();
    const d = this.interSeasonDecay;
    for (const [id, st] of this.teams.entries()) {
      nextTeams.set(id, {
        ...st,
        currentTier: tier,
        wasPromotedThisSeason: false,
        currentSeasonPlayed: 0,
        currentSeasonHomePlayed: 0,
        currentSeasonAwayPlayed: 0,
        weightedPlayed: st.weightedPlayed * d,
        weightedHomePlayed: st.weightedHomePlayed * d,
        weightedAwayPlayed: st.weightedAwayPlayed * d,
        weightedScored: st.weightedScored * d,
        weightedConceded: st.weightedConceded * d,
        weightedHomeScored: st.weightedHomeScored * d,
        weightedHomeConceded: st.weightedHomeConceded * d,
        weightedAwayScored: st.weightedAwayScored * d,
        weightedAwayConceded: st.weightedAwayConceded * d,
        weightedFts: st.weightedFts * d,
        weightedCs: st.weightedCs * d,
        weightedHomeFts: st.weightedHomeFts * d,
        weightedHomeCs: st.weightedHomeCs * d,
        weightedAwayFts: st.weightedAwayFts * d,
        weightedAwayCs: st.weightedAwayCs * d,
        eloRaw: BASE_ELO + d * (st.eloRaw - BASE_ELO),
      });
    }

    // Merge feeder-tier promoted clubs (strictly if NOT already carrying recent Tier-1 history stronger than feeder)
    if (feederEndStates) {
      const s = this.promotedGoalScale;
      const invS = 1 / Math.max(0.5, s);
      for (const [id, feeder] of feederEndStates.entries()) {
        const existingSameTier = nextTeams.get(id);
        // Use feeder state if team has no prior Tier-1 state or feeder season is fresher than stale Tier-1 record
        const feederFresher =
          !existingSameTier ||
          (feeder.lastMatchTimestampMs !== null &&
            (existingSameTier.lastMatchTimestampMs === null ||
              feeder.lastMatchTimestampMs > existingSameTier.lastMatchTimestampMs));

        if (feederFresher && feeder.weightedPlayed > 0) {
          const decayedElo = BASE_ELO + d * (feeder.eloRaw - BASE_ELO);
          nextTeams.set(id, {
            teamId: feeder.teamId,
            teamName: feeder.teamName,
            currentTier: tier,
            originTier: feeder.currentTier,
            wasPromotedThisSeason: feeder.currentTier > tier,
            currentSeasonPlayed: 0,
            currentSeasonHomePlayed: 0,
            currentSeasonAwayPlayed: 0,
            weightedPlayed: feeder.weightedPlayed * d,
            weightedHomePlayed: feeder.weightedHomePlayed * d,
            weightedAwayPlayed: feeder.weightedAwayPlayed * d,
            weightedScored: feeder.weightedScored * d * s,
            weightedConceded: feeder.weightedConceded * d * invS,
            weightedHomeScored: feeder.weightedHomeScored * d * s,
            weightedHomeConceded: feeder.weightedHomeConceded * d * invS,
            weightedAwayScored: feeder.weightedAwayScored * d * s,
            weightedAwayConceded: feeder.weightedAwayConceded * d * invS,
            // Promoted sides typically score slightly less and keep fewer clean sheets stepping up a division
            weightedFts: Math.min(feeder.weightedPlayed * d, feeder.weightedFts * d * 1.15),
            weightedCs: feeder.weightedCs * d * 0.85,
            weightedHomeFts: Math.min(feeder.weightedHomePlayed * d, feeder.weightedHomeFts * d * 1.15),
            weightedHomeCs: feeder.weightedHomeCs * d * 0.85,
            weightedAwayFts: Math.min(feeder.weightedAwayPlayed * d, feeder.weightedAwayFts * d * 1.15),
            weightedAwayCs: feeder.weightedAwayCs * d * 0.85,
            eloRaw: decayedElo + (feeder.currentTier > tier ? this.promotedEloAdjustment : 0),
            lastMatchTimestampMs: feeder.lastMatchTimestampMs,
          });
        }
      }
    }

    this.teams = nextTeams;
    this.currentSeasonKey = seasonKey;
    this.currentTier = tier;
    this.seasonMatchCounter = 0;
    this.resetCurrentSeasonCompetitionAccumulators();
  }

  private resetCurrentSeasonCompetitionAccumulators(): void {
    this.curMatches = 0;
    this.curHomeGoals = 0;
    this.curAwayGoals = 0;
    this.curHomeGoalsSq = 0;
    this.curAwayGoalsSq = 0;
    this.curDraws = 0;
    this.curOver25 = 0;
    this.curBtts = 0;
    this.curHomeScoredAny = 0;
    this.curAwayScoredAny = 0;
  }

  getCompetitionPriorsSnapshot(): Phase6CompetitionPriorSnapshot {
    const priorW =
      this.mode === 'CROSS_SEASON'
        ? Math.min(this.priorEffectiveMatches, this.priorCompCarry.rawMatches)
        : 0;
    const curW = this.curMatches;
    const effTotal = priorW + curW;

    const blend = (priorRate: number, curSum: number): number => {
      if (effTotal <= 0) return priorRate;
      return (priorW * priorRate + curSum) / effTotal;
    };

    const avgHomeGoals = blend(this.priorCompCarry.avgHomeGoals, this.curHomeGoals);
    const avgAwayGoals = blend(this.priorCompCarry.avgAwayGoals, this.curAwayGoals);

    let varHomeGoals = this.priorCompCarry.varHomeGoals;
    let varAwayGoals = this.priorCompCarry.varAwayGoals;
    if (curW >= 20) {
      const curMeanH = this.curHomeGoals / curW;
      const curMeanA = this.curAwayGoals / curW;
      const curVarH = Math.max(0.1, (this.curHomeGoalsSq - curW * curMeanH * curMeanH) / (curW - 1));
      const curVarA = Math.max(0.1, (this.curAwayGoalsSq - curW * curMeanA * curMeanA) / (curW - 1));
      varHomeGoals = blend(this.priorCompCarry.varHomeGoals, curW * curVarH);
      varAwayGoals = blend(this.priorCompCarry.varAwayGoals, curW * curVarA);
    }

    const dispersionHomeR = estimateCausalNegBinDispersion(avgHomeGoals, varHomeGoals, effTotal);
    const dispersionAwayR = estimateCausalNegBinDispersion(avgAwayGoals, varAwayGoals, effTotal);

    return {
      seasonKey: this.currentSeasonKey,
      tier: this.currentTier,
      currentSeasonMatches: curW,
      priorEffectiveMatches: priorW,
      effectiveTotalMatches: effTotal,
      avgHomeGoals,
      avgAwayGoals,
      varHomeGoals,
      varAwayGoals,
      dispersionHomeR,
      dispersionAwayR,
      leagueDrawRate: blend(this.priorCompCarry.drawRate, this.curDraws),
      leagueOver25Rate: blend(this.priorCompCarry.over25Rate, this.curOver25),
      leagueBttsRate: blend(this.priorCompCarry.bttsRate, this.curBtts),
      leagueHomeScoredAnyRate: blend(this.priorCompCarry.homeScoredAnyRate, this.curHomeScoredAny),
      leagueAwayScoredAnyRate: blend(this.priorCompCarry.awayScoredAnyRate, this.curAwayScoredAny),
    };
  }

  private getOrCreateTeamReadonly(teamId: string, teamName: string): InternalTeamState {
    const existing = this.teams.get(teamId);
    if (existing) return { ...existing };
    return createNeutralTeamState(teamId, teamName, this.currentTier);
  }

  private computeShrunkLambdas(
    home: InternalTeamState,
    away: InternalTeamState,
    comp: Phase6CompetitionPriorSnapshot
  ): { lambdaHome: number; lambdaAway: number } {
    const K = this.shrinkageK;
    const avgSide = Math.max(0.5, (comp.avgHomeGoals + comp.avgAwayGoals) / 2);

    // Overall shrunk scoring / conceding rates relative to overall average scoring
    const homeOvAtt =
      ((home.weightedScored + K * avgSide) / (home.weightedPlayed + K)) / avgSide;
    const homeOvDef =
      ((home.weightedConceded + K * avgSide) / (home.weightedPlayed + K)) / avgSide;
    const awayOvAtt =
      ((away.weightedScored + K * avgSide) / (away.weightedPlayed + K)) / avgSide;
    const awayOvDef =
      ((away.weightedConceded + K * avgSide) / (away.weightedPlayed + K)) / avgSide;

    // Venue-specific modifiers gently blended once venue history accrues
    const homeVenAtt =
      ((home.weightedHomeScored + K * comp.avgHomeGoals) / (home.weightedHomePlayed + K)) /
      Math.max(0.5, comp.avgHomeGoals);
    const homeVenDef =
      ((home.weightedHomeConceded + K * comp.avgAwayGoals) / (home.weightedHomePlayed + K)) /
      Math.max(0.5, comp.avgAwayGoals);

    const awayVenAtt =
      ((away.weightedAwayScored + K * comp.avgAwayGoals) / (away.weightedAwayPlayed + K)) /
      Math.max(0.5, comp.avgAwayGoals);
    const awayVenDef =
      ((away.weightedAwayConceded + K * comp.avgHomeGoals) / (away.weightedAwayPlayed + K)) /
      Math.max(0.5, comp.avgHomeGoals);

    const wVenH = home.weightedHomePlayed / (home.weightedHomePlayed + K);
    const wVenA = away.weightedAwayPlayed / (away.weightedAwayPlayed + K);

    const hAtt = wVenH * homeVenAtt + (1 - wVenH) * homeOvAtt;
    const hDef = wVenH * homeVenDef + (1 - wVenH) * homeOvDef;
    const aAtt = wVenA * awayVenAtt + (1 - wVenA) * awayOvAtt;
    const aDef = wVenA * awayVenDef + (1 - wVenA) * awayOvDef;

    const lambdaHome = Math.max(0.25, Math.min(4.2, comp.avgHomeGoals * hAtt * aDef));
    const lambdaAway = Math.max(0.20, Math.min(3.8, comp.avgAwayGoals * aAtt * hDef));

    return {
      lambdaHome: Math.round(lambdaHome * 1000) / 1000,
      lambdaAway: Math.round(lambdaAway * 1000) / 1000,
    };
  }

  /**
   * Evaluate all matches in an exact-timestamp batch strictly against pre-batch (< T) state.
   */
  evaluateBatch(batch: Phase6TimestampBatch): Phase6CrossSeasonProjection[] {
    assertTimestampBatchIntegrity(batch.timestampMs, this.highWaterTimestampMs, batch.matches);

    const compPriors = this.getCompetitionPriorsSnapshot();
    const priorCalibSamples = this.oneXTwoCalibHistory.filter(
      (s) => s.timestampMs < batch.timestampMs
    );
    const tempChoice = selectCausalOneXTwoTemperature(priorCalibSamples);

    const projections: Phase6CrossSeasonProjection[] = [];
    for (let idx = 0; idx < batch.matches.length; idx++) {
      const m = batch.matches[idx];
      const home = this.getOrCreateTeamReadonly(m.homeTeamId, m.homeTeamName);
      const away = this.getOrCreateTeamReadonly(m.awayTeamId, m.awayTeamName);

      const homeProv = resolveTeamProvenance(home);
      const awayProv = resolveTeamProvenance(away);
      const matchProv = resolveMatchProvenance(homeProv, awayProv);

      const isColdStartCohort = this.seasonMatchCounter + idx + 1 <= 45;
      const isPromotedTeamMatch =
        (home.wasPromotedThisSeason && home.currentSeasonPlayed < 10) ||
        (away.wasPromotedThisSeason && away.currentSeasonPlayed < 10);

      const { lambdaHome, lambdaAway } = this.computeShrunkLambdas(home, away, compPriors);

      const poisDc = calculatePoissonProbabilities(lambdaHome, lambdaAway, 7, true);
      const poissonDc1X2 = normalizeSimplex3(
        poisDc.markets.homeWin / 100,
        poisDc.markets.draw / 100,
        poisDc.markets.awayWin / 100
      );
      const poissonDcO25_01 = poisDc.markets.over25 / 100;

      const negBin = computeNormalizedBivariateNegBin(
        lambdaHome,
        lambdaAway,
        compPriors.dispersionHomeR,
        compPriors.dispersionAwayR,
        -0.11
      );
      const rawNegBin1X2 = normalizeSimplex3(negBin.homeWin01, negBin.draw01, negBin.awayWin01);

      const eloCalc = calculateEloProbabilities(home.eloRaw, away.eloRaw);
      const elo1X2 = normalizeSimplex3(
        eloCalc.homeWinProb / 100,
        eloCalc.drawProb / 100,
        eloCalc.awayWinProb / 100
      );

      // Structural blend: 85% Negative Binomial + Dixon-Coles, 15% Causal Elo
      const blended1X2 = normalizeSimplex3(
        0.85 * rawNegBin1X2.homeWin01 + 0.15 * elo1X2.homeWin01,
        0.85 * rawNegBin1X2.draw01 + 0.15 * elo1X2.draw01,
        0.85 * rawNegBin1X2.awayWin01 + 0.15 * elo1X2.awayWin01
      );

      const calibrated1X2 = tempChoice.applied
        ? applyMulticlassTemperature(blended1X2, tempChoice.T)
        : blended1X2;

      const minEffPlayed = Math.min(home.weightedPlayed, away.weightedPlayed);
      const priorWeightO25 = 4 / (minEffPlayed + 16);
      const hierarchicalO25_01 = Math.max(
        0.05,
        Math.min(0.95, (1 - priorWeightO25) * negBin.over25_01 + priorWeightO25 * compPriors.leagueOver25Rate)
      );

      projections.push({
        matchId: m.id,
        seasonKey: m.seasonKey,
        timestampMs: batch.timestampMs,
        homeProvenance: homeProv,
        awayProvenance: awayProv,
        matchProvenance: matchProv,
        isColdStartCohort,
        isPromotedTeamMatch,
        homeCurrentSeasonPlayed: home.currentSeasonPlayed,
        awayCurrentSeasonPlayed: away.currentSeasonPlayed,
        homeEffectivePlayed: Math.round(home.weightedPlayed * 100) / 100,
        awayEffectivePlayed: Math.round(away.weightedPlayed * 100) / 100,
        homeEloCausal: Math.round(home.eloRaw),
        awayEloCausal: Math.round(away.eloRaw),
        lambdaHome,
        lambdaAway,
        rawNegBin1X2,
        elo1X2,
        blended1X2,
        calibrated1X2,
        calibrationApplied: tempChoice.applied,
        calibrationSamplesUsed: priorCalibSamples.length,
        poissonDc1X2,
        poissonDcO25_01,
        negBinO25_01: negBin.over25_01,
        hierarchicalO25_01,
        competitionPriors: compPriors,
        homeTeamState: home,
        awayTeamState: away,
      });
    }

    return projections;
  }

  /**
   * Commit match outcomes strictly AFTER the entire timestamp batch has been evaluated.
   */
  commitBatch(batch: Phase6TimestampBatch, evaluatedProjections: Phase6CrossSeasonProjection[]): void {
    assertTimestampBatchIntegrity(batch.timestampMs, this.highWaterTimestampMs, batch.matches);

    const projById = new Map<string, Phase6CrossSeasonProjection>();
    for (const p of evaluatedProjections) projById.set(p.matchId, p);

    for (const m of batch.matches) {
      this.seasonMatchCounter++;
      this.curMatches++;
      this.curHomeGoals += m.homeGoals;
      this.curAwayGoals += m.awayGoals;
      this.curHomeGoalsSq += m.homeGoals * m.homeGoals;
      this.curAwayGoalsSq += m.awayGoals * m.awayGoals;
      if (m.homeGoals === m.awayGoals) this.curDraws++;
      if (m.homeGoals + m.awayGoals > 2.5) this.curOver25++;
      if (m.homeGoals > 0 && m.awayGoals > 0) this.curBtts++;
      if (m.homeGoals > 0) this.curHomeScoredAny++;
      if (m.awayGoals > 0) this.curAwayScoredAny++;

      const h = this.teams.get(m.homeTeamId) ?? createNeutralTeamState(m.homeTeamId, m.homeTeamName, this.currentTier);
      const a = this.teams.get(m.awayTeamId) ?? createNeutralTeamState(m.awayTeamId, m.awayTeamName, this.currentTier);

      // Update causal Elo strictly matching eloRating.ts parameters
      const expHome = 1 / (1 + Math.pow(10, -(h.eloRaw + ELO_HOME_ADV_UPDATE - a.eloRaw) / 400));
      const scoreHome = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
      const goalDiff = Math.abs(m.homeGoals - m.awayGoals);
      const marginMult = goalDiff <= 1 ? 1 : 1 + 0.25 * Math.min(goalDiff - 1, 3);
      const deltaElo = ELO_K_FACTOR * marginMult * (scoreHome - expHome);

      h.teamName = m.homeTeamName;
      h.currentTier = this.currentTier;
      h.eloRaw += deltaElo;
      h.currentSeasonPlayed += 1;
      h.currentSeasonHomePlayed += 1;
      h.weightedPlayed += 1;
      h.weightedHomePlayed += 1;
      h.weightedScored += m.homeGoals;
      h.weightedConceded += m.awayGoals;
      h.weightedHomeScored += m.homeGoals;
      h.weightedHomeConceded += m.awayGoals;
      if (m.homeGoals === 0) {
        h.weightedFts += 1;
        h.weightedHomeFts += 1;
      }
      if (m.awayGoals === 0) {
        h.weightedCs += 1;
        h.weightedHomeCs += 1;
      }
      h.lastMatchTimestampMs = batch.timestampMs;

      a.teamName = m.awayTeamName;
      a.currentTier = this.currentTier;
      a.eloRaw -= deltaElo;
      a.currentSeasonPlayed += 1;
      a.currentSeasonAwayPlayed += 1;
      a.weightedPlayed += 1;
      a.weightedAwayPlayed += 1;
      a.weightedScored += m.awayGoals;
      a.weightedConceded += m.homeGoals;
      a.weightedAwayScored += m.awayGoals;
      a.weightedAwayConceded += m.homeGoals;
      if (m.awayGoals === 0) {
        a.weightedFts += 1;
        a.weightedAwayFts += 1;
      }
      if (m.homeGoals === 0) {
        a.weightedCs += 1;
        a.weightedAwayCs += 1;
      }
      a.lastMatchTimestampMs = batch.timestampMs;

      this.teams.set(m.homeTeamId, h);
      this.teams.set(m.awayTeamId, a);

      const proj = projById.get(m.id);
      if (proj) {
        const winner: 'HOME' | 'DRAW' | 'AWAY' =
          m.homeGoals > m.awayGoals ? 'HOME' : m.homeGoals < m.awayGoals ? 'AWAY' : 'DRAW';
        this.oneXTwoCalibHistory.push({
          timestampMs: batch.timestampMs,
          pH: proj.blended1X2.homeWin01,
          pD: proj.blended1X2.draw01,
          pA: proj.blended1X2.awayWin01,
          winner,
        });
      }
    }

    this.highWaterTimestampMs = batch.timestampMs;
  }

  /**
   * Run a feeder-tier season cleanly in an isolated sub-engine (zero contamination of Tier-1 priors).
   */
  static replayFeederSeasonEndStates(batches: Phase6TimestampBatch[], seasonKey: string, tier: number): Map<string, InternalTeamState> {
    const subEngine = new Phase6HierarchicalEngine({ mode: 'SINGLE_SEASON' });
    subEngine.startSeason({ seasonKey, tier });
    for (const b of batches) {
      const proj = subEngine.evaluateBatch(b);
      subEngine.commitBatch(b, proj);
    }
    return subEngine.exportEndOfSeasonTeamStates();
  }
}

export function buildCanonicalAbstainContract(reason: string): {
  modelType: 'ABSTAIN';
  confidence: null;
  confidenceScore: null;
  probabilities: null;
  expectedScore: null;
  abstainReason: string;
} {
  return {
    modelType: 'ABSTAIN',
    confidence: null,
    confidenceScore: null,
    probabilities: null,
    expectedScore: null,
    abstainReason: reason,
  };
}

export function isValidMatchForTarget(match: Phase6CleanMatch): boolean {
  return Number.isFinite(match.timestampMs) && match.homeGoals >= 0 && match.awayGoals >= 0;
}
