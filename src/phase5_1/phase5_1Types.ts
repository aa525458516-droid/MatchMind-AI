import { Match, MatchStatistics, Prediction } from '../types/football';
import { Phase5CausalPriors } from '../phase5/phase5Types';

export const MODEL_VERSION_PHASE5_1 = 'phase-5.1-research' as const;
export const TAIL_SHRINKAGE_VERSION = 'phase5_1-tail-shrink-v1' as const;

export type Phase5_1MarketKey = '1X2' | 'DRAW';
export type Phase5_1Status = 'PREDICT' | 'ABSTAIN' | 'NOT_TRAINED';
export type Phase5_1CalibrationState = 'CALIBRATED' | 'NOT_TRAINED';

export type OneXTwoCalibrationApproach =
  | 'A_EXISTING_PHASE5'
  | 'B_TEMPERATURE'
  | 'C_BETA'
  | 'D_TAIL_SHRINKAGE';

export type DrawVariantKey =
  | 'A_PHASE5'
  | 'B_POISSON_PRIOR'
  | 'C_STRENGTH_SYMMETRY'
  | 'D_CAUSAL_ENSEMBLE';

export type DrawDecisionRule =
  | 'ARGMAX'
  | 'FIXED_THRESHOLD'
  | 'CAUSAL_LEARNED_THRESHOLD';

export interface ReliabilityBinDetail {
  binLabel: string;
  minPct: number;
  maxPct: number;
  count: number;
  meanPredictedPct: number | null;
  observedFrequencyPct: number | null;
  calibrationErrorPct: number | null;
  signedBiasPct: number | null; // meanPredicted - observed (>0 means overconfident)
}

export interface ClassTailBreakdown {
  outcomeClass: 'HOME' | 'DRAW' | 'AWAY' | 'OVERALL_TOP';
  totalCount: number;
  ge70Count: number;
  ge70MeanPredPct: number | null;
  ge70ObservedPct: number | null;
  ge70CalErrorPct: number | null;
  ge80Count: number;
  ge80MeanPredPct: number | null;
  ge80ObservedPct: number | null;
  ge80CalErrorPct: number | null;
  ge85Count: number;
  ge85MeanPredPct: number | null;
  ge85ObservedPct: number | null;
  ge85CalErrorPct: number | null;
}

export interface TailShrinkageParameters {
  version: typeof TAIL_SHRINKAGE_VERSION;
  status: Phase5_1CalibrationState;
  hingeThreshold01: number;
  pooledGamma: number;
  gammaHome: number;
  gammaAway: number;
  totalPriorSamples: number;
  tailPriorSamples: number;
  applied: boolean;
  reason: string;
}

export interface Phase5_1OneXTwoCalibrationResult {
  approach: OneXTwoCalibrationApproach;
  homeWin01: number;
  draw01: number;
  awayWin01: number;
  status: Phase5_1CalibrationState;
  sampleCount: number;
  temperature: number | null;
  tailShrinkage: TailShrinkageParameters | null;
  reason: string;
}

export interface Phase5_1DrawSignalFeatures {
  valid: boolean;
  lambdaHome: number | null;
  lambdaAway: number | null;
  absStrengthDiff: number | null;
  expectedGoalDiff: number | null;
  absExpectedGoalDiff: number | null;
  totalExpectedGoals: number | null;
  poissonDrawProb01: number | null;
  historicalLeagueDrawRate01: number | null;
  teamStrengthUncertainty: number | null;
  venueNormalizedStrengthDiff: number | null;
  shrunkAttackDefenseSymmetry: number | null;
  lowScoringIndex: number | null;
  eloAbsDiffCausal: number | null;
  eloSymmetry: number | null;
  homeDrawRateCausal: number | null;
  awayDrawRateCausal: number | null;
}

export interface DrawFeatureUsefulnessEntry {
  featureName: string;
  sampleSize: number;
  meanOnDraws: number | null;
  meanOnNonDraws: number | null;
  correlationWithDraw: number | null;
  rocAuc: number | null;
  univariateCvLogLoss: number | null;
  baselineLogLoss: number | null;
  logLossDelta: number | null;
}

export interface DrawVariantOutput {
  variant: DrawVariantKey;
  status: Phase5_1Status;
  rawProb01: number | null;
  finalProb01: number | null;
  calibrationStatus: Phase5_1CalibrationState;
  samplesUsed: number;
  learnedWeights?: {
    wA?: number;
    wB?: number;
    wC?: number;
    priorWeightB?: number;
  };
  reason: string;
}

export interface DrawThresholdDecision {
  rule: DrawDecisionRule;
  status: Phase5_1Status;
  threshold01: number | null;
  triggered: boolean;
  trainingSamples: number;
}

export interface Phase5_1Prediction {
  matchId: string;
  modelVersion: typeof MODEL_VERSION_PHASE5_1;
  calculatedAt: string;
  isExperimental: true;
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  abstainReason?: string;
  phase3Prediction: Prediction;
  causalPriors: Phase5CausalPriors;
  expectedGoals: {
    shrunkHome: number | null;
    shrunkAway: number | null;
  };
  oneXTwoRaw: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
  };
  oneXTwoVariants: Record<OneXTwoCalibrationApproach, {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    status: Phase5_1CalibrationState;
    sampleCount: number;
    appliedDetail: string;
  }>;
  oneXTwoSelected: {
    approach: OneXTwoCalibrationApproach;
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    status: Phase5_1CalibrationState;
    sampleCount: number;
    tailShrinkage: TailShrinkageParameters | null;
  };
  drawSignals: Phase5_1DrawSignalFeatures;
  drawVariants: Record<DrawVariantKey, DrawVariantOutput>;
  drawSelected: {
    variant: DrawVariantKey;
    probPct: number | null;
    status: Phase5_1Status;
    calibrationStatus: Phase5_1CalibrationState;
    samplesUsed: number;
    thresholds: Record<DrawDecisionRule, DrawThresholdDecision>;
  };
  marketDecisions: {
    '1X2': {
      status: Phase5_1Status;
      probs1X2: { homeWin: number; draw: number; awayWin: number } | null;
      reason: string;
    };
    DRAW: {
      status: Phase5_1Status;
      finalProbabilityPct: number | null;
      reason: string;
    };
  };
  limitationsNote: string;
}

export interface OneXTwoPhase5_1EvalSummary {
  sampleSize: number;
  abstainedCount: number;
  notTrainedCount: number;
  coveragePct: number;
  accuracyPct: number | null;
  accuracyCi95: [number, number] | null;
  brier: number | null;
  logLoss: number | null;
  ecePct: number | null;
  tailEcePct: number | null;
  ge70AggregateErrorPct: number | null;
  sixBinReliability: ReliabilityBinDetail[];
  tailRegions: {
    bin70_80: ReliabilityBinDetail;
    bin80_90: ReliabilityBinDetail;
    bin90_100: ReliabilityBinDetail;
    ge70: ReliabilityBinDetail;
    ge80: ReliabilityBinDetail;
    ge85: ReliabilityBinDetail;
  };
  classWiseTail: {
    HOME: ClassTailBreakdown;
    DRAW: ClassTailBreakdown;
    AWAY: ClassTailBreakdown;
    OVERALL_TOP: ClassTailBreakdown;
  };
  predictedRates: { homePct: number | null; drawPct: number | null; awayPct: number | null };
  actualRates: { homePct: number | null; drawPct: number | null; awayPct: number | null };
}

export interface DrawPhase5_1EvalSummary {
  sampleSize: number;
  abstainedCount: number;
  notTrainedCount: number;
  coveragePct: number;
  thresholdUsedDesc: string;
  meanThresholdPct: number | null;
  meanTrainingSampleSize: number | null;
  positiveCallRatePct: number | null;
  actualDrawRatePct: number | null;
  predictedMeanProbPct: number | null;
  precisionPct: number | null;
  recallPct: number | null;
  f1Pct: number | null;
  accuracyPct: number | null;
  brier: number | null;
  logLoss: number | null;
  ecePct: number | null;
  calibrationCurve: ReliabilityBinDetail[];
}

export interface Phase5_1BenchmarkReport {
  datasetId: string;
  datasetName: string;
  dateRange: string;
  totalFixtures: number;
  isBlindHoldout: boolean;
  leakageCheck: {
    verified: boolean;
    futureDataViolations: number;
    targetMatchViolations: number;
    sameTimestampViolations: number;
    targetXgViolations: number;
    targetEventsViolations: number;
    seasonEndRatingViolations: number;
    futureCalibrationViolations: number;
    futureThresholdViolations: number;
  };
  oneXTwo: {
    baselines: {
      homeBias: OneXTwoPhase5_1EvalSummary;
      empiricalLeague: OneXTwoPhase5_1EvalSummary;
      phase3Frozen: OneXTwoPhase5_1EvalSummary;
      phase4Experimental: OneXTwoPhase5_1EvalSummary;
      phase5Experimental: OneXTwoPhase5_1EvalSummary;
    };
    phase5_1Approaches: {
      A_existingCalibration: OneXTwoPhase5_1EvalSummary;
      B_temperatureScaling: OneXTwoPhase5_1EvalSummary;
      C_betaCalibration: OneXTwoPhase5_1EvalSummary;
      D_tailShrinkage: OneXTwoPhase5_1EvalSummary;
    };
    phase5_1Filtered: OneXTwoPhase5_1EvalSummary;
    tailDiagnosticsNote: string;
  };
  draw: {
    baselines: {
      empiricalDrawRate: DrawPhase5_1EvalSummary;
      phase3Argmax: DrawPhase5_1EvalSummary;
      phase3Signal: DrawPhase5_1EvalSummary;
      phase4Experimental: DrawPhase5_1EvalSummary;
      phase5Argmax: DrawPhase5_1EvalSummary;
      phase5Signal: DrawPhase5_1EvalSummary;
    };
    variants: {
      variantA_phase5: DrawPhase5_1EvalSummary;
      variantB_poissonPrior: DrawPhase5_1EvalSummary;
      variantC_strengthSymmetry: DrawPhase5_1EvalSummary;
      variantD_causalEnsemble: DrawPhase5_1EvalSummary;
    };
    thresholdComparison: {
      defaultArgmax: DrawPhase5_1EvalSummary;
      fixedThreshold285: DrawPhase5_1EvalSummary;
      causalLearnedThreshold: DrawPhase5_1EvalSummary;
    };
    featureUsefulnessAudit: DrawFeatureUsefulnessEntry[];
  };
}

export interface Phase5_1CalibSample1X2 {
  timestampMs: number;
  pH: number;
  pD: number;
  pA: number;
  winner: 'HOME' | 'DRAW' | 'AWAY';
}

export interface Phase5_1HistoryInput {
  match: Match;
  stats: MatchStatistics;
  prediction: Phase5_1Prediction;
  actualHomeGoals: number;
  actualAwayGoals: number;
}
