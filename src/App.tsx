/**
 * MatchMind AI - Professional Football Match Analysis Platform
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { OfflineIndicator } from './components/OfflineIndicator';
import { Activity } from 'lucide-react';
import { footballService } from './services/footballDataService';
import { DataProviderType } from './types/football';
import { useLanguage } from './i18n/LanguageContext';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const MatchAnalysisPage = lazy(() =>
  import('./pages/MatchAnalysisPage').then((m) => ({ default: m.MatchAnalysisPage }))
);
const PredictionsPage = lazy(() =>
  import('./pages/PredictionsPage').then((m) => ({ default: m.PredictionsPage }))
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const ValidationPage = lazy(() =>
  import('./pages/ValidationPage').then((m) => ({ default: m.ValidationPage }))
);

export default function App() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(undefined);
  const [activeProvider, setActiveProvider] = useState<DataProviderType>(
    footballService.getActiveProvider()
  );
  const [providerVersion, setProviderVersion] = useState<number>(0);

  useEffect(() => {
    return footballService.subscribe(() => {
      setActiveProvider(footballService.getActiveProvider());
      setSelectedMatchId(undefined);
      setProviderVersion((v) => v + 1);
    });
  }, []);

  const handleSelectMatchForAnalysis = (matchId: string) => {
    setSelectedMatchId(matchId);
    setActiveTab('analysis');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNewAnalysis = () => {
    setSelectedMatchId(undefined);
    setActiveTab('analysis');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#0a0f1d] text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-white">
      {/* Top Bar Navigation */}
      <Navbar
        activeTab={activeTab}
        activeProvider={activeProvider}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNewAnalysis={handleNewAnalysis}
      />

      {/* Honest Offline Status Notice */}
      <OfflineIndicator />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 pb-24 md:pb-8">
        <Suspense
          fallback={
            <div className="py-20 text-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs font-mono text-slate-400">{t.common.loading}</p>
            </div>
          }
        >
          {activeTab === 'dashboard' && (
            <DashboardPage
              providerVersion={providerVersion}
              onSelectMatch={handleSelectMatchForAnalysis}
              onNavigateToPredictions={() => setActiveTab('predictions')}
              onNavigateToSettings={() => setActiveTab('settings')}
              onNavigateToValidation={() => setActiveTab('validation')}
            />
          )}

          {activeTab === 'analysis' && (
            <MatchAnalysisPage
              initialMatchId={selectedMatchId}
              providerVersion={providerVersion}
            />
          )}

          {activeTab === 'predictions' && (
            <PredictionsPage
              providerVersion={providerVersion}
              onSelectMatch={handleSelectMatchForAnalysis}
            />
          )}

          {activeTab === 'validation' && <ValidationPage providerVersion={providerVersion} />}

          {activeTab === 'history' && <HistoryPage providerVersion={providerVersion} />}

          {activeTab === 'settings' && (
            <SettingsPage onNavigateToValidation={() => setActiveTab('validation')} />
          )}
        </Suspense>
      </main>

      {/* Professional Footer (spaced above fixed mobile bottom nav + safe area) */}
      <footer className="border-t border-slate-800/80 bg-[#090d1a] pt-6 pb-24 pb-safe md:py-8 text-xs text-slate-400 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Activity className="w-3 h-3" />
            </div>
            <span className="font-bold text-white tracking-tight" dir="ltr">{t.common.brandName}</span>
            <span className="text-slate-600">·</span>
            <span>{t.footer.subtitle}</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-[11px] text-slate-500">
            <span>{t.footer.poisson}</span>
            <span>·</span>
            <span>{t.footer.expectedGoals}</span>
            <span>·</span>
            <span>{t.footer.gemini}</span>
            <span>·</span>
            <span>{t.footer.nonGambling}</span>
          </div>

          <div className="text-[11px] text-slate-500">
            © {new Date().getFullYear()} {t.common.brandName}. {t.footer.rights}
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}
