/**
 * Multi-Model Comparison & 4-Pillar Smart Confidence Card
 * Supports both Frozen Phase 3 baseline and Experimental Phase 4 ensemble weights/evaluations.
 * Mobile-first: displays stacked model cards below `md` and a clean comparison table on desktop.
 */

import React from 'react';
import {
  Layers,
  Scale,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { Prediction, Match } from '../types/football';
import { Phase4Prediction } from '../phase4/phase4Types';
import { useLanguage } from '../i18n/LanguageContext';
import {
  translateModelName,
  translateProviderMessage,
  translateTargetTier,
} from '../i18n/translations';

interface Props {
  match: Match;
  prediction: Prediction;
  phase4Prediction?: Phase4Prediction | null;
}

export const ModelComparisonCard: React.FC<Props> = ({
  match,
  prediction,
  phase4Prediction,
}) => {
  const { t, language, formatDateTime } = useLanguage();
  const pillars = prediction.confidencePillars;
  const evals =
    phase4Prediction && phase4Prediction.ensemble.evaluations.length > 0
      ? phase4Prediction.ensemble.evaluations
      : prediction.modelEvaluations || [];

  const isAbstain =
    prediction.modelType === 'ABSTAIN' ||
    prediction.confidence === null ||
    pillars?.decision.startsWith('ABSTAIN');
  const cachedOrRetrieved =
    prediction.provenance?.cachedAt || prediction.provenance?.retrievedAt || prediction.provenance?.timestamp;

  const rawAbstainReason = prediction.abstainReason || pillars?.abstainReason;
  const weights = phase4Prediction?.ensemble.weights;

  const weightForEngine = (modelName: string): string | null => {
    if (!weights) return null;
    if (modelName === 'Poisson') return `${(weights.poisson * 100).toFixed(0)}%`;
    if (modelName === 'Dixon-Coles') return `${(weights.dixonColes * 100).toFixed(0)}%`;
    if (modelName === 'Elo') return `${(weights.elo * 100).toFixed(0)}%`;
    if (modelName === 'Monte Carlo') return `${(weights.monteCarlo * 100).toFixed(0)}%`;
    if (modelName === 'xG Regression') return `${(weights.variantBNegBin * 100).toFixed(0)}%`;
    return null;
  };

  return (
    <div className="space-y-6">
      {/* 4-Pillar Smart Confidence & Abstention Status Panel */}
      <div
        className={`rounded-xl p-4 sm:p-5 border transition-all ${
          isAbstain
            ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
            : pillars?.decision === 'RECOMMENDED_ANALYSIS'
            ? 'bg-emerald-950/20 border-emerald-500/50 text-slate-100'
            : 'bg-slate-900/80 border-slate-800 text-slate-100'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/70">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Scale className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                {t.modelComparison.title}
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              {t.modelComparison.desc}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-mono text-slate-400">
              <span>
                {t.common.calculatedAt}: <strong className="text-slate-200">{formatDateTime(prediction.calculatedAt)}</strong>
              </span>
              {cachedOrRetrieved && (
                <span>
                  · {t.common.dataLabel} {prediction.provenance?.cached ? t.common.cached : t.common.retrieved}:{' '}
                  <strong className="text-slate-300">{formatDateTime(cachedOrRetrieved)}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAbstain ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-900/60 border border-rose-700/80 text-rose-200 text-xs font-mono font-bold">
                <ShieldAlert className="w-3.5 h-3.5" />
                {t.modelComparison.systemAbstain}
              </span>
            ) : pillars?.decision === 'RECOMMENDED_ANALYSIS' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-900/60 border border-emerald-600/80 text-emerald-200 text-xs font-mono font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.modelComparison.highConviction}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono font-medium">
                {t.modelComparison.moderateSignal}
              </span>
            )}
          </div>
        </div>

        {/* Abstention Explanation if active */}
        {isAbstain && (
          <div className="mt-3 p-3 rounded-lg bg-rose-950/60 border border-rose-800/60 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-rose-100">
                {t.common.abstainDefaultMessage}
              </strong>
              {rawAbstainReason && (
                <p className="mt-1 text-rose-200/90">
                  {translateProviderMessage(rawAbstainReason, language)}
                </p>
              )}
              <span className="block text-[11px] text-rose-300/80 mt-0.5">
                {t.modelComparison.abstainPolicyNote}
              </span>
            </div>
          </div>
        )}

        {/* The 4 Distinct Pillars Display */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">
              {t.modelComparison.pillar1Title}
            </span>
            <div className="font-mono text-xl font-bold text-white tabular-nums" dir="ltr">
              {pillars?.modelProbability !== null && pillars?.modelProbability !== undefined
                ? `${pillars.modelProbability.toFixed(1)}%`
                : t.common.na}
            </div>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {t.modelComparison.pillar1Sub}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">
              {t.modelComparison.pillar2Title}
            </span>
            <div className="font-mono text-lg font-bold text-emerald-400 tabular-nums">
              {pillars?.historicalAccuracy !== null && pillars?.historicalAccuracy !== undefined
                ? `${pillars.historicalAccuracy.toFixed(1)}%`
                : t.modelComparison.unavailableText}
            </div>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {pillars?.historicalAccuracy !== null && pillars?.historicalAccuracy !== undefined
                ? t.modelComparison.pillar2SubVerified
                : t.modelComparison.pillar2SubUnavailable}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">
              {t.modelComparison.pillar3Title}
            </span>
            <div className="font-mono text-xl font-bold text-cyan-400 tabular-nums" dir="ltr">
              {pillars?.dataReliability !== null && pillars?.dataReliability !== undefined
                ? `${pillars.dataReliability}%`
                : t.common.na}
            </div>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {t.modelComparison.pillar3Sub}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">
              {t.modelComparison.pillar4Title}
            </span>
            <div className="font-mono text-xl font-bold text-blue-400 tabular-nums" dir="ltr">
              {pillars?.modelAgreement !== null && pillars?.modelAgreement !== undefined
                ? `${pillars.modelAgreement}%`
                : t.common.na}
            </div>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {t.modelComparison.pillar4Sub}
            </span>
          </div>
        </div>

        {pillars?.targetCategoryTier && (
          <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs gap-2">
            <span className="text-slate-400">{t.modelComparison.signalClassification}</span>
            <span className="font-mono font-bold text-emerald-400 text-end">
              {translateTargetTier(pillars.targetCategoryTier, language)}
            </span>
          </div>
        )}
      </div>

      {/* Multi-Model Comparative Breakdown (Responsive Mobile Cards + Desktop Table) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              {t.modelComparison.tableTitle}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t.modelComparison.tableDesc}
            </p>
          </div>
          {weights && (
            <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/60 rounded-lg px-2.5 py-1 self-start">
              {weights.isUniformFallback
                ? language === 'ar'
                  ? `أوزان متساوية (العينات السابقة: ${weights.learnedFromSamples})`
                  : `Uniform Prior (${weights.learnedFromSamples} priors)`
                : language === 'ar'
                ? `أوزان سببية متعلمة (${weights.learnedFromSamples} عينة)`
                : `Causal Hedge Weights (${weights.learnedFromSamples} priors)`}
            </div>
          )}
        </div>

        {evals.length === 0 ? (
          <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-400 text-center">
            {t.modelComparison.noModelTable}
          </div>
        ) : (
          <>
            {/* Mobile Cards View */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {evals.map((m) => {
                const w = weightForEngine(m.modelName);
                const engineTitle =
                  m.modelName === 'xG Regression' && phase4Prediction
                    ? language === 'ar'
                      ? 'توزيع سلبي ثنائي الحدين Variant-B'
                      : 'Variant-B Negative Binomial'
                    : translateModelName(m.modelName, language);
                return (
                  <div
                    key={m.modelName}
                    className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-white">{engineTitle}</span>
                      {w && (
                        <span className="font-mono text-[11px] text-emerald-400" dir="ltr">
                          w={w}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-center font-mono text-[11px]" dir="ltr">
                      <div className="bg-slate-900 rounded p-1.5">
                        <span className="block text-[9px] text-slate-500">1</span>
                        <span className="font-bold text-blue-400">{m.homeWinProb.toFixed(1)}%</span>
                      </div>
                      <div className="bg-slate-900 rounded p-1.5">
                        <span className="block text-[9px] text-slate-500">X</span>
                        <span className="font-bold text-slate-200">{m.drawProb.toFixed(1)}%</span>
                      </div>
                      <div className="bg-slate-900 rounded p-1.5">
                        <span className="block text-[9px] text-slate-500">2</span>
                        <span className="font-bold text-cyan-400">{m.awayWinProb.toFixed(1)}%</span>
                      </div>
                      <div className="bg-slate-900 rounded p-1.5">
                        <span className="block text-[9px] text-slate-500">O2.5</span>
                        <span className="font-bold text-emerald-400">{m.over25Prob.toFixed(1)}%</span>
                      </div>
                      <div className="bg-slate-900 rounded p-1.5">
                        <span className="block text-[9px] text-slate-500">BTTS</span>
                        <span className="font-bold text-slate-200">{m.bttsProb.toFixed(1)}%</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {translateProviderMessage(m.notes, language)}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="pb-3 font-semibold text-start">{t.modelComparison.colEngine}</th>
                    <th className="pb-3 font-semibold text-center">{match.homeTeam.shortName} (1)</th>
                    <th className="pb-3 font-semibold text-center">{t.modelComparison.colDraw}</th>
                    <th className="pb-3 font-semibold text-center">{match.awayTeam.shortName} (2)</th>
                    <th className="pb-3 font-semibold text-center">{t.modelComparison.colOver25}</th>
                    <th className="pb-3 font-semibold text-center">{t.modelComparison.colBtts}</th>
                    {weights && (
                      <th className="pb-3 font-semibold text-center">
                        {language === 'ar' ? 'الوزن' : 'Weight'}
                      </th>
                    )}
                    <th className="pb-3 font-semibold text-end">{t.modelComparison.colNotes}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {evals.map((m) => {
                    const w = weightForEngine(m.modelName);
                    const engineTitle =
                      m.modelName === 'xG Regression' && phase4Prediction
                        ? language === 'ar'
                          ? 'سلبي ثنائي الحدين (Variant-B)'
                          : 'Variant-B Negative Binomial'
                        : translateModelName(m.modelName, language);
                    return (
                      <tr key={m.modelName} className="hover:bg-slate-950/40 transition-colors">
                        <td className="py-3 font-bold text-white flex items-center gap-2 text-start">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span>{engineTitle}</span>
                        </td>
                        <td className="py-3 text-center text-blue-400 tabular-nums" dir="ltr">
                          {m.homeWinProb.toFixed(1)}%
                        </td>
                        <td className="py-3 text-center text-slate-300 tabular-nums" dir="ltr">
                          {m.drawProb.toFixed(1)}%
                        </td>
                        <td className="py-3 text-center text-cyan-400 tabular-nums" dir="ltr">
                          {m.awayWinProb.toFixed(1)}%
                        </td>
                        <td className="py-3 text-center text-emerald-400 tabular-nums" dir="ltr">
                          {m.over25Prob.toFixed(1)}%
                        </td>
                        <td className="py-3 text-center text-slate-300 tabular-nums" dir="ltr">
                          {m.bttsProb.toFixed(1)}%
                        </td>
                        {weights && (
                          <td className="py-3 text-center text-emerald-300 tabular-nums" dir="ltr">
                            {w ?? '—'}
                          </td>
                        )}
                        <td className="py-3 text-end text-slate-400 text-[11px] font-sans">
                          {translateProviderMessage(m.notes, language)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/70 text-xs text-slate-400 flex items-start gap-2">
          <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-200">{t.modelComparison.scientificNoteLabel} </strong>
            {t.modelComparison.scientificNoteBody}
          </span>
        </div>
      </div>
    </div>
  );
};
