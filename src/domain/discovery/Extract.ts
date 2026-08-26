import { ersatzname } from '../consolidation/Spaltennamen.js';
import type { DataBlock } from './Discovery.js';

/**
 * Aus einem erkannten Datenblock einen sauberen Datenbestand machen.
 *
 * Der Block ist bis hierher eine Ansicht: erkannte Zeilen in einem Inhalt, der
 * daneben noch Anrede und Grußformel enthält. Um damit weiterzuarbeiten,
 * braucht die Verarbeitung eine Datei, die nichts weiter enthält als die
 * Daten — mit Kopfzeile, einem Trennzeichen und Anführungszeichen dort, wo sie
 * nötig sind.
 *
 * Bewusst als CSV mit Semikolon und in UTF-8: Das liest jedes Werkzeug, das
 * danach kommt, und die Übertragung und Konsolidierung von Unikom kennen es
 * ohnehin. Was hier entsteht, ist nichts Neues, sondern der Normalfall.
 */
export const EXTRACT_DELIMITER = ';';

export interface ExtractOptions {
  /** Ob eine Kopfzeile geschrieben wird. Ohne Namen wird „Spalte 1" daraus. */
  header?: boolean;
  delimiter?: string;
}

export function toCsv(block: DataBlock, options: ExtractOptions = {}): string {
  const trenner = options.delimiter ?? EXTRACT_DELIMITER;
  const mitKopf = options.header ?? true;
  const zeilen: string[] = [];

  if (mitKopf) {
    zeilen.push(
      block.columns.map((spalte, index) => feld(spalte.name ?? ersatzname(index), trenner)).join(trenner)
    );
  }

  for (const zeile of block.rows) {
    // Auf die Breite des Blocks bringen: Eine Zeile, in der ein Feld fehlt,
    // gehört zum Block (die Erkennung ist tolerant), darf die Datei aber nicht
    // verschieben.
    const gerade = Array.from({ length: block.columns.length }, (_, index) => zeile[index] ?? '');

    zeilen.push(gerade.map((wert) => feld(wert, trenner)).join(trenner));
  }

  return `${zeilen.join('\r\n')}\r\n`;
}

/**
 * Ein Feld in Anführungszeichen, wo es sein muss.
 *
 * Nötig ist das bei Trennzeichen, Anführungszeichen und Zeilenumbrüchen im
 * Wert. Ohne diese Behandlung erzeugte ausgerechnet die Bereinigung eine
 * Datei, die beim nächsten Lesen anders zerfällt als sie geschrieben wurde.
 */
function feld(wert: string, trenner: string): string {
  const muss = wert.includes(trenner) || wert.includes('"') || /[\r\n]/.test(wert);

  return muss ? `"${wert.replace(/"/g, '""')}"` : wert;
}

/** Ein Name, der sich von selbst sortiert und sagt, woher die Datei kommt. */
export function extractFilename(basis: string, moment: Date, endung = 'csv'): string {
  const zweistellig = (wert: number): string => String(wert).padStart(2, '0');
  const stempel =
    `${moment.getFullYear()}-${zweistellig(moment.getMonth() + 1)}-${zweistellig(moment.getDate())}` +
    `-${zweistellig(moment.getHours())}${zweistellig(moment.getMinutes())}${zweistellig(moment.getSeconds())}`;

  return `${basis}-${stempel}.${endung}`;
}
