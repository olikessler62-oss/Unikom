import type { Konfliktstatus } from './Konfliktfall.js';

/**
 * Die Bearbeitungshistorie (SPEC-07, Abschnitt 12).
 *
 * „Nachträgliche Korrekturen dürfen frühere Entscheidungen nicht löschen oder
 * überschreiben. Sie müssen als neue Bearbeitungsschritte dokumentiert werden."
 *
 * Deshalb gibt es hier keine Funktion, die einen Schritt ändert, und keine, die
 * einen entfernt. Es gibt `anfuegen` — und wer eine falsche Entscheidung
 * zurücknimmt, erzeugt damit einen Schritt, der die Rücknahme dokumentiert.
 *
 * ## Was ein Schritt festhalten muss
 *
 * Abschnitt 12 zählt neun Dinge auf. Sie stehen einzeln im Typ und nicht als
 * ein Textfeld „Bemerkung": Ein Freitext lässt sich nicht auswerten, nicht
 * filtern und nach zwei Jahren nicht mehr verstehen.
 *
 * ```text
 * Konflikt-UUID          fallId
 * ursprünglicher Konflikt  vonStatus + vorher
 * ursprüngliche Werte    vorher
 * getroffene Entscheidung  art + entscheidung
 * neuer Wert             nachher
 * Zeitpunkt              zeitpunkt
 * Benutzer               benutzer
 * verwendete Regel       regel
 * Ergebnis               nachStatus + nachher
 * ```
 */
export type Schrittart =
  | 'ENTSTANDEN'
  | 'GESPERRT'
  | 'FREIGEGEBEN'
  | 'ENTSCHIEDEN'
  | 'ZURUECKGESTELLT'
  | 'WIEDERAUFGENOMMEN'
  | 'AKZEPTIERT'
  | 'ERNEUT_VERARBEITET'
  | 'ABGESCHLOSSEN';

export interface Bearbeitungsschritt {
  /** Fortlaufend je Fall, ab 1 — die Reihenfolge steht damit fest. */
  nummer: number;
  fallId: string;
  art: Schrittart;
  zeitpunkt: string;
  benutzer: string;
  benutzerName?: string;
  vonStatus?: Konfliktstatus;
  nachStatus?: Konfliktstatus;
  /** Die Werte vor dem Schritt. */
  vorher?: Readonly<Record<string, string>>;
  /** Die Werte danach. */
  nachher?: Readonly<Record<string, string>>;
  /** Was entschieden wurde, in Worten. */
  entscheidung?: string;
  /** Welche Regel dabei angewendet wurde. */
  regel?: string;
  /**
   * Die Kennung des Massenvorgangs, wenn dieser Schritt Teil einer
   * gemeinsamen Bearbeitung war (SPEC-07, Abschnitt 8).
   *
   * „Jede durch eine Massenentscheidung vorgenommene Änderung muss den
   * betroffenen Konfliktfällen eindeutig zugeordnet und protokolliert werden."
   * Über diese Kennung lässt sich hinterher fragen: Was hat dieser eine
   * Knopfdruck angerichtet?
   */
  vorgang?: string;
  bemerkung?: string;
}

/**
 * Ein Schritt an die Historie — die einzige erlaubte Veränderung.
 *
 * Der neue Schritt bekommt die nächste Nummer und wird eingefroren. Ein
 * eingefrorener Schritt lässt sich auch aus JavaScript heraus nicht mehr
 * ändern; `readonly` allein wäre nach dem Übersetzen verschwunden.
 */
export function anfuegen(
  historie: readonly Bearbeitungsschritt[],
  schritt: Omit<Bearbeitungsschritt, 'nummer'>
): Bearbeitungsschritt[] {
  const nummer = historie.length === 0 ? 1 : historie[historie.length - 1].nummer + 1;

  return [...historie, Object.freeze({ ...schritt, nummer })];
}

/** Wie ein Schritt einem Menschen gegenüber heißt. */
export const SCHRITT_LABELS: Record<Schrittart, string> = {
  ENTSTANDEN: 'entstanden',
  GESPERRT: 'in Bearbeitung genommen',
  FREIGEGEBEN: 'zur Bearbeitung freigegeben',
  ENTSCHIEDEN: 'entschieden',
  ZURUECKGESTELLT: 'zurückgestellt',
  WIEDERAUFGENOMMEN: 'wieder aufgenommen',
  AKZEPTIERT: 'bewusst akzeptiert',
  ERNEUT_VERARBEITET: 'zur erneuten Verarbeitung gegeben',
  ABGESCHLOSSEN: 'erfolgreich verarbeitet',
};
