/**
 * Phase 6 Experimental Research Types & Pre-Registered Constants
 *
 * Strictly isolated under src/phase6/.
 * Does NOT modify Phase 3, Phase 4, Phase 5, or Phase 5.1 pipelines.
 */

export const MODEL_VERSION_PHASE6 = 'phase-6-research' as const;

// Pre-registered cross-season hyperparameters (Step 2 specification — NEVER tuned on Chain B / External / Holdout)
export const PHASE6_INTER_SEASON_DECAY = 0.65;
export const PHASE6_PROMOTED_GOAL_SCALE = 0.85;
export const PHASE6_PROMOTED_ELO_ADJUSTMENT = -100;
export const PHASE6_SHRINKAGE_K = 6;
export const PHASE6_PRIOR_EFFECTIVE_MATCHES = 30;
export const PHASE6_MIN_EDGE_LOGLOSS_DELTA = 0.005;
export const PHASE6_MIN_VALID_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

export type Phase6TeamProvenance =
  | 'SAME_SEASON_DATA'
  | 'CROSS_SEASON_PRIOR'
  | 'PROMOTED_TEAM_TIER_ADJUSTED'
  | 'LEAGUE_PRIOR_ONLY';

export type Phase6MarketStatus = 'PREDICT' | 'ABSTAIN' | 'INFORMATIONAL_PRIOR_ONLY';

export type Phase6ExclusionReason =
  | 'RELEGATION_PLAYOFF'
  | 'INVALID_OR_EPOCH_TIMESTAMP'
  | 'UNFINISHED_OR_NULL_SCORE'
  | 'INVALID_TEAM_ID'
  | 'DUPLICATE_MATCH_ID';

export interface Phase6ExcludedMatchRecord {
  matchId: string;
  seasonKey: string;
  utcDate: string | null;
  groupName: string | null;
  reason: Phase6ExclusionReason;
  detail: string;
}

export interface Phase6SeasonExclusionLedger {
  seasonKey: string;
  rawMatchCount: number;
  retainedMatchCount: number;
  excludedTotal: number;
  countsByReason: Record<Phase6ExclusionReason, number>;
  samples: Phase6ExcludedMatchRecord[];
}

export interface Phase6CleanMatch {
  id: string;
  provider: 'openliga' | 'statsbomb';
  competitionKey: string;
  tier: number;
  seasonLabel: string;
  seasonKey: string;
  utcDate: string;
  timestampMs: number;
  matchday: number | null;
  groupName: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number;
  awayGoals: number;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
}

export interface Phase6SeasonDataset {
  seasonKey: string;
  provider: 'openliga' | 'statsbomb';
  competitionKey: string;
  competitionName: string;
  tier: number;
  seasonLabel: string;
  matches: Phase6CleanMatch[];
  exclusions: Phase6SeasonExclusionLedger;
}

export interface Phase6TimestampBatch {
  timestampMs: number;
  utcDate: string;
  matches: Phase6CleanMatch[];
}

export interface Phase6CanonicalAbstainContract {
  modelType: 'ABSTAIN';
  confidence: null;
  confidenceScore: null;
  probabilities: null;
  expectedScore: null;
  abstainReason: string;
}

export interface Phase6TeamAggregateState {
  teamId: string;
  teamName: string;
  currentTier: number;
  originTier: number;
  wasPromotedThisSeason: boolean;
  currentSeasonPlayed: number;
  currentSeasonHomePlayed: number;
  currentSeasonAwayPlayed: number;
  weightedPlayed: number;
  weightedHomePlayed: number;
  weightedAwayPlayed: number;
  weightedScored: number;
  weightedConceded: number;
  weightedHomeScored: number;
  weightedHomeConceded: number;
  weightedAwayScored: number;
  weightedAwayConceded: number;
  weightedFts: number;
  weightedCs: number;
  weightedHomeFts: number;
  weightedHomeCs: number;
  weightedAwayFts: number;
  weightedAwayCs: number;
  eloRaw: number;
  lastMatchTimestampMs: number | null;
}

export interface Phase6CompetitionPriorSnapshot {
  seasonKey: string;
  tier: number;
  currentSeasonMatches: number;
  priorEffectiveMatches: number;
  effectiveTotalMatches: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  varHomeGoals: number;
  varAwayGoals: number;
  dispersionHomeR: number;
  dispersionAwayR: number;
  leagueDrawRate: number;
  leagueOver25Rate: number;
  leagueBttsRate: number;
  leagueHomeScoredAnyRate: number;
  leagueAwayScoredAnyRate: number;
}

export interface Phase6CrossSeasonProjection {
  matchId: string;
  seasonKey: string;
  timestampMs: number;
  homeProvenance: Phase6TeamProvenance;
  awayProvenance: Phase6TeamProvenance;
  matchProvenance: Phase6TeamProvenance;
  isColdStartCohort: boolean;
  isPromotedTeamMatch: boolean;
  homeCurrentSeasonPlayed: number;
  awayCurrentSeasonPlayed: number;
  homeEffectivePlayed: number;
  awayEffectivePlayed: number;
  homeEloCausal: number;
  awayEloCausal: number;
  lambdaHome: number;
  lambdaAway: number;
  rawNegBin1X2: { homeWin01: number; draw01: number; awayWin01: number };
  elo1X2: { homeWin01: number; draw01: number; awayWin01: number };
  blended1X2: { homeWin01: number; draw01: number; awayWin01: number };
  calibrated1X2: { homeWin01: number; draw01: number; awayWin01: number };
  calibrationApplied: boolean;
  calibrationSamplesUsed: number;
  poissonDc1X2: { homeWin01: number; draw01: number; awayWin01: number };
  poissonDcO25_01: number;
  negBinO25_01: number;
  hierarchicalO25_01: number;
  competitionPriors: Phase6CompetitionPriorSnapshot;
  homeTeamState: Phase6TeamAggregateState;
  awayTeamState: Phase6TeamAggregateState;
}

export interface Phase6DrawCandidateOutput {
  leagueDrawPrior01: number;
  poissonDrawProb01: number;
  eloSymmetry: number;
  totalExpectedGoals: number;
  prunedModelProb01: number;
  prunedLearnerActive: boolean;
  prunedSamplesUsed: number;
  recommendedStatus: Phase6MarketStatus;
  notes: string;
}

export interface Phase6BttsCandidateOutput {
  leagueBttsPrior01: number;
  decoupledFtsCsProb01: number;
  lightlyShrunkPoissonDcProb01: number;
  homeScoringProb01: number;
  awayScoringProb01: number;
  recommendedStatus: Phase6MarketStatus;
  notes: string;
}

export interface Phase6CalibrationBin {
  binLabel: string;
  count: number;
  meanPredictedPct: number | null;
  actualRatePct: number | null;
  absErrorPct: number | null;
}

export interface Phase6MetricSummary1X2 {
  totalFixtures: number;
  evaluatedCount: number;
  abstainedCount: number;
  coveragePct: number;
  accuracyPct: number | null;
  accuracyCi95: [number, number] | null;
  brier: number | null;
  brierCi95: [number, number] | null;
  logLoss: number | null;
  logLossCi95: [number, number] | null;
  ecePct: number | null;
  tailEcePct: number | null;
  calibrationBins: Phase6CalibrationBin[];
}

export interface Phase6BinaryMetricSummary {
  totalFixtures: number;
  evaluatedCount: number;
  abstainedCount: number;
  coveragePct: number;
  actualPositiveRatePct: number | null;
  meanPredictedProbPct: number | null;
  brier: number | null;
  brierCi95: [number, number] | null;
  logLoss: number | null;
  logLossCi95: [number, number] | null;
  ecePct: number | null;
  rocAuc: number | null;
  calibrationBins: Phase6CalibrationBin[];
}

export interface Phase6GoalMetricSummary {
  totalFixtures: number;
  evaluatedCount: number;
  abstainedCount: number;
  coveragePct: number;
  maeTotal: number | null;
  rmseTotal: number | null;
  maePerTeamGoal: number | null;
  rmsePerTeamGoal: number | null;
  meanPredictedTotal: number | null;
  meanActualTotal: number | null;
  biasTotal: number | null;
}

export interface Phase6CohortEvaluation {
  cohortName: string;
  fixtureCount: number;
  provenanceCounts: Record<Phase6TeamProvenance, number>;
  phase3AbstainReasons: Record<string, number>;
  goals: {
    phase6CrossSeason: Phase6GoalMetricSummary;
    singleSeasonBaseline: Phase6GoalMetricSummary;
    phase3FrozenAll: Phase6GoalMetricSummary;
    phase3FrozenActive: Phase6GoalMetricSummary;
    causalLeaguePrior: Phase6GoalMetricSummary;
  };
  oneXTwo: {
    phase6CrossSeason: Phase6MetricSummary1X2;
    phase6RawUnCalibrated: Phase6MetricSummary1X2;
    singleSeasonBaseline: Phase6MetricSummary1X2;
    phase3FrozenAll: Phase6MetricSummary1X2;
    phase3FrozenActive: Phase6MetricSummary1X2;
    causalLeaguePrior: Phase6MetricSummary1X2;
  };
  over25: {
    phase6CrossSeason: Phase6BinaryMetricSummary;
    singleSeasonBaseline: Phase6BinaryMetricSummary;
    phase3FrozenActive: Phase6BinaryMetricSummary;
    causalLeaguePrior: Phase6BinaryMetricSummary;
  };
  draw: {
    causalLeaguePrior: Phase6BinaryMetricSummary;
    phase6Pruned: Phase6BinaryMetricSummary;
    singleSeasonPruned: Phase6BinaryMetricSummary;
    deltaLogLossVsPrior: number | null;
  };
  btts: {
    causalLeaguePrior: Phase6BinaryMetricSummary;
    phase6DecoupledFtsCs: Phase6BinaryMetricSummary;
    phase6LightPoissonDc: Phase6BinaryMetricSummary;
    singleSeasonLightPoissonDc: Phase6BinaryMetricSummary;
    phase3FrozenActive: Phase6BinaryMetricSummary;
    deltaLogLossDecoupledVsPrior: number | null;
    deltaLogLossPoissonVsPrior: number | null;
  };
}

export interface Phase6SeasonReport {
  seasonKey: string;
  competitionKey: string;
  seasonLabel: string;
  isBurnInSeason: boolean;
  exclusions: Phase6SeasonExclusionLedger;
  fullSeason: Phase6CohortEvaluation;
  coldStartFirst45: Phase6CohortEvaluation;
  promotedTeamFirst10: Phase6CohortEvaluation | null;
}

export interface Phase6CompetitionSummary {
  competitionKey: string;
  seasonsEvaluated: string[];
  burnInSeasons: string[];
  combinedNonBurnInFull: Phase6CohortEvaluation;
  combinedColdStart: Phase6CohortEvaluation;
  combinedPromotedTeams: Phase6CohortEvaluation | null;
  allSeasonsFull: Phase6CohortEvaluation;
}

export interface Phase6AcceptanceGateVerdict {
  market: 'DRAW' | 'BTTS';
  bestCandidateName: string;
  combinedEvalFixtureCount: number;
  priorLogLoss: number | null;
  candidateLogLoss: number | null;
  deltaLogLoss: number | null;
  requiredDelta: number;
  passed: boolean;
  assignedStatus: Phase6MarketStatus;
  rationale: string;
}

export interface Phase6BenchmarkReport {
  generatedAt: string;
  modelVersion: typeof MODEL_VERSION_PHASE6;
  hyperparameters: {
    interSeasonDecay: number;
    promotedGoalScale: number;
    promotedEloAdjustment: number;
    shrinkageK: number;
    priorEffectiveMatches: number;
    minEdgeLogLossDelta: number;
  };
  guardsVerified: {
    protectedHoldoutsBlocked: string[];
    externalValidationBlocked: string[];
    chainBBlockedInStep1to3: boolean;
    skipObservedXGEnforced: boolean;
    exactTimestampBatchingVerified: boolean;
    leakageViolations: number;
  };
  seasonReports: Phase6SeasonReport[];
  competitionSummaries: Phase6CompetitionSummary[];
  combinedApprovedDevEval: Phase6CohortEvaluation;
  acceptanceGates: {
    draw: Phase6AcceptanceGateVerdict;
    btts: Phase6AcceptanceGateVerdict;
  };
}
