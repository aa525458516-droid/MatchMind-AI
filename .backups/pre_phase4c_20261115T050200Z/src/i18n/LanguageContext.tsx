import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Language, translations, Translations } from './translations';

const STORAGE_KEY = 'matchmind_language';

interface LanguageContextValue {
  language: Language;
  isRtl: boolean;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: Translations;
  formatDate: (dateStr: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (dateStr: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (dateStr: string | Date) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'ar';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const applyDocumentDirection = useCallback((lang: Language) => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, []);

  useEffect(() => {
    applyDocumentDirection(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore storage access errors
    }
  }, [language, applyDocumentDirection]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'ar' ? 'en' : 'ar'));
  }, []);

  const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';

  const formatDate = useCallback(
    (dateStr: string | Date, options?: Intl.DateTimeFormatOptions) => {
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      if (Number.isNaN(date.getTime())) return String(dateStr);
      return date.toLocaleDateString(locale, options);
    },
    [locale]
  );

  const formatDateTime = useCallback(
    (dateStr: string | Date, options?: Intl.DateTimeFormatOptions) => {
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      if (Number.isNaN(date.getTime())) return String(dateStr);
      return date.toLocaleString(locale, options);
    },
    [locale]
  );

  const formatTime = useCallback(
    (dateStr: string | Date) => {
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      if (Number.isNaN(date.getTime())) return String(dateStr);
      return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    },
    [locale]
  );

  const value: LanguageContextValue = {
    language,
    isRtl: language === 'ar',
    setLanguage,
    toggleLanguage,
    t: translations[language],
    formatDate,
    formatDateTime,
    formatTime,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
