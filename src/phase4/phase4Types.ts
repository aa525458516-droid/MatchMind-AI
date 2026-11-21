import {
  DataProvenance,
  MarketProbabilities,
  Prediction,
  ScorelineProbability,
  SingleModelEvaluation,
} from '../types/football';

export const MODEL_VERSION_PHASE3 = 'phase-3-frozen' as const;
export const MODEL_VERSION_PHASE4 = 'phase-4-experimental-1' as const;
export const PHASE4_EXPERIMENT_ID = 'exp-phase4-draw-nb-ensemble-v1' as const;

export type ModelVersionTag = typeof MODEL_VERSION_PHASE3 | typeof MODEL_VERSION_PHASE4;

export type CalibrationStateLabel = 'CALIBRATED' | 'UNAVAILABLE' | 'NOT_TRAINED';
export type MarketAbstainStatus = 'AVAILABLE' | 'MARKET_ABSTAIN' | 'MATCH_ABSTAIN';

export interface MarketUncertaintyEstimate {
  marketKey: 'OVER_15' | 'OVER_25' | 'BTTS' | 'DOUBLE_CHANCE';
  rawProb: number; // 0-100
  calibratedProb: number; // 0-100
  uncertainty: number; // epistemic std dev 0-1
  sampleSize: number;
  calibrationStatus: CalibrationStateLabel;
  status: MarketAbstainStatus;
  abstainReason?: string;
}

export interface OneXTwoMarketState {
  status: MarketAbstainStatus;
  sampleSize: number;
  calibrationStatus: CalibrationStateLabel;
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  rawHomeWin: number | null;
  rawDraw: number | null;
  rawAwayWin: number | null;
  abstainReason?: string;
}

export interface DrawExperimentResult {
  drawProb: number | null; // 0-100
  rawDixonColesDrawProb: number | null;
  parityScore: number | null; // 0-1
  lowScoringIndex: number | null; // 0-1
  drawSignal: boolean;
  drawThreshold: number; // e.g. 0.28 for F1 balanced detection
  causalAdjustmentApplied: boolean;
  causalSamplesUsed: number;
}

export interface CausalEnsembleWeights {
  poisson: number;
  dixonColes: number;
  elo: number;
  monteCarlo: number;
  variantBNegBin: number;
  learnedFromSamples: number;
  isUniformFallback: boolean;
  method: 'CAUSAL_EXPONENTIATED_GRADIENT_LOGLOSS' | 'UNIFORM_PRIOR';
}

export interface ExplanationFactor {
  key: string;
  labelEn: string;
  labelAr: string;
  value: string;
  impactEn: string;
  impactAr: string;
  available: boolean;
}

export interface ExplanationPayload {
  matchSummaryEn: string;
  matchSummaryAr: string;
  factors: ExplanationFactor[];
  confidenceNoteEn: string;
  confidenceNoteAr: string;
  abstainExplanationEn: string | null;
  abstainExplanationAr: string | null;
  limitationsEn: string;
  limitationsAr: string;
}

export interface Phase4Prediction {
  matchId: string;
  calculatedAt: string;
  modelVersion: typeof MODEL_VERSION_PHASE4;
  baselineVersion: typeof MODEL_VERSION_PHASE3;
  experimentId: string;
  phase3Prediction: Prediction;
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  abstainReason?: string;
  lambdaComparison: {
    phase3Home: number | null;
    phase3Away: number | null;
    variantBHome: number | null;
    variantBAway: number | null;
    homeVenueWeight: number | null;
    awayVenueWeight: number | null;
    reliabilityWeight: number | null;
  };
  drawExperiment: DrawExperimentResult;
  goalMarkets: {
    oneXTwo: OneXTwoMarketState;
    doubleChance: MarketUncertaintyEstimate;
    over15: MarketUncertaintyEstimate;
    over25: MarketUncertaintyEstimate;
    btts: MarketUncertaintyEstimate;
  };
  ensemble: {
    probabilities: MarketProbabilities | null;
    rawProbabilities: MarketProbabilities | null;
    weights: CausalEnsembleWeights;
    evaluations: SingleModelEvaluation[];
    expectedGoals: {
      home: number | null;
      away: number | null;
    };
    mostLikelyScore: string | null;
    mostLikelyScoreProb: number | null;
    topScorelines: ScorelineProbability[];
    calibrationStatus: CalibrationStateLabel;
    calibrationSampleCount: number;
  };
  explanation: ExplanationPayload;
  isDemoData: boolean;
  sampleSizeMatches: number;
  provenance: DataProvenance;
}

export interface ExperimentReportMetadata {
  experimentId: string;
  modelVersion: ModelVersionTag;
  baselineVersion: typeof MODEL_VERSION_PHASE3;
  parameters: Record<string, string | number | boolean>;
  evaluationWindow: string;
  dataSources: string[];
  causalityStatus: 'STRICT_PRE_KICKOFF_CONFIRMED' | 'UNVERIFIED';
  reproducibilitySignature: string;
  sampleSize: number;
}

export interface GoalMarketMetricsPair {
  evaluatedCount: number;
  abstainedCount: number;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  predictedMean: number | null;
  actualRate: number | null;
  meanUncertainty: number | null;
}

export interface ModelSideMetrics {
  modelVersion: ModelVersionTag;
  totalFixtures: number;
  evaluatedMatches: number;
  abstainedMatches: number;
  coveragePct: number;
  oneXTwo: {
    sampleSize: number;
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
    meanEceRaw: number | null;
    meanEceCalibrated: number | null;
  };
  draw: {
    sampleSize: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    actualDrawRate: number | null;
    predictedDrawMean: number | null;
    brier: number | null;
    logLoss: number | null;
  };
  doubleChance: {
    sampleSize: number;
    abstainedCount: number;
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
  };
  over15: GoalMarketMetricsPair;
  over25: GoalMarketMetricsPair;
  btts: GoalMarketMetricsPair;
  goalsProjection: {
    sampleSize: number;
    predictedHomeMean: number | null;
    actualHomeMean: number | null;
    predictedAwayMean: number | null;
    actualAwayMean: number | null;
    totalGoalsMAE: number | null;
    totalGoalsRMSE: number | null;
  };
}

export interface Phase4BenchmarkComparison {
  datasetName: string;
  leagueId: string;
  evaluationWindow: string;
  dataSource: string;
  causalityStatus: 'STRICT_PRE_KICKOFF_CONFIRMED' | 'UNVERIFIED';
  executedAt: string;
  experimentMetadata: ExperimentReportMetadata;
  phase3: ModelSideMetrics;
  phase4: ModelSideMetrics;
  leakageChecks: {
    futureDataViolations: number;
    targetXgUsed: number;
    verified: boolean;
  };
}

export interface Phase4VersionedHistoryRecord {
  key: string; // `${matchId}::${modelVersion}`
  matchId: string;
  modelVersion: ModelVersionTag;
  experimentId: string | null;
  calculatedAt: string;
  matchDate: string;
  homeTeamName: string;
  awayTeamName: string;
  competition: string;
  leagueId: string;
  provider: string;
  status: 'AVAILABLE' | 'MARKET_ABSTAIN' | 'MATCH_ABSTAIN';
  confidence: 'HIGH' | 'MEDIUM' | 'MODERATE' | null;
  confidenceScore: number | null;
  sampleSize: number;
  calibrationStatus: CalibrationStateLabel;
  probabilities: MarketProbabilities | null;
  expectedScore: string | null;
  abstainReason?: string;
  isDemoData: boolean;
}
