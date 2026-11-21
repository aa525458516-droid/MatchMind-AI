import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  BarChart2,
  Brain,
  History,
  Target,
  Scale,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Star,
  Sparkles,
  CheckCircle2,
  Info,
} from 'lucide-react';
import {
  Match,
  League,
  MatchStatistics,
  Prediction,
  AIAnalysis,
} from '../types/football';
import { footballService } from '../services/footballDataService';
import { requestMatchAnalysis } from '../services/aiAnalysisService';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { FormBadge } from '../components/FormBadge';
import { ProbabilityBar } from '../components/ProbabilityBar';
import { ScorelineMatrix } from '../components/ScorelineMatrix';
import { AIAnalysisCard } from '../components/AIAnalysisCard';
import { ModelComparisonCard } from '../components/ModelComparisonCard';
import { useLanguage } from '../i18n/LanguageContext';
import { translateConfidenceTier, translateProviderMessage } from '../i18n/translations';
import {
  MODEL_VERSION_PHASE3,
  MODEL_VERSION_PHASE4,
  Phase4Prediction,
} from '../phase4/phase4Types';
import { evaluateLivePhase4Match } from '../phase4/phase4Service';
import { MODEL_VERSION_PHASE5, Phase5Prediction } from '../phase5/phase5Types';
import { evaluateLivePhase5Match } from '../phase5/phase5Service';
import { Phase5_1Prediction } from '../phase5_1/phase5_1Types';
import { evaluateLivePhase5_1Match } from '../phase5_1/phase5_1Service';
import {
  FavoritesState,
  loadFavorites,
  subscribeFavorites,
  toggleFavoriteMatch,
  toggleFavoriteTeam,
} from '../utils/favoritesStore';

interface Props {
  initialMatchId?: string;
  providerVersion?: number;
}

export const MatchAnalysisPage: React.FC<Props> = ({
  initialMatchId,
  providerVersion = 0,
}) => {
  const { t, language, formatDate, formatDateTime } = useLanguage();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [favorites, setFavorites] = useState<FavoritesState>(() => loadFavorites());

  // Selection state
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedMatchId, setSelectedMatchId] = useState<string>(initialMatchId || '');
  const [activeModelView, setActiveModelView] = useState<'COMPARE' | 'PHASE3' | 'PHASE4' | 'PHASE5' | 'PHASE5_1'>('COMPARE');

  // Loaded data state
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [matchStats, setMatchStats] = useState<MatchStatistics | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [phase4Prediction, setPhase4Prediction] = useState<Phase4Prediction | null>(null);
  const [phase5Prediction, setPhase5Prediction] = useState<Phase5Prediction | null>(null);
  const [phase5_1Prediction, setPhase5_1Prediction] = useState<Phase5_1Prediction | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'models' | 'probabilities' | 'form' | 'h2h' | 'ai'>('models');

  const [loading, setLoading] = useState<boolean>(true);
  const [analyzingMatch, setAnalyzingMatch] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return subscribeFavorites(() => setFavorites(loadFavorites()));
  }, []);

  const runGeminiAnalysis = useCallback(
    async (matchObj?: Match, statsObj?: MatchStatistics, predObj?: Prediction) => {
      const targetMatch = matchObj || currentMatch;
      const targetStats = statsObj || matchStats;
      const targetPred = predObj || prediction;

      if (!targetMatch || !targetStats || !targetPred) return;

      if (
        targetPred.modelType === 'ABSTAIN' ||
        targetPred.confidence === null ||
        !targetPred.probabilities
      ) {
        setAiAnalysis(null);
        setAiErrorMessage(
          translateProviderMessage(targetPred.abstainReason, language) ||
            t.common.abstainDefaultMessage
        );
        return;
      }

      setIsAiLoading(true);
      setAiErrorMessage(null);
      try {
        const result = await requestMatchAnalysis(targetMatch, targetStats, targetPred, language);
        setAiAnalysis(result);
      } catch (err: unknown) {
        const error = err as Error;
        setAiErrorMessage(error?.message || 'Gemini analysis endpoint unavailable.');
        setAiAnalysis(null);
      } finally {
        setIsAiLoading(false);
      }
    },
    [currentMatch, matchStats, prediction, language, t.common.abstainDefaultMessage]
  );

  const loadInitialSelection = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setCurrentMatch(null);
    setMatchStats(null);
    setPrediction(null);
    setPhase4Prediction(null);
    setPhase5Prediction(null);
    setPhase5_1Prediction(null);
    setAiAnalysis(null);
    setAiErrorMessage(null);

    try {
      const loadedLeagues = await footballService.getLeagues();
      setLeagues(loadedLeagues);

      if (loadedLeagues.length === 0) {
        setMatches([]);
        setSelectedLeagueId('');
        setSelectedMatchId('');
        return;
      }

      let targetMatch: Match | null = null;
      let targetLeagueId = loadedLeagues[0].id;

      if (initialMatchId && initialMatchId !== 'custom') {
        targetMatch = await footballService.getMatchById(initialMatchId);
        if (targetMatch) {
          targetLeagueId = targetMatch.leagueId;
        }
      }

      setSelectedLeagueId(targetLeagueId);
      const leagueMatches = await footballService.getMatches({ leagueId: targetLeagueId });
      setMatches(leagueMatches);

      if (!targetMatch && leagueMatches.length > 0) {
        const upcoming = leagueMatches.find(
          (m) => m.status === 'SCHEDULED' || m.status === 'TIMED' || m.status === 'IN_PLAY'
        );
        targetMatch = upcoming || leagueMatches[0];
      }

      setSelectedMatchId(targetMatch ? targetMatch.id : '');
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMsg(e?.message || 'Failed to load competitions and fixtures from active provider.');
    } finally {
      setLoading(false);
    }
  }, [initialMatchId]);

  useEffect(() => {
    loadInitialSelection();
  }, [loadInitialSelection, providerVersion]);

  const handleLeagueChange = async (newLeagueId: string) => {
    setSelectedLeagueId(newLeagueId);
    setLoading(true);
    setErrorMsg(null);
    setCurrentMatch(null);
    setMatchStats(null);
    setPrediction(null);
    setPhase4Prediction(null);
    setPhase5Prediction(null);
    setPhase5_1Prediction(null);
    setAiAnalysis(null);
    setAiErrorMessage(null);

    try {
      const leagueMatches = await footballService.getMatches({ leagueId: newLeagueId });
      setMatches(leagueMatches);
      const upcoming = leagueMatches.find(
        (m) => m.status === 'SCHEDULED' || m.status === 'TIMED' || m.status === 'IN_PLAY'
      );
      const nextMatch = upcoming || leagueMatches[0] || null;
      setSelectedMatchId(nextMatch ? nextMatch.id : '');
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMsg(e?.message || `Failed to load matches for competition ${newLeagueId}.`);
      setMatches([]);
      setSelectedMatchId('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedMatchId) {
      setCurrentMatch(null);
      setMatchStats(null);
      setPrediction(null);
      setPhase4Prediction(null);
      setPhase5Prediction(null);
      setPhase5_1Prediction(null);
      return;
    }

    let cancelled = false;
    async function resolveSelectedMatch() {
      setAnalyzingMatch(true);
      setErrorMsg(null);
      setAiAnalysis(null);
      setAiErrorMessage(null);

      try {
        const match =
          matches.find((m) => m.id === selectedMatchId) ||
          (await footballService.getMatchById(selectedMatchId));

        if (!match) {
          if (!cancelled) {
            setCurrentMatch(null);
            setErrorMsg(`Selected fixture "${selectedMatchId}" is not available in the active provider.`);
          }
          return;
        }

        const stats = await footballService.getMatchStatistics(match);
        const pred = await footballService.calculatePrediction(match, stats, {
          includeMonteCarlo: true,
        });
        const p4 = await evaluateLivePhase4Match({
          match,
          stats,
          phase3Prediction: pred,
          competitionMatches: matches,
          recordHistory: true,
        });
        const p5 = await evaluateLivePhase5Match({
          match,
          stats,
          phase3Prediction: pred,
          competitionMatches: matches,
        }).catch(() => null);
        const p51 = await evaluateLivePhase5_1Match({
          match,
          stats,
          phase3Prediction: pred,
          competitionMatches: matches,
        }).catch(() => null);

        if (!cancelled) {
          setCurrentMatch(match);
          setMatchStats(stats);
          setPrediction(pred);
          setPhase4Prediction(p4);
          setPhase5Prediction(p5);
          setPhase5_1Prediction(p51);
          if (pred.modelType !== 'ABSTAIN' && pred.confidence !== null) {
            runGeminiAnalysis(match, stats, pred);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as Error;
          setErrorMsg(e?.message || 'Failed to compute pre-match statistics for selected fixture.');
        }
      } finally {
        if (!cancelled) setAnalyzingMatch(false);
      }
    }

    resolveSelectedMatch();
    return () => {
      cancelled = true;
    };
  }, [selectedMatchId, matches]);

  const activeProvider = footballService.getActiveProvider();
  const isAbstain =
    prediction?.modelType === 'ABSTAIN' ||
    prediction?.confidence === null ||
    !prediction?.probabilities;

  const getFormResultShort = (r: 'W' | 'D' | 'L') =>
    r === 'W' ? t.common.winShort : r === 'D' ? t.common.drawShort : t.common.lossShort;

  const displayProbs = (() => {
    if (
      activeModelView === 'PHASE5_1' &&
      phase5_1Prediction &&
      phase5_1Prediction.abstainScope !== 'MATCH_ABSTAIN' &&
      phase5_1Prediction.oneXTwoSelected.homeWin !== null &&
      phase5_1Prediction.oneXTwoSelected.draw !== null &&
      phase5_1Prediction.oneXTwoSelected.awayWin !== null &&
      prediction?.probabilities
    ) {
      const pH = phase5_1Prediction.oneXTwoSelected.homeWin;
      const pD = phase5_1Prediction.oneXTwoSelected.draw;
      const pA = phase5_1Prediction.oneXTwoSelected.awayWin;
      return {
        ...prediction.probabilities,
        homeWin: pH,
        draw: pD,
        awayWin: pA,
        homeOrDraw: Math.round((pH + pD) * 10) / 10,
        awayOrDraw: Math.round((pA + pD) * 10) / 10,
        homeOrAway: Math.round((pH + pA) * 10) / 10,
      };
    }
    if (
      activeModelView === 'PHASE5' &&
      phase5Prediction &&
      phase5Prediction.abstainScope !== 'MATCH_ABSTAIN' &&
      phase5Prediction.oneXTwo.homeWin !== null &&
      phase5Prediction.oneXTwo.draw !== null &&
      phase5Prediction.oneXTwo.awayWin !== null &&
      prediction?.probabilities
    ) {
      const pH = phase5Prediction.oneXTwo.homeWin;
      const pD = phase5Prediction.oneXTwo.draw;
      const pA = phase5Prediction.oneXTwo.awayWin;
      const o25 = phase5Prediction.o25Research.selectedFinalPct ?? prediction.probabilities.over25;
      const btts = phase5Prediction.bttsResearch.selectedFinalPct ?? prediction.probabilities.bttsYes;
      return {
        ...prediction.probabilities,
        homeWin: pH,
        draw: pD,
        awayWin: pA,
        homeOrDraw: Math.round((pH + pD) * 10) / 10,
        awayOrDraw: Math.round((pA + pD) * 10) / 10,
        homeOrAway: Math.round((pH + pA) * 10) / 10,
        over25: o25,
        under25: Math.round((100 - o25) * 10) / 10,
        bttsYes: btts,
        bttsNo: Math.round((100 - btts) * 10) / 10,
      };
    }
    if (activeModelView === 'PHASE4' && phase4Prediction?.ensemble.probabilities) {
      return phase4Prediction.ensemble.probabilities;
    }
    return prediction?.probabilities ?? null;
  })();

  return (
    <div className="space-y-5 sm:space-y-6">
      <DisclaimerBanner />

      {/* Match Selector Panel */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              {t.analysis.selectorTitle}
            </h2>
            <p className="text-xs text-slate-400">
              {t.analysis.selectorDesc}
            </p>
          </div>
          <DemoDataBadge
            provider={activeProvider}
            provenance={currentMatch?.provenance}
            isDemo={currentMatch?.isDemoData}
            category={currentMatch?.matchCategory}
            showTimestamp
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t.analysis.competitionLabel} ({leagues.length} {t.analysis.discoveredSuffix})
            </label>
            <select
              value={selectedLeagueId}
              onChange={(e) => handleLeagueChange(e.target.value)}
              disabled={loading || leagues.length === 0}
              className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            >
              {leagues.length === 0 ? (
                <option value="">{t.analysis.noCompetitionsLoaded}</option>
              ) : (
                leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.flag} {l.name} ({l.season})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t.analysis.fixtureLabel} ({matches.length} {t.analysis.availableSuffix})
            </label>
            <select
              value={selectedMatchId}
              onChange={(e) => setSelectedMatchId(e.target.value)}
              disabled={loading || matches.length === 0}
              className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            >
              {matches.length === 0 ? (
                <option value="">{t.analysis.noFixturesAvailable}</option>
              ) : (
                matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.utcDate.split('T')[0]} · {m.homeTeam.shortName} {t.common.vs} {m.awayTeam.shortName}{' '}
                    {m.status === 'FINISHED' && m.score.home !== null
                      ? `(${t.common.fullTimePrefix} ${m.score.home}-${m.score.away})`
                      : `(${t.analysis.scheduledTag})`}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Quick Fixture Chips */}
        {matches.length > 0 && (
          <div className="pt-2 border-t border-slate-800/70">
            <span className="text-[11px] font-mono tracking-wider text-slate-400 mb-2 block">
              {t.analysis.quickSelect}
            </span>
            <div className="flex flex-wrap gap-2">
              {(matches.some((m) => m.status === 'SCHEDULED')
                ? matches.filter((m) => m.status === 'SCHEDULED')
                : matches
              )
                .slice(0, 8)
                .map((m) => {
                  const isSelected = selectedMatchId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMatchId(m.id)}
                      className={`min-h-[40px] text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                        isSelected
                          ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300 font-bold'
                          : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {m.homeTeam.shortName} {t.common.vs} {m.awayTeam.shortName}
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Loading / Error / Empty States */}
      {(loading || analyzingMatch) && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl py-16 text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-mono text-slate-400">
            {t.analysis.computingFeatures}
          </p>
        </div>
      )}

      {!loading && errorMsg && (
        <div className="bg-rose-950/30 border border-rose-800/70 rounded-xl p-6 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto" />
          <div className="text-sm font-bold text-rose-100">{t.analysis.matchDataUnavailable}</div>
          <p className="text-xs text-rose-200/80 max-w-md mx-auto">
            {translateProviderMessage(errorMsg, language)}
          </p>
          <button
            type="button"
            onClick={loadInitialSelection}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.retryLoad}</span>
          </button>
        </div>
      )}

      {!loading && !analyzingMatch && !errorMsg && !currentMatch && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
          {t.analysis.noFixturesActive}
        </div>
      )}

      {!loading && !analyzingMatch && currentMatch && matchStats && prediction && (
        <>
          {/* Card 1: Match Overview Billboard & Favorites */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-6 shadow-xl backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pb-4 border-b border-slate-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-200">{currentMatch.leagueName}</span>
                <span>·</span>
                <DemoDataBadge
                  provenance={currentMatch.provenance}
                  isDemo={currentMatch.isDemoData}
                  category={currentMatch.matchCategory}
                  showTimestamp
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleFavoriteMatch(currentMatch.id)}
                  className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-500/60 text-xs flex items-center gap-1.5 text-slate-300"
                >
                  <Star
                    className={`w-3.5 h-3.5 ${
                      favorites.matchIds.includes(currentMatch.id)
                        ? 'fill-amber-400 text-amber-400'
                        : ''
                    }`}
                  />
                  <span>{language === 'ar' ? 'تفضيل' : 'Follow'}</span>
                </button>
                {isAbstain ? (
                  <span className="text-[11px] font-mono font-bold text-rose-300 bg-rose-950/60 border border-rose-800/50 px-2 py-1 rounded flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> {t.common.abstain}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-1 rounded">
                    {t.common.available} · {translateConfidenceTier(prediction.confidence, language)} ({prediction.confidenceScore ?? t.common.na}%)
                  </span>
                )}
              </div>
            </div>

            {/* Version Selector & Timestamp Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 px-3 mt-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono text-slate-400">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {t.common.sampleLabel}:{' '}
                  <strong className="text-slate-200">
                    {prediction.sampleSizeMatches ?? currentMatch.provenance.sampleSizeMatches} {t.common.preMatchUnit}
                  </strong>
                </span>
                <span>·</span>
                <span className={prediction.preMatchXGAvailable ? 'text-emerald-400' : 'text-amber-300'}>
                  {prediction.preMatchXGAvailable ? t.common.preMatchXGAvailable : t.common.preMatchXGUnavailable}
                </span>
                <span>·</span>
                <span>
                  {language === 'ar' ? 'الموعد' : 'Kickoff'}:{' '}
                  <strong className="text-slate-200">
                    {formatDate(currentMatch.utcDate, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
                {[
                  { id: 'COMPARE', label: language === 'ar' ? 'مقارنة P3 / P4' : 'Compare P3/P4' },
                  { id: 'PHASE3', label: MODEL_VERSION_PHASE3 },
                  { id: 'PHASE4', label: MODEL_VERSION_PHASE4 },
                  { id: 'PHASE5', label: `${MODEL_VERSION_PHASE5} (EXP)` },
                  { id: 'PHASE5_1', label: 'Phase 5.1 — EXP' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setActiveModelView(
                        opt.id as 'COMPARE' | 'PHASE3' | 'PHASE4' | 'PHASE5' | 'PHASE5_1'
                      )
                    }
                    className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                      activeModelView === opt.id
                        ? opt.id === 'PHASE5'
                          ? 'bg-violet-600 text-white'
                          : opt.id === 'PHASE5_1'
                          ? 'bg-sky-600 text-white'
                          : 'bg-emerald-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Team Matchup Billboard */}
            <div className="py-5 sm:py-6 grid grid-cols-1 md:grid-cols-11 gap-4 items-center">
              {/* Home Team */}
              <div className="md:col-span-4 flex items-center gap-3 sm:gap-4">
                {currentMatch.homeTeam.crest && (
                  <img
                    src={currentMatch.homeTeam.crest}
                    alt={currentMatch.homeTeam.name}
                    className="w-12 h-12 sm:w-14 sm:h-14 object-contain shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="space-y-1 min-w-0">
                  <span className="text-[11px] font-mono tracking-wide text-blue-400 flex flex-wrap items-center gap-2">
                    <span>{t.analysis.homeTeam}</span>
                    <span>·</span>
                    <span>
                      {t.analysis.eloLabel}{' '}
                      {matchStats.homeTeamStats.eloRating !== null
                        ? matchStats.homeTeamStats.eloRating
                        : t.analysis.eloInsufficient}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg sm:text-xl font-extrabold text-white truncate">
                      {currentMatch.homeTeam.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => toggleFavoriteTeam(currentMatch.homeTeam.id)}
                      aria-label={`Favorite ${currentMatch.homeTeam.name}`}
                      className="min-h-[44px] min-w-[44px] -my-2 flex items-center justify-center rounded-lg text-slate-500 hover:text-amber-400 shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          favorites.teamIds.includes(currentMatch.homeTeam.id)
                            ? 'fill-amber-400 text-amber-400'
                            : ''
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{t.analysis.recentForm}</span>
                    {matchStats.homeTeamStats.recentForm.length > 0 ? (
                      <FormBadge results={matchStats.homeTeamStats.recentForm} size="sm" />
                    ) : (
                      <span className="font-mono text-slate-500">{t.analysis.nonePrior}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Center Model Expected Result: Phase 3 vs Phase 4 Comparison */}
              <div className="md:col-span-3 text-center bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-2">
                <div className="text-[11px] tracking-wider text-slate-400 font-mono">
                  {t.analysis.preMatchXGTitle}
                </div>
                {isAbstain || matchStats.homeExpectedGoals === null || matchStats.awayExpectedGoals === null ? (
                  <div className="mt-2 space-y-1">
                    <div className="font-mono text-lg font-bold text-amber-400">{t.common.abstain}</div>
                    <p className="text-[11px] text-slate-400">
                      {translateProviderMessage(prediction.abstainReason, language) || t.common.abstainDefaultMessage}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="font-mono text-2xl sm:text-3xl font-black text-white tracking-tight" dir="ltr">
                      <span className="text-blue-400">
                        {(activeModelView === 'PHASE5_1' &&
                        phase5_1Prediction?.expectedGoals.shrunkHome !== null &&
                        phase5_1Prediction?.expectedGoals.shrunkHome !== undefined
                          ? phase5_1Prediction.expectedGoals.shrunkHome
                          : activeModelView === 'PHASE5' &&
                            phase5Prediction?.expectedGoals.shrunkHome !== null &&
                            phase5Prediction?.expectedGoals.shrunkHome !== undefined
                          ? phase5Prediction.expectedGoals.shrunkHome
                          : activeModelView === 'PHASE4' &&
                            phase4Prediction?.lambdaComparison.variantBHome !== null
                          ? phase4Prediction?.lambdaComparison.variantBHome
                          : matchStats.homeExpectedGoals
                        )?.toFixed(2)}
                      </span>
                      <span className="text-slate-600 mx-2">:</span>
                      <span className="text-cyan-400">
                        {(activeModelView === 'PHASE5_1' &&
                        phase5_1Prediction?.expectedGoals.shrunkAway !== null &&
                        phase5_1Prediction?.expectedGoals.shrunkAway !== undefined
                          ? phase5_1Prediction.expectedGoals.shrunkAway
                          : activeModelView === 'PHASE5' &&
                            phase5Prediction?.expectedGoals.shrunkAway !== null &&
                            phase5Prediction?.expectedGoals.shrunkAway !== undefined
                          ? phase5Prediction.expectedGoals.shrunkAway
                          : activeModelView === 'PHASE4' &&
                            phase4Prediction?.lambdaComparison.variantBAway !== null
                          ? phase4Prediction?.lambdaComparison.variantBAway
                          : matchStats.awayExpectedGoals
                        )?.toFixed(2)}
                      </span>
                    </div>
                    {phase4Prediction &&
                      phase4Prediction.lambdaComparison.variantBHome !== null &&
                      phase4Prediction.lambdaComparison.variantBAway !== null && (
                        <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                          P3: {matchStats.homeExpectedGoals.toFixed(2)}:{matchStats.awayExpectedGoals.toFixed(2)} ·
                          P4 Variant-B: {phase4Prediction.lambdaComparison.variantBHome.toFixed(2)}:
                          {phase4Prediction.lambdaComparison.variantBAway.toFixed(2)}
                        </div>
                      )}
                    <div className="text-xs text-slate-400 flex items-center justify-center gap-2">
                      <span>{t.analysis.modeScore}</span>
                      <span className="font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded" dir="ltr">
                        {activeModelView === 'PHASE4' && phase4Prediction?.ensemble.mostLikelyScore
                          ? phase4Prediction.ensemble.mostLikelyScore
                          : prediction.expectedScore?.mostLikelyScore ?? t.common.na}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Away Team */}
              <div className="md:col-span-4 flex items-center justify-start md:justify-end gap-3 sm:gap-4 text-start md:text-end">
                <div className="space-y-1 order-2 md:order-1 min-w-0">
                  <span className="text-[11px] font-mono tracking-wide text-cyan-400 flex flex-wrap items-center gap-2 justify-start md:justify-end">
                    <span>{t.analysis.awayTeam}</span>
                    <span>·</span>
                    <span>
                      {t.analysis.eloLabel}{' '}
                      {matchStats.awayTeamStats.eloRating !== null
                        ? matchStats.awayTeamStats.eloRating
                        : t.analysis.eloInsufficient}
                    </span>
                  </span>
                  <div className="flex items-center gap-2 justify-start md:justify-end">
                    <h3 className="text-lg sm:text-xl font-extrabold text-white truncate">
                      {currentMatch.awayTeam.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => toggleFavoriteTeam(currentMatch.awayTeam.id)}
                      aria-label={`Favorite ${currentMatch.awayTeam.name}`}
                      className="min-h-[44px] min-w-[44px] -my-2 flex items-center justify-center rounded-lg text-slate-500 hover:text-amber-400 shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          favorites.teamIds.includes(currentMatch.awayTeam.id)
                            ? 'fill-amber-400 text-amber-400'
                            : ''
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 justify-start md:justify-end">
                    <span>{t.analysis.recentForm}</span>
                    {matchStats.awayTeamStats.recentForm.length > 0 ? (
                      <FormBadge results={matchStats.awayTeamStats.recentForm} size="sm" />
                    ) : (
                      <span className="font-mono text-slate-500">{t.analysis.nonePrior}</span>
                    )}
                  </div>
                </div>
                {currentMatch.awayTeam.crest && (
                  <img
                    src={currentMatch.awayTeam.crest}
                    alt={currentMatch.awayTeam.name}
                    className="w-12 h-12 sm:w-14 sm:h-14 object-contain order-1 md:order-2 shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
              </div>
            </div>

            {/* Sub-Tabs Navigation */}
            <div className="pt-4 border-t border-slate-800 flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setActiveSubTab('models')}
                className={`min-h-[42px] text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'models'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabModels}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('probabilities')}
                className={`min-h-[42px] text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'probabilities'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabProbs}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('form')}
                className={`min-h-[42px] text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'form'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabForm}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('h2h')}
                className={`min-h-[42px] text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'h2h'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabH2H}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('ai')}
                className={`min-h-[42px] text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'ai'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabAI}</span>
              </button>
            </div>
          </div>

          {/* Grounded Explanation Card (Always visible cleanly beneath hero) */}
          {phase4Prediction && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">
                    {language === 'ar'
                      ? 'محرك التفسير الشفاف المدعوم بالأدلة (Phase 4)'
                      : 'Transparent Evidence-Grounded Explanation Engine (Phase 4)'}
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-cyan-300" dir="ltr">
                  {phase4Prediction.modelVersion} · cal={phase4Prediction.ensemble.calibrationStatus} (n={phase4Prediction.ensemble.calibrationSampleCount})
                </span>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed">
                {language === 'ar'
                  ? phase4Prediction.explanation.matchSummaryAr
                  : phase4Prediction.explanation.matchSummaryEn}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {phase4Prediction.explanation.factors.map((f) => (
                  <div
                    key={f.key}
                    className={`rounded-lg p-3 border text-xs space-y-1 ${
                      f.available
                        ? 'bg-slate-950/60 border-slate-800/80'
                        : 'bg-slate-950/30 border-slate-800/50 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-200">
                        {language === 'ar' ? f.labelAr : f.labelEn}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          f.available ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {f.available
                          ? language === 'ar'
                            ? 'متاح'
                            : 'TRACKED'
                          : language === 'ar'
                          ? 'غير متاح'
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-white" dir="ltr">
                      {f.value}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {language === 'ar' ? f.impactAr : f.impactEn}
                    </p>
                  </div>
                ))}
              </div>

              <div className="text-[11px] text-slate-400 flex items-start gap-2 pt-2 border-t border-slate-800/70">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  {language === 'ar'
                    ? phase4Prediction.explanation.limitationsAr
                    : phase4Prediction.explanation.limitationsEn}
                </span>
              </div>
            </div>
          )}

          {/* SubTab: AI Tactical Intelligence */}
          {activeSubTab === 'ai' && (
            <AIAnalysisCard
              match={currentMatch}
              analysis={aiAnalysis}
              isLoading={isAiLoading}
              errorMessage={aiErrorMessage}
              onRefresh={() => runGeminiAnalysis()}
            />
          )}

          {/* SubTab: Multi-Model Comparison & 4 Pillars */}
          {activeSubTab === 'models' && (
            <ModelComparisonCard
              match={currentMatch}
              prediction={prediction}
              phase4Prediction={phase4Prediction}
            />
          )}

          {/* SubTab: Analytical Probabilities, Calibration & Market-Level Abstention */}
          {activeSubTab === 'probabilities' && (
            isAbstain || !displayProbs ? (
              <div className="bg-amber-950/30 border border-amber-800/70 rounded-xl p-8 text-center space-y-2">
                <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-amber-100">
                  {t.common.abstainDefaultMessage}
                </div>
                <p className="text-xs text-amber-200/80 max-w-lg mx-auto">
                  {translateProviderMessage(prediction.abstainReason, language) || t.analysis.abstainProbsDesc}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Draw Experiment Parity & Causal Check Card */}
                {phase4Prediction && (
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white">
                        {language === 'ar'
                          ? 'تجربة توقع التعادل وتكافؤ القوة (Phase 4 Draw Experiment)'
                          : 'Draw Parity & Causal Adjustment Experiment (Phase 4)'}
                      </h4>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                          phase4Prediction.drawExperiment.drawSignal
                            ? 'bg-amber-950/50 text-amber-300 border-amber-700'
                            : 'bg-slate-950 text-slate-400 border-slate-800'
                        }`}
                      >
                        {phase4Prediction.drawExperiment.drawSignal
                          ? language === 'ar'
                            ? 'إشارة تعادل مرتفعة'
                            : 'DRAW SIGNAL ACTIVE'
                          : language === 'ar'
                          ? 'إشارة تعادل عادية'
                          : 'NORMAL DRAW RANGE'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono" dir="ltr">
                      <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">Phase 4 Draw</span>
                        <span className="text-base font-bold text-white">
                          {phase4Prediction.drawExperiment.drawProb?.toFixed(1) ?? 'N/A'}%
                        </span>
                      </div>
                      <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">Parity Score</span>
                        <span className="text-base font-bold text-cyan-400">
                          {phase4Prediction.drawExperiment.parityScore?.toFixed(3) ?? 'N/A'}
                        </span>
                      </div>
                      <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">Low-Scoring Index</span>
                        <span className="text-base font-bold text-emerald-400">
                          {phase4Prediction.drawExperiment.lowScoringIndex?.toFixed(3) ?? 'N/A'}
                        </span>
                      </div>
                      <div className="bg-slate-950/60 border border-slate-800 p-2.5 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">Causal Draw Priors</span>
                        <span className="text-base font-bold text-slate-200">
                          {phase4Prediction.drawExperiment.causalSamplesUsed} (
                          {phase4Prediction.drawExperiment.causalAdjustmentApplied ? 'Fitted' : 'Raw DC'})
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Phase 5 Experimental Research Card (Isolated & Clearly Badged) */}
                {phase5Prediction && (
                  <div className="bg-slate-900/80 border border-violet-700/60 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-violet-950/70 text-violet-300 border border-violet-700/70">
                          EXPERIMENTAL
                        </span>
                        <h4 className="text-sm font-bold text-white">
                          {language === 'ar'
                            ? 'أبحاث المرحلة الخامسة: التعادل والأهداف والاحتمالات المعايرة (Phase 5)'
                            : 'Phase 5 Research: Draw, Over 2.5, BTTS & Per-Market Calibration'}
                        </h4>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400" dir="ltr">
                        {phase5Prediction.modelVersion} · r_H={phase5Prediction.causalPriors.causalDispersionHome.toFixed(1)} · r_A={phase5Prediction.causalPriors.causalDispersionAway.toFixed(1)}
                      </span>
                    </div>

                    {/* Independent Per-Market Decisions */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono" dir="ltr">
                      {(['1X2', 'DRAW', 'OVER25', 'BTTS'] as const).map((mk) => {
                        const dec = phase5Prediction.marketDecisions[mk];
                        const statusClass =
                          dec.status === 'PREDICT'
                            ? 'text-emerald-400 border-emerald-800/60 bg-emerald-950/40'
                            : dec.status === 'NOT_TRAINED'
                            ? 'text-cyan-300 border-cyan-800/60 bg-cyan-950/40'
                            : 'text-amber-300 border-amber-800/60 bg-amber-950/40';
                        return (
                          <div key={mk} className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] text-slate-400 font-bold">{mk}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${statusClass}`}>
                                {dec.status}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-white">
                              {mk === '1X2' && dec.probs1X2
                                ? `${dec.probs1X2.homeWin.toFixed(0)}/${dec.probs1X2.draw.toFixed(0)}/${dec.probs1X2.awayWin.toFixed(0)}%`
                                : dec.finalProbabilityPct !== null
                                ? `${dec.finalProbabilityPct.toFixed(1)}%`
                                : 'ABSTAIN'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              cal={dec.calibrationMethod} ({dec.calibrationStatus})
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Variant Comparison Grids for O2.5 & BTTS & Draw */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] font-mono" dir="ltr">
                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 space-y-1">
                        <div className="text-violet-300 font-bold">Phase 5A Draw Research</div>
                        <div className="text-slate-300">
                          Raw DC: {phase5Prediction.drawResearch.rawDixonColesDrawProbPct?.toFixed(1) ?? 'N/A'}% · Shrunk: {phase5Prediction.drawResearch.shrunkDrawProbPct?.toFixed(1) ?? 'N/A'}%
                        </div>
                        <div className="text-slate-300">
                          Logistic: {phase5Prediction.drawResearch.logisticAdjustedDrawProbPct?.toFixed(1) ?? 'N/A'}% · Final: <strong className="text-white">{phase5Prediction.drawResearch.finalDrawProbPct?.toFixed(1) ?? 'N/A'}%</strong>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Parity={phase5Prediction.drawResearch.parityScore?.toFixed(2) ?? 'N/A'} · LowScore={phase5Prediction.drawResearch.lowScoringIndex?.toFixed(2) ?? 'N/A'}
                        </div>
                      </div>

                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 space-y-1">
                        <div className="text-emerald-300 font-bold">Phase 5B Over 2.5 Variants</div>
                        <div className="text-slate-300">
                          A(Pois): {phase5Prediction.o25Research.variantAPoissonPct?.toFixed(1) ?? 'N/A'}% · B(NB): {phase5Prediction.o25Research.variantBNegBinPct?.toFixed(1) ?? 'N/A'}%
                        </div>
                        <div className="text-slate-300">
                          C(Shrunk): {phase5Prediction.o25Research.variantCShrunkPct?.toFixed(1) ?? 'N/A'}% · D(Cal): <strong className="text-white">{phase5Prediction.o25Research.variantDCalibratedPct !== null ? `${phase5Prediction.o25Research.variantDCalibratedPct.toFixed(1)}%` : 'NOT_TRAINED'}</strong>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Method={phase5Prediction.o25Research.calibrationMethod} (n={phase5Prediction.o25Research.calibrationSamplesUsed})
                        </div>
                      </div>

                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 space-y-1">
                        <div className="text-cyan-300 font-bold">Phase 5C BTTS Variants</div>
                        <div className="text-slate-300">
                          A(Exist): {phase5Prediction.bttsResearch.variantAExistingPct?.toFixed(1) ?? 'N/A'}% · B(Indep): {phase5Prediction.bttsResearch.variantBIndependentPct?.toFixed(1) ?? 'N/A'}%
                        </div>
                        <div className="text-slate-300">
                          C(NB): {phase5Prediction.bttsResearch.variantCNegBinPct?.toFixed(1) ?? 'N/A'}% · D(Cal): <strong className="text-white">{phase5Prediction.bttsResearch.variantDCalibratedPct !== null ? `${phase5Prediction.bttsResearch.variantDCalibratedPct.toFixed(1)}%` : 'NOT_TRAINED'}</strong>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Method={phase5Prediction.bttsResearch.calibrationMethod} (n={phase5Prediction.bttsResearch.calibrationSamplesUsed})
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Phase 5.1 Experimental Research Card (Only shown when optional Phase 5.1 — EXP view is active) */}
                {activeModelView === 'PHASE5_1' && phase5_1Prediction && (
                  <div className="bg-slate-900/80 border border-sky-700/60 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-700/70">
                          EXPERIMENTAL
                        </span>
                        <h4 className="text-sm font-bold text-white">
                          {language === 'ar'
                            ? 'أبحاث المرحلة 5.1: معايرة الذيل وتمييز التعادل'
                            : 'Phase 5.1 Research: Tail Calibration & Draw Discrimination'}
                        </h4>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400" dir="ltr">
                        {phase5_1Prediction.modelVersion} · cal={phase5_1Prediction.oneXTwoSelected.status} (n={phase5_1Prediction.oneXTwoSelected.sampleCount})
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono" dir="ltr">
                      <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="text-sky-300 font-bold">1X2 Calibration Approaches (A–D)</div>
                        <div className="text-slate-300">
                          A(Exist): {phase5_1Prediction.oneXTwoVariants.A_EXISTING_PHASE5.homeWin?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.A_EXISTING_PHASE5.draw?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.A_EXISTING_PHASE5.awayWin?.toFixed(1) ?? 'N/A'}% ({phase5_1Prediction.oneXTwoVariants.A_EXISTING_PHASE5.status})
                        </div>
                        <div className="text-slate-300">
                          B(Temp): {phase5_1Prediction.oneXTwoVariants.B_TEMPERATURE.homeWin?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.B_TEMPERATURE.draw?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.B_TEMPERATURE.awayWin?.toFixed(1) ?? 'N/A'}% ({phase5_1Prediction.oneXTwoVariants.B_TEMPERATURE.status})
                        </div>
                        <div className="text-slate-300">
                          C(Beta): {phase5_1Prediction.oneXTwoVariants.C_BETA.homeWin?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.C_BETA.draw?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.C_BETA.awayWin?.toFixed(1) ?? 'N/A'}% ({phase5_1Prediction.oneXTwoVariants.C_BETA.status})
                        </div>
                        <div className="text-white font-bold">
                          D(Tail): {phase5_1Prediction.oneXTwoVariants.D_TAIL_SHRINKAGE.homeWin?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.D_TAIL_SHRINKAGE.draw?.toFixed(1) ?? 'N/A'}/{phase5_1Prediction.oneXTwoVariants.D_TAIL_SHRINKAGE.awayWin?.toFixed(1) ?? 'N/A'}% ({phase5_1Prediction.oneXTwoVariants.D_TAIL_SHRINKAGE.status})
                        </div>
                      </div>

                      <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="text-emerald-300 font-bold">Draw Variants (A–D) & Thresholds</div>
                        <div className="text-slate-300">
                          A(P5): {phase5_1Prediction.drawVariants.A_PHASE5.finalProb01 !== null ? `${(phase5_1Prediction.drawVariants.A_PHASE5.finalProb01 * 100).toFixed(1)}%` : phase5_1Prediction.drawVariants.A_PHASE5.status} · B(Pois+Prior): {phase5_1Prediction.drawVariants.B_POISSON_PRIOR.finalProb01 !== null ? `${(phase5_1Prediction.drawVariants.B_POISSON_PRIOR.finalProb01 * 100).toFixed(1)}%` : phase5_1Prediction.drawVariants.B_POISSON_PRIOR.status}
                        </div>
                        <div className="text-slate-300">
                          C(Sym): {phase5_1Prediction.drawVariants.C_STRENGTH_SYMMETRY.finalProb01 !== null ? `${(phase5_1Prediction.drawVariants.C_STRENGTH_SYMMETRY.finalProb01 * 100).toFixed(1)}%` : phase5_1Prediction.drawVariants.C_STRENGTH_SYMMETRY.status} · D(Ens): {phase5_1Prediction.drawVariants.D_CAUSAL_ENSEMBLE.finalProb01 !== null ? `${(phase5_1Prediction.drawVariants.D_CAUSAL_ENSEMBLE.finalProb01 * 100).toFixed(1)}%` : phase5_1Prediction.drawVariants.D_CAUSAL_ENSEMBLE.status}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Thresholds → Argmax: {phase5_1Prediction.drawSelected.thresholds.ARGMAX.triggered ? 'YES' : 'NO'} · 28.5%: {phase5_1Prediction.drawSelected.thresholds.FIXED_THRESHOLD.triggered ? 'YES' : 'NO'} · Causal: {phase5_1Prediction.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.status === 'NOT_TRAINED' ? 'NOT_TRAINED' : `${phase5_1Prediction.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.triggered ? 'YES' : 'NO'} (@${((phase5_1Prediction.drawSelected.thresholds.CAUSAL_LEARNED_THRESHOLD.threshold01 ?? 0.285) * 100).toFixed(1)}%)`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 1X2 Match Winner */}
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-white tracking-tight">
                          {t.analysis.winner1X2CardTitle}
                        </h4>
                        <p className="text-xs text-slate-400">
                          {t.analysis.winner1X2CardDesc}
                        </p>
                      </div>
                      {phase4Prediction && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 shrink-0">
                          {phase4Prediction.goalMarkets.oneXTwo.status}
                        </span>
                      )}
                    </div>

                    <div className="space-y-3 pt-2">
                      <ProbabilityBar
                        label={`${currentMatch.homeTeam.name} (${t.analysis.homeWinSuffix})`}
                        percentage={displayProbs.homeWin}
                        color="blue"
                        subtext={
                          phase4Prediction?.goalMarkets.oneXTwo.rawHomeWin !== null &&
                          phase4Prediction?.goalMarkets.oneXTwo.rawHomeWin !== undefined
                            ? `Raw: ${phase4Prediction.goalMarkets.oneXTwo.rawHomeWin.toFixed(1)}%`
                            : t.common.home
                        }
                      />
                      <ProbabilityBar
                        label={t.analysis.matchDrawLabel}
                        percentage={displayProbs.draw}
                        color="amber"
                        subtext={
                          phase4Prediction?.goalMarkets.oneXTwo.rawDraw !== null &&
                          phase4Prediction?.goalMarkets.oneXTwo.rawDraw !== undefined
                            ? `Raw: ${phase4Prediction.goalMarkets.oneXTwo.rawDraw.toFixed(1)}%`
                            : t.analysis.equalGoals
                        }
                      />
                      <ProbabilityBar
                        label={`${currentMatch.awayTeam.name} (${t.analysis.homeWinSuffix})`}
                        percentage={displayProbs.awayWin}
                        color="cyan"
                        subtext={
                          phase4Prediction?.goalMarkets.oneXTwo.rawAwayWin !== null &&
                          phase4Prediction?.goalMarkets.oneXTwo.rawAwayWin !== undefined
                            ? `Raw: ${phase4Prediction.goalMarkets.oneXTwo.rawAwayWin.toFixed(1)}%`
                            : t.common.away
                        }
                      />
                    </div>
                  </div>

                  {/* Double Chance Markets */}
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-white tracking-tight">
                          {t.analysis.doubleChanceCardTitle}
                        </h4>
                        <p className="text-xs text-slate-400">
                          {t.analysis.doubleChanceCardDesc}
                        </p>
                      </div>
                      {phase4Prediction && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300 shrink-0" dir="ltr">
                          σ={phase4Prediction.goalMarkets.doubleChance.uncertainty.toFixed(3)} ·{' '}
                          {phase4Prediction.goalMarkets.doubleChance.status}
                        </span>
                      )}
                    </div>

                    <div className="space-y-3 pt-2">
                      <ProbabilityBar
                        label={`${t.analysis.homeOrDrawLabel} (1X - ${currentMatch.homeTeam.shortName})`}
                        percentage={displayProbs.homeOrDraw}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={`${t.analysis.awayOrDrawLabel} (X2 - ${currentMatch.awayTeam.shortName})`}
                        percentage={displayProbs.awayOrDraw}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.homeOrAwayLabel}
                        percentage={displayProbs.homeOrAway}
                        color="cyan"
                      />
                    </div>
                  </div>
                </div>

                {/* Goal Totals & Uncertainty Bounds + Scoreline Matrix */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {t.analysis.goalTotalsTitle}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {t.analysis.goalTotalsDesc}
                      </p>
                    </div>

                    <div className="space-y-3 pt-2">
                      <ProbabilityBar
                        label={t.analysis.over15Goals}
                        percentage={displayProbs.over15}
                        secondaryLabel={
                          phase4Prediction
                            ? `${t.analysis.under15Prefix} ${displayProbs.under15.toFixed(1)}% · σ=${phase4Prediction.goalMarkets.over15.uncertainty.toFixed(3)}`
                            : `${t.analysis.under15Prefix} ${displayProbs.under15.toFixed(1)}%`
                        }
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.over25Goals}
                        percentage={displayProbs.over25}
                        secondaryLabel={
                          phase4Prediction
                            ? `${t.analysis.under25Prefix} ${displayProbs.under25.toFixed(1)}% · σ=${phase4Prediction.goalMarkets.over25.uncertainty.toFixed(3)}`
                            : `${t.analysis.under25Prefix} ${displayProbs.under25.toFixed(1)}%`
                        }
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.over35Goals}
                        percentage={displayProbs.over35}
                        secondaryLabel={`${t.analysis.under35Prefix} ${displayProbs.under35.toFixed(1)}%`}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.bttsYesFull}
                        percentage={displayProbs.bttsYes}
                        secondaryLabel={
                          phase4Prediction
                            ? `${t.predictions.noPrefix} ${displayProbs.bttsNo.toFixed(1)}% · σ=${phase4Prediction.goalMarkets.btts.uncertainty.toFixed(3)}`
                            : `${t.predictions.noPrefix} ${displayProbs.bttsNo.toFixed(1)}%`
                        }
                        color="cyan"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {t.analysis.topScorelinesTitle}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {t.analysis.topScorelinesDesc}
                      </p>
                    </div>

                    <ScorelineMatrix
                      scorelines={
                        activeModelView === 'PHASE4' &&
                        phase4Prediction &&
                        phase4Prediction.ensemble.topScorelines.length > 0
                          ? phase4Prediction.ensemble.topScorelines
                          : prediction.topScorelines
                      }
                    />
                  </div>
                </div>
              </div>
            )
          )}

          {/* SubTab: Rolling Form */}
          {activeSubTab === 'form' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[
                  {
                    team: currentMatch.homeTeam,
                    stats: matchStats.homeTeamStats,
                    accentClass: 'text-emerald-400',
                  },
                  {
                    team: currentMatch.awayTeam,
                    stats: matchStats.awayTeamStats,
                    accentClass: 'text-cyan-400',
                  },
                ].map(({ team, stats, accentClass }) => (
                  <div
                    key={team.id}
                    className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        {team.crest && (
                          <img src={team.crest} alt="" className="w-6 h-6 object-contain" />
                        )}
                        <span className="font-bold text-white text-sm">
                          {team.name} ({t.analysis.eloLabel}: {stats.eloRating !== null ? stats.eloRating : t.common.na})
                        </span>
                      </div>
                      <FormBadge results={stats.recentForm} />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                      <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px]">
                          {stats.overall.avgXG !== null && stats.overall.avgXG !== undefined
                            ? t.analysis.avgXGTitle
                            : t.analysis.avgGoalsTitle}
                        </div>
                        <div className="text-sm font-bold text-white mt-1" dir="ltr">
                          {typeof stats.overall.avgXG === 'number' && typeof stats.overall.avgXGA === 'number'
                            ? `${stats.overall.avgXG} / ${stats.overall.avgXGA}`
                            : `${stats.overall.avgGoalsScored} / ${stats.overall.avgGoalsConceded}`}
                        </div>
                        <div className={`text-[10px] ${accentClass}`}>
                          {typeof stats.overall.avgXG === 'number' && typeof stats.overall.avgXGA === 'number'
                            ? `${t.analysis.diffPrefix} ${(stats.overall.avgXG - stats.overall.avgXGA).toFixed(2)}`
                            : t.analysis.xgNotTracked}
                        </div>
                      </div>

                      <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px]">{t.analysis.cleanSheets}</div>
                        <div className="text-sm font-bold text-white mt-1" dir="ltr">
                          {stats.overall.cleanSheets} / {stats.overall.matchesPlayed}
                        </div>
                        <div className={`text-[10px] ${accentClass}`} dir="ltr">
                          {stats.overall.matchesPlayed > 0
                            ? `${((stats.overall.cleanSheets / stats.overall.matchesPlayed) * 100).toFixed(0)}%`
                            : '0%'}
                        </div>
                      </div>

                      <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px]">{t.analysis.restAndCongestion}</div>
                        <div className="text-sm font-bold text-white mt-1">
                          {stats.restDays !== null ? `${stats.restDays} ${t.analysis.daysUnit}` : t.common.na}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {stats.fixtureCongestionIndex !== null
                            ? `${t.analysis.congestion21d} ${stats.fixtureCongestionIndex}/100`
                            : t.analysis.congestionNA}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <span className="text-[11px] font-mono text-slate-400 mb-2 block font-semibold">
                        {stats.formMatches.some((m) => m.xG !== null && m.xG !== undefined)
                          ? t.analysis.preMatchXGGoalLog
                          : `${t.analysis.preMatchResultsLog} (${stats.formMatches.length} ${t.analysis.priorMatchesSuffix})`}
                      </span>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pe-1">
                        {stats.formMatches.length === 0 ? (
                          <div className="text-xs text-slate-500 py-3 text-center">
                            {t.analysis.noCompletedPrior}
                          </div>
                        ) : (
                          stats.formMatches.map((m, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between text-xs bg-slate-950/40 p-2 rounded border border-slate-800/60 font-mono"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-slate-500 text-[10px] shrink-0" dir="ltr">{m.date}</span>
                                <span className="text-slate-300 truncate">
                                  {m.isHome ? t.common.vs : '@'} {m.opponent}
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0">
                                <span className="text-white font-bold" dir="ltr">{m.score}</span>
                                <span
                                  className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                                    m.result === 'W'
                                      ? 'text-emerald-400 bg-emerald-950/40'
                                      : m.result === 'D'
                                      ? 'text-amber-400 bg-amber-950/40'
                                      : 'text-rose-400 bg-rose-950/40'
                                  }`}
                                >
                                  {getFormResultShort(m.result)}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SubTab: Head-to-Head */}
          {activeSubTab === 'h2h' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    {t.analysis.h2hTitle}
                  </h4>
                  <p className="text-xs text-slate-400">
                    {t.analysis.h2hDesc} {currentMatch.homeTeam.shortName} {t.common.vs} {currentMatch.awayTeam.shortName}.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                  <span className="text-blue-400 font-bold">
                    {currentMatch.homeTeam.shortName}: {matchStats.headToHeadSummary.homeWins} {t.common.winShort}
                  </span>
                  <span className="text-slate-400">
                    {t.analysis.drawsLabel} {matchStats.headToHeadSummary.draws}
                  </span>
                  <span className="text-cyan-400 font-bold">
                    {currentMatch.awayTeam.shortName}: {matchStats.headToHeadSummary.awayWins} {t.common.winShort}
                  </span>
                </div>
              </div>

              {matchStats.headToHead.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 bg-slate-950/50 rounded-lg border border-slate-800">
                  {t.analysis.noH2HRecorded}
                </div>
              ) : (
                <div className="space-y-2">
                  {matchStats.headToHead.map((h, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-950/50 border border-slate-800/80 text-xs font-mono"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 text-[11px]" dir="ltr">{h.date}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-200 font-medium font-sans">
                          {h.homeTeamName} {t.common.vs} {h.awayTeamName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-[11px] font-sans">{h.competition}</span>
                        <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded" dir="ltr">
                          {h.score}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Experiment Provenance & Integrity Footer Card */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {language === 'ar'
                ? 'تمت أرشفة نسختي Phase 3 و Phase 4 بشكل مستقل في سجل النماذج'
                : 'Both Phase 3 Frozen and Phase 4 Experimental archived independently in History Store'}
            </span>
            <span dir="ltr">
              {formatDateTime(prediction.calculatedAt)} · {currentMatch.provenance.source}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
