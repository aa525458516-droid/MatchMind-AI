import { MatchStatistics, Prediction } from '../types/football';
import {
  Phase5BttsVariantComparison,
  Phase5CalibrationMethod,
  Phase5DrawResearch,
  Phase5MarketDecision,
  Phase5MarketKey,
  Phase5O25VariantComparison,
} from './phase5Types';

export interface Phase5AbstainInput {
  phase3Prediction: Prediction;
  stats: MatchStatistics;
  hasCausalElo: boolean;
  oneXTwoRaw: { homeWin: number; draw: number; awayWin: number } | null;
  oneXTwoFinal: { homeWin: number; draw: number; awayWin: number } | null;
  oneXTwoCalibrationStatus: 'CALIBRATED' | 'NOT_TRAINED';
  oneXTwoCalibrationMethod: Phase5CalibrationMethod;
  oneXTwoCalibrationSamples: number;
  oneXTwoUncertainty: number | null;
  drawResearch: Phase5DrawResearch;
  o25Research: Phase5O25VariantComparison;
  bttsResearch: Phase5BttsVariantComparison;
}

export function assessPhase5MarketDecisions(input: Phase5AbstainInput): {
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  abstainReason?: string;
  decisions: Record<Phase5MarketKey, Phase5MarketDecision>;
} {
  const { phase3Prediction, stats, hasCausalElo, drawResearch, o25Research, bttsResearch } = input;
  const minPlayed = Math.min(
    stats.homeTeamStats.overall.matchesPlayed,
    stats.awayTeamStats.overall.matchesPlayed
  );
  const agreement = phase3Prediction.confidencePillars?.modelAgreement ?? 0;

  // Global Match-Level ABSTAIN MUST strictly preserve Frozen Phase 3 safety rules
  const globalAbstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    phase3Prediction.probabilities === null ||
    minPlayed < 5;

  if (globalAbstain) {
    const reason =
      phase3Prediction.abstainReason ||
      'Global Phase 3 ABSTAIN preserved (insufficient pre-match sample or data integrity deficit).';
    const makeAbstain = (market: Phase5MarketKey): Phase5MarketDecision => ({
      market,
      status: 'ABSTAIN',
      rawProbabilityPct: null,
      finalProbabilityPct: null,
      probs1X2: market === '1X2' ? null : undefined,
      calibrationStatus: 'NOT_TRAINED',
      calibrationMethod: 'RAW_IDENTITY',
      calibrationSampleCount: 0,
      uncertainty: null,
      reason,
    });
    return {
      abstainScope: 'MATCH_ABSTAIN',
      abstainReason: reason,
      decisions: {
        '1X2': makeAbstain('1X2'),
        DRAW: makeAbstain('DRAW'),
        OVER25: makeAbstain('OVER25'),
        BTTS: makeAbstain('BTTS'),
      },
    };
  }

  // 1X2 decision
  let oneXTwoDecision: Phase5MarketDecision;
  if ((!hasCausalElo && minPlayed < 7) || agreement < 57 || (input.oneXTwoUncertainty ?? 0) > 0.105) {
    oneXTwoDecision = {
      market: '1X2',
      status: 'ABSTAIN',
      rawProbabilityPct: null,
      finalProbabilityPct: null,
      probs1X2: null,
      calibrationStatus: input.oneXTwoCalibrationStatus,
      calibrationMethod: input.oneXTwoCalibrationMethod,
      calibrationSampleCount: input.oneXTwoCalibrationSamples,
      uncertainty: input.oneXTwoUncertainty,
      reason: !hasCausalElo && minPlayed < 7
        ? '1X2 abstained: Elo unavailable with < 7 pre-match fixtures.'
        : '1X2 abstained: high cross-model / posterior outcome variance.',
    };
  } else {
    const topProb = input.oneXTwoFinal
      ? Math.max(input.oneXTwoFinal.homeWin, input.oneXTwoFinal.draw, input.oneXTwoFinal.awayWin)
      : null;
    oneXTwoDecision = {
      market: '1X2',
      status: 'PREDICT',
      rawProbabilityPct: input.oneXTwoRaw
        ? Math.max(input.oneXTwoRaw.homeWin, input.oneXTwoRaw.draw, input.oneXTwoRaw.awayWin)
        : null,
      finalProbabilityPct: topProb,
      probs1X2: input.oneXTwoFinal,
      calibrationStatus: input.oneXTwoCalibrationStatus,
      calibrationMethod: input.oneXTwoCalibrationMethod,
      calibrationSampleCount: input.oneXTwoCalibrationSamples,
      uncertainty: input.oneXTwoUncertainty,
      reason: 'Pre-match 1X2 consensus and sample depth sufficient.',
    };
  }

  // DRAW decision
  let drawDecision: Phase5MarketDecision;
  if (drawResearch.finalDrawProbPct === null) {
    drawDecision = {
      market: 'DRAW',
      status: 'ABSTAIN',
      rawProbabilityPct: null,
      finalProbabilityPct: null,
      calibrationStatus: drawResearch.calibrationStatus,
      calibrationMethod: drawResearch.calibrationMethod,
      calibrationSampleCount: drawResearch.causalSamplesUsed,
      uncertainty: drawResearch.uncertainty,
      reason: 'Draw abstained: unavailable pre-match goal intensity.',
    };
  } else if (minPlayed < 6 || (drawResearch.uncertainty ?? 0) > 0.085) {
    drawDecision = {
      market: 'DRAW',
      status: 'ABSTAIN',
      rawProbabilityPct: drawResearch.shrunkDrawProbPct,
      finalProbabilityPct: null,
      calibrationStatus: drawResearch.calibrationStatus,
      calibrationMethod: drawResearch.calibrationMethod,
      calibrationSampleCount: drawResearch.causalSamplesUsed,
      uncertainty: drawResearch.uncertainty,
      reason: 'Draw abstained: small sample (< 6) or high epistemic variance around draw parity.',
    };
  } else {
    drawDecision = {
      market: 'DRAW',
      status: 'PREDICT',
      rawProbabilityPct: drawResearch.shrunkDrawProbPct,
      finalProbabilityPct: drawResearch.finalDrawProbPct,
      calibrationStatus: drawResearch.calibrationStatus,
      calibrationMethod: drawResearch.calibrationMethod,
      calibrationSampleCount: drawResearch.causalSamplesUsed,
      uncertainty: drawResearch.uncertainty,
      reason: drawResearch.notes,
    };
  }

  // OVER 2.5 decision
  let o25Decision: Phase5MarketDecision;
  if (o25Research.selectedFinalPct === null) {
    o25Decision = {
      market: 'OVER25',
      status: 'ABSTAIN',
      rawProbabilityPct: null,
      finalProbabilityPct: null,
      calibrationStatus: o25Research.calibrationStatus,
      calibrationMethod: o25Research.calibrationMethod,
      calibrationSampleCount: o25Research.calibrationSamplesUsed,
      uncertainty: o25Research.uncertainty,
      reason: 'Over 2.5 abstained: pre-match expected goals unavailable.',
    };
  } else if ((o25Research.uncertainty ?? 0) > 0.095 || (minPlayed < 6 && Math.abs(o25Research.selectedFinalPct - 50) < 3.5)) {
    o25Decision = {
      market: 'OVER25',
      status: 'ABSTAIN',
      rawProbabilityPct: o25Research.selectedRawPct,
      finalProbabilityPct: null,
      calibrationStatus: o25Research.calibrationStatus,
      calibrationMethod: o25Research.calibrationMethod,
      calibrationSampleCount: o25Research.calibrationSamplesUsed,
      uncertainty: o25Research.uncertainty,
      reason: 'Over 2.5 abstained: elevated posterior goal-rate variance around 2.5 threshold.',
    };
  } else {
    o25Decision = {
      market: 'OVER25',
      status: 'PREDICT',
      rawProbabilityPct: o25Research.selectedRawPct,
      finalProbabilityPct: o25Research.selectedFinalPct,
      calibrationStatus: o25Research.calibrationStatus,
      calibrationMethod: o25Research.calibrationMethod,
      calibrationSampleCount: o25Research.calibrationSamplesUsed,
      uncertainty: o25Research.uncertainty,
      reason: `NegBin + hierarchical shrunk lambda projection (dispersion r=${o25Research.causalDispersionUsed}).`,
    };
  }

  // BTTS decision
  let bttsDecision: Phase5MarketDecision;
  if (bttsResearch.selectedFinalPct === null) {
    bttsDecision = {
      market: 'BTTS',
      status: 'ABSTAIN',
      rawProbabilityPct: null,
      finalProbabilityPct: null,
      calibrationStatus: bttsResearch.calibrationStatus,
      calibrationMethod: bttsResearch.calibrationMethod,
      calibrationSampleCount: bttsResearch.calibrationSamplesUsed,
      uncertainty: bttsResearch.uncertainty,
      reason: 'BTTS abstained: pre-match scoring rates unavailable.',
    };
  } else if ((bttsResearch.uncertainty ?? 0) > 0.095 || (minPlayed < 6 && Math.abs(bttsResearch.selectedFinalPct - 50) < 3.5)) {
    bttsDecision = {
      market: 'BTTS',
      status: 'ABSTAIN',
      rawProbabilityPct: bttsResearch.selectedRawPct,
      finalProbabilityPct: null,
      calibrationStatus: bttsResearch.calibrationStatus,
      calibrationMethod: bttsResearch.calibrationMethod,
      calibrationSampleCount: bttsResearch.calibrationSamplesUsed,
      uncertainty: bttsResearch.uncertainty,
      reason: 'BTTS abstained: high clean-sheet / shutout posterior variance on small sample.',
    };
  } else {
    bttsDecision = {
      market: 'BTTS',
      status: 'PREDICT',
      rawProbabilityPct: bttsResearch.selectedRawPct,
      finalProbabilityPct: bttsResearch.selectedFinalPct,
      calibrationStatus: bttsResearch.calibrationStatus,
      calibrationMethod: bttsResearch.calibrationMethod,
      calibrationSampleCount: bttsResearch.calibrationSamplesUsed,
      uncertainty: bttsResearch.uncertainty,
      reason: 'Independent scoring/clean-sheet + NegBin BTTS consensus passed stability checks.',
    };
  }

  const decisions = {
    '1X2': oneXTwoDecision,
    DRAW: drawDecision,
    OVER25: o25Decision,
    BTTS: bttsDecision,
  };

  const anyMarketAbstained = Object.values(decisions).some((d) => d.status !== 'PREDICT');
  const firstAbstainReason = Object.values(decisions).find((d) => d.status !== 'PREDICT')?.reason;

  return {
    abstainScope: anyMarketAbstained ? 'MARKET_ONLY' : 'NONE',
    abstainReason: firstAbstainReason,
    decisions,
  };
}
