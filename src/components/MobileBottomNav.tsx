import React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  Activity,
  History,
  Settings,
} from 'lucide-react';
import { NavTab } from './Navbar';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const MobileBottomNav: React.FC<Props> = ({ activeTab, onSelectTab }) => {
  const { language } = useLanguage();

  const items: Array<{
    id: NavTab;
    labelEn: string;
    labelAr: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'dashboard', labelEn: 'Dashboard', labelAr: 'الرئيسية', icon: LayoutDashboard },
    { id: 'predictions', labelEn: 'Matches', labelAr: 'المباريات', icon: BarChart3 },
    { id: 'analysis', labelEn: 'Analyze', labelAr: 'تحليل', icon: Activity },
    { id: 'history', labelEn: 'History', labelAr: 'السجل', icon: History },
    { id: 'settings', labelEn: 'Settings', labelAr: 'الإعدادات', icon: Settings },
  ];

  return (
    <nav
      aria-label={language === 'ar' ? 'التنقل السفلي للجوال' : 'Mobile bottom navigation'}
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0a0f1d]/95 backdrop-blur-md border-t border-slate-800 pb-safe"
    >
      <div className="flex items-stretch justify-around h-14 px-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (item.id === 'dashboard' && activeTab === 'validation');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 transition-colors ${
                isActive
                  ? 'text-emerald-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-emerald-400' : ''}`} />
              <span className="text-[11px] leading-tight truncate max-w-full">
                {language === 'ar' ? item.labelAr : item.labelEn}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
