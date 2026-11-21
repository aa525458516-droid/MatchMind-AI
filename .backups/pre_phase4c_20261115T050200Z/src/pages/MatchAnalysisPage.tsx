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

  // Selection state (initialized dynamically, never hardcoded to PL/m-pl-01)
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedMatchId, setSelectedMatchId] = useState<string>(initialMatchId || '');

  // Loaded data state
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [matchStats, setMatchStats] = useState<MatchStatistics | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'ai' | 'models' | 'probabilities' | 'form' | 'h2h'>('models');

  const [loading, setLoading] = useState<boolean>(true);
  const [analyzingMatch, setAnalyzingMatch] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  // Initial dynamic discovery of leagues & matches
  const loadInitialSelection = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setCurrentMatch(null);
    setMatchStats(null);
    setPrediction(null);
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

  // Reload league matches when user picks a different league from dropdown
  const handleLeagueChange = async (newLeagueId: string) => {
    setSelectedLeagueId(newLeagueId);
    setLoading(true);
    setErrorMsg(null);
    setCurrentMatch(null);
    setMatchStats(null);
    setPrediction(null);
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

  // Evaluate selected match (with cached Monte Carlo N=10,000 on detail page)
  useEffect(() => {
    if (!selectedMatchId) {
      setCurrentMatch(null);
      setMatchStats(null);
      setPrediction(null);
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

        if (!cancelled) {
          setCurrentMatch(match);
          setMatchStats(stats);
          setPrediction(pred);
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

  return (
    <div className="space-y-6">
      {/* Top Notice */}
      <DisclaimerBanner />

      {/* Match Selector Panel */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-4">
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
          {/* Competition Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t.analysis.competitionLabel} ({leagues.length} {t.analysis.discoveredSuffix})
            </label>
            <select
              value={selectedLeagueId}
              onChange={(e) => handleLeagueChange(e.target.value)}
              disabled={loading || leagues.length === 0}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
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

          {/* Fixture Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t.analysis.fixtureLabel} ({matches.length} {t.analysis.availableSuffix})
            </label>
            <select
              value={selectedMatchId}
              onChange={(e) => setSelectedMatchId(e.target.value)}
              disabled={loading || matches.length === 0}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
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

        {/* Quick Fixture Chips (up to 10 relevant matches) */}
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
                .slice(0, 10)
                .map((m) => {
                  const isSelected = selectedMatchId === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMatchId(m.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
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
            onClick={loadInitialSelection}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
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
          {/* Match Overview Billboard */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-sm">
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
              <div className="flex flex-wrap items-center gap-3">
                {isAbstain ? (
                  <span className="text-[11px] font-mono font-bold text-rose-300 bg-rose-950/60 border border-rose-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> {t.common.abstain}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded">
                    {t.common.available} · {translateConfidenceTier(prediction.confidence, language)} ({prediction.confidenceScore ?? t.common.na}%)
                  </span>
                )}
                <span className="font-mono text-slate-400 text-[11px] hidden sm:inline">
                  {t.analysis.kickoff} {formatDate(currentMatch.utcDate, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {/* Explicit Prediction Provenance & Timestamp Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 mt-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono text-slate-400">
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
                <span className={prediction.historicalValidationAvailable ? 'text-emerald-400' : 'text-slate-400'}>
                  {prediction.historicalValidationAvailable
                    ? t.common.historicalValidationAvailable
                    : t.common.historicalValidationUnavailable}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {t.common.calculatedAt}:{' '}
                  <strong className="text-slate-200">
                    {formatDateTime(prediction.calculatedAt)}
                  </strong>
                </span>
                {(currentMatch.provenance.cachedAt || currentMatch.provenance.retrievedAt) && (
                  <>
                    <span>·</span>
                    <span>
                      {t.common.dataLabel} {currentMatch.provenance.cached ? t.common.cached : t.common.retrieved}:{' '}
                      <strong className="text-slate-300">
                        {formatDateTime(
                          currentMatch.provenance.cachedAt || currentMatch.provenance.retrievedAt!
                        )}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Team Matchup Billboard */}
            <div className="py-6 grid grid-cols-1 md:grid-cols-11 gap-4 items-center">
              {/* Home Team */}
              <div className="md:col-span-4 flex items-center gap-4">
                {currentMatch.homeTeam.crest && (
                  <img
                    src={currentMatch.homeTeam.crest}
                    alt={currentMatch.homeTeam.name}
                    className="w-14 h-14 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="space-y-1">
                  <span className="text-[11px] font-mono tracking-wide text-blue-400 flex items-center gap-2">
                    <span>{t.analysis.homeTeam}</span>
                    <span>·</span>
                    <span>
                      {t.analysis.eloLabel}{' '}
                      {matchStats.homeTeamStats.eloRating !== null
                        ? matchStats.homeTeamStats.eloRating
                        : t.analysis.eloInsufficient}
                    </span>
                  </span>
                  <h3 className="text-xl font-extrabold text-white">
                    {currentMatch.homeTeam.name}
                  </h3>
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

              {/* Center Model Expected Result */}
              <div className="md:col-span-3 text-center bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
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
                    <div className="font-mono text-3xl font-black text-white mt-1 tracking-tight" dir="ltr">
                      <span className="text-blue-400">{matchStats.homeExpectedGoals.toFixed(2)}</span>
                      <span className="text-slate-600 mx-2">:</span>
                      <span className="text-cyan-400">{matchStats.awayExpectedGoals.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-2 flex items-center justify-center gap-2">
                      <span>{t.analysis.modeScore}</span>
                      <span className="font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded" dir="ltr">
                        {prediction.expectedScore?.mostLikelyScore ?? t.common.na}
                      </span>
                    </div>
                  </>
                )}

                {matchStats.observedMatchXG &&
                  matchStats.observedMatchXG.homeXG !== null &&
                  matchStats.observedMatchXG.awayXG !== null && (
                    <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] font-mono text-cyan-300">
                      {t.analysis.observedPostMatchXG}{' '}
                      <span dir="ltr">
                        {matchStats.observedMatchXG.homeXG} : {matchStats.observedMatchXG.awayXG}
                      </span>
                    </div>
                  )}
              </div>

              {/* Away Team */}
              <div className="md:col-span-4 flex items-center justify-start md:justify-end gap-4 text-start md:text-end">
                <div className="space-y-1 order-2 md:order-1">
                  <span className="text-[11px] font-mono tracking-wide text-cyan-400 flex items-center gap-2 justify-start md:justify-end">
                    <span>{t.analysis.awayTeam}</span>
                    <span>·</span>
                    <span>
                      {t.analysis.eloLabel}{' '}
                      {matchStats.awayTeamStats.eloRating !== null
                        ? matchStats.awayTeamStats.eloRating
                        : t.analysis.eloInsufficient}
                    </span>
                  </span>
                  <h3 className="text-xl font-extrabold text-white">
                    {currentMatch.awayTeam.name}
                  </h3>
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
                    className="w-14 h-14 object-contain order-1 md:order-2"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
              </div>
            </div>

            {/* Sub-Tabs Navigation */}
            <div className="pt-4 border-t border-slate-800 flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setActiveSubTab('models')}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'models'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabModels}</span>
              </button>

              <button
                onClick={() => setActiveSubTab('probabilities')}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'probabilities'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabProbs}</span>
              </button>

              <button
                onClick={() => setActiveSubTab('form')}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'form'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabForm}</span>
              </button>

              <button
                onClick={() => setActiveSubTab('h2h')}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeSubTab === 'h2h'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>{t.analysis.subTabH2H}</span>
              </button>

              <button
                onClick={() => setActiveSubTab('ai')}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
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
            <ModelComparisonCard match={currentMatch} prediction={prediction} />
          )}

          {/* SubTab: Analytical Probabilities & Markets */}
          {activeSubTab === 'probabilities' && (
            isAbstain || !prediction.probabilities ? (
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 1X2 Match Winner */}
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {t.analysis.winner1X2CardTitle}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {t.analysis.winner1X2CardDesc}
                      </p>
                    </div>

                    <div className="space-y-3 pt-2">
                      <ProbabilityBar
                        label={`${currentMatch.homeTeam.name} (${t.analysis.homeWinSuffix})`}
                        percentage={prediction.probabilities.homeWin}
                        color="blue"
                        subtext={t.common.home}
                      />
                      <ProbabilityBar
                        label={t.analysis.matchDrawLabel}
                        percentage={prediction.probabilities.draw}
                        color="amber"
                        subtext={t.analysis.equalGoals}
                      />
                      <ProbabilityBar
                        label={`${currentMatch.awayTeam.name} (${t.analysis.homeWinSuffix})`}
                        percentage={prediction.probabilities.awayWin}
                        color="cyan"
                        subtext={t.common.away}
                      />
                    </div>
                  </div>

                  {/* Double Chance Markets */}
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {t.analysis.doubleChanceCardTitle}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {t.analysis.doubleChanceCardDesc}
                      </p>
                    </div>

                    <div className="space-y-3 pt-2">
                      <ProbabilityBar
                        label={`${t.analysis.homeOrDrawLabel} (1X - ${currentMatch.homeTeam.shortName})`}
                        percentage={prediction.probabilities.homeOrDraw}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={`${t.analysis.awayOrDrawLabel} (X2 - ${currentMatch.awayTeam.shortName})`}
                        percentage={prediction.probabilities.awayOrDraw}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.homeOrAwayLabel}
                        percentage={prediction.probabilities.homeOrAway}
                        color="cyan"
                      />
                    </div>
                  </div>
                </div>

                {/* Over / Under Goals & Scoreline Matrix */}
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
                        percentage={prediction.probabilities.over15}
                        secondaryLabel={`${t.analysis.under15Prefix} ${prediction.probabilities.under15.toFixed(1)}%`}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.over25Goals}
                        percentage={prediction.probabilities.over25}
                        secondaryLabel={`${t.analysis.under25Prefix} ${prediction.probabilities.under25.toFixed(1)}%`}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.over35Goals}
                        percentage={prediction.probabilities.over35}
                        secondaryLabel={`${t.analysis.under35Prefix} ${prediction.probabilities.under35.toFixed(1)}%`}
                        color="emerald"
                      />
                      <ProbabilityBar
                        label={t.analysis.bttsYesFull}
                        percentage={prediction.probabilities.bttsYes}
                        secondaryLabel={`${t.predictions.noPrefix} ${prediction.probabilities.bttsNo.toFixed(1)}%`}
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

                    <ScorelineMatrix scorelines={prediction.topScorelines} />
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
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
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
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 text-[10px]" dir="ltr">{m.date}</span>
                                <span className="text-slate-300">
                                  {m.isHome ? t.common.vs : '@'} {m.opponent}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-slate-400 text-[11px]" dir="ltr">
                                  {m.xG !== null && m.xG !== undefined
                                    ? `xG: ${m.xG} vs ${m.xGA}`
                                    : `${t.analysis.goalsPrefix} ${m.goalsFor}-${m.goalsAgainst}`}
                                </span>
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
        </>
      )}
    </div>
  );
};
