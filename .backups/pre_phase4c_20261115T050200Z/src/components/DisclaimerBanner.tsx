import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  compact?: boolean;
}

export const DisclaimerBanner: React.FC<Props> = ({ compact = false }) => {
  const { t } = useLanguage();
  return (
    <div className={`w-full bg-slate-900/80 border border-slate-800 text-slate-300 ${compact ? 'py-2 px-4 text-xs' : 'p-3.5 text-xs sm:text-sm'} rounded-lg flex items-start gap-3`}>
      <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
      <div className="flex-1 text-slate-300 leading-relaxed">
        <span className="font-semibold text-slate-100">{t.disclaimer.title}</span>{' '}
        {t.disclaimer.bodyBeforeStrong}{' '}
        <strong className="text-emerald-400/90 font-medium">{t.disclaimer.strongText}</strong>{' '}
        {t.disclaimer.bodyAfterStrong}
      </div>
    </div>
  );
};
