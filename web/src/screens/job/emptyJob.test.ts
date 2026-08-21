import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyJob } from './emptyJob.js';

test('ein neuer Workflow lässt die Quelldatei nicht liegen', () => {
  // FR_009, Abschnitt 4: Datensparsamkeit als Voreinstellung. Eine verarbeitete
  // Eingangsdatei, die stehen bleibt, ist ein Bestand, den niemand verwaltet.
  assert.equal(emptyJob('default', 'de').sourceSuccessAction, 'DELETE');
});

test('die anderen Voreinstellungen bleiben, wie sie waren', () => {
  const job = emptyJob('default', 'de');

  assert.equal(job.conflictStrategy, 'SKIP', 'im Ziel wird nichts überschrieben');
  assert.equal(job.createDestinationDirectory, true);
  assert.equal(job.encryptionConfig.enabled, false);
});

/* ---------- Welche Kettenglieder ein neuer Workflow einschaltet ---------- */

test('ein neuer Workflow hakt jedes gekaufte Modul an', () => {
  /*
   * Ein Kunde, der drei Module besitzt und nur eines angehakt sieht, hält die
   * anderen leicht für nicht vorhanden — und fragt beim Support nach etwas,
   * das er längst gekauft hat.
   */
  const job = emptyJob('default', 'de', ['TRANSFER', 'CONSOLIDATION', 'DATA_IMPORT', 'CONVERSION']);

  assert.equal(job.transfer?.enabled, true);
  assert.equal(job.consolidation?.enabled, true);
  assert.equal(job.delivery?.enabled, true);
});

test('das Ausliefern ist ein Glied und nicht zwei', () => {
  /*
   * „Daten importieren" und „Daten konvertieren" standen einmal als zwei
   * Kettenglieder nebeneinander. Wer in eine Datenbank importiert, konvertiert
   * davor aber keine Datei — und das Konvertieren las in dieser Kette aus dem
   * Import, der Tabellen füllt und keine Datei hinterlässt.
   */
  const job = emptyJob('default', 'de', ['TRANSFER', 'CONSOLIDATION', 'DATA_IMPORT', 'CONVERSION']);

  assert.equal(job.delivery?.ziel, 'DATEI', 'die Datei ist der harmlosere Zweig');
  assert.equal(job.delivery?.konvertieren, undefined, 'konvertiert wird erst auf Verlangen');
});

test('wer nur den Datenbankimport hat, bekommt den Datenbankzweig', () => {
  const job = emptyJob('default', 'de', ['CONSOLIDATION', 'DATA_IMPORT']);

  assert.equal(job.delivery?.ziel, 'DATENBANK');
  assert.equal(job.delivery?.output, undefined, 'ein Import schreibt in Tabellen');
});

test('was nicht gekauft ist, wird nicht angehakt', () => {
  const job = emptyJob('default', 'de', ['CONSOLIDATION']);

  assert.equal(job.consolidation?.enabled, true);
  assert.equal(job.delivery, undefined, 'ohne eine Hälfte von Modul 3 gibt es kein Ausliefern');
});

test('ein Kunde ohne Datenübertragung kann einen Workflow anlegen', () => {
  /*
   * „Fehlt" heißt beim Übertragen **an** — eine Regel für Workflows aus der
   * Zeit, als das Glied noch nicht abschaltbar war. Fuer einen neuen Workflow
   * war sie ein Fehler: Das Speichern verlangte ein Modul, das der Kunde nie
   * gekauft hat.
   */
  assert.equal(emptyJob('default', 'de', ['CONSOLIDATION']).transfer?.enabled, false);
});

test('jedes Glied übernimmt, was das vorige ablegt', () => {
  // Die Vorbestückung: der Schritt davor, der Reihenfolge nach.
  const job = emptyJob('default', 'de', ['TRANSFER', 'CONSOLIDATION', 'CONVERSION']);

  assert.deepEqual(job.consolidation?.input, { from: 'PRECEDING' });
  assert.deepEqual(job.consolidation?.output, { to: 'FOLLOWING' });
  assert.deepEqual(job.delivery?.input, { from: 'PRECEDING' });
});

test('das erste Glied bekommt kein geratenes Verzeichnis', () => {
  // Ein leeres Feld fordert zum Ausfuellen auf; ein geratener Pfad täuscht
  // eine Entscheidung vor, die niemand getroffen hat.
  const job = emptyJob('default', 'de', ['CONSOLIDATION']);

  assert.deepEqual(job.consolidation?.input, { from: 'DIRECTORY', directory: '' });
  assert.deepEqual(job.consolidation?.output, { to: 'DIRECTORY', directory: '' });
});

test('das Ausliefern übernimmt, was die Konsolidierung ablegt', () => {
  const job = emptyJob('default', 'de', ['CONSOLIDATION', 'DATA_IMPORT']);

  assert.deepEqual(job.delivery?.input, { from: 'PRECEDING' });
  assert.deepEqual(job.consolidation?.output, { to: 'FOLLOWING' });
});

test('ohne jedes Modul bleibt die Kette leer', () => {
  // Der Editor lässt dann nichts speichern — richtig so: Ein Workflow, in dem
  // kein Schritt läuft, würde jede Nacht nichts tun.
  const job = emptyJob('default', 'de', []);

  assert.equal(job.transfer?.enabled, false);
  assert.equal(job.consolidation, undefined);
});
