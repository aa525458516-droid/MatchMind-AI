import React from 'react';
import { ScorelineProbability } from '../types/football';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  scorelines: ScorelineProbability[];
}

export const ScorelineMatrix: React.FC<Props> = ({ scorelines }) => {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      {scorelines.slice(0, 6).map((item, idx) => {
        const isTop = idx === 0;
        return (
          <div
            key={item.score}
            className={`p-2.5 rounded-lg border text-center transition-all ${
              isTop
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="text-[11px] tracking-wider text-slate-400 mb-1 font-mono">
              {isTop ? t.scorelineMatrix.mostLikely : `${t.scorelineMatrix.outcomePrefix}${idx + 1}`}
            </div>
            <div className="font-mono text-base font-bold text-white tracking-tight" dir="ltr">
              {item.score}
            </div>
            <div className="font-mono text-xs text-emerald-400 mt-1 font-medium tabular-nums" dir="ltr">
              {item.probability.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
};
