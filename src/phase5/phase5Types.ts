import { Match, MatchStatistics, Prediction } from '../types/football';

export const MODEL_VERSION_PHASE5 = 'phase-5-research' as const;

export type Phase5MarketKey = '1X2' | 'DRAW' | 'OVER25' | 'BTTS';

export type Phase5MarketStatus = 'PREDICT' | 'ABSTAIN' | 'NOT_TRAINED';

export type Phase5CalibrationMethod = 'RAW_IDENTITY' | 'TEMPERATURE' | 'BETA' | 'ISOTONIC';

export type Phase5CalibrationState = 'CALIBRATED' | 'NOT_TRAINED';

export interface CausalTeamRateSummary {
  played: number;
  venuePlayed: number;
  scored: number;
  conceded: number;
  venueScored: number;
  venueConceded: number;
  cleanSheets: number;
  failedToScore: number;
  draws: number;
  over25Count: number;
  bttsCount: number;
}

export interface Phase5CausalPriors {
  targetMatchId: string;
  targetKickoffUtc: string;
  validTimestamp: boolean;
  priorLeagueMatches: number;
  avgHomeGoals: number | null;
  avgAwayGoals: number | null;
  avgTotalGoals: number | null;
  varHomeGoals: number | null;
  varAwayGoals: number | null;
  varTotalGoals: number | null;
  /** Causal Negative Binomial dispersion parameter r (higher = closer to Poisson) */
  causalDispersionHome: number;
  causalDispersionAway: number;
  overdispersionRatioHome: number | null;
  overdispersionRatioAway: number | null;
  leagueDrawRate: number | null;
  leagueOver25Rate: number | null;
  leagueBttsRate: number | null;
  leagueHomeScoredAnyRate: number | null;
  leagueAwayScoredAnyRate: number | null;
  homeEloCausal: number | null;
  awayEloCausal: number | null;
  homeTeamPriors: CausalTeamRateSummary;
  awayTeamPriors: CausalTeamRateSummary;
}

export interface Phase5DrawResearch {
  status: Phase5MarketStatus;
  rawDixonColesDrawProbPct: number | null;
  empiricalLeagueDrawPriorPct: number | null;
  shrunkDrawProbPct: number | null;
  logisticAdjustedDrawProbPct: number | null;
  calibratedDrawProbPct: number | null;
  finalDrawProbPct: number | null;
  parityScore: number | null;
  lowScoringIndex: number | null;
  strengthUncertainty: number | null;
  eloDiffCausal: number | null;
  causalAdjustmentApplied: boolean;
  causalSamplesUsed: number;
  drawSignalActive: boolean;
  drawSignalThreshold: number;
  calibrationMethod: Phase5CalibrationMethod;
  calibrationStatus: Phase5CalibrationState;
  uncertainty: number | null;
  notes: string;
}

export interface Phase5O25VariantComparison {
  variantAPoissonPct: number | null;
  variantBNegBinPct: number | null;
  variantCShrunkPct: number | null;
  variantDCalibratedPct: number | null;
  selectedRawPct: number | null;
  selectedFinalPct: number | null;
  causalDispersionUsed: number;
  variantCLambdaHome: number | null;
  variantCLambdaAway: number | null;
  calibrationMethod: Phase5CalibrationMethod;
  calibrationStatus: Phase5CalibrationState;
  calibrationSamplesUsed: number;
  uncertainty: number | null;
}

export interface Phase5BttsVariantComparison {
  variantAExistingPct: number | null;
  variantBIndependentPct: number | null;
  variantCNegBinPct: number | null;
  variantDCalibratedPct: number | null;
  homeScoringProbPct: number | null;
  awayScoringProbPct: number | null;
  selectedRawPct: number | null;
  selectedFinalPct: number | null;
  calibrationMethod: Phase5CalibrationMethod;
  calibrationStatus: Phase5CalibrationState;
  calibrationSamplesUsed: number;
  uncertainty: number | null;
}

export interface Phase5MarketDecision {
  market: Phase5MarketKey;
  status: Phase5MarketStatus;
  rawProbabilityPct: number | null;
  finalProbabilityPct: number | null;
  probs1X2?: {
    homeWin: number;
    draw: number;
    awayWin: number;
  } | null;
  calibrationStatus: Phase5CalibrationState;
  calibrationMethod: Phase5CalibrationMethod;
  calibrationSampleCount: number;
  uncertainty: number | null;
  reason: string;
}

export interface Phase5CalibrationComparisonEntry {
  method: Phase5CalibrationMethod;
  available: boolean;
  minRequired: number;
  sampleCount: number;
  causalValidationLogLoss: number | null;
  applied: boolean;
}

export interface Phase5Prediction {
  matchId: string;
  modelVersion: typeof MODEL_VERSION_PHASE5;
  calculatedAt: string;
  isExperimental: true;
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  abstainReason?: string;
  phase3Prediction: Prediction;
  causalPriors: Phase5CausalPriors;
  expectedGoals: {
    phase3Home: number | null;
    phase3Away: number | null;
    shrunkHome: number | null;
    shrunkAway: number | null;
  };
  oneXTwo: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    rawHomeWin: number | null;
    rawDraw: number | null;
    rawAwayWin: number | null;
    calibrationStatus: Phase5CalibrationState;
    calibrationMethod: Phase5CalibrationMethod;
    calibrationSampleCount: number;
  };
  drawResearch: Phase5DrawResearch;
  o25Research: Phase5O25VariantComparison;
  bttsResearch: Phase5BttsVariantComparison;
  calibrationDiagnostics: {
    oneXTwo: Phase5CalibrationComparisonEntry[];
    draw: Phase5CalibrationComparisonEntry[];
    over25: Phase5CalibrationComparisonEntry[];
    btts: Phase5CalibrationComparisonEntry[];
  };
  marketDecisions: Record<Phase5MarketKey, Phase5MarketDecision>;
  limitationsNote: string;
}

export interface BinaryEvalSummary {
  sampleSize: number;
  abstainedCount: number;
  notTrainedCount: number;
  coveragePct: number;
  actualPositiveRatePct: number | null;
  predictedMeanProbPct: number | null;
  accuracyPct: number | null;
  accuracyCi95: [number, number] | null;
  precisionPct: number | null;
  recallPct: number | null;
  f1Pct: number | null;
  brier: number | null;
  logLoss: number | null;
  ecePct: number | null;
  tailEcePct: number | null;
  reliabilityBins: Array<{
    binLabel: string;
    count: number;
    avgPredictedPct: number | null;
    actualRatePct: number | null;
    absErrorPct: number | null;
  }>;
}

export interface OneXTwoEvalSummary {
  sampleSize: number;
  abstainedCount: number;
  coveragePct: number;
  accuracyPct: number | null;
  accuracyCi95: [number, number] | null;
  brier: number | null;
  logLoss: number | null;
  meanEcePct: number | null;
  tailEcePct: number | null;
  predictedRates: { homePct: number | null; drawPct: number | null; awayPct: number | null };
  actualRates: { homePct: number | null; drawPct: number | null; awayPct: number | null };
  reliabilityBins: Array<{
    binLabel: string;
    count: number;
    avgPredictedPct: number | null;
    actualRatePct: number | null;
    absErrorPct: number | null;
  }>;
}

export interface GoalsRegressionSummary {
  sampleSize: number;
  mae: number | null;
  rmse: number | null;
  predictedMeanTotal: number | null;
  actualMeanTotal: number | null;
  bias: number | null;
}

export interface Phase5BenchmarkReport {
  datasetId: string;
  datasetName: string;
  dateRange: string;
  totalFixtures: number;
  isBlindHoldout: boolean;
  leakageCheck: {
    verified: boolean;
    futureDataViolations: number;
    targetXgViolations: number;
    sameTimestampViolations: number;
    postKickoffViolations: number;
  };
  baselines: {
    oneXTwoHomeBias: { accuracyPct: number | null; brier: number | null; logLoss: number | null };
    oneXTwoEmpiricalLeague: { accuracyPct: number | null; brier: number | null; logLoss: number | null };
    drawEmpiricalPrior: BinaryEvalSummary;
    over25MajorityClass: { accuracyPct: number | null; majorityLabel: string };
    over25EmpiricalPrior: BinaryEvalSummary;
    bttsMajorityClass: { accuracyPct: number | null; majorityLabel: string };
    bttsEmpiricalPrior: BinaryEvalSummary;
  };
  models: {
    phase3Frozen: {
      oneXTwo: OneXTwoEvalSummary;
      drawArgmax: BinaryEvalSummary;
      drawSignal: BinaryEvalSummary;
      over25: BinaryEvalSummary;
      btts: BinaryEvalSummary;
      goals: GoalsRegressionSummary;
    };
    phase4Experimental: {
      oneXTwo: OneXTwoEvalSummary;
      drawArgmax: BinaryEvalSummary;
      drawSignal: BinaryEvalSummary;
      over25: BinaryEvalSummary;
      btts: BinaryEvalSummary;
      goals: GoalsRegressionSummary;
    };
    phase5Experimental: {
      oneXTwo: OneXTwoEvalSummary;
      oneXTwoFiltered: OneXTwoEvalSummary;
      drawArgmax: BinaryEvalSummary;
      drawSignal: BinaryEvalSummary;
      drawFiltered: BinaryEvalSummary;
      over25: BinaryEvalSummary;
      over25Filtered: BinaryEvalSummary;
      btts: BinaryEvalSummary;
      bttsFiltered: BinaryEvalSummary;
      goals: GoalsRegressionSummary;
    };
  };
  o25Variants: {
    variantA_PoissonDC: BinaryEvalSummary;
    variantB_NegBin: BinaryEvalSummary;
    variantC_Shrunk: BinaryEvalSummary;
    variantD_Calibrated: BinaryEvalSummary;
  };
  bttsVariants: {
    variantA_Existing: BinaryEvalSummary;
    variantB_Independent: BinaryEvalSummary;
    variantC_NegBin: BinaryEvalSummary;
    variantD_Calibrated: BinaryEvalSummary;
  };
  calibrationAudit: {
    oneXTwo: { rawLogLoss: number | null; tempLogLoss: number | null; rawEcePct: number | null; tempEcePct: number | null; rawTailEcePct: number | null; tempTailEcePct: number | null; calibratedCount: number; notTrainedCount: number };
    over25: { rawLogLoss: number | null; tempLogLoss: number | null; betaLogLoss: number | null; isotonicLogLoss: number | null; phase5SelectedLogLoss: number | null; rawEcePct: number | null; phase5SelectedEcePct: number | null; notTrainedCount: number };
    btts: { rawLogLoss: number | null; tempLogLoss: number | null; betaLogLoss: number | null; isotonicLogLoss: number | null; phase5SelectedLogLoss: number | null; rawEcePct: number | null; phase5SelectedEcePct: number | null; notTrainedCount: number };
    draw: { rawLogLoss: number | null; tempLogLoss: number | null; betaLogLoss: number | null; isotonicLogLoss: number | null; phase5SelectedLogLoss: number | null; rawEcePct: number | null; phase5SelectedEcePct: number | null; notTrainedCount: number };
  };
}

export interface Phase5HistoryRecordInput {
  match: Match;
  stats: MatchStatistics;
  prediction: Phase5Prediction;
  actualHomeGoals: number;
  actualAwayGoals: number;
}
