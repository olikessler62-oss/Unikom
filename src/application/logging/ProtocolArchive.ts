import fs from 'node:fs/promises';
import path from 'node:path';

import type { LogEntry } from '../../domain/logging/LogEntry.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';
import { protocolDocument, protocolFilename } from './ProtocolDocument.js';

/**
 * Protokolle, die niemand von Hand speichern kann.
 *
 * Der Lauf, dessen Protokoll wirklich gebraucht wird, ist fast immer der
 * nächtliche — und bemerkt wird das am Morgen. Bis dahin kann ein Neustart das
 * Memo geleert haben. Ein Workflow darf deshalb sagen: Schreib mein Protokoll
 * am Ende jedes Laufs weg.
 *
 * **Voreingestellt aus.** Wer nichts einstellt, bekommt das Protokoll im
 * Arbeitsspeicher und sonst nichts — kein Verzeichnis, das unbemerkt wächst.
 *
 * Sortiert nach Jahr und Monat, weil ein flaches Verzeichnis nach zwei Jahren
 * zwanzigtausend Dateien hat und kein Dateimanager damit noch Freude macht.
 */

export const PROTOCOL_DIRECTORY = 'protokolle';

/**
 * Wie lange abgelegte Protokolle bleiben, wenn der Workflow nichts anderes
 * sagt. Dreißig Tage: Sie sind für den akuten Fall gedacht, und wer eines
 * länger braucht, hat es längst verschickt.
 */
export const DEFAULT_PROTOCOL_RETENTION_DAYS = 30;

export interface ProtocolArchiveResult {
  path: string;
  lines: number;
}

export class ProtocolArchive {
  /**
   * @param dataDirectory Wohin abgelegt wird, wenn der Workflow kein eigenes
   * Verzeichnis nennt: `<Datenverzeichnis>/protokolle/<Jahr>/<Monat>`.
   */
  constructor(private readonly dataDirectory: string) {}

  directoryFor(run: RunDetail, own?: string): string {
    const started = run.startedAt;
    const year = String(started.getFullYear());
    const month = String(started.getMonth() + 1).padStart(2, '0');
    const base = own?.trim() ? path.resolve(own.trim()) : path.join(this.dataDirectory, PROTOCOL_DIRECTORY);

    return path.join(base, year, month);
  }

  async save(run: RunDetail, entries: LogEntry[], own?: string): Promise<ProtocolArchiveResult> {
    const directory = this.directoryFor(run, own);
    await fs.mkdir(directory, { recursive: true });

    const target = path.join(directory, protocolFilename(run));
    await fs.writeFile(target, protocolDocument(run, entries), 'utf8');

    return { path: target, lines: entries.length };
  }

  /**
   * Räumt abgelegte Protokolle nach Alter auf — nach dem Zeitpunkt im Namen,
   * nicht nach dem der Datei: Ein Virenscanner oder eine Sicherung fasst
   * Dateien an, ein Dateiname bleibt, was er war.
   *
   * Leergeräumte Monats- und Jahresordner verschwinden mit. Ein Baum aus
   * leeren Verzeichnissen ist genau die Art Rest, die niemand wegräumt.
   */
  async prune(cutoff: Date, own?: string): Promise<number> {
    const base = own?.trim() ? path.resolve(own.trim()) : path.join(this.dataDirectory, PROTOCOL_DIRECTORY);
    let deleted = 0;

    for (const year of await entriesOf(base)) {
      const yearPath = path.join(base, year);

      for (const month of await entriesOf(yearPath)) {
        const monthPath = path.join(yearPath, month);

        for (const name of await entriesOf(monthPath)) {
          const stamp = stampOf(name);

          if (stamp && stamp.getTime() < cutoff.getTime()) {
            await fs.rm(path.join(monthPath, name), { force: true });
            deleted += 1;
          }
        }

        await removeIfEmpty(monthPath);
      }

      await removeIfEmpty(yearPath);
    }

    return deleted;
  }
}

async function entriesOf(directory: string): Promise<string[]> {
  return fs.readdir(directory).catch(() => []);
}

async function removeIfEmpty(directory: string): Promise<void> {
  if ((await entriesOf(directory)).length === 0) {
    await fs.rmdir(directory).catch(() => {});
  }
}

/** `…_2026-08-17_0345_TR-8f2c.log` — der Zeitpunkt steht im Namen. */
function stampOf(filename: string): Date | undefined {
  const found = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_/.exec(filename);

  if (!found) {
    return undefined;
  }

  const [, year, month, day, hour, minute] = found;

  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}
