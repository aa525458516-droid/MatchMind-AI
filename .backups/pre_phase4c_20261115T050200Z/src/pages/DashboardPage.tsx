import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Calendar,
  CheckCircle,
  Activity,
  ArrowRight,
  ChevronRight,
  Database,
  BarChart3,
  Layers,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Match, Prediction, HistoryRecord, League, BacktestRun } from '../types/football';
import { footballService } from '../services/footballDataService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { useLanguage } from '../i18n/LanguageContext';
import { translateProviderMessage } from '../i18n/translations';

interface Props {
  onSelectMatch: (matchId: string) => void;
  onNavigateToPredictions: () => void;
  onNavigateToSettings: () => void;
  onNavigateToValidation?: () => void;
  providerVersion?: number;
}

export const DashboardPage: React.FC<Props> = ({
  onSelectMatch,
  onNavigateToPredictions,
  onNavigateToSettings,
  onNavigateToValidation,
  providerVersion = 0,
}) => {
  const { t, language, formatDate, formatDateTime } = useLanguage();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [backtestRun, setBacktestRun] = useState<BacktestRun | null>(null);
  const [predictionsMap, setPredictionsMap] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setMatches([]);
    setPredictionsMap({});
    try {
      const [leaguesRes, matchesRes, histBtRes] = await Promise.allSettled([
        footballService.getLeagues(),
        footballService.getMatches(),
        footballService.getHistoryAndBacktest(),
      ]);

      if (leaguesRes.status === 'rejected' && matchesRes.status === 'rejected') {
        throw new Error(
          (matchesRes.reason as Error)?.message ||
            (leaguesRes.reason as Error)?.message ||
            'Failed to retrieve data from active provider.'
        );
      }

      const loadedLeagues = leaguesRes.status === 'fulfilled' ? leaguesRes.value : [];
      const loadedMatches = matchesRes.status === 'fulfilled' ? matchesRes.value : [];
      const loadedHistory = histBtRes.status === 'fulfilled' ? histBtRes.value.records : [];
      const loadedBacktest = histBtRes.status === 'fulfilled' ? histBtRes.value.backtestRun : null;

      setLeagues(loadedLeagues);
      setHistory(loadedHistory);
      setBacktestRun(loadedBacktest);

      if (matchesRes.status === 'rejected') {
        setErrorMsg((matchesRes.reason as Error)?.message || 'Failed to load matches from provider.');
        return;
      }

      // Prioritize upcoming/scheduled fixtures cleanly, cap to 12 displayed fixtures to prevent N+1 storms
      const upcoming = loadedMatches.filter(
        (m) => m.status === 'SCHEDULED' || m.status === 'TIMED' || m.status === 'IN_PLAY'
      );
      const featured = (upcoming.length > 0 ? upcoming : loadedMatches.slice(-12).reverse()).slice(0, 12);
      setMatches(featured);

      const preds: Record<string, Prediction> = {};
      for (const m of featured) {
        const stats = await footballService.getMatchStatistics(m, { skipObservedXG: true });
        preds[m.id] = await footballService.calculatePrediction(m, stats, {
          includeMonteCarlo: false,
        });
      }
      setPredictionsMap(preds);
    } catch (e: unknown) {
      const err = e as Error;
      setErrorMsg(err?.message || 'Unable to load matches from the selected football data provider.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData, providerVersion]);

  const activeProvider = footballService.getActiveProvider();
  const providerSummary = leagues
    .slice(0, 4)
    .map((l) => l.name.split('(')[0].trim())
    .join(' · ');

  return (
    <div className="space-y-6">
      {/* Top Welcome / Hero Banner */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 sm:p-6 backdrop-blur-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono tracking-wider text-emerald-400 font-semibold">
                {t.dashboard.platformTag}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{t.dashboard.quantitativeTag}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {t.dashboard.heroTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {t.dashboard.heroDesc}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-end">
              <div className="text-[11px] font-mono text-slate-400">{t.dashboard.activeProvider}</div>
              <div className="flex items-center gap-2 mt-0.5 justify-end">
                <DemoDataBadge provider={activeProvider} showTimestamp />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytical Notice */}
      <DisclaimerBanner />

      {/* Quantitative KPIs (Strictly derived from fetched/verified outputs) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          onClick={onNavigateToValidation}
          className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 cursor-pointer hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.kpiBacktestTitle}</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums">
            {loading
              ? '...'
              : backtestRun?.brierScoreOverall !== null && backtestRun?.brierScoreOverall !== undefined
              ? backtestRun.brierScoreOverall.toFixed(3)
              : t.common.notAvailable}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {backtestRun?.brierScoreOverall !== null && backtestRun?.brierScoreOverall !== undefined
              ? `${t.dashboard.kpiBrierIndex} (${backtestRun.totalMatchesTested})`
              : backtestRun?.unavailableReason
              ? t.dashboard.kpiNoCompletedBacktest
              : t.dashboard.kpiMeasuredOnBacktest}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.kpiCompetitionsTitle}</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums">
            {loading
              ? '...'
              : `${leagues.length} ${leagues.length === 1 ? t.dashboard.leagueSingular : t.dashboard.leaguePlural}`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            {providerSummary || (loading ? t.dashboard.discovering : t.dashboard.noneLoaded)}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.kpiGoalMatrixTitle}</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums">
            {t.dashboard.kpiGoalMatrixValue}
          </div>
          <div className="text-[11px] text-cyan-400 mt-1">
            {t.dashboard.kpiGoalMatrixSub}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.kpiAiEngineTitle}</span>
            <BarChart3 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums" dir="ltr">
            {t.dashboard.kpiAiEngineValue}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">
            {t.dashboard.kpiAiEngineSub}
          </div>
        </div>
      </div>

      {/* Main Grid: Fixtures & Historical Validation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Fixtures & Probability Estimates */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                {t.dashboard.fixturesSectionTitle}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeProvider === 'STATSBOMB'
                  ? t.dashboard.fixturesSubtitleStatsBomb
                  : t.dashboard.fixturesSubtitleDefault}
              </p>
            </div>
            <button
              onClick={onNavigateToPredictions}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              <span>{t.dashboard.viewAllMarkets}</span>
              <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
            </button>
          </div>

          {loading ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl py-16 text-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs font-mono text-slate-400">
                {t.dashboard.fetchingFixtures} {footballService.getProviderName()}...
              </p>
            </div>
          ) : errorMsg ? (
            <div className="bg-rose-950/30 border border-rose-800/70 rounded-xl p-6 text-center space-y-3">
              <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto" />
              <div className="text-sm font-bold text-rose-100">
                {t.dashboard.providerUnavailableTitle}
              </div>
              <p className="text-xs text-rose-200/80 max-w-md mx-auto">
                {translateProviderMessage(errorMsg, language)}
              </p>
              <button
                onClick={loadDashboardData}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.common.retryConnection}</span>
              </button>
            </div>
          ) : matches.length === 0 ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-200">{t.dashboard.noFixturesTitle}</p>
              <p className="text-xs text-slate-400">
                {t.dashboard.noFixturesDesc}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {matches.map((match) => {
                const pred = predictionsMap[match.id];
                const p = pred?.probabilities;
                const isAbstain = pred?.modelType === 'ABSTAIN' || pred?.confidence === null || !p;
                const sampleCount = pred?.sampleSizeMatches ?? match.provenance.sampleSizeMatches;
                const cacheTime = match.provenance.cachedAt || match.provenance.retrievedAt || match.provenance.timestamp;

                return (
                  <div
                    key={match.id}
                    onClick={() => onSelectMatch(match.id)}
                    className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl p-4 sm:p-5 transition-all cursor-pointer group"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-300">{match.leagueName}</span>
                        <span>·</span>
                        <DemoDataBadge
                          provenance={match.provenance}
                          isDemo={match.isDemoData}
                          category={match.matchCategory}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatDate(match.utcDate, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Matchup row */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Teams Column */}
                      <div className="md:col-span-7 flex items-center justify-between sm:justify-start gap-4">
                        {/* Home */}
                        <div className="flex items-center gap-3 min-w-[130px]">
                          {match.homeTeam.crest && (
                            <img
                              src={match.homeTeam.crest}
                              alt={match.homeTeam.name}
                              className="w-7 h-7 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          )}
                          <div>
                            <div className="font-bold text-sm text-white group-hover:text-emerald-300 transition-colors">
                              {match.homeTeam.shortName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {t.common.home} {match.score.home !== null ? `· ${t.common.fullTimePrefix} ${match.score.home}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs font-mono font-bold text-slate-500 px-2">
                          {t.common.vs}
                        </div>

                        {/* Away */}
                        <div className="flex items-center gap-3 min-w-[130px]">
                          {match.awayTeam.crest && (
                            <img
                              src={match.awayTeam.crest}
                              alt={match.awayTeam.name}
                              className="w-7 h-7 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          )}
                          <div>
                            <div className="font-bold text-sm text-white group-hover:text-emerald-300 transition-colors">
                              {match.awayTeam.shortName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {t.common.away} {match.score.away !== null ? `· ${t.common.fullTimePrefix} ${match.score.away}` : ''}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 1X2 Probabilities Mini Bar or ABSTAIN */}
                      <div className="md:col-span-5 bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5">
                        {pred && isAbstain ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-amber-400">
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                              <span>{t.common.statusAbstain}</span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-snug">
                              {translateProviderMessage(pred.abstainReason, language) || t.common.abstainDefaultMessage}
                            </p>
                          </div>
                        ) : p ? (
                          <>
                            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5" dir="ltr">
                              <span>1: {p.homeWin.toFixed(0)}%</span>
                              <span>X: {p.draw.toFixed(0)}%</span>
                              <span>2: {p.awayWin.toFixed(0)}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-800" dir="ltr">
                              <div
                                style={{ width: `${p.homeWin}%` }}
                                className="bg-blue-500 h-full"
                                title={`${t.dashboard.homeWinTitle}: ${p.homeWin}%`}
                              />
                              <div
                                style={{ width: `${p.draw}%` }}
                                className="bg-slate-400 h-full"
                                title={`${t.dashboard.drawTitle}: ${p.draw}%`}
                              />
                              <div
                                style={{ width: `${p.awayWin}%` }}
                                className="bg-cyan-500 h-full"
                                title={`${t.dashboard.awayWinTitle}: ${p.awayWin}%`}
                              />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">
                                {t.dashboard.xScoreLabel}{' '}
                                <span className="font-mono font-bold text-emerald-400" dir="ltr">
                                  {pred?.expectedScore?.mostLikelyScore ?? t.common.na}
                                </span>
                              </span>
                              <span className="text-emerald-400 font-semibold group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-transform flex items-center gap-0.5">
                                {t.dashboard.fullAnalysis} <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-slate-500 font-mono">{t.common.calculating}</div>
                        )}
                      </div>
                    </div>

                    {/* Per-Card Provenance Strip */}
                    <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded border ${
                            !pred
                              ? 'text-slate-400 bg-slate-900 border-slate-700'
                              : isAbstain
                              ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                              : 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'
                          }`}
                        >
                          {!pred ? t.common.pending : isAbstain ? t.common.abstain : t.common.available}
                        </span>
                        <span>
                          {t.common.providerLabel}: <strong className="text-slate-300">{match.provenance.source}</strong>
                        </span>
                        <span>·</span>
                        <span>
                          {t.common.sampleLabel}: <strong className="text-slate-200">{sampleCount} {t.common.matchesUnit}</strong>
                        </span>
                        <span>·</span>
                        <span className={pred?.preMatchXGAvailable ? 'text-emerald-400' : 'text-amber-300/90'}>
                          {pred?.preMatchXGAvailable ? t.common.preMatchXGAvailable : t.common.preMatchXGUnavailable}
                        </span>
                        <span>·</span>
                        <span className={pred?.historicalValidationAvailable ? 'text-emerald-400' : 'text-slate-400'}>
                          {pred?.historicalValidationAvailable
                            ? t.common.historicalValidationAvailable
                            : t.common.historicalValidationUnavailable}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        {pred && (
                          <span>
                            {t.common.calculatedAt}:{' '}
                            <strong className="text-slate-200">
                              {formatDateTime(pred.calculatedAt)}
                            </strong>
                          </span>
                        )}
                        {cacheTime && (
                          <span>
                            {pred ? '· ' : ''}
                            {match.provenance.cached ? t.common.cached : t.common.retrieved}:{' '}
                            <strong className="text-slate-300">
                              {formatDateTime(cacheTime)}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Historical Validation & Track Record */}
        <div className="space-y-6">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                {t.dashboard.backtestSamplesTitle}
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                {history.length > 0
                  ? `${Math.min(history.length, 5)} ${t.dashboard.ofWord} ${history.length}`
                  : `0 ${t.dashboard.recordsCount}`}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {t.dashboard.backtestSamplesDesc}
            </p>

            {history.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
                {activeProvider === 'OPENLIGADB'
                  ? t.dashboard.openLigaNoArchive
                  : t.dashboard.noBacktestRecords}
              </div>
            ) : (
              <div className="space-y-3">
                {history.slice(-5).reverse().map((record) => (
                  <div
                    key={record.id}
                    className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-medium text-slate-300">
                        {record.match.homeTeam.shortName} {t.common.vs} {record.match.awayTeam.shortName}
                      </span>
                      <span className="font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.2 rounded text-[11px]" dir="ltr">
                        FT {record.actualResult.finalScore}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-300 leading-normal">
                      {translateProviderMessage(record.modelAccuracyNotes, language)}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/50">
                      <span>
                        {t.dashboard.modelLabel}{' '}
                        <span dir="ltr">{record.prediction.expectedScore?.mostLikelyScore ?? t.common.abstain}</span>
                      </span>
                      <span>
                        {t.dashboard.brierLabel}{' '}
                        <span dir="ltr">
                          {record.brierScoreContribution !== null ? record.brierScoreContribution.toFixed(3) : t.common.na}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data Source Quick Box */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs font-mono tracking-wider">
              <Database className="w-4 h-4 text-emerald-400" />
              {t.dashboard.connectorsTitle}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.dashboard.connectorsDesc}
            </p>
            <button
              onClick={onNavigateToSettings}
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center justify-center gap-2"
            >
              {t.dashboard.configureInSettings}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
