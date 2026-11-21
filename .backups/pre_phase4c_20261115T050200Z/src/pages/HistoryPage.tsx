import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { HistoryRecord, League, BacktestRun } from '../types/football';
import { footballService } from '../services/footballDataService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { useLanguage } from '../i18n/LanguageContext';
import {
  translateEvaluationScope,
  translateProviderMessage,
  translateWinnerLabel,
} from '../i18n/translations';

interface Props {
  providerVersion?: number;
}

export const HistoryPage: React.FC<Props> = ({ providerVersion = 0 }) => {
  const { language, t, formatDate, formatDateTime } = useLanguage();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [backtestRun, setBacktestRun] = useState<BacktestRun | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [fullSeason, setFullSeason] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeProvider = footballService.getActiveProvider();

  // Reset selected league when provider switches
  useEffect(() => {
    setSelectedLeague('ALL');
  }, [providerVersion]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const provider = footballService.getActiveProvider();
      const discoveredLeagues = await footballService.getLeagues();
      const historicalLeagues =
        provider === 'OPENLIGADB'
          ? []
          : provider === 'UNIFIED' || provider === 'STATSBOMB'
          ? discoveredLeagues.filter((l) => l.id.startsWith('statsbomb-'))
          : discoveredLeagues;
      setLeagues(historicalLeagues);

      const effectiveLeagueId =
        selectedLeague !== 'ALL' && historicalLeagues.some((l) => l.id === selectedLeague)
          ? selectedLeague
          : undefined;

      const options = {
        leagueId: effectiveLeagueId,
        fullSeason,
      };

      const { records, backtestRun: run } = await footballService.getHistoryAndBacktest(options);
      setHistoryRecords(records);
      setBacktestRun(run);
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMsg(e?.message || 'Failed to load historical evaluation log from provider.');
      setHistoryRecords([]);
      setBacktestRun(null);
    } finally {
      setLoading(false);
    }
  }, [selectedLeague, fullSeason]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, providerVersion]);

  const filtered = historyRecords.filter((r) => {
    if (selectedLeague !== 'ALL' && r.match?.leagueId !== selectedLeague) return false;
    return true;
  });

  // Compute genuine empirical KPIs strictly on non-abstained testable records
  const testable = filtered.filter(
    (r) =>
      r.prediction.modelType !== 'ABSTAIN' &&
      r.prediction.confidence !== null &&
      r.prediction.probabilities !== null
  );
  const brierEntries = testable.filter((r) => typeof r.brierScoreContribution === 'number');
  const avgBrierScore =
    backtestRun?.brierScore ??
    (brierEntries.length > 0
      ? brierEntries.reduce((acc, curr) => acc + (curr.brierScoreContribution ?? 0), 0) /
        brierEntries.length
      : null);

  const over25Hits = testable.filter((r) => {
    const pOver25 = r.prediction.probabilities!.over25;
    return (pOver25 >= 50 && r.actualResult.over25) || (pOver25 < 50 && !r.actualResult.over25);
  }).length;
  const over25Accuracy =
    testable.length > 0 ? Math.round((over25Hits / testable.length) * 1000) / 10 : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 sm:p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                {t.history.tag}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{t.history.subTag}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {t.history.pageTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {t.history.pageDesc}
            </p>
          </div>
          <DemoDataBadge
            provider={activeProvider}
            provenance={historyRecords[0]?.match?.provenance}
            isDemo={historyRecords[0]?.match?.isDemoData}
            category={historyRecords[0]?.match?.matchCategory}
            showTimestamp
          />
        </div>
      </div>

      <DisclaimerBanner />

      {/* Competition & Scope Controls (wired directly to getHistoryRecords & getBacktestRun) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-slate-300 font-semibold">
            <span>{t.history.competitionLabel}</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              disabled={loading || leagues.length === 0}
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
              disabled={loading || activeProvider === 'OPENLIGADB'}
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
            />
            <span>{t.history.evaluateFullSeason}</span>
          </label>
        </div>

        {backtestRun && (
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
        )}
      </div>

      {loading ? (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl py-20 text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <span className="text-xs text-slate-400 font-mono">
            {t.history.loadingText}
          </span>
        </div>
      ) : errorMsg ? (
        <div className="bg-rose-950/30 border border-rose-800/70 rounded-xl p-6 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto" />
          <div className="text-sm font-bold text-rose-100">{t.history.unableToLoad}</div>
          <p className="text-xs text-rose-200/80 max-w-md mx-auto">
            {translateProviderMessage(errorMsg, language)}
          </p>
          <button
            onClick={loadHistory}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.retryRequest}</span>
          </button>
        </div>
      ) : historyRecords.length === 0 ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-8 text-center space-y-2">
          <ShieldAlert className="w-7 h-7 text-amber-400 mx-auto" />
          <div className="text-sm font-bold text-white">{t.history.noHistoryTitle}</div>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            {activeProvider === 'OPENLIGADB'
              ? t.history.openLigaNoHistory
              : t.history.noCompletedRecords}
          </p>
        </div>
      ) : (
        <>
          {/* Calibration Metrics Strip (Strictly measured from empirical records) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">{t.history.kpiAvgBrier}</div>
              <div className="font-mono text-2xl font-bold text-emerald-400" dir="ltr">
                {avgBrierScore !== null ? avgBrierScore.toFixed(3) : t.common.notAvailable}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {avgBrierScore !== null
                  ? t.history.measuredNonAbstained
                  : t.history.requires1NonAbstained}
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">{t.history.kpiEvaluatedVsAbstained}</div>
              <div className="font-mono text-2xl font-bold text-white" dir="ltr">
                {backtestRun?.evaluatedMatches ?? testable.length} /{' '}
                {(backtestRun?.evaluatedMatches ?? testable.length) +
                  (backtestRun?.abstentions ?? filtered.length - testable.length)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {backtestRun?.abstentions ?? filtered.length - testable.length}{' '}
                {t.history.abstainedCoverage}{' '}
                <span dir="ltr">{backtestRun?.coverage ?? 0}%</span>)
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">{t.history.kpi1X2Accuracy}</div>
              <div className="font-mono text-2xl font-bold text-blue-400" dir="ltr">
                {backtestRun?.accuracy !== null && backtestRun?.accuracy !== undefined
                  ? `${backtestRun.accuracy.toFixed(1)}%`
                  : t.common.notAvailable}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {t.history.excludesAbstentions}{' '}
                <span dir="ltr">
                  {backtestRun?.logLoss !== null && backtestRun?.logLoss !== undefined
                    ? backtestRun.logLoss.toFixed(3)
                    : t.common.na}
                </span>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">{t.history.kpiOver25Accuracy}</div>
              <div className="font-mono text-2xl font-bold text-cyan-400" dir="ltr">
                {over25Accuracy !== null ? `${over25Accuracy.toFixed(1)}%` : t.common.notAvailable}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {t.history.measuredAgainstFT}
              </div>
            </div>
          </div>

          {/* History Log Records */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                {t.history.listTitle}
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                {t.history.showingRecordsPrefix} {filtered.length} {t.history.recordsWord}
              </span>
            </div>

            <div className="space-y-4">
              {filtered.map((item) => {
                const p = item.prediction.probabilities;
                const isAbstain =
                  item.prediction.modelType === 'ABSTAIN' ||
                  item.prediction.confidence === null ||
                  !p;
                const sampleCount =
                  item.prediction.sampleSizeMatches ?? item.match.provenance.sampleSizeMatches;
                const cacheTime =
                  item.match.provenance.cachedAt ||
                  item.match.provenance.retrievedAt ||
                  item.match.provenance.timestamp;

                return (
                  <div
                    key={item.id}
                    className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all space-y-4"
                  >
                    {/* Card Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">
                          {item.match.leagueName}
                        </span>
                        {item.match.venue && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-400">{item.match.venue}</span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px]">
                        <DemoDataBadge
                          provenance={item.match.provenance}
                          isDemo={item.match.isDemoData}
                          category={item.match.matchCategory}
                        />
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded border ${
                            isAbstain
                              ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                              : 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'
                          }`}
                        >
                          {isAbstain ? t.common.abstain : t.common.available}
                        </span>
                        <span className="text-slate-400">
                          {t.history.playedLabel}{' '}
                          <span dir="ltr">{formatDate(item.match.utcDate)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Matchup and Result Row */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Teams & Actual Score */}
                      <div className="md:col-span-5 flex items-center justify-between bg-slate-950/60 border border-slate-800/70 p-3 rounded-lg">
                        <div className="text-start">
                          <div className="font-bold text-sm text-white">
                            {item.match.homeTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.home}</div>
                        </div>

                        <div className="text-center font-mono px-4">
                          <span className="text-[10px] text-slate-500 uppercase block">
                            {t.history.actualFT}
                          </span>
                          <span className="text-lg font-black text-white" dir="ltr">
                            {item.actualResult.finalScore}
                          </span>
                        </div>

                        <div className="text-end">
                          <div className="font-bold text-sm text-white">
                            {item.match.awayTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.away}</div>
                        </div>
                      </div>

                      {/* Pre-Match Model Projections */}
                      {isAbstain ? (
                        <div className="md:col-span-7 bg-amber-950/20 border border-amber-800/50 p-3 rounded-lg flex items-center gap-2 text-xs text-amber-200">
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>
                            {item.prediction.abstainReason
                              ? translateProviderMessage(item.prediction.abstainReason, language)
                              : t.history.abstainExcludedNote}
                          </span>
                        </div>
                      ) : (
                        <div className="md:col-span-7 bg-slate-950/40 border border-slate-800/60 p-3 rounded-lg grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block">
                              {t.history.modelTopScore}
                            </span>
                            <span className="font-mono font-bold text-emerald-400 text-sm" dir="ltr">
                              {item.prediction.expectedScore?.mostLikelyScore ?? t.common.na}
                            </span>
                            <span className="text-[10px] text-slate-500 block">
                              {t.history.probPrefix}{' '}
                              <span dir="ltr">{item.prediction.expectedScore?.probability ?? 0}%</span>
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block">
                              {t.history.prediction1X2}
                            </span>
                            <span className="font-mono text-white text-xs block mt-0.5" dir="ltr">
                              1: {p.homeWin.toFixed(0)}% · X: {p.draw.toFixed(0)}% · 2: {p.awayWin.toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-emerald-400 block">
                              {t.history.outcomePrefix}{' '}
                              {translateWinnerLabel(item.actualResult.winner, language)}
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block">
                              {t.history.over25Label}
                            </span>
                            <span className="font-mono text-white text-xs block mt-0.5">
                              <span dir="ltr">{p.over25.toFixed(1)}%</span> {t.history.overWord}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              {t.history.actualPrefix}{' '}
                              {item.actualResult.over25
                                ? t.history.over25Value
                                : t.history.under25Value}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Per-Card Provenance & Calculation Timestamps */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400 pt-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span>
                          {t.common.sampleLabel}:{' '}
                          <strong className="text-slate-200">
                            {sampleCount} {t.common.preMatchUnit}
                          </strong>
                        </span>
                        <span>·</span>
                        <span className={item.prediction.preMatchXGAvailable ? 'text-emerald-400' : 'text-amber-300/90'}>
                          {item.prediction.preMatchXGAvailable
                            ? t.common.preMatchXGAvailable
                            : t.common.preMatchXGUnavailable}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span>
                          {t.common.calculatedAt}:{' '}
                          <strong className="text-slate-200" dir="ltr">
                            {formatDateTime(item.prediction.calculatedAt)}
                          </strong>
                        </span>
                        {cacheTime && (
                          <span>
                            · {item.match.provenance.cached ? t.common.cached : t.common.retrieved}:{' '}
                            <strong className="text-slate-300" dir="ltr">
                              {formatDateTime(cacheTime)}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Analytical Review Note */}
                    <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/60 text-xs text-slate-300 flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      <div className="leading-relaxed">
                        <span className="font-semibold text-slate-200">
                          {t.history.calibrationFinding}{' '}
                        </span>
                        {translateProviderMessage(item.modelAccuracyNotes, language)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

