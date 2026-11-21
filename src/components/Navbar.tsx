import React from 'react';
import { Activity, PlusCircle, Globe, ShieldCheck } from 'lucide-react';
import { DemoDataBadge } from './DemoDataBadge';
import { PWAInstallButton } from './PWAInstallButton';
import { DataProviderType } from '../types/football';
import { useLanguage } from '../i18n/LanguageContext';

export type NavTab = 'dashboard' | 'analysis' | 'predictions' | 'validation' | 'history' | 'settings';

interface Props {
  activeTab: NavTab;
  activeProvider?: DataProviderType;
  onSelectTab: (tab: NavTab) => void;
  onNewAnalysis?: () => void;
}

export const Navbar: React.FC<Props> = ({
  activeTab,
  activeProvider,
  onSelectTab,
  onNewAnalysis,
}) => {
  const { t, toggleLanguage } = useLanguage();

  const navItems: Array<{ id: NavTab; label: string }> = [
    { id: 'dashboard', label: t.nav.dashboard },
    { id: 'analysis', label: t.nav.analysis },
    { id: 'predictions', label: t.nav.predictions },
    { id: 'validation', label: t.nav.validation },
    { id: 'history', label: t.nav.history },
    { id: 'settings', label: t.nav.settings },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#0a0f1d]/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 lg:gap-6 h-12 md:h-16">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <button
              type="button"
              onClick={() => onSelectTab('dashboard')}
              className="min-h-[44px] flex items-center gap-1.5 sm:gap-2 text-start group min-w-0"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:border-emerald-500/60 transition-colors shrink-0">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-sm sm:text-lg font-bold tracking-tight text-white whitespace-nowrap" dir="ltr">
                MatchMind <span className="text-emerald-400">AI</span>
              </span>
            </button>
            <DemoDataBadge provider={activeProvider} className="hidden lg:inline-flex" />
          </div>

          {/* Zone 2: Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`text-xs font-semibold tracking-wide transition-colors whitespace-nowrap shrink-0 relative py-1 ${
                    isActive
                      ? 'text-emerald-400 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: PWA Install, Quick Validation (mobile), Language Switcher & Primary Action */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => onSelectTab('validation')}
              aria-label={t.nav.validation}
              className={`md:hidden min-h-[44px] min-w-[44px] px-2 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center justify-center gap-1 whitespace-nowrap shrink-0 ${
                activeTab === 'validation'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700'
                  : 'bg-slate-900 text-slate-300 border-slate-700/80'
              }`}
              title={t.nav.validation}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </button>

            <button
              type="button"
              onClick={toggleLanguage}
              className="min-h-[44px] md:min-h-[36px] px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title={t.common.switchToLanguageLabel}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.common.switchToLanguageLabel}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onNewAnalysis) {
                  onNewAnalysis();
                } else {
                  onSelectTab('analysis');
                }
              }}
              className="hidden sm:flex min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{t.nav.newAnalysis}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
