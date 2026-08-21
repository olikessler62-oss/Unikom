import { werkzeugFuer, type FieldType, type RecognitionOptions } from '../consolidation/Recognition.js';
import {
  matchScore,
  signatureOf,
  splitContent,
  STRATEGIEN,
  verschmelzeText,
  type Row,
  type Signature,
  type SplitStrategy,
} from './Rows.js';

/**
 * Die Data-Discovery-Engine (FR_007).
 *
 * Sie fragt nicht „welche Datei ist das", sondern „welche verwertbaren
 * Strukturen stecken in diesem Inhalt". Damit ist sie unabhängig davon, ob der
 * Inhalt aus einer Datei, einem E-Mail-Text oder der Zwischenablage kommt.
 *
 * Ihr Fundament ist deterministisch: Zeilenmuster, Wiederholung, Nachbarschaft.
 * Eine KI ist dafür nicht nötig und in V1 auch nicht vorhanden (SPEC-11); sie
 * käme erst dort hinzu, wo diese Verfahren keine ausreichende Sicherheit
 * liefern.
 */

/** Woher eine Aussage über die Struktur stammt. FR_008, „Wichtig für die Implementierung". */
export type Herkunft = 'OBSERVED' | 'CONFIGURED' | 'INFERRED' | 'AI_SUGGESTED' | 'CONFIRMED';

export interface Column {
  /** Aus der Kopfzeile, sofern es eine gibt. */
  name?: string;
  type: FieldType;
  confidence: number;
  herkunft: Herkunft;
}

export interface DataBlock {
  /** Erste und letzte Zeile der Daten im Inhalt, ab 1. */
  start: number;
  end: number;
  /** Die Kopfzeile, sofern eine erkannt wurde. */
  headerLine?: number;
  /** Ihr unveränderter Text — daran erkennt eine hinterlegte Regel „ihren" Block. */
  headerText?: string;
  strategy: SplitStrategy;
  columns: Column[];
  rows: string[][];
  signature: Signature;
  confidence: number;
  /** Woraus sich die Zuversicht zusammensetzt — damit sie erklärbar bleibt. */
  reasons: string[];
}

export interface DiscoveryResult {
  blocks: DataBlock[];
  /** Zeilen, die zu keinem Block gehören — Anrede, Grußformel, Fußzeilen. */
  ignoredLines: number[];
  notes: string[];
}

export interface DiscoveryOptions extends RecognitionOptions {
  /** Weniger Zeilen sind kein Block, sondern ein Zufall. */
  minRows?: number;
  /** Ab hier gilt ein Block als sicher erkannt. */
  minConfidence?: number;
}

const MIN_ROWS = 2;
const MIN_CONFIDENCE = 0.7;

export function discover(inhalt: string, options: DiscoveryOptions): DiscoveryResult {
  const werkzeug = werkzeugFuer(options);
  const minRows = options.minRows ?? MIN_ROWS;
  const minConfidence = options.minConfidence ?? MIN_CONFIDENCE;

  // Jede Zerlegung wird durchgerechnet; gewonnen hat die, die die klarste
  // Struktur ergibt. Das ist billiger als eine Vorab-Vermutung und trifft
  // öfter — eine Zeile „4711;Schraube" ist nun einmal beides, je nachdem.
  const versuche = STRATEGIEN.map((strategie) => {
    const zeilen = splitContent(inhalt, strategie).map((zeile) =>
      strategie === 'LEERZEICHEN' ? { ...zeile, fields: verschmelzeText(zeile.fields, werkzeug) } : zeile
    );

    return { strategie, bloecke: findeBloecke(zeilen, strategie, werkzeug, minRows) };
  }).filter((versuch) => versuch.bloecke.length > 0);

  if (versuche.length === 0) {
    return {
      blocks: [],
      ignoredLines: [],
      notes: ['Keine eindeutige Datenstruktur erkannt'],
    };
  }

  const bester = versuche.sort((links, rechts) => guete(rechts.bloecke) - guete(links.bloecke))[0];
  const blocks = bester.bloecke.filter((block) => block.confidence >= minConfidence);
  const notes: string[] = [];

  if (blocks.length === 0) {
    notes.push('Möglicherweise Daten gefunden, aber nicht sicher genug für eine automatische Übernahme');
  }

  if (blocks.length > 1) {
    notes.push(`${blocks.length} Datenblöcke erkannt; welcher gemeint ist, entscheidet ein Mensch`);
  }

  const belegt = new Set(blocks.flatMap((block) => spanne(block)));
  const zeilenZahl = inhalt.split(/\r\n|\r|\n/).length;
  const ignoriert: number[] = [];

  for (let zeile = 1; zeile <= zeilenZahl; zeile += 1) {
    if (!belegt.has(zeile)) {
      ignoriert.push(zeile);
    }
  }

  return { blocks, ignoredLines: ignoriert, notes };
}

/**
 * Derselbe Blick auf Inhalt, der schon in Felder zerlegt ist.
 *
 * Ein Tabellenblatt, eine Datenbankabfrage, eine bereits zerlegte CSV — dort
 * ist die Zerlegung keine Frage mehr, die Blockbildung aber sehr wohl: Auch
 * ein Excel-Blatt fängt oft erst nach zwei Zeilen Überschrift an.
 *
 * Damit läuft für jede Quelle dieselbe Engine, so wie FR_007, Abschnitt 16,
 * es verlangt — Adapter statt zweiter Erkennung.
 */
export function discoverFields(zeilen: readonly (readonly string[])[], options: DiscoveryOptions): DiscoveryResult {
  const werkzeug = werkzeugFuer(options);
  const rows: Row[] = zeilen.map((felder, index) => ({
    line: index + 1,
    raw: felder.join(' '),
    fields: felder.every((feld) => feld.trim() === '') ? [] : [...felder],
  }));

  const bloecke = findeBloecke(rows, 'VORGEGEBEN', werkzeug, options.minRows ?? MIN_ROWS).filter(
    (block) => block.confidence >= (options.minConfidence ?? MIN_CONFIDENCE)
  );

  const belegt = new Set(bloecke.flatMap((block) => spanne(block)));

  return {
    blocks: bloecke,
    ignoredLines: rows.map((zeile) => zeile.line).filter((zeile) => !belegt.has(zeile)),
    notes:
      bloecke.length === 0
        ? ['Keine eindeutige Datenstruktur erkannt']
        : bloecke.length > 1
          ? [`${bloecke.length} Datenblöcke erkannt; welcher gemeint ist, entscheidet ein Mensch`]
          : [],
  };
}

/**
 * Wie gut ein Versuch insgesamt war.
 *
 * Nicht nur Zeilen mal Zuversicht: Eine falsche Zerlegung kann sehr
 * gleichmäßig sein. „4711 | Schraube | 0,12" am Komma zerlegt ergibt in jeder
 * Zeile brav zwei Felder — und beide sind Unsinn. Deshalb zählen zwei weitere
 * Dinge:
 *
 * Wieviele Spalten einen erkennbaren Datentyp haben — eine Zerlegung, die
 * Zahlen und Datumsangaben freilegt, hat die Struktur getroffen.
 *
 * Und ob in den Feldern noch andere Trennzeichen stecken. Bleibt in einem Feld
 * ein „|" liegen, war es das Trennzeichen und nicht das, wonach zerlegt wurde.
 */
function guete(bloecke: readonly DataBlock[]): number {
  return bloecke.reduce((summe, block) => summe + block.rows.length * block.confidence * gewicht(block), 0);
}

const RESTTRENNER = /[;|\t]/;

function gewicht(block: DataBlock): number {
  const getippt = block.columns.filter((spalte) => spalte.type !== 'STRING' && spalte.type !== 'NULL').length;
  const felder = block.rows.flat();
  const mitRest = felder.filter((feld) => RESTTRENNER.test(feld)).length;

  return (1 + getippt) * (1 - 0.5 * (mitRest / Math.max(1, felder.length)));
}

function spanne(block: DataBlock): number[] {
  const von = block.headerLine ?? block.start;
  const zeilen: number[] = [];

  for (let zeile = von; zeile <= block.end; zeile += 1) {
    zeilen.push(zeile);
  }

  return zeilen;
}

function findeBloecke(
  zeilen: readonly Row[],
  strategie: SplitStrategy,
  werkzeug: ReturnType<typeof werkzeugFuer>,
  minRows: number
): DataBlock[] {
  const bloecke: DataBlock[] = [];
  let laufend: { rows: Row[]; signature: Signature; luecken: number } | undefined;

  const abschliessen = (): void => {
    if (laufend && laufend.rows.length >= minRows && traegtSpalten(laufend.rows)) {
      bloecke.push(baueBlock(laufend.rows, laufend.signature, strategie, zeilen, werkzeug));
    }

    laufend = undefined;
  };

  for (const zeile of zeilen) {
    if (zeile.fields.length === 0) {
      // Eine einzelne Leerzeile beendet den Block nicht (FR_007, Abschnitt 6);
      // zwei hintereinander schon — dann ist der Absatz vorbei.
      if (laufend) {
        laufend.luecken += 1;

        if (laufend.luecken > 1) {
          abschliessen();
        }
      }

      continue;
    }

    const signatur = signatureOf(zeile.fields, werkzeug);

    if (!laufend) {
      laufend = { rows: [zeile], signature: signatur, luecken: 0 };
      continue;
    }

    if (matchScore(laufend.signature, signatur) >= 0.75 && zeile.fields.length > 1) {
      laufend.rows.push(zeile);
      laufend.luecken = 0;
      continue;
    }

    abschliessen();
    laufend = { rows: [zeile], signature: signatur, luecken: 0 };
  }

  abschliessen();

  return bloecke;
}

/**
 * Ob die Zeilen wirklich Spalten tragen.
 *
 * „Auswertung Vertrieb" in A1 und daneben zwei leere Zellen ergibt drei Felder
 * und sieht damit für die Musterprüfung aus wie eine Tabelle. Zwei solche
 * Zeilen untereinander sind aber kein Datenblock, sondern eine Überschrift.
 *
 * Gezählt wird deshalb, in wievielen Spalten überhaupt regelmäßig etwas steht.
 * Unter zweien ist es keine Tabelle, sondern eine Liste von Zeilen.
 */
function traegtSpalten(rows: readonly Row[]): boolean {
  const breite = Math.max(...rows.map((zeile) => zeile.fields.length));
  let gefuellte = 0;

  for (let spalte = 0; spalte < breite; spalte += 1) {
    const belegt = rows.filter((zeile) => (zeile.fields[spalte] ?? '').trim() !== '').length;

    if (belegt / rows.length >= 0.5) {
      gefuellte += 1;
    }
  }

  return gefuellte >= 2;
}

function baueBlock(
  rows: readonly Row[],
  signature: Signature,
  strategy: SplitStrategy,
  alle: readonly Row[],
  werkzeug: ReturnType<typeof werkzeugFuer>
): DataBlock {
  const spalten = Math.max(...rows.map((zeile) => zeile.fields.length));
  const kopf = findeKopfzeile(rows[0], alle, signature, werkzeug);
  const reasons: string[] = [];

  // Wie gleichmäßig sich das Muster wiederholt — das stärkste Anzeichen dafür,
  // dass hier Daten stehen und nicht Prosa.
  const treffer = rows.map((zeile) => matchScore(signature, signatureOf(zeile.fields, werkzeug)));
  const musterGuete = treffer.reduce((summe, wert) => summe + wert, 0) / treffer.length;

  reasons.push(`${rows.length} Zeilen mit gleichem Muster (${(musterGuete * 100).toFixed(0)} % Übereinstimmung)`);

  const gleichViele = rows.filter((zeile) => zeile.fields.length === spalten).length / rows.length;

  if (gleichViele < 1) {
    reasons.push(`${((1 - gleichViele) * 100).toFixed(0)} % der Zeilen haben eine andere Spaltenzahl`);
  }

  const getippt = signature.filter((typ) => typ !== 'STRING').length / Math.max(1, signature.length);

  if (getippt > 0) {
    reasons.push(`${(getippt * 100).toFixed(0)} % der Spalten haben einen erkennbaren Datentyp`);
  }

  if (kopf) {
    reasons.push('Eine Kopfzeile steht unmittelbar darüber');
  }

  // Zuversicht aus mehreren Anteilen (FR_007, Abschnitt 8). Eine Zeile allein
  // wiegt wenig; erst die Wiederholung trägt.
  const menge = Math.min(1, rows.length / 4);
  const confidence = Math.min(
    1,
    musterGuete * 0.5 + gleichViele * 0.2 + menge * 0.15 + getippt * 0.1 + (kopf ? 0.05 : 0)
  );

  const columns: Column[] = Array.from({ length: spalten }, (_, index) => {
    const werte = rows.map((zeile) => zeile.fields[index] ?? '');
    const typen = werte.map((wert) => signatureOf([wert], werkzeug)[0]);
    const haeufigster = mehrheit(typen);

    return {
      name: kopf?.fields[index]?.trim() || undefined,
      type: haeufigster.typ,
      confidence: haeufigster.anteil,
      herkunft: 'OBSERVED',
    };
  });

  return {
    start: rows[0].line,
    end: rows[rows.length - 1].line,
    headerLine: kopf?.line,
    headerText: kopf?.raw,
    strategy,
    columns,
    rows: rows.map((zeile) => zeile.fields),
    signature,
    confidence,
    reasons,
  };
}

function mehrheit(typen: readonly FieldType[]): { typ: FieldType; anteil: number } {
  const zaehler = new Map<FieldType, number>();

  for (const typ of typen) {
    if (typ !== 'NULL') {
      zaehler.set(typ, (zaehler.get(typ) ?? 0) + 1);
    }
  }

  if (zaehler.size === 0) {
    return { typ: 'NULL', anteil: 1 };
  }

  const [typ, anzahl] = [...zaehler.entries()].sort((links, rechts) => rechts[1] - links[1])[0];

  return { typ, anteil: anzahl / typen.length };
}

/**
 * Die Kopfzeile steht unmittelbar über dem Block und passt gerade **nicht** zu
 * ihm: Wo Zahlen stehen, steht in ihr Text (FR_007, Abschnitt 5).
 *
 * Vorausgesetzt wird sie nicht. Ein Block ohne Kopfzeile ist ein gewöhnlicher
 * Fall, kein Mangel.
 */
function findeKopfzeile(
  erste: Row,
  alle: readonly Row[],
  signature: Signature,
  werkzeug: ReturnType<typeof werkzeugFuer>
): Row | undefined {
  const davor = alle.find((zeile) => zeile.line === erste.line - 1);

  if (!davor || davor.fields.length === 0) {
    return undefined;
  }

  const kopfSignatur = signatureOf(davor.fields, werkzeug);

  if (!kopfSignatur.every((typ) => typ === 'STRING')) {
    return undefined;
  }

  // Nur dort, wo der Block überhaupt getippte Spalten hat, ist „alles Text"
  // ein Unterschied. Bei einem reinen Textblock sagt es nichts.
  const getippte = signature.filter((typ) => typ !== 'STRING' && typ !== 'NULL').length;

  if (getippte === 0) {
    return undefined;
  }

  const passendeBreite = Math.abs(davor.fields.length - signature.length) <= 1;

  return passendeBreite ? davor : undefined;
}
