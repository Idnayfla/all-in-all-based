'use client';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { en, type Translations } from './translations/en';
import { ms } from './translations/ms';
import { zhHans } from './translations/zh-Hans';
import { ta } from './translations/ta';
import { ja } from './translations/ja';
import { ptBR } from './translations/pt-BR';

export type Locale = 'en' | 'ms' | 'zh-Hans' | 'ta' | 'ja' | 'pt-BR';
export type TranslationKey = keyof Translations;

export const SUPPORTED_LANGUAGES: { code: Locale; nativeLabel: string }[] = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'ms', nativeLabel: 'Bahasa Melayu' },
  { code: 'zh-Hans', nativeLabel: '中文' },
  { code: 'ta', nativeLabel: 'தமிழ்' },
  { code: 'ja', nativeLabel: '日本語' },
  { code: 'pt-BR', nativeLabel: 'Português' },
];

const allTranslations: Record<Locale, Translations> = {
  en,
  ms,
  'zh-Hans': zhHans,
  ta,
  ja,
  'pt-BR': ptBR,
};

type LangContextType = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
};

const LangContext = createContext<LangContextType>({
  locale: 'en',
  setLocale: () => {},
  t: key => en[key],
});

const LOCALE_KEY = 'based-locale';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem(LOCALE_KEY) as Locale | null;
    if (saved && saved in allTranslations) setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(LOCALE_KEY, l);
  };

  const t = (key: TranslationKey): string => allTranslations[locale][key] ?? en[key] ?? key;

  return <LangContext.Provider value={{ locale, setLocale, t }}>{children}</LangContext.Provider>;
}

export const useTranslation = () => useContext(LangContext);
