import type { Vorentscheidung } from '../consolidation/Vorentscheidung.js';
import type { Konfliktfall } from './Konfliktfall.js';

/**
 * Aus entschiedenen Fällen werden Vorgaben für den Korrekturlauf.
 *
 * ```text
 * Konfliktfall              Vorentscheidung
 *   datensatz  4711    ──►    datensatz  4711
 *   ergebnis   {ort:…}  ──►    werte      {ort:…}
 *   id, wer, wann      ──►    herkunft   „Konfliktfall 3f2a, entschieden …"
 * ```
 *
 * ## Was ein Fall ohne Ergebnis hier verloren hat
 *
 * Nichts. Ein Fall, den niemand entschieden hat, trägt kein `ergebnis` — ihn
 * mit leeren Werten weiterzureichen hieße, jedes seiner Felder auf „leer" zu
 * setzen und das als Entscheidung auszugeben. Er fällt fort, und der
 * Korrekturlauf legt ihn wieder vor.
 *
 * ## Der Datensatz ist der Schlüssel, wo es einen gibt
 *
 * `Konfliktfall.datensatz` trägt den Konsolidierungsschlüssel — dort, wo der
 * Konflikt einen hatte. Sonst steht dort „Kunden.csv, Zeile 7", und das findet
 * im Korrekturlauf nichts wieder: Zeilennummern überstehen keine erneute
 * Verarbeitung.
 *
 * Das ist keine Panne, sondern eine Grenze, und sie gehört benannt. Der
 * Korrekturlauf sagt, wie viele Entscheidungen ihren Datensatz nicht
 * wiedergefunden haben; der Fall wird dann erneut vorgelegt, statt still zu
 * verschwinden.
 */
export function vorentscheidungenAus(faelle: readonly Konfliktfall[]): Vorentscheidung[] {
  return faelle
    .filter((fall) => fall.ergebnis !== undefined && Object.keys(fall.ergebnis).length > 0)
    .map((fall) => ({
      datensatz: fall.datensatz,
      werte: { ...fall.ergebnis },
      herkunft: herkunftVon(fall),
    }));
}

/**
 * Der Satz, der hinterher in der Herkunft des Wertes steht.
 *
 * **Die Fallnummer und der Zeitpunkt, nicht der Name.** Der Name stünde nur
 * dann richtig da, wenn er am Fall hängt — und was am Fall hängt, ist die
 * Sperre, also wer ihn zuletzt in der Hand hatte. Das ist nicht dasselbe wie
 * der, der entschieden hat, und eine Herkunft, die den Falschen nennt, ist
 * schlechter als eine, die niemanden nennt.
 *
 * Wer entschieden hat, steht in der Historie des Falls. Sie findet man über
 * diese Nummer — und dort steht auch, was sonst noch passiert ist.
 */
function herkunftVon(fall: Konfliktfall): string {
  return `Konfliktfall ${fall.id}, entschieden am ${fall.geaendert.slice(0, 10)}`;
}
