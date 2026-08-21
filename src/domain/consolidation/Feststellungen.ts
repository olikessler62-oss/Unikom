import type { DateOrder } from '../tenants/Region.js';

/**
 * Was eine Eingangsdatei über sich selbst sagt (SPEC-02, Abschnitt 40).
 *
 * Eine **Einstellung** ist eine Wahl: Region, Jahrhundertgrenze, Rundung,
 * Mapping. Für sie gilt die Hierarchie Mandant → Profil → Allgemein.
 *
 * Eine **Feststellung** beschreibt eine Eigenschaft der Datei: Trennzeichen,
 * Kodierung, Kopfzeile, Textbegrenzer, das tatsächlich verwendete Datums- und
 * Zahlenformat. Feststellungen sind keine Einstellungen und **nicht
 * überschreibbar**.
 *
 * ## Warum das ein eigener Typ ist und keine Kennzeichnung
 *
 * Der Unterschied ließe sich auch als Merkmal an jedem Feld führen —
 * `{ wert, ueberschreibbar: false }` — und dann müsste jede Stelle, die
 * zusammenführt, dieses Merkmal beachten. Eine davon wird es vergessen.
 *
 * Hier ist es ein anderer Typ mit einer anderen Reise: Feststellungen kommen
 * aus dem Leser der Datei, gehen in den Schnappschuss und werden angezeigt. Es
 * gibt keine Funktion, die sie mit Einstellungen verrechnet — und deshalb auch
 * keine, die es falsch machen kann.
 *
 * Der Schaden, um den es geht, ist ein stiller: Eine Datei, die mit Komma
 * trennt, trennt nicht Semikolon, weil am Mandanten Semikolon eingestellt ist.
 * Läse man sie trotzdem so, ergäbe `Meier;Frankfurt` **ein** Feld statt zwei —
 * und das ist lesbar. Es fällt niemandem auf.
 */
export interface Feststellungen {
  /** Das Trennzeichen, das in dieser Datei wirklich steht. */
  trennzeichen?: string;
  /** Die Kodierung, mit der sie gelesen wurde. */
  kodierung?: string;
  /** Ob die erste Zeile Feldnamen trägt. */
  kopfzeile?: boolean;
  /** Womit Felder eingefasst sind, wenn sie es sind. */
  textbegrenzer?: string;
  /** Die Datumsreihenfolge, die in den Werten tatsächlich vorkommt. */
  datumsreihenfolge?: DateOrder;
  /** Das Dezimaltrennzeichen der Zahlen in dieser Datei. */
  dezimalzeichen?: string;
  /** Das Tausendertrennzeichen, sofern eines vorkommt. */
  tausenderzeichen?: string;
  /** Die Zahl der Spalten, die gefunden wurde. */
  spalten?: number;
}

export type Feststellungsname = keyof Feststellungen;

export const FESTSTELLUNGEN: readonly Feststellungsname[] = [
  'kodierung',
  'trennzeichen',
  'textbegrenzer',
  'kopfzeile',
  'spalten',
  'datumsreihenfolge',
  'dezimalzeichen',
  'tausenderzeichen',
];

export const FESTSTELLUNG_LABELS: Record<Feststellungsname, string> = {
  kodierung: 'Kodierung',
  trennzeichen: 'Trennzeichen',
  textbegrenzer: 'Textbegrenzer',
  kopfzeile: 'Kopfzeile',
  spalten: 'Spalten',
  datumsreihenfolge: 'Datumsreihenfolge',
  dezimalzeichen: 'Dezimaltrennzeichen',
  tausenderzeichen: 'Tausendertrennzeichen',
};

/**
 * Ob zwei Feststellungen dieselbe Datei beschreiben.
 *
 * Gebraucht beim Wiedererkennen: Kommt eine Lieferung derselben Quelle plötzlich
 * mit anderer Kodierung oder anderem Trennzeichen, ist das kein Grund, sie
 * anders zu lesen — aber ein Grund, es zu sagen. Verglichen wird nur, was
 * beide Seiten kennen; eine fehlende Angabe ist keine Abweichung.
 */
export function abweichendeFeststellungen(
  hinterlegt: Feststellungen | undefined,
  gefunden: Feststellungen | undefined
): { was: Feststellungsname; hinterlegt: unknown; gefunden: unknown }[] {
  if (!hinterlegt || !gefunden) {
    return [];
  }

  return FESTSTELLUNGEN.filter(
    (name) => hinterlegt[name] !== undefined && gefunden[name] !== undefined && hinterlegt[name] !== gefunden[name]
  ).map((name) => ({ was: name, hinterlegt: hinterlegt[name], gefunden: gefunden[name] }));
}
