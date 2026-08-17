import test from 'node:test';
import assert from 'node:assert/strict';

import { RunProtocolMemo } from './RunProtocolMemo.js';
import { protocolDocument, protocolFilename } from './ProtocolDocument.js';
import type { LogEntry, LogLevel } from '../../domain/logging/LogEntry.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';

/**
 * Das Protokoll ist eine Mitschrift im Arbeitsspeicher, keine Ablage.
 *
 * Geprüft wird deshalb weniger, dass etwas aufbewahrt wird, als *wie* es
 * fallengelassen wird: im Ganzen, nie halb, und nie der Lauf, der gerade
 * schreibt.
 */

function entry(runId: string, message: string, level: LogLevel = 'INFO'): LogEntry {
  return { timestamp: new Date('2026-08-17T03:45:00.000Z'), level, message, runId, jobId: 'kunde-a' };
}

test('jeder Lauf hat sein eigenes Protokoll', async () => {
  const memo = new RunProtocolMemo();

  memo.log(entry('TR-1', 'erste Zeile'));
  memo.log(entry('TR-2', 'anderer Lauf'));
  memo.log(entry('TR-1', 'zweite Zeile'));

  const first = await memo.list({ runId: 'TR-1' });

  assert.deepEqual(
    first.map((line) => line.message),
    ['erste Zeile', 'zweite Zeile']
  );
});

test('die Reihenfolge bleibt, auch über Läufe hinweg', async () => {
  const memo = new RunProtocolMemo();

  memo.log(entry('TR-1', 'a'));
  memo.log(entry('TR-2', 'b'));
  memo.log(entry('TR-1', 'c'));

  const all = await memo.list({});

  assert.deepEqual(
    all.map((line) => line.message),
    ['a', 'b', 'c']
  );
  // Die Position ist das, woran die laufende Anzeige erkennt, was neu ist.
  assert.deepEqual(
    all.map((line) => line.sequence),
    [1, 2, 3]
  );
});

test('der älteste Lauf wird im Ganzen vergessen, nicht halb', async () => {
  const memo = new RunProtocolMemo({ runs: 2 });

  memo.log(entry('TR-1', 'alt 1'));
  memo.log(entry('TR-1', 'alt 2'));
  memo.log(entry('TR-2', 'mittel'));
  memo.log(entry('TR-3', 'neu'));

  assert.deepEqual(await memo.list({ runId: 'TR-1' }), [], 'der älteste Lauf ist fort');
  assert.equal((await memo.list({ runId: 'TR-2' })).length, 1);
  assert.equal((await memo.list({ runId: 'TR-3' })).length, 1);
  assert.equal(memo.size, 2);
});

test('ein einzelner sehr langer Lauf verliert nicht seinen Anfang', async () => {
  // Die Zeilengrenze greift, aber es gibt nur diesen einen Lauf. Ihn zu
  // kürzen hieße, dem Zusehenden den Anfang wegzunehmen, während er zusieht.
  const memo = new RunProtocolMemo({ runs: 5, entries: 3 });

  for (let index = 0; index < 10; index += 1) {
    memo.log(entry('TR-1', `Zeile ${index}`));
  }

  const lines = await memo.list({ runId: 'TR-1' });

  assert.equal(lines.length, 10);
  assert.equal(lines[0].message, 'Zeile 0');
});

test('nach dem Detailgrad lässt sich weiterhin filtern', async () => {
  const memo = new RunProtocolMemo();

  memo.log(entry('TR-1', 'Kleinkram', 'DEBUG'));
  memo.log(entry('TR-1', 'Wichtiges', 'ERROR'));

  const errors = await memo.list({ runId: 'TR-1', minimumLevel: 'WARNING' });

  assert.deepEqual(
    errors.map((line) => line.message),
    ['Wichtiges']
  );
});

test('das Aufräumen nach Alter meldet ehrlich, dass es nichts tut', async () => {
  const memo = new RunProtocolMemo();
  memo.log(entry('TR-1', 'bleibt'));

  assert.equal(await memo.deleteOlderThan(), 0);
  assert.equal((await memo.list({ runId: 'TR-1' })).length, 1);
});

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
