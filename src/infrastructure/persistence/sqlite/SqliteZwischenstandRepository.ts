import type { DatabaseSync } from 'node:sqlite';

import type {
  Blockauskunft,
  Zwischenstand,
  Zwischenstandbestand,
} from '../../../domain/consolidation/Zwischenstand.js';

/**
 * Zwischenstände der blockweisen Konsolidierung in SQLite (SPEC-06 §15).
 *
 * Sie liegen hier und nicht im Arbeitsspeicher, weil sie genau dann gebraucht
 * werden, wenn der Prozess, der sie hielt, nicht mehr da ist: nach einem
 * Stromausfall, einem Neustart, einem beendeten Dienst. Ein Zwischenstand im
 * Arbeitsspeicher ist einer für den Fall, dass nichts passiert.
 *
 * Der Teilbericht geht als JSON hinein. Ihn in Spalten zu zerlegen hieße, das
 * ganze Berichtsformat ein zweites Mal zu beschreiben — und beim nächsten
 * zusätzlichen Feld wäre eine der beiden Beschreibungen die veraltete.
 */
interface BlockRow {
  run_id: string;
  block: number;
  blocks: number;
  records: number;
  report: string;
  finished_at: string;
}

export class SqliteZwischenstandRepository<T> implements Zwischenstandbestand<T> {
  constructor(private readonly database: DatabaseSync) {}

  async speichere(stand: Zwischenstand<T>): Promise<void> {
    /*
     * Ersetzend und nicht anfügend: Ein Schritt, der ein zweites Mal lief —
     * weil ein Lauf mittendrin abbrach und wiederholt wurde —, ersetzt sein
     * früheres Ergebnis. Zweimal gespeichert stünden seine Datensätze doppelt
     * im Endergebnis.
     */
    this.database
      .prepare(
        'INSERT OR REPLACE INTO consolidation_blocks (run_id, block, blocks, records, report, finished_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        stand.laufId,
        stand.block,
        stand.bloecke,
        stand.datensaetze,
        JSON.stringify(stand.teilbericht),
        stand.fertig
      );
  }

  /**
   * Die Auskunft ohne den Bericht — ausdrücklich ohne `report` in der Auswahl.
   *
   * `SELECT *` wäre kürzer und träte den Sinn der Sache mit Füßen: Es holte
   * zwölf Teilberichte in den Arbeitsspeicher, um zu beantworten, welche
   * Blocknummern vorliegen.
   */
  async auskunft(laufId: string): Promise<Blockauskunft[]> {
    const zeilen = this.database
      .prepare('SELECT run_id, block, blocks, records, finished_at FROM consolidation_blocks WHERE run_id = ? ORDER BY block')
      .all(laufId) as unknown as Omit<BlockRow, 'report'>[];

    return zeilen.map((zeile) => ({
      laufId: zeile.run_id,
      block: zeile.block,
      bloecke: zeile.blocks,
      datensaetze: zeile.records,
      fertig: zeile.finished_at,
    }));
  }

  async lies(laufId: string, block: number): Promise<Zwischenstand<T> | undefined> {
    const zeile = this.database
      .prepare('SELECT * FROM consolidation_blocks WHERE run_id = ? AND block = ?')
      .get(laufId, block) as unknown as BlockRow | undefined;

    if (!zeile) {
      return undefined;
    }

    return {
      laufId: zeile.run_id,
      block: zeile.block,
      bloecke: zeile.blocks,
      datensaetze: zeile.records,
      teilbericht: JSON.parse(zeile.report) as T,
      fertig: zeile.finished_at,
    };
  }

  async entferne(laufId: string): Promise<void> {
    this.database.prepare('DELETE FROM consolidation_blocks WHERE run_id = ?').run(laufId);
  }
}
