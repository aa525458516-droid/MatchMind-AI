/**
 * MatchMind AI - Professional Football Match Analysis Platform
 */

import React, { useState, useEffect } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { DashboardPage } from './pages/DashboardPage';
import { MatchAnalysisPage } from './pages/MatchAnalysisPage';
import { PredictionsPage } from './pages/PredictionsPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ValidationPage } from './pages/ValidationPage';
import { Activity } from 'lucide-react';
import { footballService } from './services/footballDataService';
import { DataProviderType } from './types/football';
import { useLanguage } from './i18n/LanguageContext';

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

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
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

        {activeTab === 'settings' && <SettingsPage />}
      </main>

      {/* Professional Footer */}
      <footer className="border-t border-slate-800/80 bg-[#090d1a] py-8 text-xs text-slate-400 mt-12">
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
    </div>
  );
}
