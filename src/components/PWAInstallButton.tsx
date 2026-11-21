import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useLanguage } from '../i18n/LanguageContext';

export const PWAInstallButton: React.FC = () => {
  const { canPrompt, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const { language } = useLanguage();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!canPrompt && !isIOS)) return null;

  const label = language === 'ar' ? 'تثبيت التطبيق' : 'Install App';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (canPrompt) {
            void promptInstall();
          } else if (isIOS) {
            setShowIOSGuide((v) => !v);
          }
        }}
        aria-label={label}
        className="min-h-[44px] min-w-[44px] md:min-w-0 md:min-h-[36px] px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-700/60 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
        title={label}
      >
        {isIOS ? <Share className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> : <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {showIOSGuide && isIOS && (
        <div className="absolute end-0 top-full mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 text-xs text-slate-200 z-50 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-emerald-400">
              {language === 'ar' ? 'تثبيت على iOS' : 'Install on iOS'}
            </span>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded hover:bg-slate-800 text-slate-400"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {language === 'ar'
              ? 'اضغط على أيقونة المشاركة (Share) في Safari ثم اختر "إضافة إلى الشاشة الرئيسية".'
              : 'Tap the Share button in Safari, then choose "Add to Home Screen" for full-screen mobile mode.'}
          </p>
        </div>
      )}
    </div>
  );
};
