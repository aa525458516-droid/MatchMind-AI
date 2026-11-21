import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Match, League, Prediction } from '../types/football';
import { footballService } from '../services/footballDataService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { ProbabilityBar } from '../components/ProbabilityBar';
import { useLanguage } from '../i18n/LanguageContext';
import { translateConfidenceTier, translateProviderMessage } from '../i18n/translations';

interface Props {
  onSelectMatch: (matchId: string) => void;
  providerVersion?: number;
}

type MarketType = 'ALL' | 'DOUBLE_CHANCE' | '1X2' | 'OVER_UNDER' | 'BTTS' | 'FIRST_HALF';
type SortOption = 'DATE' | 'CONFIDENCE' | 'HOME_PROB';

const PAGE_SIZE = 12;

export const PredictionsPage: React.FC<Props> = ({ onSelectMatch, providerVersion = 0 }) => {
  const { t, language, formatDateTime } = useLanguage();
  const [matches, setMatches] = useState<Match[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [computingSlice, setComputingSlice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters & Pagination
  const [selectedMarket, setSelectedMarket] = useState<MarketType>('ALL');
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('DATE');
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setMatches([]);
    setPredictions({});
    setSelectedLeague('ALL');
    setVisibleLimit(PAGE_SIZE);

    try {
      const [lgs, mtchs] = await Promise.all([
        footballService.getLeagues(),
        footballService.getMatches(),
      ]);
      setLeagues(lgs);
      setMatches(mtchs);
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMsg(e?.message || 'Failed to load competition fixtures from active provider.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData, providerVersion]);

  // If user switches to a specific league that wasn't fetched in initial getMatches (e.g., StatsBomb competition or OpenLiga BL2)
  useEffect(() => {
    if (selectedLeague === 'ALL') return;
    let cancelled = false;
    async function loadLeagueMatches() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const leagueMatches = await footballService.getMatches({ leagueId: selectedLeague });
        if (!cancelled) {
          setMatches(leagueMatches);
          setVisibleLimit(PAGE_SIZE);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as Error;
          setErrorMsg(e?.message || `Failed to load matches for league ${selectedLeague}.`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadLeagueMatches();
    return () => {
      cancelled = true;
    };
  }, [selectedLeague]);

  // Compute sorted list first, then lazily compute predictions ONLY for the visible slice (no 306-match loop)
  const filteredMatches = matches.filter((m) =>
    selectedLeague === 'ALL' ? true : m.leagueId === selectedLeague
  );

  const sortedMatches = [...filteredMatches].sort((a, b) => {
    const pA = predictions[a.id];
    const pB = predictions[b.id];
    if (sortBy === 'CONFIDENCE') {
      return (pB?.confidenceScore ?? -1) - (pA?.confidenceScore ?? -1);
    }
    if (sortBy === 'HOME_PROB') {
      return (pB?.probabilities?.homeWin ?? -1) - (pA?.probabilities?.homeWin ?? -1);
    }
    return new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime();
  });

  const visibleMatches = sortedMatches.slice(0, visibleLimit);

  useEffect(() => {
    let cancelled = false;
    async function computeMissingPredictions() {
      const missing = visibleMatches.filter((m) => !predictions[m.id]);
      if (missing.length === 0) return;

      setComputingSlice(true);
      try {
        const newEntries: Record<string, Prediction> = {};
        for (const m of missing) {
          const stats = await footballService.getMatchStatistics(m, { skipObservedXG: true });
          newEntries[m.id] = await footballService.calculatePrediction(m, stats, {
            includeMonteCarlo: false,
          });
        }
        if (!cancelled) {
          setPredictions((prev) => ({ ...prev, ...newEntries }));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as Error;
          setErrorMsg(e?.message || 'Error computing predictions for visible fixtures.');
        }
      } finally {
        if (!cancelled) setComputingSlice(false);
      }
    }
    computeMissingPredictions();
    return () => {
      cancelled = true;
    };
  }, [visibleMatches.map((m) => m.id).join(',')]);

  const activeProvider = footballService.getActiveProvider();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 sm:p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono tracking-wider text-emerald-400 font-semibold">
                {t.predictions.engineTag}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{t.predictions.marketEstimatesTag}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {t.predictions.pageTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {t.predictions.pageDesc}
            </p>
          </div>
          <DemoDataBadge provider={activeProvider} showTimestamp />
        </div>
      </div>

      <DisclaimerBanner />

      {/* Filter and Control Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-mono text-slate-400 me-2 shrink-0">{t.predictions.marketFilterLabel}</span>
          {[
            { id: 'ALL', label: t.predictions.marketAll },
            { id: 'DOUBLE_CHANCE', label: t.predictions.marketDoubleChance },
            { id: '1X2', label: t.predictions.market1X2 },
            { id: 'OVER_UNDER', label: t.predictions.marketOverUnder },
            { id: 'BTTS', label: t.predictions.marketBtts },
            { id: 'FIRST_HALF', label: t.predictions.marketFirstHalf },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMarket(m.id as MarketType)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap shrink-0 ${
                selectedMarket === m.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>{t.predictions.leagueFilterLabel}</span>
            <select
              value={selectedLeague}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedLeague(val);
                if (val === 'ALL') {
                  loadBaseData();
                }
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[200px]"
            >
              <option value="ALL">
                {t.predictions.defaultFeed} ({matches.length})
              </option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.flag} {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>{t.predictions.sortLabel}</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="DATE">{t.predictions.sortDate}</option>
              <option value="CONFIDENCE">{t.predictions.sortConfidence}</option>
              <option value="HOME_PROB">{t.predictions.sortHomeProb}</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl py-20 text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-mono text-slate-400">
            {t.predictions.loadingFixtures} {footballService.getProviderName()}...
          </p>
        </div>
      ) : errorMsg ? (
        <div className="bg-rose-950/30 border border-rose-800/70 rounded-xl p-6 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto" />
          <div className="text-sm font-bold text-rose-100">{t.predictions.unableToLoad}</div>
          <p className="text-xs text-rose-200/80 max-w-md mx-auto">
            {translateProviderMessage(errorMsg, language)}
          </p>
          <button
            onClick={loadBaseData}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.retryRequest}</span>
          </button>
        </div>
      ) : visibleMatches.length === 0 ? (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
          {t.predictions.noMatchesFound}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {visibleMatches.map((match) => {
              const pred = predictions[match.id];
              const p = pred?.probabilities;
              const isAbstain = pred?.modelType === 'ABSTAIN' || pred?.confidence === null || (pred && !p);
              const sampleCount = pred?.sampleSizeMatches ?? match.provenance.sampleSizeMatches;
              const cacheTime = match.provenance.cachedAt || match.provenance.retrievedAt || match.provenance.timestamp;

              return (
                <div
                  key={match.id}
                  className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700/80 transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Header info */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pb-3 border-b border-slate-800/80 mb-4">
                      <span className="font-medium text-slate-300">
                        {match.leagueName} {match.venue ? `· ${match.venue}` : ''}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <DemoDataBadge
                          provenance={match.provenance}
                          isDemo={match.isDemoData}
                          category={match.matchCategory}
                        />
                        {pred && (
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded border ${
                              isAbstain
                                ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                                : 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'
                            }`}
                          >
                            {isAbstain
                              ? t.common.statusAbstain
                              : `${t.common.available} · ${translateConfidenceTier(pred.confidence, language)} (${pred.confidenceScore ?? t.common.na}%)`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Matchup row */}
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        {match.homeTeam.crest && (
                          <img
                            src={match.homeTeam.crest}
                            alt={match.homeTeam.name}
                            className="w-8 h-8 object-contain"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div>
                          <div className="font-bold text-sm text-white">
                            {match.homeTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.home}</div>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-[10px] font-mono text-slate-500">
                          {t.predictions.xScore}
                        </div>
                        <div className="font-mono text-base font-bold text-emerald-400" dir="ltr">
                          {isAbstain ? t.common.na : pred?.expectedScore?.mostLikelyScore || '...'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-end">
                        <div>
                          <div className="font-bold text-sm text-white">
                            {match.awayTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.away}</div>
                        </div>
                        {match.awayTeam.crest && (
                          <img
                            src={match.awayTeam.crest}
                            alt={match.awayTeam.name}
                            className="w-8 h-8 object-contain"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Markets Section OR Genuine Abstention Message */}
                    {!pred ? (
                      <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/70 mb-4 text-center text-xs text-slate-400 font-mono">
                        {t.predictions.computingProbs}
                      </div>
                    ) : isAbstain || !p ? (
                      <div className="bg-amber-950/30 p-4 rounded-lg border border-amber-800/60 mb-4 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>{t.common.abstainDefaultMessage}</span>
                        </div>
                        <p className="text-[11px] text-amber-200/80 leading-relaxed">
                          {translateProviderMessage(pred.abstainReason, language) || t.common.insufficientPreMatchMin5}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3.5 bg-slate-950/50 p-3.5 rounded-lg border border-slate-800/70 mb-4">
                        {(selectedMarket === 'ALL' || selectedMarket === 'DOUBLE_CHANCE') && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                                {t.predictions.doubleChanceTitle}
                              </span>
                            </div>
                            <ProbabilityBar
                              label={`${t.predictions.homeOrDraw} (1X - ${match.homeTeam.shortName})`}
                              percentage={p.homeOrDraw}
                              color="emerald"
                            />
                            <ProbabilityBar
                              label={`${t.predictions.awayOrDraw} (X2 - ${match.awayTeam.shortName})`}
                              percentage={p.awayOrDraw}
                              color="emerald"
                            />
                          </div>
                        )}

                        {(selectedMarket === 'ALL' || selectedMarket === '1X2') && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/60">
                            <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                              {t.predictions.winner1X2Title}
                            </span>
                            <ProbabilityBar
                              label={`${t.predictions.homeWinBar} ${match.homeTeam.shortName} (1)`}
                              percentage={p.homeWin}
                              color="blue"
                            />
                            <ProbabilityBar
                              label={t.predictions.drawBar}
                              percentage={p.draw}
                              color="amber"
                            />
                            <ProbabilityBar
                              label={`${t.predictions.awayWinBar} ${match.awayTeam.shortName} (2)`}
                              percentage={p.awayWin}
                              color="cyan"
                            />
                          </div>
                        )}

                        {(selectedMarket === 'ALL' || selectedMarket === 'OVER_UNDER') && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/60">
                            <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                              {t.predictions.overUnderTitle}
                            </span>
                            <ProbabilityBar
                              label={t.predictions.over15}
                              percentage={p.over15}
                              secondaryLabel={`${t.predictions.underPrefix} ${p.under15.toFixed(1)}%`}
                              color="emerald"
                            />
                            <ProbabilityBar
                              label={t.predictions.over25}
                              percentage={p.over25}
                              secondaryLabel={`${t.predictions.underPrefix} ${p.under25.toFixed(1)}%`}
                              color="emerald"
                            />
                            <ProbabilityBar
                              label={t.predictions.over35}
                              percentage={p.over35}
                              secondaryLabel={`${t.predictions.underPrefix} ${p.under35.toFixed(1)}%`}
                              color="emerald"
                            />
                          </div>
                        )}

                        {(selectedMarket === 'ALL' || selectedMarket === 'BTTS') && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/60">
                            <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                              {t.predictions.bttsTitle}
                            </span>
                            <ProbabilityBar
                              label={t.predictions.bttsYes}
                              percentage={p.bttsYes}
                              secondaryLabel={`${t.predictions.noPrefix} ${p.bttsNo.toFixed(1)}%`}
                              color="cyan"
                            />
                          </div>
                        )}

                        {(selectedMarket === 'ALL' || selectedMarket === 'FIRST_HALF') && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/60">
                            <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                              {t.predictions.firstHalfTitle}
                            </span>
                            <ProbabilityBar
                              label={t.predictions.firstHalfOver05}
                              percentage={p.firstHalfOver05}
                              secondaryLabel={`${t.predictions.underPrefix} ${p.firstHalfUnder05.toFixed(1)}%`}
                              color="emerald"
                            />
                            <ProbabilityBar
                              label={t.predictions.firstHalfOver15}
                              percentage={p.firstHalfOver15}
                              secondaryLabel={`${t.predictions.underPrefix} ${p.firstHalfUnder15.toFixed(1)}%`}
                              color="emerald"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Per-Card Provenance & Timestamp Summary */}
                    <div className="bg-slate-950/40 border border-slate-800/70 rounded-lg p-2.5 mb-4 text-[10px] font-mono text-slate-400 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {t.common.providerLabel}: <strong className="text-slate-300">{match.provenance.source}</strong>
                        </span>
                        <span>
                          {t.predictions.preMatchSample} <strong className="text-slate-200">{sampleCount} {t.common.matchesUnit}</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={pred?.preMatchXGAvailable ? 'text-emerald-400' : 'text-amber-300/90'}>
                          {pred?.preMatchXGAvailable ? t.common.preMatchXGAvailable : t.common.preMatchXGUnavailable}
                        </span>
                        <span className={pred?.historicalValidationAvailable ? 'text-emerald-400' : 'text-slate-400'}>
                          {pred?.historicalValidationAvailable
                            ? t.common.historicalValidationAvailable
                            : t.common.historicalValidationUnavailable}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                        <span>
                          {t.common.calculatedAt}:{' '}
                          <strong className="text-slate-200">
                            {pred ? formatDateTime(pred.calculatedAt) : t.common.pending}
                          </strong>
                        </span>
                        {cacheTime && (
                          <span>
                            {match.provenance.cached ? t.common.cached : t.common.retrieved}:{' '}
                            <strong className="text-slate-300">
                              {formatDateTime(cacheTime)}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => onSelectMatch(match.id)}
                    className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700/90 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700/60"
                  >
                    <span>{t.predictions.launchFullAnalysis}</span>
                    <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>
                </div>
              );
            })}
          </div>

          {visibleLimit < sortedMatches.length && (
            <div className="text-center pt-2">
              <button
                onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                disabled={computingSlice}
                className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
              >
                {computingSlice
                  ? t.predictions.computingBatch
                  : `${t.predictions.loadNextPrefix} ${Math.min(PAGE_SIZE, sortedMatches.length - visibleLimit)} ${t.predictions.fixturesOf} (${visibleLimit} ${t.dashboard.ofWord} ${sortedMatches.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
