/**
 * Was geschieht, wenn eine Zusatzquelle mehr als einen passenden Datensatz hat
 * (SPEC-02, Abschnitt 29 und 30).
 *
 * Die beiden Regeln standen bis hierher im Konsolidierungsdienst. Sie gehören
 * aber nicht ihm, sondern der Sache: Ein Workflow speichert sie, die
 * Schnittstelle nimmt sie entgegen, die Oberfläche zeigt sie an. Ein
 * Anwendungsdienst, den all diese Stellen nur wegen zweier Typen einbinden
 * müssten, wäre eine Abhängigkeit in die falsche Richtung.
 */
export type Mehrfachtrefferregel =
  /** Genau ein Treffer erwartet — mehr sind ein Konflikt (Voreinstellung). */
  | { regel: 'KONFLIKT' }
  /** Alle übernehmen: aus einem Hauptsatz werden so viele, wie es Treffer gibt. */
  | { regel: 'ALLE' }
  /**
   * Nach einem Wert im Datensatz entscheiden — das Änderungsdatum, eine
   * Versionsnummer, ein Statusrang.
   *
   * SPEC-02, Abschnitt 29, nennt „aktueller Datensatz" und „Status-/
   * Prioritätsregel" getrennt. Beide sagen dasselbe: Ein Feld der Zusatzdatei
   * entscheidet. Ein Mechanismus statt zwei — und er nennt das Feld, statt es
   * zu erraten.
   */
  | { regel: 'FELD'; feld: string; nimm: 'GROESSTER' | 'KLEINSTER' };

/**
 * Was mit einem Datensatz geschieht, zu dem es keinen Hauptsatz gibt.
 *
 * Voreinstellung ist `KONFLIKT` (SPEC-02, Abschnitt 30): Ein Datensatz ohne
 * Bezug ist beim Anreichern eine offene Frage und keine Nebensache.
 */
export type OhneHauptsatz = 'KONFLIKT' | 'UEBERNEHMEN' | 'UEBERSPRINGEN';

export const MEHRFACHTREFFER_REGELN = ['KONFLIKT', 'ALLE', 'FELD'] as const;
export const OHNE_HAUPTSATZ: readonly OhneHauptsatz[] = ['KONFLIKT', 'UEBERNEHMEN', 'UEBERSPRINGEN'];
