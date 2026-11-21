import React from 'react';
import { DataProvenance, DataProviderType, MatchCategory } from '../types/football';
import { footballService } from '../services/footballDataService';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  className?: string;
  size?: 'sm' | 'md';
  provider?: DataProviderType;
  provenance?: DataProvenance | null;
  isDemo?: boolean;
  category?: MatchCategory;
  showTimestamp?: boolean;
}

export const DemoDataBadge: React.FC<Props> = ({
  className = '',
  provider,
  provenance,
  isDemo,
  category,
  showTimestamp = false,
}) => {
  const { t, formatTime } = useLanguage();
  const activeProvider = provider || footballService.getActiveProvider();
  const activeProvenance = provenance ?? footballService.getLastProvenance?.() ?? null;
  const effectiveTime = activeProvenance?.cachedAt || activeProvenance?.retrievedAt || activeProvenance?.timestamp;
  const cacheLabel = activeProvenance?.cached ? t.common.cached : t.common.fresh;

  let label = '';
  let dotClass = 'bg-slate-400';
  let badgeClass = 'text-slate-300 bg-slate-900 border-slate-700';
  let title = '';

  if (
    isDemo ||
    category === 'DEMO' ||
    activeProvenance?.sourceType === 'BENCHMARK_DEMO' ||
    (!provenance && !category && activeProvider === 'DEMO')
  ) {
    label = t.badge.demoLabel;
    dotClass = 'bg-amber-400';
    badgeClass = 'text-amber-400 bg-amber-950/40 border-amber-800/60';
    title = t.badge.demoTitle;
  } else if (
    category === 'LIVE_UPCOMING' ||
    activeProvenance?.sourceType === 'COMMUNITY_MAINTAINED' ||
    activeProvenance?.source?.includes('OpenLigaDB') ||
    (!provenance && !category && activeProvider === 'OPENLIGADB')
  ) {
    label = category === 'HISTORICAL' ? t.badge.openLigaHistorical : t.badge.openLigaLive;
    dotClass = category === 'HISTORICAL' ? 'bg-emerald-400' : 'bg-emerald-400 animate-pulse';
    badgeClass = 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60';
    title = `${t.badge.openLigaTitlePrefix} ${effectiveTime ? `${cacheLabel} ${t.badge.atTime} ${effectiveTime}` : ''}`;
  } else if (
    category === 'HISTORICAL' ||
    activeProvenance?.sourceType === 'RESEARCH_OPEN_DATA' ||
    activeProvenance?.source?.includes('StatsBomb') ||
    (!provenance && !category && activeProvider === 'STATSBOMB')
  ) {
    label = t.badge.statsBombLabel;
    dotClass = 'bg-cyan-400';
    badgeClass = 'text-cyan-400 bg-cyan-950/40 border-cyan-800/60';
    title = `${t.badge.statsBombTitlePrefix} ${effectiveTime ? `${cacheLabel} ${t.badge.atTime} ${effectiveTime}` : ''}`;
  } else {
    label = t.badge.unifiedLabel;
    dotClass = 'bg-emerald-400';
    badgeClass = 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60';
    title = t.badge.unifiedTitle;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono tracking-wider border px-2 py-0.5 rounded text-[11px] font-semibold ${badgeClass} ${className}`}
      title={title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span>{label}</span>
      {showTimestamp && effectiveTime && (
        <span className="text-[10px] opacity-80 font-normal normal-case border-s border-current/25 ps-1.5">
          {cacheLabel} {formatTime(effectiveTime)}
        </span>
      )}
    </span>
  );
};

export const DataSourceBadge = DemoDataBadge;
