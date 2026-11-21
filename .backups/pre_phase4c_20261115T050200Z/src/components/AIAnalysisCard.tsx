import React from 'react';
import { Brain, CheckCircle2, AlertTriangle, RefreshCw, Activity, Target, Database } from 'lucide-react';
import { AIAnalysis, Match } from '../types/football';
import { useLanguage } from '../i18n/LanguageContext';
import { translateConfidenceTier } from '../i18n/translations';

interface Props {
  match: Match;
  analysis: AIAnalysis | null;
  isLoading: boolean;
  errorMessage?: string | null;
  onRefresh: () => void;
}

export const AIAnalysisCard: React.FC<Props> = ({
  match,
  analysis,
  isLoading,
  errorMessage,
  onRefresh,
}) => {
  const { t, language } = useLanguage();

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 md:p-6 text-slate-100 shadow-xl backdrop-blur-sm relative overflow-hidden">
      {/* Background subtle pitch mesh glow */}
      <div className="absolute top-0 end-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -me-20 -mt-20" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800 relative z-10">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Brain className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold tracking-tight text-white">
              {t.aiCard.title}
            </h2>
            {analysis?.isLiveAnalysis ? (
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-700/50">
                {t.aiCard.liveBadge}
              </span>
            ) : (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {t.aiCard.awaitingBadge}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>{t.aiCard.subtitle}</span>
            <span>·</span>
            <span className="text-slate-500 font-mono">{t.aiCard.zeroHallucination}</span>
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? t.aiCard.synthesizingBtn : t.aiCard.runBtn}
        </button>
      </div>

      {isLoading ? (
        <div className="py-14 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mb-4" />
          <h3 className="text-sm font-semibold text-slate-200">
            {t.aiCard.loadingTitle}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            {t.aiCard.loadingDesc} {match.homeTeam.name} {t.common.vs} {match.awayTeam.name}.
          </p>
        </div>
      ) : errorMessage ? (
        /* Authentic Error / Offline State without fabricating fake AI text */
        <div className="py-8 space-y-4">
          <div className="bg-slate-950/70 border border-amber-800/60 rounded-lg p-4 text-xs text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="text-amber-100 font-semibold block">
                {t.aiCard.offlineTitle}
              </strong>
              <p className="text-slate-300 leading-relaxed">
                {errorMessage}
              </p>
              <p className="text-[11px] text-slate-400 pt-1">
                {t.aiCard.scientificIntegrityNote}
              </p>
            </div>
          </div>
        </div>
      ) : analysis ? (
        <div className="pt-5 space-y-6 relative z-10">
          {/* Executive Summary & Projected Scoreline Callout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-slate-950/50 border border-slate-800/80 rounded-lg p-4">
              <span className="text-xs font-semibold tracking-wider text-emerald-400 font-mono mb-1.5 block">
                {t.aiCard.execSummary}
              </span>
              <p className="text-sm text-slate-200 leading-relaxed">
                {analysis.summary}
              </p>
            </div>

            <div className="bg-slate-950/50 border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold tracking-wider text-slate-400 font-mono mb-1 block">
                  {t.aiCard.expectedScore}
                </span>
                <div className="font-mono text-2xl font-extrabold text-emerald-400 mt-1" dir="ltr">
                  {analysis.expectedScore}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">{t.aiCard.modelConfidence}</span>
                <span className="font-mono font-bold text-slate-100 flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      analysis.confidence === 'HIGH'
                        ? 'bg-emerald-400'
                        : analysis.confidence === 'MEDIUM'
                        ? 'bg-amber-400'
                        : 'bg-blue-400'
                    }`}
                  />
                  {translateConfidenceTier(analysis.confidence, language)}{' '}
                  {typeof analysis.confidenceScore === 'number' ? `(${analysis.confidenceScore}%)` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Key Influencing Factors */}
          <div>
            <h4 className="text-xs font-semibold tracking-wider text-slate-400 font-mono mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-emerald-400" />
              {t.aiCard.keyFactors}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {analysis.keyFactors.map((factor, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/30 border border-slate-800/70 rounded-lg p-3 text-xs text-slate-300 flex items-start gap-2.5"
                >
                  <span className="font-mono text-emerald-400/90 font-bold shrink-0" dir="ltr">
                    0{idx + 1}.
                  </span>
                  <span className="leading-relaxed">{factor}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths & Weaknesses Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Home Strengths & Weaknesses */}
            <div className="bg-slate-950/40 border border-slate-800/70 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-200 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span>{match.homeTeam.name} {t.aiCard.teamProfileSuffix}</span>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[11px] font-mono text-emerald-400 tracking-wide block mb-1">
                    {t.aiCard.keyStrengths}
                  </span>
                  <ul className="space-y-1 text-slate-300">
                    {analysis.strengths.home.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-2 border-t border-slate-800/50">
                  <span className="text-[11px] font-mono text-rose-400 tracking-wide block mb-1">
                    {t.aiCard.vulnerabilities}
                  </span>
                  <ul className="space-y-1 text-slate-400">
                    {analysis.weaknesses.home.map((w, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Away Strengths & Weaknesses */}
            <div className="bg-slate-950/40 border border-slate-800/70 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-200 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>{match.awayTeam.name} {t.aiCard.teamProfileSuffix}</span>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[11px] font-mono text-emerald-400 tracking-wide block mb-1">
                    {t.aiCard.keyStrengths}
                  </span>
                  <ul className="space-y-1 text-slate-300">
                    {analysis.strengths.away.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-2 border-t border-slate-800/50">
                  <span className="text-[11px] font-mono text-rose-400 tracking-wide block mb-1">
                    {t.aiCard.vulnerabilities}
                  </span>
                  <ul className="space-y-1 text-slate-400">
                    {analysis.weaknesses.away.map((w, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Tactical Explanation & In-depth Observations */}
          <div className="bg-slate-950/40 border border-slate-800/70 rounded-lg p-4">
            <h4 className="text-xs font-semibold tracking-wider text-slate-400 font-mono mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              {t.aiCard.tacticalRationale}
            </h4>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-3">
              {analysis.explanation}
            </p>
            {analysis.tacticalObservations && analysis.tacticalObservations.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                {analysis.tacticalObservations.map((obs, idx) => (
                  <div key={idx} className="text-xs text-slate-400 flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>{obs}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data Quality & Source Provenance Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800/60 rounded p-2.5 font-mono">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {t.aiCard.dataProvenanceLabel} {match.provenance?.source || t.modelComparison.unavailableText} ({match.provenance?.sampleSizeMatches ?? 0} {t.aiCard.matchesWord})
              </span>
            </div>
            <span className="text-slate-500">
              {t.aiCard.qualityScoreLabel}{' '}
              <span dir="ltr">
                {match.provenance?.qualityScore !== null && match.provenance?.qualityScore !== undefined
                  ? `${match.provenance.qualityScore}/100`
                  : t.common.na}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-slate-400 text-xs">
          {t.aiCard.emptyPrompt}
        </div>
      )}
    </div>
  );
};
