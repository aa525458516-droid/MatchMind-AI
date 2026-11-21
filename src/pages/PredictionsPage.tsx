import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Search,
  Star,
} from 'lucide-react';
import { Match, League, Prediction } from '../types/football';
import { footballService } from '../services/footballDataService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { ProbabilityBar } from '../components/ProbabilityBar';
import { useLanguage } from '../i18n/LanguageContext';
import { translateConfidenceTier, translateProviderMessage } from '../i18n/translations';
import { Phase4Prediction } from '../phase4/phase4Types';
import { evaluateLivePhase4Match } from '../phase4/phase4Service';
import {
  FavoritesState,
  loadFavorites,
  subscribeFavorites,
  toggleFavoriteLeague,
  toggleFavoriteMatch,
} from '../utils/favoritesStore';

interface Props {
  onSelectMatch: (matchId: string) => void;
  providerVersion?: number;
}

type MarketType = 'ALL' | 'DOUBLE_CHANCE' | '1X2' | 'OVER_UNDER' | 'BTTS' | 'FIRST_HALF';
type SortOption = 'DATE' | 'CONFIDENCE' | 'HOME_PROB';
type AvailabilityFilter = 'ALL' | 'AVAILABLE' | 'ABSTAIN';

const PAGE_SIZE = 12;

export const PredictionsPage: React.FC<Props> = ({ onSelectMatch, providerVersion = 0 }) => {
  const { t, language, formatDateTime } = useLanguage();
  const [matches, setMatches] = useState<Match[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [phase4Map, setPhase4Map] = useState<Record<string, Phase4Prediction>>({});
  const [favorites, setFavorites] = useState<FavoritesState>(() => loadFavorites());
  const [loading, setLoading] = useState(true);
  const [computingSlice, setComputingSlice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters & Search
  const [selectedMarket, setSelectedMarket] = useState<MarketType>('ALL');
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'LIVE' | 'HISTORICAL' | 'DEMO'>('ALL');
  const [statusFilter, setStatusFilter] = useState<AvailabilityFilter>('ALL');
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<SortOption>('DATE');
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);

  useEffect(() => {
    return subscribeFavorites(() => setFavorites(loadFavorites()));
  }, []);

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setMatches([]);
    setPredictions({});
    setPhase4Map({});
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

  const isFavoriteMatch = (m: Match) =>
    favorites.matchIds.includes(m.id) ||
    favorites.teamIds.includes(m.homeTeam.id) ||
    favorites.teamIds.includes(m.awayTeam.id) ||
    favorites.leagueIds.includes(m.leagueId);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredMatches = matches.filter((m) => {
    if (selectedLeague !== 'ALL' && m.leagueId !== selectedLeague) return false;
    if (onlyFavorites && !isFavoriteMatch(m)) return false;
    if (dateFilter && !m.utcDate.startsWith(dateFilter)) return false;
    if (sourceFilter === 'LIVE' && m.matchCategory !== 'LIVE_UPCOMING') return false;
    if (sourceFilter === 'HISTORICAL' && m.matchCategory !== 'HISTORICAL') return false;
    if (sourceFilter === 'DEMO' && !m.isDemoData) return false;
    if (normalizedQuery) {
      const hay = `${m.homeTeam.name} ${m.homeTeam.shortName} ${m.awayTeam.name} ${m.awayTeam.shortName} ${m.leagueName}`.toLowerCase();
      if (!hay.includes(normalizedQuery)) return false;
    }
    if (statusFilter !== 'ALL' && predictions[m.id]) {
      const pred = predictions[m.id];
      const isAbs = pred.modelType === 'ABSTAIN' || pred.confidence === null || !pred.probabilities;
      if (statusFilter === 'AVAILABLE' && isAbs) return false;
      if (statusFilter === 'ABSTAIN' && !isAbs) return false;
    }
    return true;
  });

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
        const newP4Entries: Record<string, Phase4Prediction> = {};
        for (const m of missing) {
          const stats = await footballService.getMatchStatistics(m, { skipObservedXG: true });
          const p3 = await footballService.calculatePrediction(m, stats, {
            includeMonteCarlo: false,
          });
          newEntries[m.id] = p3;
          newP4Entries[m.id] = await evaluateLivePhase4Match({
            match: m,
            stats,
            phase3Prediction: p3,
            competitionMatches: matches,
            recordHistory: false,
          });
        }
        if (!cancelled) {
          setPredictions((prev) => ({ ...prev, ...newEntries }));
          setPhase4Map((prev) => ({ ...prev, ...newP4Entries }));
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
  }, [visibleMatches.map((m) => m.id).join(','), matches]);

  const activeProvider = footballService.getActiveProvider();

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Page Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 sm:p-6 backdrop-blur-sm">
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

      {/* Search & Multi-Facet Filter Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {/* Team / League Search */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'ar' ? 'ابحث عن فريق أو بطولة...' : 'Search team or competition...'
              }
              className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg ps-9 pe-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Competition Selector */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedLeague}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedLeague(val);
                if (val === 'ALL') {
                  loadBaseData();
                }
              }}
              aria-label={t.predictions.leagueFilterLabel}
              className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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
            {selectedLeague !== 'ALL' && (
              <button
                type="button"
                onClick={() => toggleFavoriteLeague(selectedLeague)}
                aria-label={language === 'ar' ? 'تفضيل البطولة' : 'Favorite competition'}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-amber-400"
              >
                <Star
                  className={`w-4 h-4 ${
                    favorites.leagueIds.includes(selectedLeague)
                      ? 'fill-amber-400 text-amber-400'
                      : ''
                  }`}
                />
              </button>
            )}
          </div>

          {/* Date Filter */}
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label={language === 'ar' ? 'تصفية حسب التاريخ' : 'Filter by date'}
            className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          />

          {/* Sort + Favorites toggle */}
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label={t.predictions.sortLabel}
              className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="DATE">{t.predictions.sortDate}</option>
              <option value="CONFIDENCE">{t.predictions.sortConfidence}</option>
              <option value="HOME_PROB">{t.predictions.sortHomeProb}</option>
            </select>
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              aria-label={language === 'ar' ? 'المفضلة فقط' : 'Favorites only'}
              className={`min-h-[44px] min-w-[44px] shrink-0 px-2.5 rounded-lg border flex items-center justify-center gap-1 text-xs font-semibold ${
                onlyFavorites
                  ? 'bg-amber-950/60 border-amber-500/70 text-amber-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-amber-300'
              }`}
            >
              <Star className={`w-4 h-4 ${onlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Market & Source Tabs */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-800/70">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <span className="text-xs font-mono text-slate-400 me-1 shrink-0">{t.predictions.marketFilterLabel}</span>
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
                type="button"
                onClick={() => setSelectedMarket(m.id as MarketType)}
                className={`min-h-[44px] sm:min-h-[38px] text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedMarket === m.id
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'ALL' | 'LIVE' | 'HISTORICAL' | 'DEMO')}
              aria-label={language === 'ar' ? 'نوع المصدر' : 'Source category'}
              className="min-h-[44px] sm:min-h-[38px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">{language === 'ar' ? 'جميع المصادر' : 'All Sources'}</option>
              <option value="LIVE">{language === 'ar' ? 'مباشر / مجدول' : 'Live / Scheduled'}</option>
              <option value="HISTORICAL">{language === 'ar' ? 'تاريخي بحثي' : 'Historical Archive'}</option>
              <option value="DEMO">{language === 'ar' ? 'بيانات تجريبية' : 'Demo Benchmark'}</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AvailabilityFilter)}
              aria-label={language === 'ar' ? 'حالة التوفر' : 'Prediction status'}
              className="min-h-[44px] sm:min-h-[38px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">{language === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
              <option value="AVAILABLE">{t.common.available}</option>
              <option value="ABSTAIN">{t.common.abstain}</option>
            </select>

            {(searchQuery || dateFilter || sourceFilter !== 'ALL' || statusFilter !== 'ALL' || onlyFavorites) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setDateFilter('');
                  setSourceFilter('ALL');
                  setStatusFilter('ALL');
                  setOnlyFavorites(false);
                }}
                className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs"
              >
                {language === 'ar' ? 'إعادة ضبط' : 'Reset'}
              </button>
            )}
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
            type="button"
            onClick={loadBaseData}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {visibleMatches.map((match) => {
              const pred = predictions[match.id];
              const p4 = phase4Map[match.id];
              const p = pred?.probabilities;
              const isAbstain = pred?.modelType === 'ABSTAIN' || pred?.confidence === null || (pred && !p);
              const sampleCount = pred?.sampleSizeMatches ?? match.provenance.sampleSizeMatches;
              const cacheTime =
                match.provenance.cachedAt || match.provenance.retrievedAt || match.provenance.timestamp;
              const favMatch = favorites.matchIds.includes(match.id);

              return (
                <div
                  key={match.id}
                  className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 hover:border-slate-700/80 transition-all flex flex-col justify-between"
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
                        <button
                          type="button"
                          onClick={() => toggleFavoriteMatch(match.id)}
                          aria-label={language === 'ar' ? 'تفضيل المباراة' : 'Favorite match'}
                          className="min-h-[44px] min-w-[44px] -my-2 -me-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400"
                        >
                          <Star className={`w-4 h-4 ${favMatch ? 'fill-amber-400 text-amber-400' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Matchup row */}
                    <div className="flex items-center justify-between gap-2 sm:gap-3 mb-4">
                      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                        {match.homeTeam.crest && (
                          <img
                            src={match.homeTeam.crest}
                            alt={match.homeTeam.name}
                            className="w-7 h-7 sm:w-8 sm:h-8 object-contain shrink-0"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-white truncate">
                            {match.homeTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.home}</div>
                        </div>
                      </div>

                      <div className="text-center shrink-0">
                        <div className="text-[10px] font-mono text-slate-500">
                          {t.predictions.xScore}
                        </div>
                        <div className="font-mono text-base font-bold text-emerald-400" dir="ltr">
                          {isAbstain ? t.common.na : pred?.expectedScore?.mostLikelyScore || '...'}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 sm:gap-2.5 text-end min-w-0 flex-1">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-white truncate">
                            {match.awayTeam.shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">{t.common.away}</div>
                        </div>
                        {match.awayTeam.crest && (
                          <img
                            src={match.awayTeam.crest}
                            alt={match.awayTeam.name}
                            className="w-7 h-7 sm:w-8 sm:h-8 object-contain shrink-0"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Phase 4 Market Summary & Uncertainty Strip */}
                    {p4 && !isAbstain && (
                      <div className="mb-3 px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2">
                        <span className="text-cyan-300">
                          {language === 'ar'
                            ? `P4: معايرة=${p4.ensemble.calibrationStatus} · سحب=${p4.drawExperiment.drawProb ?? '--'}%`
                            : `P4 Exp: Cal=${p4.ensemble.calibrationStatus} · Draw=${p4.drawExperiment.drawProb ?? '--'}%`}
                        </span>
                        {p4.abstainScope === 'MARKET_ONLY' && (
                          <span className="text-amber-300 font-semibold">
                            {language === 'ar' ? 'امتناع في سوق فرعي' : 'MARKET_ABSTAIN active'}
                          </span>
                        )}
                      </div>
                    )}

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
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                                {t.predictions.doubleChanceTitle}
                              </span>
                              {p4?.goalMarkets.doubleChance && (
                                <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                                  σ={p4.goalMarkets.doubleChance.uncertainty.toFixed(3)} ·{' '}
                                  {p4.goalMarkets.doubleChance.status}
                                </span>
                              )}
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
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="text-[10px] font-mono text-slate-400 block font-semibold">
                                {t.predictions.overUnderTitle}
                              </span>
                              {p4?.goalMarkets.over25 && (
                                <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                                  O2.5 σ={p4.goalMarkets.over25.uncertainty.toFixed(3)} ·{' '}
                                  {p4.goalMarkets.over25.status}
                                </span>
                              )}
                            </div>
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
                    type="button"
                    onClick={() => onSelectMatch(match.id)}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700/90 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700/60"
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
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                disabled={computingSlice}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
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
