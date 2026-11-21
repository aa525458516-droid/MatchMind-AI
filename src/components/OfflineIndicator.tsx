import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useLanguage } from '../i18n/LanguageContext';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { language } = useLanguage();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-950/90 border-b border-amber-800/80 text-amber-200 px-4 py-2 text-xs font-medium"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-center">
        <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          {language === 'ar'
            ? 'غير متصل بالإنترنت — بيانات المباريات المباشرة غير متاحة. يتم عرض البيانات المخزنة فقط عند توفرها.'
            : 'Offline — live match data unavailable. Only cached historical/offline views remain accessible.'}
        </span>
      </div>
    </div>
  );
};
