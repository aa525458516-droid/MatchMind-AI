import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  results: Array<'W' | 'D' | 'L'>;
  size?: 'sm' | 'md';
}

export const FormBadge: React.FC<Props> = ({ results, size = 'sm' }) => {
  const { t, language } = useLanguage();

  const getStyle = (r: 'W' | 'D' | 'L') => {
    switch (r) {
      case 'W':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      case 'D':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'L':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
    }
  };

  const getShortLabel = (r: 'W' | 'D' | 'L') => {
    switch (r) {
      case 'W':
        return t.common.winShort;
      case 'D':
        return t.common.drawShort;
      case 'L':
        return t.common.lossShort;
    }
  };

  const getFullLabel = (r: 'W' | 'D' | 'L') => {
    switch (r) {
      case 'W':
        return t.common.winFull;
      case 'D':
        return t.common.drawFull;
      case 'L':
        return t.common.lossFull;
    }
  };

  const dim = size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs';

  return (
    <div className="flex items-center gap-1 font-mono font-bold">
      {results.slice(-5).map((r, i) => (
        <span
          key={i}
          className={`${dim} rounded flex items-center justify-center border ${getStyle(r)}`}
          title={
            language === 'ar'
              ? `المباراة ${i + 1}: ${getFullLabel(r)}`
              : `Match ${i + 1}: ${getFullLabel(r)}`
          }
        >
          {getShortLabel(r)}
        </span>
      ))}
    </div>
  );
};
