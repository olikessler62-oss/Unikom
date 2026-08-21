/**
 * Was ein Verarbeitungsschritt hinterlässt (SPEC-06, Abschnitt 15).
 *
 * „Zwischenstände werden separat und eindeutig dem jeweiligen Verarbeitungslauf
 * zugeordnet gespeichert." Das ist nicht nur Buchführung, sondern die
 * Voraussetzung für zwei Dinge, die derselbe Satz verlangt:
 *
 * ```text
 * Fortschritt      welcher Schritt von wie vielen, wie viel bleibt
 * Fortsetzbarkeit  „ohne bereits erfolgreich verarbeitete Eingangsdaten zu verändern"
 * ```
 *
 * ## Der Zwischenstand ist das Ergebnis, nicht der Eingang
 *
 * Gespeichert wird, was ein Block **hervorgebracht** hat — nicht, was in ihn
 * hineinging. Die Eingangsdaten bleiben, wo sie sind; sie werden bei einer
 * Fortsetzung ein zweites Mal gelesen, und das ist der Sinn des Satzes „ohne
 * bereits erfolgreich verarbeitete Eingangsdaten zu verändern": Unikom fasst
 * die Quelle nicht an.
 *
 * ## Warum er den Plan mitführt
 *
 * Ein fortgesetzter Lauf muss dieselbe Aufteilung wiederfinden. Stünde nur
 * „Block 2 ist fertig" da, ließe sich nach einer geänderten Einstellung nicht
 * mehr sagen, welche Datensätze das waren — und der fortgesetzte Lauf
 * verarbeitete manche zweimal und andere gar nicht.
 */
export interface Zwischenstand<T = unknown> {
  laufId: string;
  /** Der Schritt, ab 0. */
  block: number;
  /** Wie viele Schritte der Plan vorsah, als dieser entstand. */
  bloecke: number;
  /** Wie viele Datensätze in diesen Schritt gingen. */
  datensaetze: number;
  /** Was dabei herauskam — der Teilbericht dieses Schrittes. */
  teilbericht: T;
  fertig: string;
}

/**
 * Was über einen Schritt bekannt ist, **ohne** seinen Inhalt.
 *
 * Der Unterschied ist der ganze Sinn dieser Trennung: Um zu wissen, welche
 * Schritte noch offen sind, braucht niemand die Teilberichte — und sie alle
 * dafür in den Arbeitsspeicher zu holen, hebt genau den Vorteil auf, für den
 * es die Aufteilung gibt.
 */
export type Blockauskunft = Omit<Zwischenstand, 'teilbericht'>;

export interface Zwischenstandbestand<T = unknown> {
  speichere(stand: Zwischenstand<T>): Promise<void>;
  /** Welche Schritte vorliegen — ohne ihre Teilberichte. */
  auskunft(laufId: string): Promise<Blockauskunft[]>;
  /**
   * Einen einzelnen Teilbericht holen.
   *
   * Einzeln und nicht als Liste: Zwölf Teilberichte gleichzeitig im
   * Arbeitsspeicher sind derselbe Berg, den die Aufteilung vermeiden sollte.
   */
  lies(laufId: string, block: number): Promise<Zwischenstand<T> | undefined>;
  /** Nach dem Abschluss: Der vollständige Bericht steht dann anderswo. */
  entferne(laufId: string): Promise<void>;
}

/**
 * Welche Schritte noch zu tun sind.
 *
 * **Ein Plan, der sich geändert hat, macht die Zwischenstände wertlos.** Sie
 * gehören zu einer anderen Aufteilung, und ein Block 2 von damals enthält nicht
 * dieselben Datensätze wie ein Block 2 von heute. Dann wird von vorn begonnen —
 * das kostet Zeit und ist das einzig Richtige: Ein Lauf aus zwei Aufteilungen
 * ergäbe ein Ergebnis, in dem manche Datensätze zweimal und andere gar nicht
 * stehen.
 */
export function offeneBloecke(bloecke: number, vorhanden: readonly Blockauskunft[]): number[] {
  const brauchbar = vorhanden.filter((stand) => stand.bloecke === bloecke);
  const fertig = new Set(brauchbar.map((stand) => stand.block));

  return Array.from({ length: bloecke }, (_, nummer) => nummer).filter((nummer) => !fertig.has(nummer));
}

/** Ob die vorhandenen Zwischenstände zu diesem Plan gehören. */
export function passenZumPlan(bloecke: number, vorhanden: readonly Blockauskunft[]): boolean {
  return vorhanden.every((stand) => stand.bloecke === bloecke);
}

/** Der Stand, wie ihn ein Mensch abliest (SPEC-06, Abschnitt 15). */
export interface Fortschritt {
  /** Der Schritt, der gerade läuft — ab 1, wie ein Mensch zählt. */
  schritt: number;
  schritte: number;
  /** Datensätze, die bereits verarbeitet sind. */
  verarbeitet: number;
  /** Was noch aussteht. */
  verbleibend: number;
  /** Der Satz für den Bildschirm. */
  text: string;
}

export function fortschritt(schritt: number, schritte: number, verarbeitet: number, gesamt: number): Fortschritt {
  const verbleibend = Math.max(0, gesamt - verarbeitet);

  return {
    schritt,
    schritte,
    verarbeitet,
    verbleibend,
    text:
      `Schritt ${schritt} von ${schritte}: ${verarbeitet.toLocaleString('de-DE')} von ` +
      `${gesamt.toLocaleString('de-DE')} Datensätzen verarbeitet, ${verbleibend.toLocaleString('de-DE')} verbleiben`,
  };
}
