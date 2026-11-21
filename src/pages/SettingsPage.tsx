import React, { useState, useEffect } from 'react';
import {
  Database,
  Cpu,
  Sliders,
  ShieldAlert,
  CheckCircle2,
  Save,
  Globe,
  Star,
  Smartphone,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { DemoDataBadge } from '../components/DemoDataBadge';
import { footballService } from '../services/footballDataService';
import { DataProviderType } from '../types/football';
import { useLanguage } from '../i18n/LanguageContext';
import {
  clearAllFavorites,
  FavoritesState,
  loadFavorites,
  subscribeFavorites,
} from '../utils/favoritesStore';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface Props {
  onNavigateToValidation?: () => void;
}

export const SettingsPage: React.FC<Props> = ({ onNavigateToValidation }) => {
  const { language, setLanguage, t } = useLanguage();
  const isOnline = useOnlineStatus();
  const { canPrompt, isInstalled, promptInstall } = usePWAInstall();
  const [provider, setProvider] = useState<DataProviderType>(footballService.getActiveProvider());
  const [favorites, setFavorites] = useState<FavoritesState>(() => loadFavorites());
  const [homeAdvantageWeight, setHomeAdvantageWeight] = useState<number>(1.12);
  const [formDecayFactor, setFormDecayFactor] = useState<number>(1.0);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  useEffect(() => {
    return subscribeFavorites(() => setFavorites(loadFavorites()));
  }, []);

  const handleSelectProvider = (selected: DataProviderType) => {
    setProvider(selected);
    footballService.setActiveProvider(selected);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleSelectLanguage = (selectedLang: 'ar' | 'en') => {
    setLanguage(selectedLang);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    footballService.setActiveProvider(provider);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 sm:p-6 backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                {t.settings.tag}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{t.settings.subTag}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {t.settings.pageTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.settings.pageDesc}
            </p>
          </div>
          <DemoDataBadge provider={provider} showTimestamp />
        </div>
      </div>

      {/* Quick Mobile Product Actions: Validation Hub & PWA / Favorites Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              {language === 'ar' ? 'تطبيق الجوال وPWA' : 'Mobile App & Offline PWA'}
            </span>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                isOnline
                  ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800/50'
                  : 'text-amber-300 bg-amber-950/50 border-amber-800/50'
              }`}
            >
              {isOnline ? (language === 'ar' ? 'متصل' : 'ONLINE') : (language === 'ar' ? 'غير متصل' : 'OFFLINE')}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isInstalled
              ? language === 'ar'
                ? 'التطبيق مثبت ويعمل بوضع النافذة المستقلة (Standalone PWA).'
                : 'Installed in standalone mobile mode with offline application shell caching.'
              : language === 'ar'
              ? 'جاهز للتثبيت كتطبيق ويب تقدمي (PWA) مباشرة من متصفح الجوال (Chrome أو Safari) دون أي ملفات خارجية.'
              : 'Ready to install as a standalone Progressive Web App directly from Chrome or Safari — no extra download required.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canPrompt && !isInstalled && (
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="min-h-[44px] px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                {language === 'ar' ? 'تثبيت الآن' : 'Install App'}
              </button>
            )}
            {!canPrompt && !isInstalled && (
              <span className="text-[11px] text-slate-400 leading-snug">
                {language === 'ar'
                  ? 'افتح قائمة المتصفح واختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية".'
                  : 'Open browser menu and tap "Install app" or "Add to Home Screen".'}
              </span>
            )}
            {onNavigateToValidation && (
              <button
                type="button"
                onClick={onNavigateToValidation}
                className="min-h-[44px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.nav.validation}</span>
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
              {language === 'ar' ? 'الفرق والمباريات المفضلة' : 'Saved Favorites'}
            </span>
            <span className="text-[11px] font-mono text-slate-300 shrink-0" dir="ltr">
              {favorites.teamIds.length}T · {favorites.leagueIds.length}L · {favorites.matchIds.length}M
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {language === 'ar'
              ? 'محفوظة محلياً دون حسابات لتتبع الفرق والبطولات والمباريات بسرعة.'
              : 'Saved locally in your browser without requiring login to filter teams, leagues, and matches.'}
          </p>
          <button
            type="button"
            onClick={() => clearAllFavorites()}
            disabled={
              favorites.teamIds.length + favorites.leagueIds.length + favorites.matchIds.length === 0
            }
            className="min-h-[44px] px-3.5 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 text-slate-300 border border-slate-800 text-xs flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>{language === 'ar' ? 'مسح المفضلة' : 'Clear Favorites'}</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 0: Interface Language & Direction */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Globe className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              {t.settings.languageSectionTitle}
            </h2>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            {t.settings.languageSectionDesc}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                id: 'ar' as const,
                title: t.settings.arabicOption,
                badge: 'RTL · الافتراضي',
                desc: t.settings.arabicOptionDesc,
              },
              {
                id: 'en' as const,
                title: t.settings.englishOption,
                badge: 'LTR · English',
                desc: t.settings.englishOptionDesc,
              },
            ].map((opt) => {
              const isSelected = language === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectLanguage(opt.id)}
                  className={`min-h-[44px] p-4 rounded-xl border text-start transition-all ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500/80 text-white shadow-lg shadow-emerald-950/30'
                      : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs">{opt.title}</span>
                    <span className="text-[10px] font-mono font-semibold text-emerald-400" dir="ltr">
                      {opt.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    {opt.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 1: Free Football Data Providers */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Database className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              {t.settings.connectorsTitle}
            </h2>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            {t.settings.connectorsDesc}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                id: 'UNIFIED' as const,
                name: t.settings.unifiedName,
                badge: t.settings.unifiedBadge,
                desc: t.settings.unifiedDesc,
                color: 'emerald',
              },
              {
                id: 'OPENLIGADB' as const,
                name: t.settings.openLigaName,
                badge: t.settings.openLigaBadge,
                desc: t.settings.openLigaDesc,
                color: 'emerald',
              },
              {
                id: 'STATSBOMB' as const,
                name: t.settings.statsBombName,
                badge: t.settings.statsBombBadge,
                desc: t.settings.statsBombDesc,
                color: 'cyan',
              },
              {
                id: 'DEMO' as const,
                name: t.settings.demoName,
                badge: t.settings.demoBadge,
                desc: t.settings.demoDesc,
                color: 'amber',
              },
            ].map((p) => {
              const isSelected = provider === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectProvider(p.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500/80 text-white shadow-lg shadow-emerald-950/30'
                      : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <span className="font-bold text-xs">{p.name}</span>
                    <span
                      className={`text-[10px] font-mono font-semibold shrink-0 ${
                        p.color === 'emerald'
                          ? 'text-emerald-400'
                          : p.color === 'cyan'
                          ? 'text-cyan-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {p.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    {p.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              {t.settings.attributionTitle}
            </span>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 text-xs space-y-1.5 text-slate-400">
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 font-mono text-[10px] pt-0.5">●</span>
                <p className="text-[11px] leading-relaxed">
                  <strong className="text-slate-200">OpenLigaDB:</strong>{' '}
                  <a
                    href="https://api.openligadb.de"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline"
                    dir="ltr"
                  >
                    api.openligadb.de
                  </a>{' '}
                  — {t.settings.openLigaAttribution}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-cyan-400 font-mono text-[10px] pt-0.5">●</span>
                <p className="text-[11px] leading-relaxed">
                  <strong className="text-slate-200">StatsBomb Open Data:</strong>{' '}
                  {t.settings.statsBombAttributionPrefix}{' '}
                  <a
                    href="https://github.com/statsbomb/open-data"
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 underline"
                  >
                    {t.settings.statsBombAttributionLink}
                  </a>
                  {t.settings.statsBombAttributionSuffix}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Quantitative Model Weights */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              {t.settings.poissonSectionTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300 font-semibold">{t.settings.homeAdvantageLabel}</span>
                <span className="font-mono text-emerald-400 font-bold" dir="ltr">
                  {homeAdvantageWeight.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="1.0"
                max="1.35"
                step="0.01"
                value={homeAdvantageWeight}
                onChange={(e) => setHomeAdvantageWeight(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <span className="text-[11px] text-slate-500 block mt-1">
                {t.settings.homeAdvantageHint}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300 font-semibold">{t.settings.formDecayLabel}</span>
                <span className="font-mono text-emerald-400 font-bold" dir="ltr">
                  {formDecayFactor.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={formDecayFactor}
                onChange={(e) => setFormDecayFactor(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <span className="text-[11px] text-slate-500 block mt-1">
                {t.settings.formDecayHint}
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Gemini AI Model Configuration */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              {t.settings.geminiSectionTitle}
            </h2>
          </div>

          <div className="space-y-3 text-xs text-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <div className="min-w-0">
                <span className="font-bold text-white block">{t.settings.activeLlmLabel}</span>
                <span className="text-slate-400 text-[11px]">
                  {t.settings.activeLlmSub}
                </span>
              </div>
              <span className="font-mono text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded shrink-0" dir="ltr">
                gemini-3.8-flash
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <div className="min-w-0">
                <span className="font-bold text-white block">{t.settings.schemaContractLabel}</span>
                <span className="text-slate-400 text-[11px]">
                  {t.settings.schemaContractSub}
                </span>
              </div>
              <span className="font-mono text-cyan-400 font-bold shrink-0" dir="ltr">
                {t.settings.schemaEnforced}
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t.settings.geminiKeyNotePrefix}{' '}
              <code className="text-slate-200 bg-slate-950 px-1 py-0.2 rounded font-mono" dir="ltr">
                GEMINI_API_KEY
              </code>
              {t.settings.geminiKeyNoteSuffix}
            </p>
          </div>
        </div>

        {/* Section 4: Non-Gambling Declaration */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            {t.settings.ethicsTitle}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {t.settings.ethicsBody}
          </p>
        </div>

        {/* Save Bar */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-emerald-400 font-medium">
            {saveSuccess && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {t.settings.savedToast}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center gap-2 shadow-sm"
          >
            <Save className="w-4 h-4" />
            <span>{t.settings.saveButton}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
