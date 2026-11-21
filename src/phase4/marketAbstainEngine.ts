import { Prediction } from '../types/football';
import {
  CalibrationStateLabel,
  MarketUncertaintyEstimate,
  OneXTwoMarketState,
} from './phase4Types';
import { NegBinGoalModelResult } from './goalMarketExperiment';

export interface MarketAbstainAssessment {
  abstainScope: 'NONE' | 'MARKET_ONLY' | 'MATCH_ABSTAIN';
  summaryReason?: string;
  oneXTwo: OneXTwoMarketState;
  doubleChance: MarketUncertaintyEstimate;
  over15: MarketUncertaintyEstimate;
  over25: MarketUncertaintyEstimate;
  btts: MarketUncertaintyEstimate;
}

export const MARKET_UNCERTAINTY_THRESHOLD_GOALS = 0.088;
export const MARKET_UNCERTAINTY_THRESHOLD_DC = 0.11;

/**
 * Evaluate independent per-market ABSTAIN status while strictly respecting global Phase 3 MATCH ABSTAIN.
 */
export function assessMarketAbstentions(params: {
  phase3Prediction: Prediction;
  rawMarkets: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over15: number;
    over25: number;
    bttsYes: number;
    homeOrDraw: number;
    awayOrDraw: number;
  } | null;
  calibratedMarkets: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over15: number;
    over25: number;
    bttsYes: number;
    homeOrDraw: number;
    awayOrDraw: number;
  } | null;
  negBinResult: NegBinGoalModelResult | null;
  calibrationStatus: CalibrationStateLabel;
  sampleSize: number;
  homePlayed: number;
  awayPlayed: number;
  hasElo: boolean;
  agreementScore: number | null;
}): MarketAbstainAssessment {
  const {
    phase3Prediction,
    rawMarkets,
    calibratedMarkets,
    negBinResult,
    calibrationStatus,
    sampleSize,
    homePlayed,
    awayPlayed,
    hasElo,
    agreementScore,
  } = params;

  const isGlobalMatchAbstain =
    phase3Prediction.modelType === 'ABSTAIN' ||
    phase3Prediction.confidence === null ||
    !phase3Prediction.probabilities ||
    !rawMarkets ||
    !calibratedMarkets ||
    !negBinResult;

  if (isGlobalMatchAbstain) {
    const matchReason =
      phase3Prediction.abstainReason ||
      'Match-level ABSTAIN enforced due to insufficient pre-match data or reliability deficit.';
    return {
      abstainScope: 'MATCH_ABSTAIN',
      summaryReason: matchReason,
      oneXTwo: {
        status: 'MATCH_ABSTAIN',
        sampleSize,
        calibrationStatus: 'UNAVAILABLE',
        homeWin: null,
        draw: null,
        awayWin: null,
        rawHomeWin: null,
        rawDraw: null,
        rawAwayWin: null,
        abstainReason: matchReason,
      },
      doubleChance: {
        marketKey: 'DOUBLE_CHANCE',
        rawProb: 0,
        calibratedProb: 0,
        uncertainty: 1,
        sampleSize,
        calibrationStatus: 'UNAVAILABLE',
        status: 'MATCH_ABSTAIN',
        abstainReason: matchReason,
      },
      over15: {
        marketKey: 'OVER_15',
        rawProb: 0,
        calibratedProb: 0,
        uncertainty: 1,
        sampleSize,
        calibrationStatus: 'UNAVAILABLE',
        status: 'MATCH_ABSTAIN',
        abstainReason: matchReason,
      },
      over25: {
        marketKey: 'OVER_25',
        rawProb: 0,
        calibratedProb: 0,
        uncertainty: 1,
        sampleSize,
        calibrationStatus: 'UNAVAILABLE',
        status: 'MATCH_ABSTAIN',
        abstainReason: matchReason,
      },
      btts: {
        marketKey: 'BTTS',
        rawProb: 0,
        calibratedProb: 0,
        uncertainty: 1,
        sampleSize,
        calibrationStatus: 'UNAVAILABLE',
        status: 'MATCH_ABSTAIN',
        abstainReason: matchReason,
      },
    };
  }

  const minPlayed = Math.min(homePlayed, awayPlayed);

  // 1X2 market-level guard: abstain on 1X2 specifically if cross-model agreement is marginal AND Elo missing on small sample
  let oneXTwoStatus: OneXTwoMarketState['status'] = 'AVAILABLE';
  let oneXTwoReason: string | undefined;
  if (!hasElo && minPlayed < 7) {
    oneXTwoStatus = 'MARKET_ABSTAIN';
    oneXTwoReason = `1X2 market abstained: empirical Elo unavailable with small pre-match sample (${minPlayed} matches).`;
  } else if (agreementScore !== null && agreementScore < 65) {
    oneXTwoStatus = 'MARKET_ABSTAIN';
    oneXTwoReason = `1X2 market abstained: cross-model agreement (${agreementScore}%) below 65% threshold.`;
  }

  // Double Chance guard
  const rawDcFav = Math.max(rawMarkets.homeOrDraw, rawMarkets.awayOrDraw);
  const calDcFav = Math.max(calibratedMarkets.homeOrDraw, calibratedMarkets.awayOrDraw);
  const dcUnc = negBinResult.uncertainties.doubleChance;
  let dcStatus: MarketUncertaintyEstimate['status'] = 'AVAILABLE';
  let dcReason: string | undefined;
  if (dcUnc > MARKET_UNCERTAINTY_THRESHOLD_DC) {
    dcStatus = 'MARKET_ABSTAIN';
    dcReason = `Double Chance market abstained: predictive uncertainty (${dcUnc.toFixed(3)}) exceeds ${MARKET_UNCERTAINTY_THRESHOLD_DC}.`;
  }

  // Over 1.5 guard
  const o15Unc = negBinResult.uncertainties.over15;
  let o15Status: MarketUncertaintyEstimate['status'] = 'AVAILABLE';
  let o15Reason: string | undefined;
  if (o15Unc > MARKET_UNCERTAINTY_THRESHOLD_GOALS && minPlayed < 7) {
    o15Status = 'MARKET_ABSTAIN';
    o15Reason = `Over 1.5 market abstained: small-sample goal variance (${o15Unc.toFixed(3)}) too wide.`;
  }

  // Over 2.5 guard (stricter for noisy low-sample high-variance market)
  const o25Unc = negBinResult.uncertainties.over25;
  let o25Status: MarketUncertaintyEstimate['status'] = 'AVAILABLE';
  let o25Reason: string | undefined;
  if (o25Unc > MARKET_UNCERTAINTY_THRESHOLD_GOALS) {
    o25Status = 'MARKET_ABSTAIN';
    o25Reason = `Over 2.5 market abstained: predictive uncertainty (${o25Unc.toFixed(3)}) exceeds ${MARKET_UNCERTAINTY_THRESHOLD_GOALS}.`;
  }

  // BTTS guard
  const bttsUnc = negBinResult.uncertainties.btts;
  let bttsStatus: MarketUncertaintyEstimate['status'] = 'AVAILABLE';
  let bttsReason: string | undefined;
  if (bttsUnc > MARKET_UNCERTAINTY_THRESHOLD_GOALS) {
    bttsStatus = 'MARKET_ABSTAIN';
    bttsReason = `BTTS market abstained: predictive uncertainty (${bttsUnc.toFixed(3)}) exceeds ${MARKET_UNCERTAINTY_THRESHOLD_GOALS}.`;
  }

  const anyMarketAbstain =
    oneXTwoStatus === 'MARKET_ABSTAIN' ||
    dcStatus === 'MARKET_ABSTAIN' ||
    o15Status === 'MARKET_ABSTAIN' ||
    o25Status === 'MARKET_ABSTAIN' ||
    bttsStatus === 'MARKET_ABSTAIN';

  const marketReasons = [oneXTwoReason, dcReason, o15Reason, o25Reason, bttsReason].filter(Boolean);

  return {
    abstainScope: anyMarketAbstain ? 'MARKET_ONLY' : 'NONE',
    summaryReason: anyMarketAbstain ? marketReasons[0] : undefined,
    oneXTwo: {
      status: oneXTwoStatus,
      sampleSize,
      calibrationStatus,
      homeWin: oneXTwoStatus === 'AVAILABLE' ? calibratedMarkets.homeWin : null,
      draw: oneXTwoStatus === 'AVAILABLE' ? calibratedMarkets.draw : null,
      awayWin: oneXTwoStatus === 'AVAILABLE' ? calibratedMarkets.awayWin : null,
      rawHomeWin: oneXTwoStatus === 'AVAILABLE' ? rawMarkets.homeWin : null,
      rawDraw: oneXTwoStatus === 'AVAILABLE' ? rawMarkets.draw : null,
      rawAwayWin: oneXTwoStatus === 'AVAILABLE' ? rawMarkets.awayWin : null,
      abstainReason: oneXTwoReason,
    },
    doubleChance: {
      marketKey: 'DOUBLE_CHANCE',
      rawProb: rawDcFav,
      calibratedProb: calDcFav,
      uncertainty: dcUnc,
      sampleSize,
      calibrationStatus,
      status: dcStatus,
      abstainReason: dcReason,
    },
    over15: {
      marketKey: 'OVER_15',
      rawProb: rawMarkets.over15,
      calibratedProb: calibratedMarkets.over15,
      uncertainty: o15Unc,
      sampleSize,
      calibrationStatus,
      status: o15Status,
      abstainReason: o15Reason,
    },
    over25: {
      marketKey: 'OVER_25',
      rawProb: rawMarkets.over25,
      calibratedProb: calibratedMarkets.over25,
      uncertainty: o25Unc,
      sampleSize,
      calibrationStatus,
      status: o25Status,
      abstainReason: o25Reason,
    },
    btts: {
      marketKey: 'BTTS',
      rawProb: rawMarkets.bttsYes,
      calibratedProb: calibratedMarkets.bttsYes,
      uncertainty: bttsUnc,
      sampleSize,
      calibrationStatus,
      status: bttsStatus,
      abstainReason: bttsReason,
    },
  };
}
