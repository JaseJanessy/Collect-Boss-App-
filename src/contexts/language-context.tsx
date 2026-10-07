"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRegion } from "@/contexts/region-context";
import {
  isLocale,
  LOCALE_CHANGED_EVENT,
  LOCALE_STORAGE_KEY,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n/messages";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: "en",
  setLocale: () => undefined,
  t: (key, vars) => translate("en", key, vars),
});

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * UI language for this device. A saved choice wins; otherwise the business's
 * regional language decides (Bahasa Malaysia when it is "ms").
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { configuration } = useRegion();
  const regionLocale: Locale = configuration.settings.languageCode?.toLowerCase().startsWith("ms") ? "ms" : "en";
  const [chosen, setChosen] = useState<Locale | null>(null);
  const locale = chosen ?? regionLocale;

  useEffect(() => {
    const sync = () => setChosen(storedLocale());
    void Promise.resolve().then(sync);
    window.addEventListener(LOCALE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(LOCALE_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ms" ? "ms-MY" : "en-MY";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: still switch for this session.
    }
    setChosen(next);
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGED_EVENT, { detail: next }));
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => translate(locale, key, vars),
  }), [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useT() {
  return useContext(LanguageContext).t;
}
