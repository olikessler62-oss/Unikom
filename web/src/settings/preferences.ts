/**
 * Was jemand an seiner Ansicht eingestellt hat: Erscheinungsbild und Sprache.
 *
 * Beides liegt im Browser, nicht am Benutzerkonto. Das ist eine bewusste
 * Entscheidung und keine Abkürzung: Es sind Anzeigeeinstellungen, sie wirken
 * sofort und ohne Anfrage beim Server, und wer sich an einem hellen Bildschirm
 * in der Werkstatt anmeldet, will dort womöglich etwas anderes sehen als am
 * dunklen Arbeitsplatz. Der Preis ist, dass die Wahl an diesem Browser hängt.
 */

export type Theme = 'autumn' | 'spring';
export type Language = 'de' | 'en' | 'es';

export const THEMES: Theme[] = ['autumn', 'spring'];
export const LANGUAGES: Language[] = ['de', 'en', 'es'];

const THEME_KEY = 'unikom.theme';
const LANGUAGE_KEY = 'unikom.language';

const DEFAULT_THEME: Theme = 'autumn';
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

export function storedTheme(): Theme {
  const value = read(THEME_KEY);

  return THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
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

/**
 * Das Erscheinungsbild hängt am Wurzelelement, nicht an einem Container: Auch
 * was außerhalb der Anwendung gezeichnet wird — Bildlaufleisten, Datumswähler,
 * die Fläche hinter der Seite — soll dazu passen.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
}

export function saveTheme(theme: Theme): void {
  write(THEME_KEY, theme);
  applyTheme(theme);
}

export function saveLanguage(language: Language): void {
  write(LANGUAGE_KEY, language);
  applyLanguage(language);
}
