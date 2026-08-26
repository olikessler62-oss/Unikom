/**
 * Was ein Mensch über einen einzelnen Datensatz entschieden hat — als Vorgabe
 * für den Lauf, der ihn noch einmal rechnet (SPEC-07, Abschnitt 13).
 *
 * ## Der Rückweg
 *
 * ```text
 * Lauf 1   Lieferung ──→ Ergebnis (zurückgehalten)
 *                          └─ 3 Konflikte
 *
 *          ein Mensch entscheidet die 3
 *
 * Lauf 2   dieselbe Lieferung + diese Entscheidungen
 *            └─→ ein vollständiges Ergebnis, das Lauf 1 ersetzt
 * ```
 *
 * Der Korrekturlauf rechnet auf **derselben** Lieferung. Ohne diese Vorgaben
 * entstünden dabei genau dieselben Konflikte noch einmal — und der Lauf
 * endete, wo der erste endete.
 *
 * ## Warum sie nicht als Quelle mitkommt
 *
 * Die entschiedenen Werte als weitere Datei in den Stapel zu legen wäre
 * naheliegend und falsch. Eine Quelle unterliegt den Regeln: Prioritäten,
 * Aktualität, Mehrheit. Eine Entscheidung tut das nicht — sie ist der Grund,
 * warum die Regeln hier nicht mehr gefragt werden. Als Quelle könnte die
 * eingestellte Quellenpriorität sie überstimmen, und der Mensch, der zwanzig
 * Minuten an einem Fall gesessen hat, fände seinen Wert nicht wieder.
 *
 * ## Ein Datensatz, mehrere Fälle
 *
 * Je strittigem **Feld** entsteht ein eigener Konfliktfall. Ein Datensatz mit
 * drei strittigen Feldern hat also drei Fälle, und alle drei Entscheidungen
 * gelten für denselben Datensatz. Deshalb wird zusammengelegt und nicht
 * überschrieben — sonst käme von drei Entscheidungen eine an, und die anderen
 * beiden wären wieder Konflikte.
 */
export interface Vorentscheidung {
  /**
   * Der Konsolidierungsschlüssel des Datensatzes, im Klartext.
   *
   * Derselbe Wert, der am Konfliktfall als `datensatz` steht — dort kommt er
   * aus `konflikt.schluessel`. Ein Fall ohne Schlüssel trägt stattdessen
   * „Datei, Zeile 7", und der findet hier nichts wieder: Zeilennummern
   * überstehen keine erneute Verarbeitung.
   */
  datensatz: string;
  /** Die entschiedenen Werte: Feldname → Wert. */
  werte: Readonly<Record<string, string>>;
  /**
   * Woher sie stammt — dieser Satz wird zur Begründung des Feldes.
   *
   * Er steht hinterher in der Herkunft jedes so entstandenen Wertes. Ein
   * Ergebnis, in dem nicht mehr zu sehen ist, welche Werte von Hand gesetzt
   * wurden, wäre genau das, was die Nachvollziehbarkeit verhindern soll.
   */
  herkunft: string;
}

/**
 * Was als Quelle eines von Hand entschiedenen Wertes dasteht.
 *
 * Keine Kennung einer Datei, weil der Wert aus keiner stammt. Ein Feldergebnis
 * ohne Quelle wäre die Alternative gewesen — dann müsste jede Stelle, die
 * Herkunft anzeigt, den leeren Fall eigens behandeln, und eine davon vergisst
 * es.
 */
export const QUELLE_BEARBEITUNG = 'Konfliktbearbeitung';

/**
 * Was für einen Datensatz feststeht — je Feld der Wert und woher er kommt.
 *
 * Die Herkunft steht **am Feld** und nicht am Datensatz. Drei Fälle zu einem
 * Datensatz sind der Regelfall; trüge der Datensatz eine einzige Herkunft,
 * bekämen alle drei Felder die des zuletzt eingelesenen Falls — und die
 * Nachvollziehbarkeit zählte zwei Fallnummern weniger, ohne es zu sagen.
 */
export interface Datensatzentscheidung {
  datensatz: string;
  felder: ReadonlyMap<string, { wert: string; herkunft: string }>;
}

/**
 * Legt die Entscheidungen je Datensatz zusammen.
 *
 * Mehrere Fälle zu einem Datensatz sind der Regelfall und nicht die Ausnahme:
 * Je strittigem Feld entsteht ein eigener. Feldweise zusammengelegt, und bei
 * demselben Feld gewinnt die **spätere** — sie ist die jüngere Entscheidung
 * über dieselbe Frage.
 */
export function nachDatensatz(
  vorentscheidungen: readonly Vorentscheidung[]
): ReadonlyMap<string, Datensatzentscheidung> {
  const gesammelt = new Map<string, Map<string, { wert: string; herkunft: string }>>();

  for (const eine of vorentscheidungen) {
    const felder = gesammelt.get(eine.datensatz) ?? new Map<string, { wert: string; herkunft: string }>();

    for (const [feld, wert] of Object.entries(eine.werte)) {
      felder.set(feld, { wert, herkunft: eine.herkunft });
    }

    gesammelt.set(eine.datensatz, felder);
  }

  return new Map(
    [...gesammelt].map(([datensatz, felder]) => [datensatz, { datensatz, felder }])
  );
}
