/**
 * Football Data Architecture & Research Types for MatchMind AI
 * Built for high-accuracy research, multi-model validation, and scientific benchmarking.
 */

export interface Team {
  id: string;
  name: string;
  shortName: string;
  code: string;
  crest: string;
  country: string;
  founded?: number;
  stadium: string | null;
  leagueId: string;
  eloRating: number | null; // null when insufficient historical matches (< 5)
}

export interface League {
  id: string;
  name: string;
  country: string;
  flag: string;
  season: string;
  matchday: number | null;
  totalMatchdays: number | null;
  totalTeams: number | null;
  averageGoalsPerMatch: number | null;
  homeWinRate: number | null;
  drawRate: number | null;
  awayWinRate: number | null;
}

export type MatchStatus = 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'FINISHED';

export interface MatchScore {
  home: number | null;
  away: number | null;
  htHome?: number | null;
  htAway?: number | null;
}

export type DataProviderType = 'UNIFIED' | 'OPENLIGADB' | 'STATSBOMB' | 'DEMO';
export type MatchCategory = 'LIVE_UPCOMING' | 'HISTORICAL' | 'DEMO';
export type DataSourceType = 'COMMUNITY_MAINTAINED' | 'RESEARCH_OPEN_DATA' | 'BENCHMARK_DEMO';

export interface DataProvenance {
  source: string;
  timestamp: string;
  cached?: boolean;
  cachedAt?: string;
  retrievedAt?: string;
  qualityIndicator: 'HIGH_FIDELITY' | 'VERIFIED_SAMPLE' | 'PARTIAL' | 'COMMUNITY_UNVERIFIED';
  qualityScore: number | null; // 0-100 calculated strictly from verifiable completeness, or null
  sampleSizeMatches: number; // actual verified prior matches
  sourceType?: DataSourceType;
  attribution?: string;
  attributionUrl?: string;
  isHistorical?: boolean;
  completenessBreakdown?: {
    hasScores: boolean;
    hasStandings: boolean;
    hasXG: boolean;
    hasLineups: boolean;
    sampleSizeMatches: number;
  };
}

export interface Match {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  matchday: number | null;
  homeTeam: Team;
  awayTeam: Team;
  utcDate: string;
  status: MatchStatus;
  score: MatchScore;
  venue: string | null;
  round?: string;
  matchCategory?: MatchCategory;
  isDemoData: boolean;
  provenance: DataProvenance;
}

export interface FormMatchRecord {
  opponent: string;
  opponentCode: string;
  opponentElo: number | null;
  isHome: boolean;
  score: string;
  result: 'W' | 'D' | 'L';
  date: string;
  goalsFor: number;
  goalsAgainst: number;
  xG?: number | null; // null when provider does not track xG (e.g. OpenLigaDB)
  xGA?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
  shotsConceded?: number | null;
  possession?: number | null;
  restDays: number | null;
}

export interface SplitStats {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  totalXG?: number | null; // null if not recorded by provider
  totalXGA?: number | null;
  avgXG?: number | null;
  avgXGA?: number | null;
  cleanSheets: number;
  failedToScore: number;
  avgPossession?: number | null;
  avgShotsOnTarget?: number | null;
  avgShotsConcededOnTarget?: number | null;
  shotConversionRate?: number | null;
}

export interface TeamStatistics {
  teamId: string;
  teamName: string;
  recentForm: Array<'W' | 'D' | 'L'>;
  formMatches: FormMatchRecord[]; // Pre-match completed fixtures (strictly before target match kickoff)
  overall: SplitStats;
  homeOrAwaySplit: SplitStats;
  eloRating: number | null;
  opponentStrengthIndex: number | null; // Mean empirical Elo of prior opponents, or null
  restDays: number | null;
  fixtureCongestionIndex: number | null;
  confirmedLineupAvailable: boolean | null; // null when untracked
  injuriesCount?: number | null; // null when unverified
  keyPlayersMissing: string[];
  isDemoData: boolean;
  provenance: DataProvenance;
}

export interface HeadToHeadMatch {
  date: string;
  homeTeamName: string;
  awayTeamName: string;
  score: string;
  winner: 'HOME' | 'AWAY' | 'DRAW';
  competition: string;
  homeXG?: number | null;
  awayXG?: number | null;
}

export interface HeadToHeadSummary {
  totalMatches: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  totalGoals: number;
  avgGoals: number | null;
}

export interface MatchStatistics {
  matchId: string;
  homeTeamStats: TeamStatistics;
  awayTeamStats: TeamStatistics;
  headToHead: HeadToHeadMatch[];
  headToHeadSummary: HeadToHeadSummary;
  homeExpectedGoals: number | null; // strictly pre-match projected lambda, null when insufficient sample
  awayExpectedGoals: number | null;
  totalExpectedGoals: number | null;
  observedMatchXG?: { homeXG: number | null; awayXG: number | null } | null; // post-match reference only (NEVER model input)
  hasSufficientData: boolean;
  unavailableReason?: string;
  isDemoData: boolean;
  provenance: DataProvenance;
}

export interface MarketProbabilities {
  // 1X2 Match Winner Model
  homeWin: number; // percentage 0-100
  draw: number;
  awayWin: number;

  // Double Chance Probabilities
  homeOrDraw: number; // 1X
  awayOrDraw: number; // X2
  homeOrAway: number; // 12

  // Over / Under Goals
  over15: number;
  under15: number;
  over25: number;
  under25: number;
  over35: number;
  under35: number;

  // Both Teams To Score
  bttsYes: number;
  bttsNo: number;

  // First Half Markets
  firstHalfOver05: number;
  firstHalfUnder05: number;
  firstHalfOver15: number;
  firstHalfUnder15: number;
  firstHalfHomeWin: number;
  firstHalfDraw: number;
  firstHalfAwayWin: number;
}

export interface ScorelineProbability {
  score: string;
  homeGoals: number;
  awayGoals: number;
  probability: number;
}

/** Individual prediction output from a single model engine */
export interface SingleModelEvaluation {
  modelName: 'Poisson' | 'Dixon-Coles' | 'Elo' | 'Monte Carlo' | 'xG Regression';
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over25Prob: number;
  bttsProb: number;
  projectedHomeGoals: number;
  projectedAwayGoals: number;
  notes: string;
}

/** 4-Pillar Smart Confidence System */
export interface ConfidencePillars {
  modelProbability: number | null;
  historicalAccuracy: number | null; // Populated strictly from an empirical backtest, otherwise null
  dataReliability: number | null;
  modelAgreement: number | null;
  decision: 'RECOMMENDED_ANALYSIS' | 'MODERATE_SIGNAL' | 'ABSTAIN_UNCERTAINTY' | 'ABSTAIN_DATA_DEFICIT';
  abstainReason?: string;
  targetCategoryTier?: string;
}

export interface CalibrationStatus {
  applied: boolean;
  status: 'CALIBRATED' | 'NOT_TRAINED';
  method: 'CAUSAL_TEMPERATURE_SCALING';
  sampleCount: number;
  minRequired: number;
  temperatures?: {
    oneXTwo: number;
    doubleChance: number;
    over15: number;
    over25: number;
    btts: number;
  };
}

export interface Prediction {
  matchId: string;
  calculatedAt: string;
  modelType: 'ENSEMBLE_VALIDATED' | 'POISSON_WEIGHTED' | 'DIXON_COLES' | 'MONTE_CARLO' | 'ABSTAIN';
  probabilities: MarketProbabilities | null;
  rawProbabilities?: MarketProbabilities | null;
  calibrationStatus?: CalibrationStatus;
  expectedScore: {
    home: number;
    away: number;
    mostLikelyScore: string;
    probability: number;
  } | null;
  topScorelines: ScorelineProbability[];
  modelEvaluations: SingleModelEvaluation[];
  confidence: 'HIGH' | 'MEDIUM' | 'MODERATE' | null;
  confidenceScore: number | null;
  abstainReason?: string;
  confidencePillars: ConfidencePillars;
  metricsExplanation: string;
  isDemoData: boolean;
  sampleSizeMatches?: number;
  preMatchXGAvailable?: boolean;
  historicalValidationAvailable?: boolean;
  provenance: DataProvenance;
}

export interface AIAnalysis {
  matchId: string;
  generatedAt: string;
  summary: string;
  keyFactors: string[];
  strengths: {
    home: string[];
    away: string[];
  };
  weaknesses: {
    home: string[];
    away: string[];
  };
  predictedProbabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over25: number;
    btts: number;
  };
  expectedScore: string;
  confidence: 'HIGH' | 'MEDIUM' | 'MODERATE';
  confidenceScore?: number;
  explanation: string;
  tacticalObservations?: string[];
  dataQualityDisclaimer: string;
  isLiveAnalysis: boolean;
}

export interface CalibrationBin {
  binRange: string;
  binMin: number;
  binMax: number;
  sampleCount: number;
  predictedAvgProb: number;
  observedActualFrequency: number;
  calibrationError: number;
}

export interface MarketValidationResult {
  marketKey: 'HOME_WIN' | 'OVER_15' | 'OVER_25' | 'BTTS' | 'DOUBLE_CHANCE';
  marketLabel: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracyPercentage: number;
  brierScore: number;
  logLoss: number;
  baselineComparison: {
    randomBaselineAccuracy: number;
    homeBiasBaselineAccuracy: number;
    accuracyAdvantage: number;
  };
  isTargetCategory: boolean;
  targetAchievementStatus: 'ACHIEVED' | 'RESEARCH_IN_PROGRESS';
}

export interface BacktestOptions {
  leagueId?: string;
  maxMatches?: number | null; // null = full season
  fullSeason?: boolean;
}

export interface BacktestRun {
  runId: string;
  executedAt: string;
  dataSource: string;
  datasetDateRange: string;
  totalMatchesTested: number;
  abstainedMatchesCount?: number;
  brierScoreOverall: number | null;
  logLossOverall: number | null;
  evaluatedMatches: number;
  abstentions: number;
  coverage: number;
  accuracy: number | null;
  brierScore: number | null;
  logLoss: number | null;
  evaluationWindow: {
    requestedMaxMatches: number | null;
    scope: 'FULL_SEASON' | 'WINDOWED' | 'UNSUPPORTED';
    totalFixturesInCompetition: number;
    dateRange: string;
  };
  calibrationBins: CalibrationBin[];
  marketResults: MarketValidationResult[];
  preventedDataLeakage: boolean;
  lookaheadLeakageZeroVerified: boolean;
  isDemoData?: boolean;
  unavailableReason?: string;
}

export interface HistoryRecord {
  id: string;
  match: Match;
  prediction: Prediction;
  aiAnalysis?: AIAnalysis;
  actualResult: {
    finalScore: string;
    homeGoals: number;
    awayGoals: number;
    winner: 'HOME' | 'AWAY' | 'DRAW';
    over15: boolean;
    over25: boolean;
    btts: boolean;
  };
  modelAccuracyNotes: string;
  brierScoreContribution: number | null;
}

export interface AppSettings {
  apiProvider: DataProviderType;
  apiKey: string;
  modelWeighting: {
    homeAdvantageWeight: number;
    recentFormWeight: number;
    h2hWeight: number;
  };
  oddsDisplayFormat: 'PERCENTAGE' | 'DECIMAL_ODDS' | 'PROBABILITY_RATIO';
  disclaimerAcknowledged: boolean;
}
