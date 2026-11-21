import React, { useState } from 'react';
import { Activity, Menu, X, PlusCircle, Globe } from 'lucide-react';
import { DemoDataBadge } from './DemoDataBadge';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 lg:gap-8 h-16">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                onSelectTab('dashboard');
                setMobileMenuOpen(false);
              }}
              className="flex items-center gap-2.5 text-start group"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:border-emerald-500/60 transition-colors">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap" dir="ltr">
                MatchMind <span className="text-emerald-400">AI</span>
              </span>
            </button>
            <DemoDataBadge provider={activeProvider} className="hidden sm:inline-flex" />
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
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

          {/* Zone 3: Language Switcher, Primary Action & Mobile Toggle */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={toggleLanguage}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title={t.common.switchToLanguageLabel}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.common.switchToLanguageLabel}</span>
            </button>

            <button
              onClick={() => {
                if (onNewAnalysis) {
                  onNewAnalysis();
                } else {
                  onSelectTab('analysis');
                }
              }}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{t.nav.newAnalysis}</span>
            </button>

            {/* Mobile menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white md:hidden hover:bg-slate-800"
              aria-label={t.nav.toggleNavigation}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-slate-800 bg-[#0a0f1d] px-4 pt-2 pb-4 space-y-1">
          <div className="py-2 px-3 mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">{t.nav.dataSource}</span>
            <DemoDataBadge provider={activeProvider} />
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full text-start px-3 py-2 rounded-lg text-xs font-semibold tracking-wider transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
