import type { DateOrder } from '../tenants/Region.js';

/**
 * Datumsangaben lesen — nach der Reihenfolge, die die Region vorgibt.
 *
 * `04/03/2026` ist in Deutschland der 4. März und in den USA der 3. April.
 * Beide Lesarten ergeben ein gültiges Datum; ohne die Region ist die Frage
 * nicht entscheidbar, und ein falsch gelesener Monat fällt bei Rechnungen
 * frühestens beim Mahnlauf auf.
 */
export interface DateValue {
  year: number;
  month: number;
  day: number;
}

/**
 * Zweistellige Jahreszahlen: 00–49 werden zu 2000–2049, 50–99 zu 1950–1999
 * (SPEC-02, Abschnitt 7). Die Grenze ist einstellbar, weil ein Bestand mit
 * Geburtsdaten sie anders braucht als einer mit Rechnungsdaten.
 */
export const DEFAULT_PIVOT = 50;

const MIT_TRENNER = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})$/;

export function parseDate(text: string, order: DateOrder, pivot: number = DEFAULT_PIVOT): DateValue | undefined {
  const treffer = MIT_TRENNER.exec(text.trim());

  if (!treffer) {
    return undefined;
  }

  const [, erstes, , zweites, drittes] = treffer;

  // Die ISO-Schreibweise ist eindeutig und gilt unabhängig von der Region:
  // wer 2026-03-04 schreibt, meint nichts anderes.
  if (erstes.length === 4) {
    return gueltig({ year: Number(erstes), month: Number(zweites), day: Number(drittes) });
  }

  if (order === 'YEAR_FIRST') {
    return gueltig({ year: jahr(erstes, pivot), month: Number(zweites), day: Number(drittes) });
  }

  const tag = order === 'DAY_FIRST' ? erstes : zweites;
  const monat = order === 'DAY_FIRST' ? zweites : erstes;

  return gueltig({ year: jahr(drittes, pivot), month: Number(monat), day: Number(tag) });
}

/** Ob dieselbe Angabe unter der anderen Reihenfolge ebenfalls gelänge. */
export function isAmbiguous(text: string): boolean {
  const treffer = MIT_TRENNER.exec(text.trim());

  if (!treffer || treffer[1].length === 4) {
    return false;
  }

  const erstes = Number(treffer[1]);
  const zweites = Number(treffer[3]);

  // Beide Stellen könnten ein Monat sein — dann entscheidet allein die Region,
  // und niemand sieht der Datei an, ob sie richtig gelesen wurde.
  return erstes >= 1 && erstes <= 12 && zweites >= 1 && zweites <= 12 && erstes !== zweites;
}

function jahr(text: string, pivot: number): number {
  const wert = Number(text);

  if (text.length > 2) {
    return wert;
  }

  return wert < pivot ? 2000 + wert : 1900 + wert;
}

/**
 * Nicht nur Bereiche prüfen, sondern den Kalender: Der 31. Februar liegt in
 * jedem Bereich und existiert trotzdem nicht, und 2026 ist kein Schaltjahr.
 */
function gueltig(datum: DateValue): DateValue | undefined {
  if (datum.month < 1 || datum.month > 12 || datum.day < 1) {
    return undefined;
  }

  const probe = new Date(Date.UTC(datum.year, datum.month - 1, datum.day));

  if (datum.year < 100) {
    probe.setUTCFullYear(datum.year);
  }

  const passt =
    probe.getUTCFullYear() === datum.year &&
    probe.getUTCMonth() === datum.month - 1 &&
    probe.getUTCDate() === datum.day;

  return passt ? datum : undefined;
}
