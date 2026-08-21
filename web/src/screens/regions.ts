/**
 * Die Regionen zur Auswahl und die Zeitzonen dazu.
 *
 * Eine Auswahl und kein Textfeld: Eine falsch getippte Kennung lehnt der Server
 * ab, eine wohlgeformte falsche — `en-US` statt `en-GB` — nicht. Und die liest
 * jedes Datum verkehrt herum, ohne dass irgendwo ein Fehler entsteht.
 *
 * Die Liste ist eine Abkürzung, keine Schranke: Was am Mandanten steht, kommt
 * mit in die Auswahl, auch wenn es hier nicht aufgeführt ist.
 */
export const LOCALES: { value: string; label: string }[] = [
  { value: 'de-DE', label: 'Deutschland (de-DE)' },
  { value: 'de-AT', label: 'Österreich (de-AT)' },
  { value: 'de-CH', label: 'Schweiz, deutsch (de-CH)' },
  { value: 'fr-CH', label: 'Schweiz, französisch (fr-CH)' },
  { value: 'en-GB', label: 'Vereinigtes Königreich (en-GB)' },
  { value: 'en-US', label: 'Vereinigte Staaten (en-US)' },
  { value: 'fr-FR', label: 'Frankreich (fr-FR)' },
  { value: 'it-IT', label: 'Italien (it-IT)' },
  { value: 'es-ES', label: 'Spanien (es-ES)' },
  { value: 'nl-NL', label: 'Niederlande (nl-NL)' },
  { value: 'pl-PL', label: 'Polen (pl-PL)' },
  { value: 'cs-CZ', label: 'Tschechien (cs-CZ)' },
  { value: 'da-DK', label: 'Dänemark (da-DK)' },
  { value: 'sv-SE', label: 'Schweden (sv-SE)' },
  { value: 'fi-FI', label: 'Finnland (fi-FI)' },
  { value: 'pt-PT', label: 'Portugal (pt-PT)' },
  { value: 'hu-HU', label: 'Ungarn (hu-HU)' },
  { value: 'tr-TR', label: 'Türkei (tr-TR)' },
];

/** Die Zeitzonen kennt der Browser selbst — dieselbe Liste, die der Server prüft. */
export function timeZones(): string[] {
  const alle = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return alle.length > 0 ? alle : ['Europe/Berlin', 'UTC'];
}

export const DATE_ORDER_LABELS: Record<'DAY_FIRST' | 'MONTH_FIRST' | 'YEAR_FIRST', string> = {
  DAY_FIRST: 'Tag zuerst',
  MONTH_FIRST: 'Monat zuerst',
  YEAR_FIRST: 'Jahr zuerst',
};

/**
 * Wie dieser Mandant den 3. April 2026 schreibt — im Browser gerechnet, aber
 * nur für die Vorschau *während* der Auswahl.
 *
 * Was gilt, sagt der Server: `dateSample` am Mandanten kommt aus derselben
 * Datumsformatierung, die der Lauf benutzt. Hier geht es um die Angabe, die
 * noch nicht gespeichert ist — dafür gibt es keine Antwort vom Server, und ein
 * Feld, das seine Wirkung erst nach dem Speichern zeigt, ist eine Zumutung.
 */
export function previewOf(locale: string, timeZone: string): { sample: string; order: string } {
  try {
    const sample = new Intl.DateTimeFormat(locale, { timeZone }).format(new Date(Date.UTC(2026, 3, 3, 12)));
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(Date.UTC(2026, 3, 3)));
    const erste = parts.find((part) => part.type === 'day' || part.type === 'month' || part.type === 'year');
    const order =
      erste?.type === 'day' ? 'DAY_FIRST' : erste?.type === 'month' ? 'MONTH_FIRST' : 'YEAR_FIRST';

    return { sample, order: DATE_ORDER_LABELS[order] };
  } catch {
    return { sample: '—', order: 'unbekannt' };
  }
}
