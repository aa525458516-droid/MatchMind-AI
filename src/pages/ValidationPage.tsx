/**
 * Research & Scientific Validation Hub
 *
 * Displays strictly empirical, lookahead-leakage-free backtest outcomes for Frozen Phase 3,
 * plus an isolated Phase 3 vs Phase 4 chronological side-by-side comparison runner.
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
  GitCompare,
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
import { Phase4BenchmarkComparison } from '../phase4/phase4Types';
import { runServicePhase4Comparison } from '../phase4/phase4Service';
import { Phase5BenchmarkReport } from '../phase5/phase5Types';
import { runServicePhase5Benchmark } from '../phase5/phase5Service';
import { Phase5_1BenchmarkReport } from '../phase5_1/phase5_1Types';
import { runServicePhase5_1Benchmark } from '../phase5_1/phase5_1Service';

interface Props {
  providerVersion?: number;
}

function fmtNum(v: number | null, decimals = 3): string {
  return v !== null && Number.isFinite(v) ? v.toFixed(decimals) : 'N/A';
}

function fmtPct(v: number | null): string {
  return v !== null && Number.isFinite(v) ? `${v.toFixed(1)}%` : 'N/A';
}

export const ValidationPage: React.FC<Props> = ({ providerVersion = 0 }) => {
  const { language, t, formatDateTime } = useLanguage();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [fullSeason, setFullSeason] = useState<boolean>(false);
  const [backtestRun, setBacktestRun] = useState<BacktestRun | null>(null);
  const [phase4Comparison, setPhase4Comparison] = useState<Phase4BenchmarkComparison | null>(null);
  const [runningPhase4, setRunningPhase4] = useState<boolean>(false);
  const [phase4Error, setPhase4Error] = useState<string | null>(null);
  const [phase5Report, setPhase5Report] = useState<Phase5BenchmarkReport | null>(null);
  const [runningPhase5, setRunningPhase5] = useState<boolean>(false);
  const [phase5Error, setPhase5Error] = useState<string | null>(null);
  const [phase5_1Report, setPhase5_1Report] = useState<Phase5_1BenchmarkReport | null>(null);
  const [runningPhase5_1, setRunningPhase5_1] = useState<boolean>(false);
  const [phase5_1Error, setPhase5_1Error] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setSelectedLeague('ALL');
    setPhase4Comparison(null);
    setPhase5Report(null);
    setPhase5_1Report(null);
  }, [providerVersion]);

  const loadBacktest = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setPhase4Comparison(null);
    setPhase4Error(null);
    setPhase5Report(null);
    setPhase5Error(null);
    setPhase5_1Report(null);
    setPhase5_1Error(null);
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

  const handleRunPhase4Benchmark = async () => {
    setRunningPhase4(true);
    setPhase4Error(null);
    try {
      const effectiveLeagueId =
        selectedLeague !== 'ALL' && leagues.some((l) => l.id === selectedLeague)
          ? selectedLeague
          : leagues[0]?.id;
      const res = await runServicePhase4Comparison({
        leagueId: effectiveLeagueId,
        fullSeason,
      });
      setPhase4Comparison(res);
    } catch (err: unknown) {
      const e = err as Error;
      setPhase4Error(e?.message || 'Failed to execute Phase 3 vs Phase 4 comparison.');
    } finally {
      setRunningPhase4(false);
    }
  };

  const handleRunPhase5Benchmark = async () => {
    setRunningPhase5(true);
    setPhase5Error(null);
    try {
      const effectiveLeagueId =
        selectedLeague !== 'ALL' && leagues.some((l) => l.id === selectedLeague)
          ? selectedLeague
          : leagues[0]?.id;
      const rep = await runServicePhase5Benchmark({
        leagueId: effectiveLeagueId,
        maxMatches: fullSeason ? undefined : 120,
      });
      setPhase5Report(rep);
    } catch (err: unknown) {
      const e = err as Error;
      setPhase5Error(e?.message || 'Failed to execute Phase 5 experimental benchmark.');
    } finally {
      setRunningPhase5(false);
    }
  };

  const handleRunPhase5_1Benchmark = async () => {
    setRunningPhase5_1(true);
    setPhase5_1Error(null);
    try {
      const effectiveLeagueId =
        selectedLeague !== 'ALL' && leagues.some((l) => l.id === selectedLeague)
          ? selectedLeague
          : leagues[0]?.id;
      const rep = await runServicePhase5_1Benchmark({
        leagueId: effectiveLeagueId,
        maxMatches: fullSeason ? undefined : 120,
      });
      setPhase5_1Report(rep);
    } catch (err: unknown) {
      const e = err as Error;
      setPhase5_1Error(e?.message || 'Failed to execute Phase 5.1 experimental benchmark.');
    } finally {
      setRunningPhase5_1(false);
    }
  };

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
            type="button"
            onClick={loadBacktest}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors"
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
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 sm:p-6 backdrop-blur-sm">
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
        <div className="flex flex-wrap items-center gap-3 text-xs w-full sm:w-auto">
          <label className="flex flex-wrap items-center gap-2 text-slate-300 font-semibold w-full sm:w-auto">
            <span>{t.validation.competitionLabel}</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              disabled={leagues.length === 0}
              className="min-h-[44px] sm:min-h-[40px] w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 max-w-full sm:max-w-[260px] disabled:opacity-50"
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

          <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer min-h-[44px] sm:min-h-[40px]">
            <input
              type="checkbox"
              checked={fullSeason}
              onChange={(e) => setFullSeason(e.target.checked)}
              disabled={leagues.length === 0}
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
            />
            <span>{t.validation.fullSeasonScope}</span>
          </label>

          <button
            type="button"
            onClick={handleRunPhase4Benchmark}
            disabled={runningPhase4 || leagues.length === 0}
            className="min-h-[44px] sm:min-h-[42px] w-full sm:w-auto justify-center px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
          >
            <GitCompare className="w-3.5 h-3.5 shrink-0" />
            <span>
              {runningPhase4
                ? language === 'ar'
                  ? 'جارٍ تشغيل مقارنة Phase 4...'
                  : 'Running Phase 3 vs Phase 4...'
                : language === 'ar'
                ? 'تشغيل مقارنة Phase 3 مقابل Phase 4'
                : 'Compare Phase 3 Frozen vs Phase 4 Exp'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunPhase5Benchmark}
            disabled={runningPhase5 || leagues.length === 0}
            className="min-h-[44px] sm:min-h-[42px] w-full sm:w-auto justify-center px-3.5 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
          >
            <GitCompare className="w-3.5 h-3.5 shrink-0" />
            <span>
              {runningPhase5
                ? language === 'ar'
                  ? 'جارٍ تشغيل أبحاث Phase 5...'
                  : 'Running Phase 5 Research...'
                : language === 'ar'
                ? 'أبحاث Phase 5 (تجريبي)'
                : 'Phase 5 Research (EXP)'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunPhase5_1Benchmark}
            disabled={runningPhase5_1 || leagues.length === 0}
            className="min-h-[44px] sm:min-h-[42px] w-full sm:w-auto justify-center px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
          >
            <GitCompare className="w-3.5 h-3.5 shrink-0" />
            <span>
              {runningPhase5_1
                ? language === 'ar'
                  ? 'جارٍ تشغيل أبحاث Phase 5.1...'
                  : 'Running Phase 5.1...'
                : 'Phase 5.1 — EXP'}
            </span>
          </button>
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

      {/* Paired Phase 3 vs Phase 4 Chronological Comparison Panel */}
      {phase4Error && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 text-xs text-amber-200">
          {phase4Error}
        </div>
      )}

      {phase4Comparison && (
        <div className="bg-slate-900/90 border border-emerald-700/60 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-emerald-400" />
                {language === 'ar'
                  ? `مقارنة زمنية مقترنة: ${phase4Comparison.datasetName}`
                  : `Paired Chronological Benchmark: ${phase4Comparison.datasetName}`}
              </h2>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5" dir="ltr">
                {phase4Comparison.experimentMetadata.experimentId} · {phase4Comparison.evaluationWindow} · Leakage Violations: {phase4Comparison.leakageChecks.futureDataViolations} · Status: {phase4Comparison.causalityStatus}
              </p>
            </div>
            <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 px-2.5 py-1 rounded self-start">
              N={phase4Comparison.phase3.totalFixtures}
            </span>
          </div>

          {/* Mobile Cards + Desktop Table for Side-by-Side Phase 3 vs Phase 4 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
            {[
              {
                label: 'Coverage / Tested',
                p3: `${fmtPct(phase4Comparison.phase3.coveragePct)} (n=${phase4Comparison.phase3.evaluatedMatches})`,
                p4: `${fmtPct(phase4Comparison.phase4.coveragePct)} (n=${phase4Comparison.phase4.evaluatedMatches})`,
              },
              {
                label: '1X2 Accuracy',
                p3: `${fmtPct(phase4Comparison.phase3.oneXTwo.accuracy)} (n=${phase4Comparison.phase3.oneXTwo.sampleSize})`,
                p4: `${fmtPct(phase4Comparison.phase4.oneXTwo.accuracy)} (n=${phase4Comparison.phase4.oneXTwo.sampleSize})`,
              },
              {
                label: '1X2 Brier / LogLoss',
                p3: `${fmtNum(phase4Comparison.phase3.oneXTwo.brier)} / ${fmtNum(phase4Comparison.phase3.oneXTwo.logLoss)}`,
                p4: `${fmtNum(phase4Comparison.phase4.oneXTwo.brier)} / ${fmtNum(phase4Comparison.phase4.oneXTwo.logLoss)}`,
              },
              {
                label: '1X2 ECE Calibrated',
                p3: `${fmtPct(phase4Comparison.phase3.oneXTwo.meanEceCalibrated)}`,
                p4: `${fmtPct(phase4Comparison.phase4.oneXTwo.meanEceCalibrated)}`,
              },
              {
                label: 'Draw F1 (P / R)',
                p3: `${fmtPct(phase4Comparison.phase3.draw.f1)} (${fmtPct(phase4Comparison.phase3.draw.precision)}/${fmtPct(phase4Comparison.phase3.draw.recall)})`,
                p4: `${fmtPct(phase4Comparison.phase4.draw.f1)} (${fmtPct(phase4Comparison.phase4.draw.precision)}/${fmtPct(phase4Comparison.phase4.draw.recall)})`,
              },
              {
                label: 'Draw Brier / LogLoss',
                p3: `${fmtNum(phase4Comparison.phase3.draw.brier)} / ${fmtNum(phase4Comparison.phase3.draw.logLoss)}`,
                p4: `${fmtNum(phase4Comparison.phase4.draw.brier)} / ${fmtNum(phase4Comparison.phase4.draw.logLoss)}`,
              },
              {
                label: 'Double Chance Acc',
                p3: `${fmtPct(phase4Comparison.phase3.doubleChance.accuracy)} (n=${phase4Comparison.phase3.doubleChance.sampleSize})`,
                p4: `${fmtPct(phase4Comparison.phase4.doubleChance.accuracy)} (n=${phase4Comparison.phase4.doubleChance.sampleSize})`,
              },
              {
                label: 'Over 1.5 Acc / Brier',
                p3: `${fmtPct(phase4Comparison.phase3.over15.accuracy)} / ${fmtNum(phase4Comparison.phase3.over15.brier)} (n=${phase4Comparison.phase3.over15.evaluatedCount})`,
                p4: `${fmtPct(phase4Comparison.phase4.over15.accuracy)} / ${fmtNum(phase4Comparison.phase4.over15.brier)} (n=${phase4Comparison.phase4.over15.evaluatedCount})`,
              },
              {
                label: 'Over 2.5 Acc / Brier',
                p3: `${fmtPct(phase4Comparison.phase3.over25.accuracy)} / ${fmtNum(phase4Comparison.phase3.over25.brier)} (n=${phase4Comparison.phase3.over25.evaluatedCount})`,
                p4: `${fmtPct(phase4Comparison.phase4.over25.accuracy)} / ${fmtNum(phase4Comparison.phase4.over25.brier)} (n=${phase4Comparison.phase4.over25.evaluatedCount})`,
              },
              {
                label: 'BTTS Acc / Brier',
                p3: `${fmtPct(phase4Comparison.phase3.btts.accuracy)} / ${fmtNum(phase4Comparison.phase3.btts.brier)} (n=${phase4Comparison.phase3.btts.evaluatedCount})`,
                p4: `${fmtPct(phase4Comparison.phase4.btts.accuracy)} / ${fmtNum(phase4Comparison.phase4.btts.brier)} (n=${phase4Comparison.phase4.btts.evaluatedCount})`,
              },
              {
                label: 'Goals MAE / RMSE',
                p3: `${fmtNum(phase4Comparison.phase3.goalsProjection.totalGoalsMAE)} / ${fmtNum(phase4Comparison.phase3.goalsProjection.totalGoalsRMSE)}`,
                p4: `${fmtNum(phase4Comparison.phase4.goalsProjection.totalGoalsMAE)} / ${fmtNum(phase4Comparison.phase4.goalsProjection.totalGoalsRMSE)}`,
              },
              {
                label: 'Pred H/A Goals Mean',
                p3: `${fmtNum(phase4Comparison.phase3.goalsProjection.predictedHomeMean)} / ${fmtNum(phase4Comparison.phase3.goalsProjection.predictedAwayMean)}`,
                p4: `${fmtNum(phase4Comparison.phase4.goalsProjection.predictedHomeMean)} / ${fmtNum(phase4Comparison.phase4.goalsProjection.predictedAwayMean)}`,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 space-y-1.5"
                dir="ltr"
              >
                <div className="text-[10px] text-slate-400 uppercase font-semibold">{row.label}</div>
                <div className="text-[11px] text-emerald-300">
                  P3 Frozen: <strong className="text-white">{row.p3}</strong>
                </div>
                <div className="text-[11px] text-cyan-300">
                  P4 Exp: <strong className="text-white">{row.p4}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Experimental Phase 5 Research Benchmark Panel */}
      {phase5Error && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 text-xs text-amber-200">
          {phase5Error}
        </div>
      )}

      {phase5Report && (
        <div className="bg-slate-900/90 border border-violet-700/60 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-violet-950/70 text-violet-300 border border-violet-700/70">
                  EXPERIMENTAL
                </span>
                <h2 className="text-sm font-bold text-white">
                  {language === 'ar'
                    ? `أبحاث Phase 5: ${phase5Report.datasetName}`
                    : `Phase 5 Research Benchmark: ${phase5Report.datasetName}`}
                </h2>
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-1" dir="ltr">
                {phase5Report.dateRange} · Future/Same-TS/Post-Kickoff Violations:{' '}
                {phase5Report.leakageCheck.futureDataViolations +
                  phase5Report.leakageCheck.sameTimestampViolations +
                  phase5Report.leakageCheck.postKickoffViolations}{' '}
                · Causal Check: {phase5Report.leakageCheck.verified ? 'VERIFIED ZERO LEAKAGE' : 'ALERT'}
              </p>
            </div>
            <span className="text-[11px] font-mono text-violet-300 bg-violet-950/50 border border-violet-800/60 px-2.5 py-1 rounded self-start">
              N={phase5Report.totalFixtures}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono" dir="ltr">
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">1X2 Paired Comparison</div>
              <div className="text-slate-300">Emp Base: {fmtPct(phase5Report.baselines.oneXTwoEmpiricalLeague.accuracyPct)} · Brier {fmtNum(phase5Report.baselines.oneXTwoEmpiricalLeague.brier)}</div>
              <div className="text-emerald-300">P3 Frozen: {fmtPct(phase5Report.models.phase3Frozen.oneXTwo.accuracyPct)} · LL {fmtNum(phase5Report.models.phase3Frozen.oneXTwo.logLoss)} · TailECE {fmtPct(phase5Report.models.phase3Frozen.oneXTwo.tailEcePct)}</div>
              <div className="text-cyan-300">P4 Exp: {fmtPct(phase5Report.models.phase4Experimental.oneXTwo.accuracyPct)} · LL {fmtNum(phase5Report.models.phase4Experimental.oneXTwo.logLoss)}</div>
              <div className="text-violet-300">P5 Exp: <strong className="text-white">{fmtPct(phase5Report.models.phase5Experimental.oneXTwo.accuracyPct)}</strong> · LL {fmtNum(phase5Report.models.phase5Experimental.oneXTwo.logLoss)} · TailECE {fmtPct(phase5Report.models.phase5Experimental.oneXTwo.tailEcePct)}</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Draw Signal & Calibration</div>
              <div className="text-slate-300">Emp Prior: Brier {fmtNum(phase5Report.baselines.drawEmpiricalPrior.brier)} · LL {fmtNum(phase5Report.baselines.drawEmpiricalPrior.logLoss)}</div>
              <div className="text-emerald-300">P3 Frozen: Pred {fmtPct(phase5Report.models.phase3Frozen.drawSignal.predictedMeanProbPct)} · LL {fmtNum(phase5Report.models.phase3Frozen.drawSignal.logLoss)}</div>
              <div className="text-cyan-300">P4 Exp: Pred {fmtPct(phase5Report.models.phase4Experimental.drawSignal.predictedMeanProbPct)} · LL {fmtNum(phase5Report.models.phase4Experimental.drawSignal.logLoss)}</div>
              <div className="text-violet-300">P5 Exp: Pred {fmtPct(phase5Report.models.phase5Experimental.drawSignal.predictedMeanProbPct)} · LL <strong className="text-white">{fmtNum(phase5Report.models.phase5Experimental.drawSignal.logLoss)}</strong> · Flt Cov {fmtPct(phase5Report.models.phase5Experimental.drawFiltered.coveragePct)}</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Over 2.5 Variants (A-D)</div>
              <div className="text-slate-300">Maj Class: {fmtPct(phase5Report.baselines.over25MajorityClass.accuracyPct)} · Emp LL {fmtNum(phase5Report.baselines.over25EmpiricalPrior.logLoss)}</div>
              <div className="text-emerald-300">Var A (Pois): {fmtPct(phase5Report.o25Variants.variantA_PoissonDC.accuracyPct)} · LL {fmtNum(phase5Report.o25Variants.variantA_PoissonDC.logLoss)}</div>
              <div className="text-cyan-300">Var B (NB) / C (Shrunk): LL {fmtNum(phase5Report.o25Variants.variantB_NegBin.logLoss)} / {fmtNum(phase5Report.o25Variants.variantC_Shrunk.logLoss)}</div>
              <div className="text-violet-300">Var D (Cal, n={phase5Report.o25Variants.variantD_Calibrated.sampleSize}): <strong className="text-white">{fmtPct(phase5Report.o25Variants.variantD_Calibrated.accuracyPct)}</strong> · LL {fmtNum(phase5Report.o25Variants.variantD_Calibrated.logLoss)}</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">BTTS Variants (A-D)</div>
              <div className="text-slate-300">Maj Class: {fmtPct(phase5Report.baselines.bttsMajorityClass.accuracyPct)} · Emp LL {fmtNum(phase5Report.baselines.bttsEmpiricalPrior.logLoss)}</div>
              <div className="text-emerald-300">Var A (Exist): {fmtPct(phase5Report.bttsVariants.variantA_Existing.accuracyPct)} · LL {fmtNum(phase5Report.bttsVariants.variantA_Existing.logLoss)}</div>
              <div className="text-cyan-300">Var B (Indep) / C (NB): LL {fmtNum(phase5Report.bttsVariants.variantB_Independent.logLoss)} / {fmtNum(phase5Report.bttsVariants.variantC_NegBin.logLoss)}</div>
              <div className="text-violet-300">Var D (Cal, n={phase5Report.bttsVariants.variantD_Calibrated.sampleSize}): <strong className="text-white">{fmtPct(phase5Report.bttsVariants.variantD_Calibrated.accuracyPct)}</strong> · LL {fmtNum(phase5Report.bttsVariants.variantD_Calibrated.logLoss)}</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Binary Calibration Audit</div>
              <div className="text-slate-300">O2.5 Raw/Temp/Beta/Iso: {fmtNum(phase5Report.calibrationAudit.over25.rawLogLoss)} / {fmtNum(phase5Report.calibrationAudit.over25.tempLogLoss)} / {fmtNum(phase5Report.calibrationAudit.over25.betaLogLoss)} / {fmtNum(phase5Report.calibrationAudit.over25.isotonicLogLoss)}</div>
              <div className="text-slate-300">BTTS Raw/Temp/Beta/Iso: {fmtNum(phase5Report.calibrationAudit.btts.rawLogLoss)} / {fmtNum(phase5Report.calibrationAudit.btts.tempLogLoss)} / {fmtNum(phase5Report.calibrationAudit.btts.betaLogLoss)} / {fmtNum(phase5Report.calibrationAudit.btts.isotonicLogLoss)}</div>
              <div className="text-violet-300">Draw Raw/Temp/Beta/Iso: {fmtNum(phase5Report.calibrationAudit.draw.rawLogLoss)} / {fmtNum(phase5Report.calibrationAudit.draw.tempLogLoss)} / {fmtNum(phase5Report.calibrationAudit.draw.betaLogLoss)} / {fmtNum(phase5Report.calibrationAudit.draw.isotonicLogLoss)}</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Selective Market Coverage & Goals</div>
              <div className="text-slate-300">Filtered Cov: 1X2 {fmtPct(phase5Report.models.phase5Experimental.oneXTwoFiltered.coveragePct)} · Draw {fmtPct(phase5Report.models.phase5Experimental.drawFiltered.coveragePct)} · O2.5 {fmtPct(phase5Report.models.phase5Experimental.over25Filtered.coveragePct)}</div>
              <div className="text-emerald-300">P3 Goals MAE/RMSE: {fmtNum(phase5Report.models.phase3Frozen.goals.mae)} / {fmtNum(phase5Report.models.phase3Frozen.goals.rmse)}</div>
              <div className="text-violet-300">P5 Goals MAE/RMSE: {fmtNum(phase5Report.models.phase5Experimental.goals.mae)} / {fmtNum(phase5Report.models.phase5Experimental.goals.rmse)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Experimental Phase 5.1 Research Benchmark Panel */}
      {phase5_1Error && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 text-xs text-amber-200">
          {phase5_1Error}
        </div>
      )}

      {phase5_1Report && (
        <div className="bg-slate-900/90 border border-sky-700/60 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-700/70">
                  EXPERIMENTAL
                </span>
                <h2 className="text-sm font-bold text-white">
                  {language === 'ar'
                    ? `أبحاث Phase 5.1: ${phase5_1Report.datasetName}`
                    : `Phase 5.1 — EXP Benchmark: ${phase5_1Report.datasetName}`}
                </h2>
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-1" dir="ltr">
                {phase5_1Report.dateRange} · 8-Check Leakage:{' '}
                {phase5_1Report.leakageCheck.verified ? '0 VIOLATIONS (VERIFIED)' : 'ALERT'}
              </p>
            </div>
            <span className="text-[11px] font-mono text-sky-300 bg-sky-950/50 border border-sky-800/60 px-2.5 py-1 rounded self-start">
              N={phase5_1Report.totalFixtures}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono" dir="ltr">
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-sky-300 uppercase font-semibold">1X2 Calibration (A–D)</div>
              <div className="text-slate-300">
                A(P5): Acc {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.A_existingCalibration.accuracyPct)} · ECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.A_existingCalibration.ecePct)} · TailECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.A_existingCalibration.tailEcePct)}
              </div>
              <div className="text-slate-300">
                B(Temp): Acc {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.B_temperatureScaling.accuracyPct)} · ECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.B_temperatureScaling.ecePct)} · TailECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.B_temperatureScaling.tailEcePct)}
              </div>
              <div className="text-slate-300">
                C(Beta): Acc {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.C_betaCalibration.accuracyPct)} · ECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.C_betaCalibration.ecePct)} · TailECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.C_betaCalibration.tailEcePct)}
              </div>
              <div className="text-white font-bold">
                D(Tail): Acc {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.D_tailShrinkage.accuracyPct)} · LL {fmtNum(phase5_1Report.oneXTwo.phase5_1Approaches.D_tailShrinkage.logLoss)} · ECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.D_tailShrinkage.ecePct)} · TailECE {fmtPct(phase5_1Report.oneXTwo.phase5_1Approaches.D_tailShrinkage.tailEcePct)}
              </div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-emerald-300 uppercase font-semibold">Draw Variants (A–D)</div>
              <div className="text-slate-300">
                A(P5): F1 {fmtPct(phase5_1Report.draw.variants.variantA_phase5.f1Pct)} · LL {fmtNum(phase5_1Report.draw.variants.variantA_phase5.logLoss)}
              </div>
              <div className="text-slate-300">
                B(Pois+Prior): F1 {fmtPct(phase5_1Report.draw.variants.variantB_poissonPrior.f1Pct)} · LL {fmtNum(phase5_1Report.draw.variants.variantB_poissonPrior.logLoss)}
              </div>
              <div className="text-slate-300">
                C(Sym, n={phase5_1Report.draw.variants.variantC_strengthSymmetry.sampleSize}): F1 {fmtPct(phase5_1Report.draw.variants.variantC_strengthSymmetry.f1Pct)} · LL {fmtNum(phase5_1Report.draw.variants.variantC_strengthSymmetry.logLoss)}
              </div>
              <div className="text-white font-bold">
                D(Ens, n={phase5_1Report.draw.variants.variantD_causalEnsemble.sampleSize}): F1 {fmtPct(phase5_1Report.draw.variants.variantD_causalEnsemble.f1Pct)} · LL {fmtNum(phase5_1Report.draw.variants.variantD_causalEnsemble.logLoss)}
              </div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="text-[10px] text-amber-300 uppercase font-semibold">Draw Threshold Comparison</div>
              <div className="text-slate-300">
                Argmax: P {fmtPct(phase5_1Report.draw.thresholdComparison.defaultArgmax.precisionPct)} / R {fmtPct(phase5_1Report.draw.thresholdComparison.defaultArgmax.recallPct)} / F1 {fmtPct(phase5_1Report.draw.thresholdComparison.defaultArgmax.f1Pct)}
              </div>
              <div className="text-slate-300">
                Fixed 28.5%: P {fmtPct(phase5_1Report.draw.thresholdComparison.fixedThreshold285.precisionPct)} / R {fmtPct(phase5_1Report.draw.thresholdComparison.fixedThreshold285.recallPct)} / F1 {fmtPct(phase5_1Report.draw.thresholdComparison.fixedThreshold285.f1Pct)}
              </div>
              <div className="text-white font-bold">
                Causal ({fmtPct(phase5_1Report.draw.thresholdComparison.causalLearnedThreshold.meanThresholdPct)}): P {fmtPct(phase5_1Report.draw.thresholdComparison.causalLearnedThreshold.precisionPct)} / R {fmtPct(phase5_1Report.draw.thresholdComparison.causalLearnedThreshold.recallPct)} / F1 {fmtPct(phase5_1Report.draw.thresholdComparison.causalLearnedThreshold.f1Pct)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Research Target Tracking Banner */}
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

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-center w-full md:w-auto md:min-w-[190px] shrink-0">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs">{t.validation.kpiBrierTitle}</span>
            <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="font-mono text-lg sm:text-2xl font-bold text-white" dir="ltr">
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
            <BarChart3 className="w-4 h-4 text-blue-400 shrink-0" />
          </div>
          <div className="font-mono text-lg sm:text-2xl font-bold text-white" dir="ltr">
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
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="font-mono text-base sm:text-xl font-bold text-emerald-400">
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
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              {t.validation.tableTitle}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {t.validation.tableDesc}
            </p>
          </div>

          {/* Mobile Stacked Cards (320px-767px) */}
          <div className="md:hidden space-y-2.5">
            {backtestRun.marketResults.map((m) => (
              <div
                key={m.marketKey}
                className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 space-y-2 text-xs font-mono"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        m.isTargetCategory ? 'bg-emerald-400' : 'bg-slate-500'
                      }`}
                    />
                    <span className="font-semibold text-slate-200 truncate">
                      {translateMarketKey(m.marketKey, m.marketLabel, language)}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded font-bold shrink-0 ${
                      m.accuracyPercentage >= 80
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                        : 'text-slate-200 bg-slate-900 border border-slate-800'
                    }`}
                    dir="ltr"
                  >
                    {m.accuracyPercentage.toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-800/60 text-[11px]" dir="ltr">
                  <div>
                    <span className="text-slate-500 block">{t.validation.colTested}</span>
                    <span className="text-slate-200 font-semibold">{m.totalPredictions}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">{t.validation.colBrier}</span>
                    <span className="text-slate-200 font-semibold">{m.brierScore.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">{t.validation.colAdvantage}</span>
                    <span
                      className={`font-bold ${
                        m.baselineComparison.accuracyAdvantage >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {m.baselineComparison.accuracyAdvantage >= 0 ? '+' : ''}
                      {m.baselineComparison.accuracyAdvantage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
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
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 font-mono">
                    <span className="text-slate-300 font-semibold" dir="ltr">{bin.binRange}</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
