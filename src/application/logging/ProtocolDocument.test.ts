import test from 'node:test';
import assert from 'node:assert/strict';

import { protocolDocument, protocolFilename } from './ProtocolDocument.js';
import type { LogEntry, LogLevel } from '../../domain/logging/LogEntry.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';

/**
 * Das Protokoll zum Aus-der-Hand-geben.
 *
 * Mitgeschrieben wird in die Datenbank; hier geht es um die Fassung, die
 * jemand speichert und verschickt — an den Hersteller, an den Betreiber des
 * Gegenservers. Sie muss für sich allein verständlich sein: Wer sie öffnet,
 * hat weder die Oberfläche noch die Datenbank daneben.
 */

function entry(runId: string, message: string, level: LogLevel = 'INFO'): LogEntry {
  return { timestamp: new Date('2026-08-17T03:45:00.000Z'), level, message, runId, jobId: 'kunde-a' };
}

const RUN: RunDetail = {
  runId: 'TR-8f2c',
  jobId: 'kunde-a',
  jobName: 'Kunde A – Bestellungen',
  status: TransferRunStatus.COMPLETED_WITH_ERRORS,
  startedAt: new Date('2026-08-17T03:45:00.000Z'),
  completedAt: new Date('2026-08-17T03:45:12.500Z'),
  durationMs: 12500,
  filesFound: 3,
  filesProcessed: 3,
  filesSucceeded: 2,
  filesSkipped: 0,
  filesFailed: 1,
  files: [],
  logs: [],
};

test('das gespeicherte Protokoll trägt Kopf, Verlauf und die Fehler noch einmal', () => {
  const text = protocolDocument(RUN, [
    entry('TR-8f2c', 'Lauf gestartet'),
    { ...entry('TR-8f2c', 'ORDER_002.csv konnte nicht verschlüsselt werden', 'ERROR'), filename: 'ORDER_002.csv' },
  ]);

  assert.match(text, /Unikom — Laufprotokoll/);
  assert.match(text, /Workflow {4}Kunde A – Bestellungen/);
  assert.match(text, /Ergebnis {4}mit Fehlern beendet/);
  assert.match(text, /3 gesichtet, 2 übernommen, 0 übersprungen, 1 fehlgeschlagen/);
  assert.match(text, /2 Zeilen/);
  assert.match(text, /\[ORDER_002\.csv\]/);
  // Am Ende noch einmal, weil danach gesucht wird.
  assert.match(text, /Fehler und Warnungen \(1\)/);
});

test('ein Protokoll ohne Fehler sagt das ausdrücklich', () => {
  const text = protocolDocument(RUN, [entry('TR-8f2c', 'alles ruhig')]);

  assert.match(text, /Keine Fehler, keine Warnungen\./);
});

test('der Dateiname ist einer, den man in einem Ordner wiederfindet', () => {
  // Der Gedankenstrich im Workflow-Namen ist in einem Dateinamen erlaubt, der
  // Schrägstrich wäre es nicht — geprüft wird, dass nichts Gefährliches bleibt.
  const name = protocolFilename({ ...RUN, jobName: 'Kunde A / Bestellungen' });

  assert.match(name, /^Kunde-A-Bestellungen_2026-08-17_\d{4}_TR-8f2c\.log$/);
  assert.equal(name.includes('/'), false);
});
