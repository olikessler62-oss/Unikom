import { decode, detectEncoding, type Encoding } from './Csv.js';

/**
 * Der Anfang einer Datei, so weit man ihn ansehen muss, um sie zu erkennen.
 *
 * ## Warum nur der Anfang
 *
 * Eine Lieferung hat zweihundert Megabyte. Sie in eine Textfläche im Browser zu
 * laden, wäre in jeder Hinsicht falsch: Der Server hielte sie im Speicher, die
 * Antwort ginge über die Leitung, und der Browser bekäme zweihundert Megabyte
 * für eine Frage, die nach hundert Zeilen beantwortet ist. Die Erkennung liest
 * Aufbau und Typen aus einer **Stichprobe**; mehr trägt nichts bei.
 *
 * Vierundsechzig Kilobyte sind bei einer gewöhnlichen Zeile von achtzig Zeichen
 * rund achthundert Datensätze. Das ist reichlich für ein Muster und immer noch
 * eine Antwort, die sofort da ist.
 *
 * ## Warum am Zeilenende geschnitten wird
 *
 * Zwei Gründe, und beide zählen einzeln.
 *
 * Der eine ist sichtbar: Eine halbe letzte Zeile hat zu wenig Felder und sähe
 * für die Erkennung aus wie eine Zeile, die aus der Reihe fällt — bei
 * achthundert guten Zeilen keine Katastrophe, aber eine Auffälligkeit, die es
 * in der Datei nicht gibt.
 *
 * Der andere ist unsichtbar und schlimmer: Ein Schnitt mitten in einem
 * mehrteiligen Zeichen macht aus gültigem UTF-8 ungültiges. `detectEncoding`
 * prüft streng — es fiele dann auf Windows-1252 zurück, und die **ganze**
 * Stichprobe käme falsch entziffert heraus. Aus „Müller" würde „MÃ¼ller", und
 * zwar überall, wegen eines abgeschnittenen Zeichens ganz am Ende.
 *
 * Der Zeilenumbruch löst beides zugleich: `0x0A` kommt in UTF-8 nur als es
 * selbst vor, nie als Teil eines anderen Zeichens. Wer dort schneidet, schneidet
 * immer zwischen zwei vollständigen Zeichen.
 */
export const PROBE_BYTES = 64 * 1024;

const UMBRUCH = 0x0a;

/** Was eine Datei ist, soweit ihre ersten Bytes es verraten. */
export type Signatur = 'ZIP' | 'OLE2' | 'PDF' | 'UTF-16';

const SIGNATUREN: readonly { art: Signatur; magie: readonly number[] }[] = [
  // Auch .xlsx und .docx — beides sind Zip-Archive mit anderem Inhalt.
  { art: 'ZIP', magie: [0x50, 0x4b, 0x03, 0x04] },
  // Das alte Office-Format: .xls, .doc.
  { art: 'OLE2', magie: [0xd0, 0xcf, 0x11, 0xe0] },
  { art: 'PDF', magie: [0x25, 0x50, 0x44, 0x46] },
  { art: 'UTF-16', magie: [0xff, 0xfe] },
  { art: 'UTF-16', magie: [0xfe, 0xff] },
];

/**
 * Woran der Anfang der Datei erinnert — oder nichts, wenn nichts passt.
 *
 * Nur für die **Auskunft**, nicht für die Entscheidung: Ob gelesen wird,
 * entscheidet `istText`. Eine Signatur nennt beim Namen, was sonst als
 * „irgendetwas Binäres" abgewiesen würde — und der Unterschied zwischen „das
 * geht hier nicht" und „das ist eine Excel-Mappe, speichern Sie das Blatt als
 * CSV" ist der zwischen einer Sackgasse und einem nächsten Schritt.
 */
export function signaturVon(bytes: Uint8Array): Signatur | undefined {
  return SIGNATUREN.find((eintrag) => eintrag.magie.every((byte, stelle) => bytes[stelle] === byte))?.art;
}

/**
 * Ob das Text ist — daran, dass kein Nullbyte darin steht.
 *
 * Eine Textdatei enthält keines: Weder UTF-8 noch Windows-1252 erzeugen es,
 * und kein Editor schreibt es. Jedes gepackte, gebündelte oder gerenderte
 * Format dagegen enthält früher oder später eines, meist in den ersten Zeilen.
 *
 * Gezählt wird nicht, geraten wird nicht: Ein Anteil unlesbarer Zeichen wäre
 * eine Schwelle, und eine Schwelle weist irgendwann eine Datei ab, die in
 * Ordnung ist. Das Nullbyte ist eine Tatsache und keine Schätzung.
 *
 * UTF-16 fällt damit auch heraus, und das ist richtig: Es ist zwar Text, aber
 * keiner, den Unikom liest — `detectEncoding` kennt UTF-8 und Windows-1252.
 * Die Signatur sagt es beim Namen, statt es als „binär" abzutun.
 */
export function istText(bytes: Uint8Array): boolean {
  return !bytes.includes(0);
}

/**
 * Warum diese Datei hier nicht gelesen wird — als Satz, der weiterhilft.
 *
 * „Das ist keine Textdatei" ist richtig und beendet das Gespräch. Wer eine
 * Excel-Mappe ausgesucht hat, hat nichts Unvernünftiges getan; er soll erfahren,
 * was stattdessen geht — und dass Unikom seine Mappe im Lauf sehr wohl liest,
 * nur hier noch nicht.
 */
export function warumKeinText(signatur: Signatur | undefined, name: string): string {
  switch (signatur) {
    case 'ZIP':
      return (
        `„${name}" ist ein gepacktes Archiv - eine Excel-Mappe (.xlsx) ist auch eines. ` +
        'Unikom liest Tabellenblätter im Lauf; für die Erkennung hier speichern Sie das Blatt bitte als CSV.'
      );
    case 'OLE2':
      return (
        `„${name}" ist im alten Office-Format gespeichert (.xls, .doc). ` +
        'Speichern Sie das Blatt als CSV - das alte Format liest Unikom an keiner Stelle.'
      );
    case 'PDF':
      return (
        `„${name}" ist ein PDF. Darin stehen Seiten und keine Spalten; ` +
        'was als Tabelle aussieht, ist dort gezeichnet und nicht gespeichert.'
      );
    case 'UTF-16':
      return (
        `„${name}" ist als UTF-16 gespeichert. Unikom liest UTF-8 und Windows-1252 - ` +
        'speichern Sie die Datei in einer der beiden.'
      );
    default:
      return `„${name}" ist keine Textdatei: Sie enthält Nullbytes, und die kommen in Text nicht vor.`;
  }
}

/**
 * Bis zum letzten vollständigen Zeilenumbruch — für eine abgeschnittene Probe.
 *
 * Gibt es keinen, war die Datei eine einzige lange Zeile. Dann wird nichts
 * fortgenommen: Eine Stichprobe, die auf null Bytes schrumpft, weil in
 * vierundsechzig Kilobyte kein Umbruch stand, wäre schlechter als eine, deren
 * letztes Zeichen unvollständig ist.
 */
export function bisZurLetztenZeile(bytes: Uint8Array): Uint8Array {
  const letzter = bytes.lastIndexOf(UMBRUCH);

  return letzter === -1 ? bytes : bytes.subarray(0, letzter + 1);
}

export interface Probe {
  text: string;
  kodierung: Encoding;
  /** Wie viele Bytes am Ende übrig blieben — nach dem Schnitt an der Zeile. */
  bytes: number;
}

/**
 * Der gelesene Anfang, entziffert.
 *
 * `gekuerzt` sagt, ob die Datei größer war als das, was hereinkam. Nur dann
 * wird geschnitten: Bei einer Datei, die vollständig hereinpasst, ist das Ende
 * ihr Ende — dort etwas fortzunehmen hieße, eine letzte Zeile zu verlieren, die
 * ohne abschließenden Umbruch dasteht, und das ist der Normalfall.
 */
export function probeAus(kopf: Uint8Array, gekuerzt: boolean): Probe {
  const nutzbar = gekuerzt ? bisZurLetztenZeile(kopf) : kopf;
  const kodierung = detectEncoding(nutzbar);

  return { text: decode(nutzbar, kodierung), kodierung, bytes: nutzbar.length };
}
