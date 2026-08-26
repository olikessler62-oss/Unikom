import type { Cell } from '../../domain/consolidation/Cell.js';
import { textCell } from '../../domain/consolidation/Cell.js';
import { ersatzname } from '../../domain/consolidation/Spaltennamen.js';
import type { Feststellungen } from '../../domain/consolidation/Feststellungen.js';
import { recogniseTypedField, werkzeugFuer, type RecognitionOptions } from '../../domain/consolidation/Recognition.js';
import type { Column, DataBlock, DiscoveryResult } from '../../domain/discovery/Discovery.js';
import { signatureOf } from '../../domain/discovery/Rows.js';
import type { Table } from './Csv.js';

/**
 * Was ein Leser abliefert — gleich, aus welchem Format.
 *
 * Vier Formate, ein Ergebnis: Feldnamen, Zeilen, und was der Leser über die
 * Datei **festgestellt** hat. Alles, was danach kommt — Erkennung, Mapping,
 * Konsolidierung — soll nicht wissen müssen, ob die Daten aus einer CSV, einer
 * Tabelle mit festen Spaltenbreiten, einem JSON oder einem XML kamen.
 *
 * Die Zellen tragen ihren erklärten Typ mit. CSV und Fixed-Width haben keinen
 * und liefern Text; JSON und XML wissen es teilweise selbst, und diese Auskunft
 * wegzuwerfen, um sie anschließend zu erraten, wäre Verschwendung mit
 * Fehlerrisiko.
 */
export interface Gelesen {
  fields: string[];
  rows: Cell[][];
  /** Was die Datei über sich sagt (SPEC-02, Abschnitt 40) — keine Einstellung. */
  feststellungen: Feststellungen;
  /** Zeilennummern, deren Feldzahl von der ersten abweicht. */
  ragged: number[];
  notes: string[];
}

/** Die Werte einer Spalte als Text — die Eingabe der Typerkennung. */
export function spaltenwerte(gelesen: Gelesen, index: number): string[] {
  return gelesen.rows.map((zeile) => zeile[index]?.text ?? '');
}

/**
 * Ein gelesener Bestand als Ergebnis der Data-Discovery-Engine.
 *
 * JSON, XML und feste Feldbreiten brauchen **keine** Blocksuche: Sie bringen
 * ihre Feldnamen mit und wissen, wo die Daten anfangen. Sie durch die Erkennung
 * zu schicken, die aus einem E-Mail-Text die Tabelle heraussucht, wäre nicht
 * nur unnötig — sie könnte dabei etwas anderes finden als das, was in der Datei
 * steht.
 *
 * Was bleibt, ist die **Typerkennung**, und die läuft hier über
 * `recogniseTypedField`: Wo das Format seinen Typ selbst kennt (JSON), wird er
 * genommen; wo nicht (feste Breiten), wird er wie bei CSV aus den Werten
 * bestimmt.
 */
export function alsBlock(gelesen: Gelesen, options: RecognitionOptions): DiscoveryResult {
  const werkzeug = werkzeugFuer(options);

  const columns: Column[] = gelesen.fields.map((name, index) => {
    const erkannt = recogniseTypedField(
      name,
      gelesen.rows.map((zeile) => zeile[index] ?? { text: '', declared: 'EMPTY' as const }),
      options
    );

    return {
      name,
      type: erkannt.type,
      confidence: erkannt.confidence,
      // Der Name steht in der Datei — er ist beobachtet und nicht abgeleitet.
      herkunft: 'OBSERVED' as const,
    };
  });

  if (gelesen.rows.length === 0) {
    return { blocks: [], ignoredLines: [], notes: [...gelesen.notes, 'Die Datei enthält keine Datenzeile'] };
  }

  const block: DataBlock = {
    start: 1,
    end: gelesen.rows.length,
    strategy: 'VORGEGEBEN',
    columns,
    rows: gelesen.rows.map(texte),
    signature: signatureOf(texte(gelesen.rows[0]), werkzeug),
    /*
     * Die Struktur steht fest, sie wurde nicht erraten — das ist der ganze
     * Unterschied zu einem Block aus einem E-Mail-Text. Die Zuversicht ist
     * deshalb voll, und der Grund steht dabei.
     */
    confidence: 1,
    reasons: [`Die Struktur kommt aus der Datei selbst: ${columns.length} Feld(er), ${gelesen.rows.length} Datensätze`],
  };

  return { blocks: [block], ignoredLines: [], notes: gelesen.notes };
}

/** Eine Zeile als reiner Text — für alles, was den erklärten Typ nicht braucht. */
export function texte(zeile: readonly Cell[]): string[] {
  return zeile.map((zelle) => zelle.text);
}

/**
 * Die CSV-Tabelle in derselben Form.
 *
 * CSV bleibt bei seinem eigenen Rückgabetyp, weil dort Trennzeichen und
 * Kopfzeile eine Rolle spielen, die es sonst nirgends gibt. Hier wird
 * übersetzt, statt den Leser umzubauen — die Übersetzung ist eine Funktion von
 * zehn Zeilen, der Umbau wäre ein Eingriff in geprüften Code.
 */
export function ausTabelle(table: Table): Gelesen {
  return {
    fields: table.fields,
    rows: table.rows.map((zeile) => zeile.map(textCell)),
    feststellungen: {
      kodierung: table.encoding,
      trennzeichen: table.delimiter,
      kopfzeile: table.header,
      spalten: table.fields.length,
    },
    ragged: table.ragged,
    notes: table.notes,
  };
}

/**
 * Ein erkannter Datenblock als Bestand — die Umkehrung von `alsBlock`.
 *
 * Die Zellen tragen dabei **keinen** erklärten Typ mehr, und das ist keine
 * Nachlässigkeit: Ein Datenblock führt seine Werte als Text, weil er aus einer
 * Erkennung stammt. „1.234,50" ist erkanntermaßen eine Dezimalzahl, aber sie in
 * eine JSON-Zahl zu verwandeln hieße, sie nach der Region umzurechnen — und das
 * ist eine Frage des Mappings, nicht des Schreibens. Was als Text vorlag, geht
 * als Text hinaus, bis jemand die Umrechnung ausdrücklich einrichtet.
 */
export function ausBlock(block: { columns: { name?: string }[]; rows: string[][] }): Gelesen {
  return {
    fields: block.columns.map((spalte, index) => spalte.name ?? ersatzname(index)),
    rows: block.rows.map((zeile) => zeile.map(textCell)),
    feststellungen: { spalten: block.columns.length },
    ragged: [],
    notes: [],
  };
}
