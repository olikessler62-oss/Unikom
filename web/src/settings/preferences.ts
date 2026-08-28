/**
 * Was jemand an seiner Ansicht eingestellt hat: die Sprache.
 *
 * Sie liegt im Browser, nicht am Benutzerkonto. Das ist eine bewusste
 * Entscheidung und keine Abkürzung: Es ist eine Anzeigeeinstellung, sie wirkt
 * sofort und ohne Anfrage beim Server. Der Preis ist, dass die Wahl an diesem
 * Browser hängt.
 *
 * Hier stand einmal auch das Erscheinungsbild - zwei zur Wahl, ein dunkles und
 * ein helles. Es gibt jetzt nur noch eines, und damit auch nichts mehr zu
 * wählen.
 */

export type Language = 'de' | 'en' | 'es';

export const LANGUAGES: Language[] = ['de', 'en', 'es'];

const LANGUAGE_KEY = 'unikom.language';

const DEFAULT_LANGUAGE: Language = 'de';

/**
 * Ein privates Fenster oder abgeschaltete Speicherung darf die Oberfläche nicht
 * zerlegen. Fehlt der Speicher, gilt die Voreinstellung und der Rest läuft.
 */
function read(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Gewollt still: die Wahl gilt für diese Sitzung, nur eben nicht länger.
  }
}

export function storedLanguage(): Language {
  const value = read(LANGUAGE_KEY);

  if (LANGUAGES.includes(value as Language)) {
    return value as Language;
  }

  // Noch nie gewählt: die Sprache des Browsers, sofern wir sie sprechen.
  const preferred = navigator.language?.slice(0, 2).toLowerCase();

  return LANGUAGES.includes(preferred as Language) ? (preferred as Language) : DEFAULT_LANGUAGE;
}

export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
}

export function saveLanguage(language: Language): void {
  write(LANGUAGE_KEY, language);
  applyLanguage(language);
}
