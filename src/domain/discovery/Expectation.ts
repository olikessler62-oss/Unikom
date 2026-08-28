import type { FieldType } from '../consolidation/Recognition.js';
import type { Column, DataBlock, Herkunft } from './Discovery.js';

/**
 * Die zweite Spur der Erkennung (FR_008): was der Benutzer über eine Quelle
 * schon weiß.
 *
 * Der Kern der Spec ist ein Wort: **UND**, nicht ODER. Eine hinterlegte
 * Struktur ersetzt die Erkennung nicht, sie tritt neben sie. Wo beide dasselbe
 * sagen, ist die Sache sicher; wo sie sich widersprechen, wird der Widerspruch
 * gezeigt und nicht stillschweigend aufgelöst.
 */
export type Erkennungsmodus = 'AUTOMATIK' | 'EINSTELLUNGEN' | 'BEIDE';

/**
 * Wie verbindlich eine hinterlegte Angabe ist (FR_008, Abschnitt 4).
 *
 * HINWEIS         — die Daten dürfen widersprechen, wenn sie eindeutig sind.
 * EINSCHRAENKUNG  — was dagegen verstößt, ist kein gültiger Block.
 * VORGABE         — es gilt, was hinterlegt ist; Abweichung ist ein Konflikt.
 */
export type Verbindlichkeit = 'HINWEIS' | 'EINSCHRAENKUNG' | 'VORGABE';

export interface Spaltenvorgabe {
  /** Die Stelle, ab 1 — so, wie ein Mensch sie zählt. */
  position: number;
  name?: string;
  type?: FieldType;
}

export interface Strukturvorgabe {
  verbindlichkeit: Verbindlichkeit;
  /** Erwartete Spaltenzahl. */
  columns?: number;
  /** Mindestzahl an Spalten — für die Einschränkung. */
  minColumns?: number;
  spalten?: Spaltenvorgabe[];
  /** Der Datenblock beginnt nach einer Zeile, die diesen Text enthält. */
  beginntNach?: string;
}

export interface Abweichung {
  position: number;
  name?: string;
  hinterlegt: FieldType;
  erkannt: FieldType;
}

export interface Strukturergebnis {
  block?: DataBlock;
  columns: Column[];
  /** Anteil der hinterlegten Angaben, die zutreffen. */
  configurationMatch: number;
  /** Wie gleichmäßig sich das Muster in den Daten wiederholt. */
  patternMatch: number;
  overallConfidence: number;
  abweichungen: Abweichung[];
  notes: string[];
}

/**
 * Bringt eine erkannte Struktur mit einer hinterlegten zusammen.
 *
 * `block` fehlt, wenn im Modus EINSTELLUNGEN nichts erkannt werden musste oder
 * wenn die Erkennung nichts gefunden hat.
 */
export function combine(
  blocks: readonly DataBlock[],
  vorgabe: Strukturvorgabe | undefined,
  modus: Erkennungsmodus = vorgabe ? 'BEIDE' : 'AUTOMATIK'
): Strukturergebnis {
  const notes: string[] = [];

  if (modus === 'AUTOMATIK' || !vorgabe) {
    const block = waehle(blocks, undefined, notes);

    return {
      block,
      columns: block?.columns ?? [],
      configurationMatch: 1,
      patternMatch: block?.confidence ?? 0,
      overallConfidence: block?.confidence ?? 0,
      abweichungen: [],
      notes,
    };
  }

  if (modus === 'EINSTELLUNGEN') {
    // Allein nach Einstellungen: Die Daten werden nicht befragt, also gibt es
    // auch nichts abzugleichen. Das ist der Modus für eine Quelle, die sich
    // nie ändert — und dafür trägt der Benutzer die Verantwortung.
    return {
      block: waehle(blocks, vorgabe, notes),
      columns: ausVorgabe(vorgabe),
      configurationMatch: 1,
      patternMatch: 0,
      overallConfidence: 1,
      abweichungen: [],
      notes: [...notes, 'Nach hinterlegter Struktur gelesen; die Daten wurden dabei nicht geprüft'],
    };
  }

  const block = waehle(blocks, vorgabe, notes);

  if (!block) {
    return {
      columns: ausVorgabe(vorgabe),
      configurationMatch: 0,
      patternMatch: 0,
      overallConfidence: 0,
      abweichungen: [],
      notes: [...notes, 'Es wurde nichts erkannt, was zur hinterlegten Struktur passt'],
    };
  }

  const abweichungen: Abweichung[] = [];
  let geprueft = 0;
  let getroffen = 0;

  const columns = block.columns.map((spalte, index): Column => {
    const hinterlegt = vorgabe.spalten?.find((eintrag) => eintrag.position === index + 1);

    if (!hinterlegt) {
      return spalte;
    }

    const name = hinterlegt.name ?? spalte.name;

    if (!hinterlegt.type) {
      return { ...spalte, name, herkunft: name === hinterlegt.name ? 'CONFIGURED' : spalte.herkunft };
    }

    geprueft += 1;

    if (hinterlegt.type === spalte.type) {
      getroffen += 1;

      // Beide Wege sagen dasselbe — das ist die stärkste Aussage, die es hier
      // gibt, und sie ist mehr wert als jede der beiden allein.
      return { ...spalte, name, confidence: Math.min(1, spalte.confidence + 0.1), herkunft: 'CONFIRMED' };
    }

    abweichungen.push({ position: index + 1, name, hinterlegt: hinterlegt.type, erkannt: spalte.type });

    if (vorgabe.verbindlichkeit === 'HINWEIS') {
      // Ein Hinweis darf von eindeutigen Daten überstimmt werden — aber nicht
      // heimlich; die Abweichung steht oben.
      return { ...spalte, name };
    }

    return { ...spalte, name, type: hinterlegt.type, herkunft: 'CONFIGURED', confidence: spalte.confidence };
  });

  if (vorgabe.columns !== undefined) {
    geprueft += 1;

    if (vorgabe.columns === block.columns.length) {
      getroffen += 1;
    } else {
      notes.push(`Erwartet waren ${vorgabe.columns} Spalten, erkannt wurden ${block.columns.length}`);
    }
  }

  const configurationMatch = geprueft === 0 ? 1 : getroffen / geprueft;

  if (abweichungen.length > 0) {
    notes.push(
      `${abweichungen.length} Spalte(n) weichen von der hinterlegten Struktur ab; ` +
        (vorgabe.verbindlichkeit === 'HINWEIS'
          ? 'die Daten haben den Vorrang, weil die Angabe ein Hinweis ist'
          : 'es gilt die hinterlegte Struktur') +
        ' - bitte prüfen'
    );
  }

  return {
    block,
    columns,
    configurationMatch,
    patternMatch: block.confidence,
    // Beide Wege zusammen. Sie stützen einander, deshalb liegt das Ergebnis
    // über dem schwächeren der beiden — aber nie über dem, was die Daten
    // hergeben, wenn die Konfiguration danebenliegt.
    overallConfidence: Math.min(1, (configurationMatch + block.confidence) / 2 + (abweichungen.length === 0 ? 0.05 : 0)),
    abweichungen,
    notes,
  };
}

function waehle(
  blocks: readonly DataBlock[],
  vorgabe: Strukturvorgabe | undefined,
  notes: string[]
): DataBlock | undefined {
  let geeignet = [...blocks];

  if (vorgabe?.beginntNach) {
    const gesucht = vorgabe.beginntNach.toLowerCase();
    const passend = geeignet.filter((block) => block.headerText?.toLowerCase().includes(gesucht));

    if (passend.length > 0) {
      geeignet = passend;
    } else {
      notes.push(`Kein Datenblock beginnt nach „${vorgabe.beginntNach}"`);
    }
  }

  const mindestens = vorgabe?.minColumns ?? (vorgabe?.verbindlichkeit === 'EINSCHRAENKUNG' ? vorgabe.columns : undefined);

  if (mindestens !== undefined) {
    const genug = geeignet.filter((block) => block.columns.length >= mindestens);

    if (genug.length < geeignet.length) {
      notes.push(`${geeignet.length - genug.length} Block/Blöcke haben weniger als ${mindestens} Spalten`);
    }

    geeignet = genug;
  }

  if (geeignet.length > 1) {
    notes.push(`${geeignet.length} Blöcke kommen in Frage; die Auswahl trifft ein Mensch`);
  }

  return geeignet[0];
}

function ausVorgabe(vorgabe: Strukturvorgabe): Column[] {
  return (vorgabe.spalten ?? []).map((spalte) => ({
    name: spalte.name,
    type: spalte.type ?? 'STRING',
    confidence: 1,
    herkunft: 'CONFIGURED' as Herkunft,
  }));
}

/**
 * Aus einem bestätigten Block eine hinterlegte Struktur machen (FR_008,
 * Abschnitt 7).
 *
 * Das ist die Lernfähigkeit — und sie entsteht erst durch die Bestätigung
 * eines Menschen, nicht durch das bloße Erkennen. Eine Vermutung, die sich
 * selbst zur Regel erklärt, wäre genau das, was SPEC-02, Abschnitt 18,
 * ausschließt.
 */
export function alsVorgabe(block: DataBlock, verbindlichkeit: Verbindlichkeit = 'HINWEIS'): Strukturvorgabe {
  return {
    verbindlichkeit,
    columns: block.columns.length,
    spalten: block.columns.map((spalte, index) => ({
      position: index + 1,
      name: spalte.name,
      type: spalte.type,
    })),
  };
}
