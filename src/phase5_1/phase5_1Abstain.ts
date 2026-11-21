import { MatchStatistics, Prediction } from '../types/football';
import { DrawVariantOutput, Phase5_1Status } from './phase5_1Types';

export interface Phase5_1AbstainInput {
  phase3Prediction: Prediction;
  stats: MatchStatistics;
  hasCausalElo: boolean;
  oneXTwoFinalPct: { homeWin: number; draw: number; awayWin: number } | null;
  oneXTwoUncertainty: number | null;
  drawVariantOutput: DrawVariantOutput;
  drawUncertainty: number | null;
}

export function assessPhase5_1Decisions(input: Phase5_1AbstainInput): {
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  abstainReason?: string;
  oneXTwoDecision: {
    status: Phase5_1Status;
    probs1X2: { homeWin: number; draw: number; awayWin: number } | null;
    reason: string;
  };
  drawDecision: {
    status: Phase5_1Status;
    finalProbabilityPct: number | null;
    reason: string;
  };
} {
  const { phase3Prediction, stats, hasCausalElo, oneXTwoFinalPct, oneXTwoUncertainty, drawVariantOutput, drawUncertainty } = input;

  const minPlayed = Math.min(
    stats.homeTeamStats.overall.matchesPlayed,
    stats.awayTeamStats.overall.matchesPlayed
  );
  const agreement = phase3Prediction.confidencePillars?.modelAgreement ?? 0;

  // Strictly preserve Frozen Phase 3 global ABSTAIN contract
  const globalAbstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    phase3Prediction.probabilities === null ||
    minPlayed < 5;

  if (globalAbstain) {
    const reason =
      phase3Prediction.abstainReason ||
      'Frozen Phase 3 global ABSTAIN preserved (pre-match sample < 5 or data deficit).';
    return {
      abstainScope: 'MATCH_ABSTAIN',
      abstainReason: reason,
      oneXTwoDecision: { status: 'ABSTAIN', probs1X2: null, reason },
      drawDecision: { status: 'ABSTAIN', finalProbabilityPct: null, reason },
    };
  }

  let oneXTwoDecision: {
    status: Phase5_1Status;
    probs1X2: { homeWin: number; draw: number; awayWin: number } | null;
    reason: string;
  };

  if (
    !oneXTwoFinalPct ||
    (!hasCausalElo && minPlayed < 7) ||
    agreement < 57 ||
    (oneXTwoUncertainty ?? 0) > 0.105
  ) {
    oneXTwoDecision = {
      status: 'ABSTAIN',
      probs1X2: null,
      reason:
        !hasCausalElo && minPlayed < 7
          ? '1X2 abstained: causal Elo unavailable with < 7 pre-match fixtures.'
          : '1X2 abstained: high cross-model or posterior outcome variance.',
    };
  } else {
    oneXTwoDecision = {
      status: 'PREDICT',
      probs1X2: oneXTwoFinalPct,
      reason: 'Phase 5.1 tail-calibrated 1X2 passed sample depth and consensus checks.',
    };
  }

  let drawDecision: {
    status: Phase5_1Status;
    finalProbabilityPct: number | null;
    reason: string;
  };

  if (drawVariantOutput.status === 'ABSTAIN' || drawVariantOutput.finalProb01 === null) {
    drawDecision = {
      status: drawVariantOutput.status === 'NOT_TRAINED' ? 'NOT_TRAINED' : 'ABSTAIN',
      finalProbabilityPct: null,
      reason: drawVariantOutput.reason,
    };
  } else if (minPlayed < 6 || (drawUncertainty ?? 0) > 0.085) {
    drawDecision = {
      status: 'ABSTAIN',
      finalProbabilityPct: null,
      reason: 'Draw abstained: small team sample (< 6) or elevated draw posterior variance.',
    };
  } else {
    drawDecision = {
      status: 'PREDICT',
      finalProbabilityPct: Math.round(drawVariantOutput.finalProb01 * 1000) / 10,
      reason: drawVariantOutput.reason,
    };
  }

  const anyAbstain = oneXTwoDecision.status !== 'PREDICT' || drawDecision.status !== 'PREDICT';
  const firstReason =
    oneXTwoDecision.status !== 'PREDICT'
      ? oneXTwoDecision.reason
      : drawDecision.status !== 'PREDICT'
      ? drawDecision.reason
      : undefined;

  return {
    abstainScope: anyAbstain ? 'MARKET_ONLY' : 'NONE',
    abstainReason: firstReason,
    oneXTwoDecision,
    drawDecision,
  };
}
