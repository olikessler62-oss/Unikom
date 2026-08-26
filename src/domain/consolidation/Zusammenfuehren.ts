import { entscheide, type Angebot, type Entscheidungsgrund, type Entscheidungsregeln } from './Prioritaet.js';
import type { Datensatz } from './Quellen.js';
import { QUELLE_BEARBEITUNG, type Datensatzentscheidung } from './Vorentscheidung.js';

/**
 * Aus mehreren Datensätzen wird einer (SPEC-04, Abschnitt 7; SPEC-06,
 * Abschnitt 4).
 *
 * ```text
 * Datensatz A            Datensatz B            Ergebnis
 * Name    Müller GmbH    Name    Mueller GmbH   Müller GmbH
 * Telefon (leer)         Telefon 069 123456     069 123456
 * E-Mail  info@…         E-Mail  (leer)         info@…
 * ```
 *
 * Die Zusammenführung entscheidet **feldweise** und nicht datensatzweise. Das
 * ist der ganze Punkt: Ein Datensatz, der als Ganzes gewinnt, nimmt seine
 * leeren Felder mit und wirft die gefüllten des anderen weg.
 *
 * ## Jedes Feld trägt seine Herkunft
 *
 * Zu jedem Wert steht, aus welcher Quelle er kommt, welche Regel ihn gewählt
 * hat und was dabei übergangen wurde (SPEC-04, Abschnitt 8; SPEC-06,
 * Abschnitt 12). Ohne diese Angabe ist ein konsolidierter Datensatz eine
 * Behauptung: Er sieht vollständig aus, und niemand kann prüfen, woher er
 * stammt.
 *
 * ## Ein Konflikt hält nicht den Datensatz auf
 *
 * Ein Feld ohne entscheidbaren Wert bleibt leer, und der Datensatz entsteht
 * trotzdem — mit dem Konflikt daneben. Alles andere hieße, wegen eines
 * strittigen Telefonanschlusses auch Name und Anschrift zurückzuhalten.
 *
 * ## Und einmal wird gar nicht abgewogen
 *
 * Hat ein Mensch über dieses Feld dieses Datensatzes bereits entschieden, gilt
 * sein Wert. Die Regeln werden dann nicht mehr gefragt — sie sind der Weg zu
 * einer Entscheidung, und die liegt vor. Siehe `Vorentscheidung`.
 */
export interface Feldergebnis {
  feld: string;
  wert: string;
  /** Die `id` der Quelle, aus der der Wert stammt. */
  quelle: string;
  grund: Entscheidungsgrund;
  begruendung: string;
  konfidenz: number;
  /** Was vorlag und nicht genommen wurde. */
  uebergangen: Angebot[];
  /** Etwas spricht gegen die angewandte Regel (SPEC-04, Abschnitt 8). */
  pruefhinweis?: string;
}

export interface Feldkonflikt {
  feld: string;
  begruendung: string;
  angebote: Angebot[];
  konfidenz: number;
}

export interface Herkunftsangabe {
  quelle: string;
  /** Die Zeile in der Quelle, ab 1. */
  zeile: number;
}

export interface Zusammengefuehrt {
  /** Der Konsolidierungsschlüssel im Klartext. */
  schluessel: string;
  werte: Map<string, string>;
  felder: Feldergebnis[];
  konflikte: Feldkonflikt[];
  /** Aus welchen Datensätzen er entstanden ist (SPEC-06, Abschnitt 12). */
  herkunft: Herkunftsangabe[];
}

/**
 * Die Zielfelder einer Gruppe.
 *
 * Ohne vorgegebene Zielstruktur die Vereinigung aller vorkommenden Felder, in
 * der Reihenfolge ihres ersten Auftretens. Ein Feld, das nur eine Quelle
 * kennt, fällt damit nicht unter den Tisch — „fehlende Felder einer einzelnen
 * Quelle dürfen nicht automatisch als Fehler gelten" (SPEC-09, Abschnitt 5).
 */
export function zielfelder(gruppe: readonly Datensatz[], vorgabe?: readonly string[]): string[] {
  if (vorgabe && vorgabe.length > 0) {
    return [...vorgabe];
  }

  const felder: string[] = [];

  for (const datensatz of gruppe) {
    for (const feld of datensatz.werte.keys()) {
      if (!felder.includes(feld)) {
        felder.push(feld);
      }
    }
  }

  return felder;
}

export function fuehreZusammen(
  schluessel: string,
  gruppe: readonly Datensatz[],
  regeln: Entscheidungsregeln = {},
  vorgabe?: readonly string[],
  /** Was ein Mensch über **diesen** Datensatz entschieden hat — siehe `Vorentscheidung`. */
  entschieden?: Datensatzentscheidung
): Zusammengefuehrt {
  const werte = new Map<string, string>();
  const felder: Feldergebnis[] = [];
  const konflikte: Feldkonflikt[] = [];

  for (const feld of zielfelder(gruppe, vorgabe)) {
    /*
     * Auch die Quellen, die das Feld gar nicht führen, geben ein Angebot ab —
     * ein leeres. Aussortiert wird es erst in `entscheide`, und zwar zusammen
     * mit den leeren Werten der Quellen, die es führen. Beides ist dasselbe:
     * eine Quelle, die von „Telefon" nichts weiß, stimmt nicht für „kein
     * Telefon".
     */
    const angebote: Angebot[] = gruppe.map((datensatz) => ({
      quelle: datensatz.quelle,
      wert: datensatz.werte.get(feld) ?? '',
      stand: datensatz.stand,
    }));

    const gesetzt = entschieden?.felder.get(feld);

    if (gesetzt !== undefined) {
      /*
       * Ohne Bedingung: auch dort, wo die Quellen sich einig sind. Ein Mensch,
       * der einen Wert eingetragen hat, hat ihn für diesen Datensatz
       * eingetragen — und nicht unter dem Vorbehalt, dass die Lieferung ihm
       * nicht widerspricht. Der Fall entstand ohnehin nur, weil es etwas zu
       * entscheiden gab.
       */
      werte.set(feld, gesetzt.wert);
      felder.push({
        feld,
        wert: gesetzt.wert,
        quelle: QUELLE_BEARBEITUNG,
        grund: 'KONFLIKTBEARBEITUNG',
        // Die Herkunft **dieses** Feldes, nicht die des Datensatzes: Drei
        // strittige Felder sind drei Fälle, und jedes Feld nennt seinen.
        begruendung: gesetzt.herkunft,
        // Eine Entscheidung ist keine Schätzung. Sie noch einmal an einer
        // Mindestkonfidenz zu messen hieße, sie zur Vermutung zu erklären.
        konfidenz: 1,
        uebergangen: angebote.filter((angebot) => angebot.wert !== gesetzt.wert),
      });

      continue;
    }

    const entscheidung = entscheide(feld, angebote, regeln);

    if (entscheidung.entschieden) {
      werte.set(feld, entscheidung.wert);
      felder.push({
        feld,
        wert: entscheidung.wert,
        quelle: entscheidung.quelle,
        grund: entscheidung.grund,
        begruendung: entscheidung.begruendung,
        konfidenz: entscheidung.konfidenz,
        uebergangen: entscheidung.uebergangen,
        pruefhinweis: entscheidung.pruefhinweis,
      });
    } else {
      // Leer und nicht „irgendeiner der beiden Werte": Ein Konflikt, der
      // nebenbei schon einen Wert gesetzt hat, wird niemand mehr entscheiden.
      werte.set(feld, '');
      konflikte.push({
        feld,
        begruendung: entscheidung.begruendung,
        angebote: entscheidung.angebote,
        konfidenz: entscheidung.konfidenz,
      });
    }
  }

  return {
    schluessel,
    werte,
    felder,
    konflikte,
    herkunft: gruppe.map((datensatz) => ({ quelle: datensatz.quelle, zeile: datensatz.zeile })),
  };
}
