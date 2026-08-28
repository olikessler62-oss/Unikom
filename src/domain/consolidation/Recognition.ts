import { dateOrderOf, type Region } from '../tenants/Region.js';
import type { Cell } from './Cell.js';
import { isAmbiguous, parseDate } from './Dates.js';
import { isWholeNumber, parseNumber, separatorsOf, type Separators } from './Numbers.js';

/**
 * Das interne Datentypmodell (SPEC-04, Abschnitt 4). Erkannt werden in Etappe 1
 * BOOLEAN, INTEGER, DECIMAL, DATE und STRING; TIME, DATETIME und BINARY sind
 * vorgesehen, aber noch nicht erkannt.
 */
export type FieldType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'TIME' | 'DATETIME' | 'BINARY' | 'NULL';

/** Was als „nicht ausgefüllt" gilt (SPEC-02, Abschnitt 14). Je Profil änderbar. */
export const DEFAULT_NULL_VALUES: readonly string[] = ['', '-', '-', 'N/A', 'n/a', 'NULL', 'null'];

/**
 * Wahrheitswerte. Absichtlich **ohne** 1 und 0: Eine Spalte aus Einsen und
 * Nullen ist häufiger eine Anzahl als ein Ja/Nein. Wer sie als Wahrheitswert
 * will, stellt es im Profil ein — dann ist es eine Entscheidung und keine
 * Vermutung (SPEC-04, Abschnitt 4).
 */
export const DEFAULT_BOOLEANS = {
  wahr: ['ja', 'j', 'yes', 'y', 'true', 'wahr', 'x'],
  falsch: ['nein', 'n', 'no', 'false', 'falsch'],
} as const;

/** SPEC-02, Abschnitt 5 — Untergrenze, nach oben einstellbar. */
export const CONFIDENCE_THRESHOLD = 0.97;
/** SPEC-02, Abschnitt 4 — Regelfall und Obergrenze der Erweiterung. */
export const SAMPLE_SIZE = 100;
export const SAMPLE_LIMIT = 1000;
/** Ab diesem Anteil gilt eine Spalte als uneinheitlich statt als Text. */
export const MIXED_FROM = 0.5;

export interface RecognitionOptions {
  region: Region;
  threshold?: number;
  nullValues?: readonly string[];
  booleans?: { wahr: readonly string[]; falsch: readonly string[] };
}

export interface FieldRecognition {
  name: string;
  type: FieldType;
  /** Anteil der Werte, die zum erkannten Typ passen. */
  confidence: number;
  /** Geprüfte Werte ohne die leeren. */
  checked: number;
  matched: number;
  empty: number;
  /** Werte, die nicht passen — die Grundlage des Prüffalls. Höchstens fünf. */
  outliers: string[];
  /** Sicher genug für die automatische Übernahme. */
  certain: boolean;
  /** Warum nicht sicher, oder was ein Mensch trotzdem wissen sollte. */
  note?: string;
}

const KANDIDATEN: readonly FieldType[] = ['BOOLEAN', 'INTEGER', 'DECIMAL', 'DATE'];

/**
 * Der Typ eines Feldes, aus seinen Werten.
 *
 * Erst 100 Werte (SPEC-02, Abschnitt 4). Reicht das nicht für eine sichere
 * Aussage, wird auf 1.000 erweitert. Reicht auch das nicht, entsteht kein
 * Ergebnis auf gut Glück: Das Feld gilt als unsicher und geht als Prüffall an
 * einen Menschen.
 */
export function recogniseField(name: string, values: readonly string[], options: RecognitionOptions): FieldRecognition {
  const erste = beurteile(name, values.slice(0, SAMPLE_SIZE), options);

  if (erste.certain || values.length <= SAMPLE_SIZE) {
    return erste;
  }

  return beurteile(name, values.slice(0, SAMPLE_LIMIT), options);
}

function beurteile(name: string, werte: readonly string[], options: RecognitionOptions): FieldRecognition {
  const schwelle = options.threshold ?? CONFIDENCE_THRESHOLD;
  const nullWerte = (options.nullValues ?? DEFAULT_NULL_VALUES).map((wert) => wert.trim().toLowerCase());
  const gefuellt = werte.filter((wert) => !nullWerte.includes(wert.trim().toLowerCase()));
  const leer = werte.length - gefuellt.length;

  if (gefuellt.length === 0) {
    return {
      name,
      type: 'NULL',
      confidence: 0,
      checked: 0,
      matched: 0,
      empty: leer,
      outliers: [],
      certain: false,
      note: 'Kein einziger Wert ist gefüllt; der Typ lässt sich daraus nicht bestimmen',
    };
  }

  const werkzeug = werkzeugFuer(options);

  const bewertet = KANDIDATEN.map((typ) => {
    const passend = gefuellt.filter((wert) => passt(wert, typ, werkzeug));

    return { typ, anteil: passend.length / gefuellt.length, passend: passend.length };
  }).sort((links, rechts) => rechts.anteil - links.anteil);

  const bester = bewertet[0];
  const ausreisser = (typ: FieldType): string[] =>
    gefuellt.filter((wert) => !passt(wert, typ, werkzeug)).slice(0, 5);

  if (bester.anteil >= schwelle) {
    return {
      name,
      type: bester.typ,
      confidence: bester.anteil,
      checked: gefuellt.length,
      matched: bester.passend,
      empty: leer,
      outliers: ausreisser(bester.typ),
      certain: true,
      note: hinweisZumDatum(bester.typ, gefuellt),
    };
  }

  // Mindestens die Hälfte sieht aus wie ein Typ, ist aber nicht sicher genug.
  // Das ist etwas anderes als eine Textspalte: Hier ist etwas uneinheitlich,
  // und wer es als Text durchwinkt, verliert die Auffälligkeit still.
  //
  // Die Grenze bei der Hälfte ist gesetzt, nicht gemessen. Sie trennt zwei
  // Fehlerarten: Darunter meldet UniCom eine Textspalte, in der zufällig ein
  // paar Zahlen stehen — lästig. Darüber verschwiegen es eine halb zerlegte
  // Zahlenspalte — teuer.
  if (bester.anteil >= MIXED_FROM) {
    return {
      name,
      type: bester.typ,
      confidence: bester.anteil,
      checked: gefuellt.length,
      matched: bester.passend,
      empty: leer,
      outliers: ausreisser(bester.typ),
      certain: false,
      note:
        `${(bester.anteil * 100).toFixed(1)} % der Werte passen zu ${bester.typ}, ` +
        `die Schwelle liegt bei ${(schwelle * 100).toFixed(0)} %`,
    };
  }

  return {
    name,
    type: 'STRING',
    confidence: 1,
    checked: gefuellt.length,
    matched: gefuellt.length,
    empty: leer,
    outliers: [],
    certain: true,
  };
}

export interface Werkzeug {
  separators: Separators;
  order: ReturnType<typeof dateOrderOf>;
  booleans: { wahr: readonly string[]; falsch: readonly string[] };
}

/** Das Werkzeug einer Region — einmal gebaut, für viele Werte benutzt. */
export function werkzeugFuer(options: RecognitionOptions): Werkzeug {
  return {
    separators: separatorsOf(options.region.locale),
    order: dateOrderOf(options.region.locale),
    booleans: options.booleans ?? DEFAULT_BOOLEANS,
  };
}

/**
 * Der Typ eines einzelnen Wertes.
 *
 * Die Reihenfolge ist die von KANDIDATEN: Wahrheitswert vor ganzer Zahl vor
 * Dezimalzahl vor Datum. Wer hier etwas anderes will, ändert die Liste — nicht
 * eine zweite Erkennung daneben.
 */
export function typeOfValue(wert: string, werkzeug: Werkzeug, nullWerte: readonly string[] = DEFAULT_NULL_VALUES): FieldType {
  if (nullWerte.some((leer) => leer.toLowerCase() === wert.trim().toLowerCase())) {
    return 'NULL';
  }

  return KANDIDATEN.find((typ) => passt(wert, typ, werkzeug)) ?? 'STRING';
}

function passt(wert: string, typ: FieldType, werkzeug: Werkzeug): boolean {
  const roh = wert.trim();

  switch (typ) {
    case 'BOOLEAN': {
      const klein = roh.toLowerCase();
      return werkzeug.booleans.wahr.includes(klein) || werkzeug.booleans.falsch.includes(klein);
    }
    case 'INTEGER':
      return isWholeNumber(roh, werkzeug.separators);
    case 'DECIMAL':
      return parseNumber(roh, werkzeug.separators) !== undefined;
    case 'DATE':
      return parseDate(roh, werkzeug.order) !== undefined;
    default:
      return false;
  }
}

/**
 * Bei Datumsangaben, die unter einer anderen Region einen anderen Tag ergäben,
 * hängt das Ergebnis allein an der Einstellung des Mandanten. Das gehört einem
 * Menschen gesagt, bevor er die Datei freigibt — es ist kein Fehler, aber die
 * Stelle, an der einer entstünde.
 */
function hinweisZumDatum(typ: FieldType, werte: readonly string[]): string | undefined {
  if (typ !== 'DATE') {
    return undefined;
  }

  const mehrdeutig = werte.filter((wert) => isAmbiguous(wert)).length;

  return mehrdeutig === 0
    ? undefined
    : `${mehrdeutig} von ${werte.length} Angaben ergäben unter einer anderen Region einen anderen Tag`;
}

/**
 * Der Typ eines Feldes, wenn die Quelle ihn selbst kennt.
 *
 * Eine Tabellenkalkulation weiß, was in einer Zelle steht. Diese Auskunft zu
 * verwerfen und den angezeigten Text neu zu erraten, wäre der Fehler: Aus
 * einer Zahl würde je nach Region wieder eine Frage, und aus einem Datum eine
 * fünfstellige Zahl.
 *
 * Nur wo die Quelle „Text" sagt, wird erkannt — denn dort weiß sie es selbst
 * nicht besser, und Menschen tragen Zahlen auch in Textspalten ein.
 */
export function recogniseTypedField(
  name: string,
  cells: readonly Cell[],
  options: RecognitionOptions
): FieldRecognition {
  const gefuellt = cells.filter((zelle) => zelle.declared !== 'EMPTY');
  const schwelle = options.threshold ?? CONFIDENCE_THRESHOLD;

  if (gefuellt.length === 0) {
    return beurteile(name, [], options);
  }

  if (gefuellt.every((zelle) => zelle.declared === 'STRING')) {
    return beurteile(name, gefuellt.map((zelle) => zelle.text), options);
  }

  const haeufigkeit = new Map<string, number>();

  for (const zelle of gefuellt) {
    haeufigkeit.set(zelle.declared, (haeufigkeit.get(zelle.declared) ?? 0) + 1);
  }

  const [haeufigster, anzahl] = [...haeufigkeit.entries()].sort((links, rechts) => rechts[1] - links[1])[0];
  const anteil = anzahl / gefuellt.length;
  const abweichend = gefuellt.filter((zelle) => zelle.declared !== haeufigster);

  const typ: FieldType =
    haeufigster === 'DATE'
      ? 'DATE'
      : haeufigster === 'BOOLEAN'
        ? 'BOOLEAN'
        : haeufigster === 'NUMBER'
          ? gefuellt.every((zelle) => zelle.declared !== 'NUMBER' || !zelle.text.includes('.'))
            ? 'INTEGER'
            : 'DECIMAL'
          : 'STRING';

  return {
    name,
    type: typ,
    confidence: anteil,
    checked: gefuellt.length,
    matched: anzahl,
    empty: cells.length - gefuellt.length,
    outliers: abweichend.slice(0, 5).map((zelle) => zelle.text),
    certain: anteil >= schwelle,
    note:
      anteil >= schwelle
        ? 'Vom Format der Quelle vorgegeben, nicht erraten'
        : `Die Quelle gibt in dieser Spalte mehrere Arten an: ${[...haeufigkeit.keys()].join(', ')}`,
  };
}
