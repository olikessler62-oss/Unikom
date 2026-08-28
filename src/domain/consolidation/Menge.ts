import type { Quelle } from './Quellen.js';

/**
 * Was diese Installation an Datensätzen trägt (SPEC-06, Abschnitt 15).
 *
 * ```text
 *    20.000 Datensätze      60 MB      1,1 s
 *   100.000 Datensätze     266 MB      2,9 s
 *   600.000 Datensätze   1.317 MB     25   s
 * 1.200.000 Datensätze   2.431 MB     75   s
 * ```
 *
 * ## Die Zahl ist gemessen, nicht geschätzt
 *
 * Die Tabelle stammt aus einem Lauf über zwei Quellen mit acht Feldern,
 * zusammengeführt über einen Schlüssel. Daraus ergeben sich rund **zwei
 * Kilobyte je Datensatz** — die Konsolidierung hält jeden Satz als `Map` im
 * Arbeitsspeicher, dazu die Gruppierung, das Ergebnis und die Herkunftsangaben.
 *
 * ## Warum es diese Schranke gibt
 *
 * Solange ein Mensch auf einen Knopf drückte und zusah, war das belanglos: Er
 * sah den Browser hängen und wusste, woran es lag. Seit die Konsolidierung im
 * Hintergrund läuft, landet die große Datei nachts um drei — und ein Prozess,
 * dem der Speicher ausgeht, verschwindet **ohne einen Protokolleintrag**.
 * Erkannt wird er dann von der Herzschlagüberwachung, die sagen kann, dass er
 * fort ist, aber nicht warum.
 *
 * Eine Meldung, die den Grund nennt und die Zahl dazu, ist unendlich viel mehr
 * wert als ein Lauf, der es „irgendwie versucht".
 *
 * ## Warum sie an der Installation hängt und nicht am Mandanten
 *
 * Sie beschreibt den Rechner, nicht den Kunden. Zwei Mandanten auf derselben
 * Maschine teilen sich denselben Arbeitsspeicher; eine Grenze je Kunde wäre
 * eine Zusage, die der zweite Lauf bricht.
 */
export const SPEICHER_JE_DATENSATZ_BYTES = 2048;

/**
 * Wie viele Datensätze ein Lauf höchstens umfasst.
 *
 * 500 000 sind nach der Tabelle etwa ein Gigabyte — auf einem Server, der
 * daneben eine Datenbank betreibt, die Grenze des Vertretbaren. Wer mehr
 * Speicher hat, hebt sie über `UNIKOM_HOECHSTMENGE`.
 */
export const HOECHSTMENGE = 500_000;

export interface Mengenurteil {
  datensaetze: number;
  /** Was das nach der Messung ungefähr kostet. */
  geschaetztMb: number;
  traegt: boolean;
  /** Warum nicht, falls nicht — mit allen Zahlen, die zur Entscheidung führten. */
  grund?: string;
}

export function beurteileMenge(datensaetze: number, grenze: number = HOECHSTMENGE): Mengenurteil {
  const geschaetztMb = Math.round((datensaetze * SPEICHER_JE_DATENSATZ_BYTES) / 1024 / 1024);

  if (datensaetze <= grenze) {
    return { datensaetze, geschaetztMb, traegt: true };
  }

  return {
    datensaetze,
    geschaetztMb,
    traegt: false,
    grund:
      `Der Lauf umfasst ${datensaetze.toLocaleString('de-DE')} Datensätze; diese Installation ist auf ` +
      `${grenze.toLocaleString('de-DE')} eingestellt. Nach der Messung wären das etwa ${geschaetztMb} MB ` +
      'Arbeitsspeicher allein für die Konsolidierung. Es wurde nichts verarbeitet - ein Lauf, dem unterwegs der ' +
      'Speicher ausgeht, endet ohne Protokolleintrag, und dann steht nur da, dass ein Prozess verschwunden ist. ' +
      'Teile die Quellen auf, engere das Dateimuster ein, oder hebe UNIKOM_HOECHSTMENGE, wenn der Rechner es hergibt',
  };
}

/** Wie viele Datensätze in einem Lauf zusammenkommen. */
export function datensaetzeIn(quellen: readonly Quelle[]): number {
  return quellen.reduce((summe, quelle) => summe + quelle.zeilen.length, 0);
}
