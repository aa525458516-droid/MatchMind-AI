/**
 * Research & Scientific Validation Hub
 *
 * Displays strictly empirical, lookahead-leakage-free backtest outcomes.
 * Never displays hardcoded accuracy claims; shows "Not available" if no completed backtest exists.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Scale,
  Target,
  Clock,
  Award,
  RefreshCw,
} from 'lucide-react';
import { BacktestRun, League } from '../types/football';
import { footballService } from '../services/footballDataService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { useLanguage } from '../i18n/LanguageContext';
import {
  translateEvaluationScope,
  translateMarketKey,
  translateProviderMessage,
} from '../i18n/translations';

interface Props {
  providerVersion?: number;
}

export const ValidationPage: React.FC<Props> = ({ providerVersion = 0 }) => {
  const { language, t, formatDateTime } = useLanguage();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [fullSeason, setFullSeason] = useState<boolean>(false);
  const [backtestRun, setBacktestRun] = useState<BacktestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setSelectedLeague('ALL');
  }, [providerVersion]);

  const loadBacktest = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const provider = footballService.getActiveProvider();
      const discovered = await footballService.getLeagues();
      const historicalLeagues =
        provider === 'OPENLIGADB'
          ? []
          : provider === 'UNIFIED' || provider === 'STATSBOMB'
          ? discovered.filter((l) => l.id.startsWith('statsbomb-'))
          : discovered;
      setLeagues(historicalLeagues);

      const effectiveLeagueId =
        selectedLeague !== 'ALL' && historicalLeagues.some((l) => l.id === selectedLeague)
          ? selectedLeague
          : undefined;

      const run = await footballService.getBacktestRun({
        leagueId: effectiveLeagueId,
        fullSeason,
      });
      setBacktestRun(run);
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMsg(e?.message || 'Failed to execute historical validation run.');
      setBacktestRun(null);
    } finally {
      setLoading(false);
    }
  }, [selectedLeague, fullSeason]);

  useEffect(() => {
    loadBacktest();
  }, [loadBacktest, providerVersion]);

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <span className="text-xs text-slate-400 font-mono">
          {t.validation.loadingText}
        </span>
      </div>
    );
  }

  if (errorMsg || !backtestRun) {
    return (
      <div className="space-y-6">
        <DisclaimerBanner />
        <div className="bg-rose-950/30 border border-rose-800/70 rounded-xl p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <div className="text-sm font-bold text-rose-100">{t.validation.unavailableTitle}</div>
          <p className="text-xs text-rose-200/80 max-w-md mx-auto">
            {errorMsg ? translateProviderMessage(errorMsg, language) : t.validation.unavailableFallback}
          </p>
          <button
            onClick={loadBacktest}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.validation.retryBtn}</span>
          </button>
        </div>
      </div>
    );
  }

  const dcMarket = backtestRun.marketResults.find((m) => m.marketKey === 'DOUBLE_CHANCE');
  const hasMetrics =
    backtestRun.totalMatchesTested > 0 &&
    backtestRun.brierScoreOverall !== null &&
    backtestRun.logLossOverall !== null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 sm:p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                {t.validation.tag}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{t.validation.subTag}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {t.validation.pageTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {t.validation.sourceLabel}{' '}
              <span className="text-slate-200 font-medium">{backtestRun.dataSource}</span> ·{' '}
              {t.validation.evaluatedLabel}{' '}
              <span dir="ltr" className="inline-block">
                {formatDateTime(backtestRun.executedAt)}
              </span>
              . {t.validation.temporalConstraintDesc}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DemoDataBadge
              provider={footballService.getActiveProvider()}
              category={backtestRun.isDemoData ? 'DEMO' : 'HISTORICAL'}
              isDemo={backtestRun.isDemoData}
            />
          </div>
        </div>
      </div>

      <DisclaimerBanner />

      {/* Competition & Evaluation Window Selector */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-slate-300 font-semibold">
            <span>{t.validation.competitionLabel}</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              disabled={leagues.length === 0}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[260px] disabled:opacity-50"
            >
              <option value="ALL">
                {leagues.length > 0
                  ? `${t.validation.defaultCompetition} (${leagues[0].name})`
                  : t.validation.noHistoricalCompetitions}
              </option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.flag} {l.name} ({l.season})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={fullSeason}
              onChange={(e) => setFullSeason(e.target.checked)}
              disabled={leagues.length === 0}
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
            />
            <span>{t.validation.fullSeasonScope}</span>
          </label>
        </div>

        <div className="text-[11px] font-mono text-slate-400">
          {t.validation.scopeLabel}{' '}
          <strong className="text-slate-200">
            {translateEvaluationScope(backtestRun.evaluationWindow.scope, language)}
          </strong>{' '}
          · {t.validation.coverageLabel}{' '}
          <strong className="text-emerald-400" dir="ltr">
            {backtestRun.coverage}%
          </strong>{' '}
          <span dir="ltr">
            ({backtestRun.evaluatedMatches}/{backtestRun.evaluatedMatches + backtestRun.abstentions})
          </span>
        </div>
      </div>

      {/* Research Target Tracking Banner (Strictly empirical, never hardcoded) */}
      <div className="bg-gradient-to-r from-emerald-950/30 via-slate-900/80 to-blue-950/30 border border-slate-700/80 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-400" />
              <h2 className="text-sm font-bold text-white tracking-tight">
                {t.validation.trackerTitle}
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
              {t.validation.trackerDesc} ({backtestRun.abstainedMatchesCount ?? 0} {t.validation.abstainedInRun}).
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-center min-w-[190px] shrink-0">
            <span className="text-[10px] font-mono uppercase text-slate-400 block">
              {t.validation.measuredDcHitRate}
            </span>
            <span className="font-mono text-2xl font-extrabold text-emerald-400" dir="ltr">
              {dcMarket ? `${dcMarket.accuracyPercentage.toFixed(1)}%` : t.common.notAvailable}
            </span>
            <span className="text-[10px] font-mono text-slate-300 block mt-0.5">
              {!dcMarket
                ? t.validation.noTestableSample
                : dcMarket.targetAchievementStatus === 'ACHIEVED'
                ? t.validation.benchmarkMet
                : t.validation.researchInProgress}
            </span>
          </div>
        </div>
      </div>

      {backtestRun.unavailableReason && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold text-amber-100 block">{t.validation.availabilityNotice}</strong>
            <span className="mt-0.5 block">
              {translateProviderMessage(backtestRun.unavailableReason, language)}
            </span>
          </div>
        </div>
      )}

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs">{t.validation.kpiBrierTitle}</span>
            <Scale className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white" dir="ltr">
            {backtestRun.brierScoreOverall !== null
              ? backtestRun.brierScoreOverall.toFixed(3)
              : t.common.notAvailable}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {hasMetrics
              ? `${backtestRun.totalMatchesTested} ${t.validation.testedMatchesSuffix}`
              : t.validation.noCompletedSample}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs">{t.validation.kpiLogLossTitle}</span>
            <BarChart3 className="w-4 h-4 text-blue-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white" dir="ltr">
            {backtestRun.logLossOverall !== null
              ? backtestRun.logLossOverall.toFixed(3)
              : t.common.notAvailable}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {t.validation.kpiLogLossSub}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs">{t.validation.kpiLeakageTitle}</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-xl font-bold text-emerald-400">
            {backtestRun.lookaheadLeakageZeroVerified
              ? t.validation.zeroLeakage
              : t.validation.unverified}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {t.validation.kpiLeakageSub}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs">{t.validation.kpiWindowTitle}</span>
            <Clock className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="font-mono text-sm font-bold text-white truncate mt-1" dir="ltr">
            {backtestRun.evaluationWindow.dateRange}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {backtestRun.abstentions} {t.validation.abstainedWord} · {t.validation.coverageLabel}{' '}
            <span dir="ltr">{backtestRun.coverage}%</span> (
            {translateEvaluationScope(backtestRun.evaluationWindow.scope, language)})
          </div>
        </div>
      </div>

      {/* Market-by-Market Accuracy Table */}
      {hasMetrics && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              {t.validation.tableTitle}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {t.validation.tableDesc}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="pb-3 font-semibold text-start">{t.validation.colMarket}</th>
                  <th className="pb-3 font-semibold text-center">{t.validation.colTested}</th>
                  <th className="pb-3 font-semibold text-center">{t.validation.colAccuracy}</th>
                  <th className="pb-3 font-semibold text-center">{t.validation.colBrier}</th>
                  <th className="pb-3 font-semibold text-center">{t.validation.colBaseRate}</th>
                  <th className="pb-3 font-semibold text-center">{t.validation.colAdvantage}</th>
                  <th className="pb-3 font-semibold text-end">{t.validation.colBenchmark}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {backtestRun.marketResults.map((m) => (
                  <tr key={m.marketKey} className="hover:bg-slate-950/40 transition-colors">
                    <td className="py-3 font-medium text-slate-200 flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          m.isTargetCategory ? 'bg-emerald-400' : 'bg-slate-500'
                        }`}
                      />
                      <span>{translateMarketKey(m.marketKey, m.marketLabel, language)}</span>
                    </td>
                    <td className="py-3 text-center text-slate-300 tabular-nums" dir="ltr">
                      {m.totalPredictions}
                    </td>
                    <td className="py-3 text-center font-bold text-white tabular-nums" dir="ltr">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          m.accuracyPercentage >= 80
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                            : 'text-slate-200'
                        }`}
                      >
                        {m.accuracyPercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-center text-slate-400 tabular-nums" dir="ltr">
                      {m.brierScore.toFixed(3)}
                    </td>
                    <td className="py-3 text-center text-slate-400 tabular-nums" dir="ltr">
                      {m.baselineComparison.homeBiasBaselineAccuracy.toFixed(1)}%
                    </td>
                    <td className="py-3 text-center font-bold tabular-nums" dir="ltr">
                      <span
                        className={
                          m.baselineComparison.accuracyAdvantage >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        {m.baselineComparison.accuracyAdvantage >= 0 ? '+' : ''}
                        {m.baselineComparison.accuracyAdvantage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-end">
                      {m.isTargetCategory ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${
                            m.targetAchievementStatus === 'ACHIEVED'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                              : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {m.targetAchievementStatus === 'ACHIEVED'
                            ? t.validation.validated80
                            : t.validation.researchInProgress}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {t.validation.highVarianceMarket}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Calibration Curves & Methodology */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-400" />
              {t.validation.calibrationTitle}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t.validation.calibrationDesc}
            </p>
          </div>

          {backtestRun.calibrationBins.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-950/50 rounded-lg border border-slate-800">
              {t.validation.noCalibrationBins}
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              {backtestRun.calibrationBins.map((bin) => (
                <div key={bin.binRange} className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 text-xs">
                  <div className="flex items-center justify-between mb-1.5 font-mono">
                    <span className="text-slate-300 font-semibold" dir="ltr">{bin.binRange}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">
                        N: <strong className="text-white">{bin.sampleCount}</strong>
                      </span>
                      <span className="text-slate-400">
                        {t.validation.predictedLabel}{' '}
                        <strong className="text-cyan-400" dir="ltr">
                          {bin.sampleCount > 0 ? `${bin.predictedAvgProb.toFixed(1)}%` : t.common.na}
                        </strong>
                      </span>
                      <span className="text-slate-400">
                        {t.validation.observedLabel}{' '}
                        <strong className="text-emerald-400" dir="ltr">
                          {bin.sampleCount > 0 ? `${bin.observedActualFrequency.toFixed(1)}%` : t.common.na}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${bin.sampleCount > 0 ? bin.observedActualFrequency : 0}%` }}
                      className="bg-emerald-500 h-full rounded-full transition-all"
                    />
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>
                      {t.validation.calibrationDelta}{' '}
                      <span className="text-slate-300 font-bold" dir="ltr">
                        {bin.sampleCount > 0 ? `${bin.calibrationError.toFixed(1)}%` : t.validation.emptyBin}
                      </span>
                    </span>
                    <span>
                      {bin.sampleCount === 0
                        ? t.validation.noSamples
                        : bin.calibrationError <= 4
                        ? t.validation.optimalCalibration
                        : t.validation.withinTolerance}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scientific Methodology */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              {t.validation.safeguardsTitle}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t.validation.safeguardsIntro}
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 space-y-1">
                <span className="font-mono text-emerald-400 font-bold block">
                  {t.validation.safeguard1Title}
                </span>
                <p className="text-slate-400 leading-relaxed">
                  {t.validation.safeguard1Body}
                </p>
              </div>

              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 space-y-1">
                <span className="font-mono text-cyan-400 font-bold block">
                  {t.validation.safeguard2Title}
                </span>
                <p className="text-slate-400 leading-relaxed">
                  {t.validation.safeguard2Body}
                </p>
              </div>

              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 space-y-1">
                <span className="font-mono text-blue-400 font-bold block">
                  {t.validation.safeguard3Title}
                </span>
                <p className="text-slate-400 leading-relaxed">
                  {t.validation.safeguard3Body}
                </p>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/70">
            <strong className="text-slate-200">{t.validation.researchPolicyLabel}</strong>{' '}
            {t.validation.researchPolicyBody}
          </div>
        </div>
      </div>
    </div>
  );
};
