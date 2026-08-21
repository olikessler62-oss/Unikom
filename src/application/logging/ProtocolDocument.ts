import type { LogEntry } from '../../domain/logging/LogEntry.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';

/**
 * Das Protokoll eines Laufs als Text, so wie man es weitergibt.
 *
 * Es entsteht hier und nicht im Browser, damit es überall gleich aussieht —
 * dieselbe Datei, ob sie aus der Übersicht gespeichert oder später aus einem
 * Skript geholt wird. Und weil das Gespeicherte mehr enthalten muss als das
 * Angezeigte: Die Anzeige ist auf einen Detailgrad gefiltert, die Datei nimmt
 * jede Zeile mit. Wer ein Protokoll verschickt, will nicht hinterher merken,
 * dass genau die fehlende Zeile die Antwort war.
 *
 * Reiner Text und kein CSV oder JSON: Gelesen wird es von einem Menschen, oft
 * in einer Mail. Die Zeitstempel stehen dabei in Ortszeit, wie überall sonst
 * in Unikom, und mit Millisekunden — bei nebenläufigen Dateien entscheidet
 * die Millisekunde darüber, was worauf folgte.
 */

const STATUS_TEXTS: Record<string, string> = {
  PENDING: 'wartet',
  RUNNING: 'läuft',
  SUCCESS: 'erfolgreich',
  SUCCESS_NO_FILES: 'erfolgreich, keine passenden Dateien',
  PARTIAL_SUCCESS: 'teilweise erfolgreich',
  COMPLETED_WITH_ERRORS: 'mit Fehlern beendet',
  FAILED: 'fehlgeschlagen',
  CANCELLED: 'abgebrochen',
};

function moment(value: Date): string {
  const pad = (number: number, width = 2): string => String(number).padStart(width, '0');

  return (
    `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`
  );
}

function line(entry: LogEntry): string {
  const parts = [moment(entry.timestamp), entry.level.padEnd(7), entry.message];

  if (entry.filename) {
    parts.splice(2, 0, `[${entry.filename}]`);
  }

  /*
   * Der Urheber wandert in die gespeicherte Fassung mit — mit Name *und*
   * Kennung. Der Name ist das, was jemand liest; die Kennung ist das, was
   * eindeutig bleibt, wenn der Name sich später ändert oder zweimal vorkommt.
   * In einem Protokoll, das per Mail zum Hersteller geht, entscheidet genau das
   * über die Frage „wer hat das eingestellt".
   */
  if (entry.username || entry.userId) {
    parts.push(`(${entry.username ?? 'unbekannt'}${entry.userId ? `, ${entry.userId}` : ''})`);
  }

  const rendered = parts.join(' ');

  // Zusatzangaben in die nächste Zeile, eingerückt: Sie gehören zur Zeile
  // darüber, sind aber selten das, was man beim Überfliegen sucht.
  return entry.context && Object.keys(entry.context).length > 0
    ? `${rendered}\n${' '.repeat(24)}${JSON.stringify(entry.context)}`
    : rendered;
}

/** Ein Dateiname, den man in einem Ordner voller Protokolle wiederfindet. */
export function protocolFilename(run: RunDetail): string {
  const started = run.startedAt;
  const pad = (number: number): string => String(number).padStart(2, '0');
  const stamp =
    `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}` +
    `_${pad(started.getHours())}${pad(started.getMinutes())}`;

  // Alles, was in einem Dateinamen Ärger macht, wird zum Bindestrich — auf
  // allen drei Systemen, nicht nur auf dem, auf dem gerade gespeichert wird.
  const name = (run.jobName ?? run.jobId).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');

  return `${name}_${stamp}_${run.runId}.log`;
}

export function protocolDocument(run: RunDetail, entries: LogEntry[]): string {
  const head = [
    'Unikom — Laufprotokoll',
    '',
    `Workflow    ${run.jobName ?? run.jobId}`,
    `Lauf        ${run.runId}`,
    `Beginn      ${moment(run.startedAt)}`,
    run.completedAt ? `Ende        ${moment(run.completedAt)}` : 'Ende        — (noch nicht beendet)',
    run.durationMs !== undefined ? `Dauer       ${(run.durationMs / 1000).toFixed(1)} s` : undefined,
    `Ergebnis    ${STATUS_TEXTS[run.status] ?? run.status}`,
    `Dateien     ${run.filesFound} gesichtet, ${run.filesSucceeded} übernommen, ` +
      `${run.filesSkipped} übersprungen, ${run.filesFailed} fehlgeschlagen`,
    '',
    // Die Zahl steht dabei, weil ein Protokoll ohne sie nicht verrät, ob es
    // vollständig ist oder ob der Speicher schon Zeilen fallen ließ.
    `${entries.length} Zeilen`,
    '─'.repeat(78),
    '',
  ].filter((part): part is string => part !== undefined);

  const body = entries.map(line);

  const failures = entries.filter((entry) => entry.level === 'ERROR' || entry.level === 'WARNING');

  // Fehler und Warnungen noch einmal am Ende: Wer ein Protokoll aufmacht, um
  // ein Problem zu klären, sucht genau diese Zeilen — und nicht in tausend
  // anderen.
  const tail =
    failures.length > 0
      ? ['', '─'.repeat(78), '', `Fehler und Warnungen (${failures.length})`, '', ...failures.map(line)]
      : ['', '─'.repeat(78), '', 'Keine Fehler, keine Warnungen.'];

  return [...head, ...body, ...tail].join('\n');
}
