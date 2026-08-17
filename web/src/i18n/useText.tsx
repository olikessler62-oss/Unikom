import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  applyLanguage,
  saveLanguage,
  storedLanguage,
  type Language,
} from '../settings/preferences.js';
import { setActiveLanguage, textOf, type TextKey } from './texts.js';

interface LanguageState {
  language: Language;
  setLanguage(next: Language): void;
  t(key: TextKey): string;
}

const Context = createContext<LanguageState | undefined>(undefined);

/**
 * Die Sprache steht über der ganzen Anwendung, damit ein Wechsel überall
 * gleichzeitig wirkt — sonst spräche das Menü Spanisch, während die offene
 * Maske noch Deutsch zeigt, bis jemand sie neu öffnet.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(() => {
    const initial = storedLanguage();
    applyLanguage(initial);
    setActiveLanguage(initial);
    return initial;
  });

  const setLanguage = useCallback((next: Language) => {
    saveLanguage(next);
    setActiveLanguage(next);
    setState(next);
  }, []);

  const value = useMemo<LanguageState>(
    () => ({ language, setLanguage, t: (key) => textOf(key, language) }),
    [language, setLanguage]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage(): LanguageState {
  const value = useContext(Context);

  if (!value) {
    throw new Error('useLanguage was called outside the LanguageProvider');
  }

  return value;
}

/** Der kurze Weg, wenn nur Text gebraucht wird. */
export function useText(): (key: TextKey) => string {
  return useLanguage().t;
}
