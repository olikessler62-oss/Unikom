import type { Quelle } from '../../domain/consolidation/Quellen.js';
import { waehleBlatt, type Blattwahl } from '../../domain/consolidation/Quellen.js';
import { ersatzname } from '../../domain/consolidation/Spaltennamen.js';
import type { RecognitionOptions } from '../../domain/consolidation/Recognition.js';
import { ausTabelle, texte, type Gelesen } from '../../infrastructure/formats/Bestand.js';
import { readCsv } from '../../infrastructure/formats/Csv.js';
import { readJson } from '../../infrastructure/formats/Json.js';
import { discoverSheet, readXlsx, type XlsxSheet } from '../../infrastructure/formats/Xlsx.js';
import { readXml } from '../../infrastructure/formats/Xml.js';

/**
 * Was in einen Konsolidierungslauf hineingeht (SPEC-06, Abschnitt 2 und 8).
 *
 * ```text
 * Datei          →  Leser  →  Quelle
 * Bestellungen.csv   CSV      „Bestellungen.csv"
 * Filialen.xlsx      XLSX     „Filialen.xlsx, Blatt ‚Nord'"
 * ```
 *
 * Der Teil ohne Dateisystem: Hier steht, **welche** Datei mitkommt und **wie**
 * sie gelesen wird. Das Aufsuchen und Öffnen macht der Dienst — so lässt sich
 * das Heikle prüfen, ohne Verzeichnisse anzulegen.
 *
 * ## Nichts kommt mit, weil es zufällig danebenliegt
 *
 * „Nicht ausdrücklich ausgewählte oder eindeutig über eine Regel bestimmte
 * Dateien dürfen nicht automatisch Bestandteil einer Konsolidierung werden"
 * (SPEC-06, Abschnitt 2). Ein Muster ist eine solche Regel. Ein Verzeichnis
 * ist keine.
 */

/** Die Formate, für die es einen Leser gibt. */
export const LESBARE_ENDUNGEN: readonly string[] = ['.csv', '.txt', '.tsv', '.json', '.xml', '.xlsx'];

export function istLesbar(name: string): boolean {
  const kleingeschrieben = name.toLowerCase();

  return LESBARE_ENDUNGEN.some((endung) => kleingeschrieben.endsWith(endung));
}

/*
 * Die Musterregel steht in der Domäne: Auch der Stapel prüft damit, ob eine
 * Datei zu einem erwarteten Platz gehört. Zwei Auslegungen desselben
 * Sternchens wären ein Fehler, den man nur im Ergebnis sieht.
 */
export { passt, passtEndung, musterAlsRegex } from '../../domain/consolidation/Namensmuster.js';

export interface Eingangsdatei {
  /** Der Name, unter dem die Quelle später in jeder Meldung erscheint. */
  name: string;
  bytes: Uint8Array;
  /** Wann die Datei zuletzt verändert wurde — für die Aktualitätsregel. */
  geaendert?: string;
}

export interface Lesewunsch extends RecognitionOptions {
  /** Bei Arbeitsmappen: welches Blatt. */
  blatt?: Blattwahl;
  /** Wann Unikom gelesen hat; steht am Datenstand jeder Quelle. */
  eingelesen?: string;
}

export interface Leseergebnis {
  quellen: Quelle[];
  hinweise: string[];
}

/**
 * Eine Datei als Quelle oder Quellen.
 *
 * Eine Arbeitsmappe kann mehrere sein — deshalb eine Liste und kein einzelner
 * Wert. Alles andere ergibt genau eine.
 */
export function liesDatei(datei: Eingangsdatei, wunsch: Lesewunsch): Leseergebnis {
  const endung = datei.name.slice(datei.name.lastIndexOf('.')).toLowerCase();
  const stand = { geaendert: datei.geaendert, eingelesen: wunsch.eingelesen };

  if (endung === '.xlsx') {
    return ausMappe(datei, wunsch, stand);
  }

  const gelesen = einfachesFormat(endung, datei.bytes, wunsch);

  if (!gelesen) {
    return {
      quellen: [],
      hinweise: [
        `„${datei.name}" wurde übergangen: Für die Endung „${endung}" gibt es keinen Leser. ` +
          `Gelesen werden ${LESBARE_ENDUNGEN.join(', ')}`,
      ],
    };
  }

  return {
    quellen: [
      {
        id: datei.name,
        name: datei.name,
        felder: gelesen.fields,
        zeilen: gelesen.rows.map(texte),
        stand,
      },
    ],
    hinweise: gelesen.notes,
  };
}

function einfachesFormat(endung: string, bytes: Uint8Array, wunsch: Lesewunsch): Gelesen | undefined {
  switch (endung) {
    case '.csv':
    case '.txt':
    case '.tsv':
      return ausTabelle(readCsv(bytes, wunsch));
    case '.json':
      return readJson(bytes);
    case '.xml':
      return readXml(bytes);
    default:
      return undefined;
  }
}

/**
 * Ein Blatt einer Arbeitsmappe — und nur eines, das benannt wurde.
 *
 * Hat die Mappe genau ein Blatt, ist die Wahl eindeutig und braucht keine
 * Angabe. Bei mehreren wird **keines** ersatzweise genommen: „Ein Bericht, der
 * stillschweigend ‚Tabelle1' liest, weil ‚Umsatz 2026' nicht da ist, ist
 * schlimmer als gar kein Bericht — er sieht richtig aus" (SPEC-06, Abschnitt 8).
 */
function ausMappe(datei: Eingangsdatei, wunsch: Lesewunsch, stand: Quelle['stand']): Leseergebnis {
  const mappe = readXlsx(Buffer.from(datei.bytes));
  const namen = mappe.sheets.map((blatt) => blatt.name);

  if (namen.length === 0) {
    return { quellen: [], hinweise: [`„${datei.name}" enthält kein Tabellenblatt`] };
  }

  const wahl: Blattwahl = wunsch.blatt ?? { position: 1 };

  if (!wunsch.blatt && namen.length > 1) {
    return {
      quellen: [],
      hinweise: [
        `„${datei.name}" hat ${namen.length} Tabellenblätter (${namen.join(', ')}) und es ist keines ausgewählt. ` +
          'Trage das Blatt am Konsolidierungsschritt ein - ersatzweise eines zu nehmen, ergäbe einen Bericht, ' +
          'der richtig aussieht und es nicht ist',
      ],
    };
  }

  const ergebnis = waehleBlatt(namen, wahl);

  if (!ergebnis.ok) {
    return { quellen: [], hinweise: [`„${datei.name}": ${ergebnis.meldung}`] };
  }

  const blatt = mappe.sheets[ergebnis.position - 1];
  const gelesen = ausBlatt(blatt, wunsch);

  return {
    quellen: [
      {
        id: `${datei.name}#${ergebnis.name}`,
        name: datei.name,
        blatt: ergebnis.name,
        felder: gelesen.fields,
        zeilen: gelesen.zeilen,
        stand,
      },
    ],
    hinweise: [...mappe.notes, ...gelesen.notes],
  };
}

/**
 * Wo in einem Blatt die Daten anfangen.
 *
 * Eine Tabelle beginnt selten in A1: Darüber stehen Titel, ein Logo, ein
 * Berichtszeitraum. Deshalb läuft dasselbe Verfahren wie bei einer E-Mail
 * darüber — die Blocksuche —, statt anzunehmen, die erste Zeile sei die
 * Kopfzeile.
 */
function ausBlatt(blatt: XlsxSheet, wunsch: Lesewunsch): { fields: string[]; zeilen: string[][]; notes: string[] } {
  const erkannt = discoverSheet(blatt, wunsch);
  const block = erkannt.blocks[0];

  if (!block) {
    return {
      fields: [],
      zeilen: [],
      notes: [...erkannt.notes, `Im Blatt „${blatt.name}" wurde kein zusammenhängender Datenblock gefunden`],
    };
  }

  return {
    fields: block.columns.map((spalte, index) => spalte.name ?? ersatzname(index)),
    zeilen: block.rows,
    notes: erkannt.notes,
  };
}
