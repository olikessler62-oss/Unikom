import { SPEICHER_JE_DATENSATZ_BYTES } from './Menge.js';

/**
 * Die Verarbeitung in klar abgegrenzte Schritte teilen (SPEC-06, Abschnitt 15).
 *
 * ```text
 * 1.200.000 Datensätze
 *      │
 *      ├── Block 1  … 150.000    verarbeitet, Zwischenstand gespeichert
 *      ├── Block 2  … 150.000    verarbeitet, Zwischenstand gespeichert
 *      ├── Block 3  … 150.000    ← hier bricht der Strom ab
 *      └── …                     beim nächsten Lauf geht es hier weiter
 * ```
 *
 * ## Der Schlüssel bestimmt den Block, nicht die Reihenfolge
 *
 * Nach den ersten 150 000 Zeilen zu schneiden wäre der naheliegende Weg und
 * der falsche: Ein Kunde mit Sätzen in Block 1 und Block 4 würde zweimal
 * verarbeitet und käme zweimal ins Ergebnis. Die Konsolidierung braucht **alle
 * Sätze eines Schlüssels beisammen**.
 *
 * Deshalb entscheidet der Schlüssel, in welchen Block ein Satz kommt — über
 * eine Streuung, die immer dasselbe Ergebnis liefert. Das ist die Bedingung
 * für die Fortsetzbarkeit: Ein abgebrochener Lauf muss dieselbe Aufteilung
 * wiederfinden, sonst wäre der gespeicherte Zwischenstand von Block 2 beim
 * nächsten Mal der von etwas anderem.
 *
 * ## Ein Block ist keine feste Zahl
 *
 * „Die Größe der Verarbeitungsschritte ist nicht fest auf eine bestimmte
 * Datensatzanzahl beschränkt, sondern muss abhängig von Datenmenge,
 * Datenstruktur, Konfiguration und verfügbaren Ressourcen bestimmt werden
 * können." Sie ergibt sich hier aus dem Speicher, den ein Block kosten darf,
 * und aus dem gemessenen Preis eines Datensatzes.
 *
 * ## Der Normalfall bleibt unberührt
 *
 * Wer 5000 Datensätze konsolidiert, bekommt **einen** Block und damit genau
 * den Ablauf von vorher. Blockweise Verarbeitung, die sich auch bei kleinen
 * Mengen einschaltet, kostet Zwischenstände, Schreibvorgänge und Erklärungen
 * für einen Gewinn, den es dort nicht gibt.
 */
export interface Blockplan {
  /** Wie viele Schritte geplant sind. 1 heißt: wie bisher, in einem Zug. */
  bloecke: number;
  /** Wie viele Datensätze auf einen Block entfallen, im Mittel. */
  jeBlock: number;
  datensaetze: number;
  /** Was ein Block ungefähr kostet — die Zahl, aus der die Aufteilung folgt. */
  jeBlockMb: number;
  /** Der Satz für den Bildschirm und das Protokoll. */
  begruendung: string;
}

/**
 * Wie viel Arbeitsspeicher ein einzelner Block kosten darf.
 *
 * 256 MB sind großzügig genug, dass ein gewöhnlicher Lauf in einen Block passt,
 * und klein genug, dass zwei gleichzeitige Läufe nebeneinander bestehen.
 */
export const BLOCK_SPEICHER_MB = 256;

export interface Blockoptionen {
  /** Was ein Block kosten darf; ohne Angabe `BLOCK_SPEICHER_MB`. */
  speicherMb?: number;
  /** Eine feste Blockgröße, wo jemand sie kennt — sie sticht die Rechnung. */
  jeBlock?: number;
}

export function planeBloecke(datensaetze: number, optionen: Blockoptionen = {}): Blockplan {
  const speicherMb = optionen.speicherMb ?? BLOCK_SPEICHER_MB;
  const passtInEinenBlock = Math.max(1, Math.floor((speicherMb * 1024 * 1024) / SPEICHER_JE_DATENSATZ_BYTES));
  const jeBlock = Math.max(1, optionen.jeBlock ?? passtInEinenBlock);

  const bloecke = datensaetze === 0 ? 1 : Math.ceil(datensaetze / jeBlock);
  const jeBlockMb = Math.round((Math.min(jeBlock, Math.max(datensaetze, 1)) * SPEICHER_JE_DATENSATZ_BYTES) / 1024 / 1024);

  return {
    bloecke,
    jeBlock,
    datensaetze,
    jeBlockMb,
    begruendung:
      bloecke === 1
        ? `${datensaetze.toLocaleString('de-DE')} Datensätze passen in einen Schritt (etwa ${jeBlockMb} MB)`
        : `${datensaetze.toLocaleString('de-DE')} Datensätze werden in ${bloecke} Schritten zu je etwa ` +
          `${jeBlock.toLocaleString('de-DE')} verarbeitet (etwa ${jeBlockMb} MB je Schritt). Die Aufteilung folgt ` +
          'dem Konsolidierungsschlüssel, damit alle Sätze eines Schlüssels im selben Schritt liegen',
  };
}

/**
 * In welchen Block ein Schlüssel gehört.
 *
 * FNV-1a, 32 Bit — und ausdrücklich **keine** eingebaute Streuung: Die
 * Aufteilung muss über Prozessgrenzen und Programmversionen hinweg dieselbe
 * sein, sonst findet ein fortgesetzter Lauf seine Zwischenstände nicht wieder.
 * Ein Verfahren, das die Laufzeitumgebung beisteuert, gibt diese Zusage nicht.
 */
export function blockFuer(schluessel: string, bloecke: number): number {
  if (bloecke <= 1) {
    return 0;
  }

  return streuung(schluessel) % bloecke;
}

const FNV_ANFANG = 0x811c9dc5;
const FNV_PRIMZAHL = 0x01000193;

export function streuung(text: string): number {
  let wert = FNV_ANFANG;

  for (let stelle = 0; stelle < text.length; stelle += 1) {
    wert ^= text.charCodeAt(stelle);
    // Multiplikation ohne Überlauf ins Negative: `>>> 0` hält den Wert in
    // 32 Bit ohne Vorzeichen, so wie FNV es beschreibt.
    wert = Math.imul(wert, FNV_PRIMZAHL) >>> 0;
  }

  return wert;
}
