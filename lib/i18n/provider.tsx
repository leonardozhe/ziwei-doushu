'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, dict, isLocale, LOCALE_META, TOPIC_LABELS_EN, type DictKey, type Locale } from './dict';

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
  /** 13 维标签按当前语言返回 */
  topicLabel: (topic: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = 'ziwei-locale';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) {
      setLocaleState(saved);
      return;
    }
    // 没手动选过语言时，跟随浏览器
    const browser = window.navigator.language.slice(0, 2).toLowerCase();
    if (isLocale(browser)) setLocaleState(browser);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key) => dict[locale][key] ?? dict.zh[key] ?? key,
    topicLabel: (topic) =>
      locale === 'zh'
        ? (dict.zh as Record<string, string>)[`topic.${topic}`] ?? topic
        : TOPIC_LABELS_EN[topic] ?? topic,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
