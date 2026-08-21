import assert from 'node:assert/strict';
import test from 'node:test';

import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../transfer/TransferJob.js';
import { ausgeblieben, dauer, oertlich, VERSPAETET_AB_MS } from './Ausbleiben.js';

const JETZT = new Date('2026-08-20T08:00:00.000Z');

function job(teile: Partial<TransferJob> = {}): TransferJob {
  return createTransferJob({
    id: 'nachtlauf',
    name: 'Nachtlauf',
    tenantId: 'default',
    enabled: true,
    executionMode: 'AUTOMATIC',
    schedule: { type: 'DAILY', executionTime: '02:00', timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
    nextExecutionAt: new Date('2026-08-20T02:00:00.000Z'),
    ...teile,
  });
}

test('ein Termin, der Stunden zurückliegt, gilt als ausgeblieben', () => {
  const versaeumt = ausgeblieben([job()], JETZT);

  assert.equal(versaeumt.length, 1);
  assert.equal(versaeumt[0].name, 'Nachtlauf');
  assert.equal(versaeumt[0].erwartet, '2026-08-20T02:00:00.000Z');
  assert.equal(versaeumt[0].ueberfaellig, '6 Stunden');
});

test('ein gerade eben fälliger Termin ist nicht ausgeblieben', () => {
  /*
   * Sonst wäre jeder Workflow in der Sekunde seiner Fälligkeit „ausgeblieben" —
   * eine Sekunde bevor der Tick ihn startet.
   */
  assert.deepEqual(ausgeblieben([job({ nextExecutionAt: JETZT })], JETZT), []);
});

test('die Nachfrist gilt genau und nicht ungefähr', () => {
  const knapp = new Date(JETZT.getTime() - VERSPAETET_AB_MS);
  const darüber = new Date(JETZT.getTime() - VERSPAETET_AB_MS - 1000);

  assert.deepEqual(ausgeblieben([job({ nextExecutionAt: knapp })], JETZT), []);
  assert.equal(ausgeblieben([job({ nextExecutionAt: darüber })], JETZT).length, 1);
});

test('ein Termin in der Zukunft ist keiner', () => {
  assert.deepEqual(
    ausgeblieben([job({ nextExecutionAt: new Date('2026-08-21T02:00:00.000Z') })], JETZT),
    []
  );
});

/* ---------- Was gar nicht laufen sollte ---------- */

test('ein abgeschalteter Workflow wird nicht vermisst', () => {
  // Er soll ja nicht laufen. Ihn zu melden hieße, den Benutzer für seine
  // eigene Entscheidung zu tadeln.
  assert.deepEqual(ausgeblieben([job({ enabled: false })], JETZT), []);
});

test('ein Workflow ohne Zeitplan wird nicht vermisst', () => {
  assert.deepEqual(ausgeblieben([job({ schedule: undefined })], JETZT), []);
});

test('ein Workflow, der nur von Hand läuft, wird nicht vermisst', () => {
  // „Erwartet" heißt: Es gab eine Erwartung. Bei einem Handstart gibt es keine.
  assert.deepEqual(ausgeblieben([job({ executionMode: 'MANUAL' })], JETZT), []);
});

test('ein Workflow ohne nächsten Termin wird nicht vermisst', () => {
  // Er hat noch keinen bekommen — der erste Tick vergibt ihn.
  assert.deepEqual(ausgeblieben([job({ nextExecutionAt: undefined })], JETZT), []);
});

test('ein Workflow, der auch von Hand laufen darf, wird trotzdem erwartet', () => {
  assert.equal(ausgeblieben([job({ executionMode: 'MANUAL_AND_AUTOMATIC' })], JETZT).length, 1);
});

/* ---------- Die Kennung ---------- */

test('die Kennung nennt Workflow und Termin', () => {
  /*
   * Ohne den Termin meldete sich derselbe Workflow bei jedem Tick erneut,
   * solange ihn etwas am Nachholen hindert. Ohne den Workflow verschwiegen wir
   * den zweiten, der zur selben Zeit ausblieb.
   */
  const [versaeumt] = ausgeblieben([job()], JETZT);

  assert.equal(versaeumt.kennung, 'nachtlauf@2026-08-20T02:00:00.000Z');
});

test('derselbe Workflow zum nächsten Termin ist ein neues Versäumnis', () => {
  const heute = ausgeblieben([job()], JETZT)[0];
  const morgen = ausgeblieben([job({ nextExecutionAt: new Date('2026-08-21T02:00:00.000Z') })],
    new Date('2026-08-21T08:00:00.000Z'))[0];

  assert.notEqual(heute.kennung, morgen.kennung);
});

/* ---------- Wie lange her ---------- */

test('die Verspätung steht in der Einheit, in der man sie ausspricht', () => {
  assert.equal(dauer(0), '0 Minuten');
  assert.equal(dauer(45 * 60_000), '45 Minuten');
  assert.equal(dauer(3 * 3600_000), '3 Stunden');
  assert.equal(dauer(5 * 24 * 3600_000), '5 Tage');
});

test('eine negative Dauer ergibt keine negative Zahl', () => {
  // Uhren laufen zurück — Sommerzeit, eine Zeitsynchronisation, eine
  // Zeitzone, die jemand ändert. „vor -3 Minuten" liest sich wie ein Fehler
  // im Erzeugnis, und genau das würde dann gemeldet.
  assert.equal(dauer(-60_000), '0 Minuten');
});

/* ---------- Der Zeitpunkt, wie ein Mensch ihn liest ---------- */

test('der erwartete Zeitpunkt steht in der Zeitzone des Zeitplans', () => {
  /*
   * Ein Nachtlauf um 02:00 in Berlin steht als 00:00Z im Bestand. Wer das um
   * acht Uhr morgens liest, sucht nach einem Lauf um Mitternacht.
   */
  const [versaeumt] = ausgeblieben(
    [job({ nextExecutionAt: new Date('2026-08-20T00:00:00.000Z') })],
    new Date('2026-08-20T08:00:00.000Z')
  );

  assert.match(versaeumt.erwartetLokal, /02:00/);
  assert.match(versaeumt.erwartetLokal, /Europe\/Berlin/);
  assert.equal(versaeumt.erwartet, '2026-08-20T00:00:00.000Z', 'die technische Angabe bleibt daneben stehen');
});

test('eine andere Zeitzone ergibt eine andere Uhrzeit', () => {
  // Ein Dienstleister betreibt Workflows für Kunden in mehreren Ländern.
  const zeitpunkt = new Date('2026-08-20T00:00:00.000Z');

  assert.match(oertlich(zeitpunkt, 'Europe/Berlin'), /02:00/);
  assert.match(oertlich(zeitpunkt, 'UTC'), /00:00/);
});

test('eine unbekannte Zeitzone lässt die Meldung nicht scheitern', () => {
  // Lieber die technische Schreibweise als eine Meldung, die es gar nicht gibt.
  assert.equal(
    oertlich(new Date('2026-08-20T00:00:00.000Z'), 'Mittelerde/Auenland'),
    '2026-08-20T00:00:00.000Z'
  );
});
