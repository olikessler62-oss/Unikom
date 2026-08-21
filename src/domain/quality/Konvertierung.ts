import { parseDate } from '../consolidation/Dates.js';
import { parseNumber, separatorsOf } from '../consolidation/Numbers.js';
import { DEFAULT_BOOLEANS, type FieldType } from '../consolidation/Recognition.js';
import { dateOrderOf, type Region } from '../tenants/Region.js';
import { leerart } from './Normalisierung.js';

/**
 * Konvertierung in den Zieltyp (SPEC-04, Abschnitt 4; SPEC-08, Abschnitt 3).
 *
 * Eine automatische Konvertierung ist zulässig, **wenn sie eindeutig und ohne
 * unerlaubten Informationsverlust möglich ist**. Alles andere ist ein Konflikt
 * und keine Notlösung:
 *
 * ```text
 * "12345"      → Integer 12345      erlaubt
 * "18.08.2026" → Date               erlaubt, sofern die Region feststeht
 * "ABC123"     → Integer            Konflikt — nicht konvertierbar
 * 1234.56      → Integer            Konflikt — Datenverlust
 * 9007199254740993 → Integer        Konflikt — Überlauf
 * ```
 *
 * ## Warum ein Konflikt und keine Kürzung
 *
 * `1234.56` zu `1234` zu machen ist die bequemste Zeile Code im ganzen Modul
 * und der teuerste Fehler: Aus 56 Cent je Datensatz werden über ein Jahr
 * Beträge, die niemand mehr erklären kann — und die Datei sieht dabei die ganze
 * Zeit richtig aus. „Überläufe dürfen nicht automatisch durch Kürzung oder
 * andere Datenverluste behandelt werden" steht deshalb ausdrücklich in der Spec.
 */
export type Konfliktart = 'UNGUELTIG' | 'VERLUST' | 'UEBERLAUF' | 'MEHRDEUTIG';

export type Konvertierung =
  | { ok: true; typ: FieldType; wert: string | number | boolean | null; text: string; hinweis?: string }
  | { ok: false; art: Konfliktart; grund: string; auswirkung: string };

export interface Konvertierungsoptionen {
  region: Region;
  /** Werte, die als „nichts" gelten. */
  nullWerte?: readonly string[];
  /** Eigene Schreibweisen für wahr und falsch (SPEC-04, Abschnitt 4). */
  booleans?: { wahr: readonly string[]; falsch: readonly string[] };
  /** Ob ein leerer Wert erlaubt ist; sonst ist er ein Konflikt. */
  leerErlaubt?: boolean;
  jahrhundertGrenze?: number;
}

function konflikt(art: Konfliktart, grund: string, auswirkung: string): Konvertierung {
  return { ok: false, art, grund, auswirkung };
}

export function konvertiere(text: string, ziel: FieldType, options: Konvertierungsoptionen): Konvertierung {
  const art = leerart(text, options.nullWerte);

  if (art !== 'GEFUELLT') {
    return options.leerErlaubt === false
      ? konflikt(
          'UNGUELTIG',
          `Der Wert ist ${art === 'NULL' ? 'nicht vorhanden' : art === 'LEER' ? 'leer' : 'nur ein Leerzeichen'}`,
          'Das Feld ist als Pflichtfeld eingerichtet; der Datensatz kann so nicht übernommen werden'
        )
      : { ok: true, typ: 'NULL', wert: null, text };
  }

  switch (ziel) {
    case 'STRING':
      return { ok: true, typ: 'STRING', wert: text, text };

    case 'INTEGER':
      return alsGanzzahl(text, options);

    case 'DECIMAL':
      return alsDezimalzahl(text, options);

    case 'BOOLEAN':
      return alsWahrheitswert(text, options);

    case 'DATE':
    case 'DATETIME':
      return alsDatum(text, ziel, options);

    default:
      return { ok: true, typ: ziel, wert: text, text };
  }
}

/**
 * Die Grenze, bis zu der eine Ganzzahl in JavaScript **genau** ist.
 *
 * Darüber rechnet die Sprache weiter und rundet dabei still: `9007199254740993`
 * wird zu `9007199254740992`, und keine Warnung sagt es. Eine Kundennummer, die
 * sich beim Einlesen um eins ändert, ist der Fehler, den niemand findet.
 */
const GENAU_BIS = Number.MAX_SAFE_INTEGER;

function alsGanzzahl(text: string, options: Konvertierungsoptionen): Konvertierung {
  const zahl = parseNumber(text, separatorsOf(options.region.locale));

  if (zahl === undefined) {
    return konflikt(
      'UNGUELTIG',
      `„${text}" ist keine Zahl`,
      'Der Wert kann nicht in eine Ganzzahl umgesetzt werden; der Datensatz geht als Prüffall an einen Menschen'
    );
  }

  if (!Number.isInteger(zahl)) {
    return konflikt(
      'VERLUST',
      `„${text}" hat Nachkommastellen`,
      'Sie abzuschneiden wäre ein Datenverlust — aus 1.234,56 würde 1.234. Unikom tut das nicht von selbst'
    );
  }

  if (Math.abs(zahl) > GENAU_BIS) {
    return konflikt(
      'UEBERLAUF',
      `„${text}" liegt über dem Bereich, in dem ganze Zahlen genau bleiben`,
      'Weiterzurechnen würde den Wert still verändern; deshalb wird hier abgebrochen statt gerundet'
    );
  }

  return { ok: true, typ: 'INTEGER', wert: zahl, text };
}

function alsDezimalzahl(text: string, options: Konvertierungsoptionen): Konvertierung {
  const zahl = parseNumber(text, separatorsOf(options.region.locale));

  if (zahl === undefined) {
    return konflikt(
      'UNGUELTIG',
      `„${text}" ist keine Zahl`,
      'Der Wert kann nicht als Dezimalzahl gelesen werden; der Datensatz geht als Prüffall an einen Menschen'
    );
  }

  return { ok: true, typ: 'DECIMAL', wert: zahl, text };
}

function alsWahrheitswert(text: string, options: Konvertierungsoptionen): Konvertierung {
  const gewaehlt = options.booleans ?? DEFAULT_BOOLEANS;
  const gesucht = text.trim().toLowerCase();

  if (gewaehlt.wahr.some((eintrag) => eintrag.toLowerCase() === gesucht)) {
    return { ok: true, typ: 'BOOLEAN', wert: true, text };
  }

  if (gewaehlt.falsch.some((eintrag) => eintrag.toLowerCase() === gesucht)) {
    return { ok: true, typ: 'BOOLEAN', wert: false, text };
  }

  /*
   * `1` und `0` sind bewusst nicht voreingestellt (siehe `DEFAULT_BOOLEANS`).
   * In einer Mengenspalte heißt `1` nun einmal eins, und wer sie als „wahr"
   * liest, hat aus einer Bestellung über ein Stück ein Ja gemacht.
   */
  return konflikt(
    'MEHRDEUTIG',
    `„${text}" ist keine der eingerichteten Schreibweisen für wahr oder falsch`,
    `Erwartet wird eine von: ${[...gewaehlt.wahr, ...gewaehlt.falsch].join(', ')}. ` +
      'Weitere Schreibweisen lassen sich im Profil eintragen'
  );
}

function alsDatum(text: string, ziel: FieldType, options: Konvertierungsoptionen): Konvertierung {
  const reihenfolge = dateOrderOf(options.region.locale);
  const gelesen = parseDate(text, reihenfolge, options.jahrhundertGrenze);

  if (!gelesen) {
    return konflikt(
      'UNGUELTIG',
      `„${text}" ist kein Datum in der Schreibweise dieser Region`,
      `Gelesen wird nach ${reihenfolge === 'DAY_FIRST' ? 'Tag zuerst' : reihenfolge === 'MONTH_FIRST' ? 'Monat zuerst' : 'Jahr zuerst'}; ` +
        'stimmt das nicht, gehört die Region an den Mandanten'
    );
  }

  const zweistellig = /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2}\b/.test(text);
  const iso = `${String(gelesen.year).padStart(4, '0')}-${String(gelesen.month).padStart(2, '0')}-${String(gelesen.day).padStart(2, '0')}`;

  return {
    ok: true,
    typ: ziel,
    wert: iso,
    text,
    hinweis: zweistellig
      ? `Die Jahreszahl war zweistellig und wurde als ${gelesen.year} gelesen ` +
        `(Grenze ${options.jahrhundertGrenze ?? 50}). Bei alten Geburtsdaten ist das zu prüfen`
      : undefined,
  };
}
