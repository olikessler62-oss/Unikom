import assert from 'node:assert/strict';
import test from 'node:test';

import type { Job } from '../../api/types.js';
import { emptyJob } from './emptyJob.js';
import {
  ausgangBelegt,
  dateiwahlBelegt,
  eingangBelegt,
  nachlaufBelegt,
  quelleBelegt,
  zielBelegt,
} from './belegt.js';

function job(teile: Partial<Job> = {}): Job {
  return { ...emptyJob('default', 'de'), ...teile } as Job;
}

/* ---------- Der leere Workflow leuchtet nirgends ---------- */

test('ein frischer Workflow hat keinen belegten Bereich', () => {
  /*
   * Der Kern der Sache. Leuchtete der Streifen von Anfang an, sagte er nichts —
   * und man gewöhnte sich an, ihn zu übersehen.
   */
  const frisch = job();

  assert.equal(quelleBelegt(frisch), false);
  assert.equal(zielBelegt(frisch), false);
  assert.equal(dateiwahlBelegt(frisch), false);

  // Ausgenommen die Fläche, die nur aus einer Auswahl besteht: Dort *steht*
  // eine Antwort, auch wenn niemand sie angefasst hat.
  assert.equal(nachlaufBelegt(frisch), true);
});

/* ---------- Die Quelle ---------- */

test('ein örtliches Verzeichnis genügt sich selbst', () => {
  assert.equal(quelleBelegt(job({ sourceType: 'LOCAL', sourceDirectory: 'C:/eingang' })), true);
});

test('eine Freigabe ohne Zugang leuchtet nicht', () => {
  // Ohne Zugang wird sie mit dem Dienstkonto erreicht — der Lauf findet dann
  // nichts oder das Falsche. Das ist keine halbe Angabe, sondern keine.
  const ohne = job({ sourceType: 'SHARE', sourceDirectory: '//srv/austausch' });

  assert.equal(quelleBelegt(ohne), false);
  assert.equal(quelleBelegt({ ...ohne, credentialId: 'z1' }), true);
});

test('SFTP braucht Server und Zugang', () => {
  const nur = job({ sourceType: 'SFTP', sourceDirectory: '/eingang' });

  assert.equal(quelleBelegt(nur), false);
  assert.equal(quelleBelegt({ ...nur, sourceConfig: { ...nur.sourceConfig, host: 'srv' } }), false);
  assert.equal(quelleBelegt({ ...nur, sourceConfig: { ...nur.sourceConfig, host: 'srv' }, credentialId: 'z1' }), true);
});

test('Leerzeichen sind kein Verzeichnis', () => {
  assert.equal(quelleBelegt(job({ sourceType: 'LOCAL', sourceDirectory: '   ' })), false);
});

/* ---------- Das Ziel ---------- */

test('ein Ziel ohne Art ist örtlich', () => {
  // So verhielt sich jeder Workflow, bevor es entfernte Ziele gab.
  assert.equal(zielBelegt(job({ destinationDirectory: 'C:/ausgang' })), true);
});

test('ein Freigabeziel ohne Zugang leuchtet nicht', () => {
  const ohne = job({ destinationType: 'SHARE', destinationDirectory: '//srv/ausgang' });

  assert.equal(zielBelegt(ohne), false);
  assert.equal(zielBelegt({ ...ohne, destinationCredentialId: 'z1' }), true);
});

/* ---------- Welche Dateien ---------- */

test('erst ein Namensanfang oder eine Endung ist eine Entscheidung', () => {
  // Leer heißt „alles" — eine brauchbare Voreinstellung und keine Eingabe.
  assert.equal(dateiwahlBelegt(job({ filenamePrefix: 'Filiale_' })), true);
  assert.equal(dateiwahlBelegt(job({ allowedExtensions: ['.csv'] })), true);
  assert.equal(dateiwahlBelegt(job({ filenamePrefix: '  ' })), false);
});

/* ---------- Nach der Übernahme ---------- */

test('eine getroffene Wahl genügt, solange sie nichts weiter verlangt', () => {
  /*
   * Ein Auswahlfeld zeigt immer einen Wert, und der Anwender sieht ihn — die
   * Fläche trägt also eine Antwort. Nur „verschieben" verlangt eine zweite
   * Angabe; ohne sie bliebe der Lauf hängen.
   */
  assert.equal(nachlaufBelegt(job({ sourceSuccessAction: 'KEEP' })), true);
  assert.equal(nachlaufBelegt(job({ sourceSuccessAction: 'DELETE' })), true);
  assert.equal(nachlaufBelegt(job({ sourceSuccessAction: 'MOVE' })), false);
  assert.equal(
    nachlaufBelegt(job({ sourceSuccessAction: 'MOVE', sourceArchiveDirectory: 'C:/archiv' })),
    true
  );
});

/* ---------- Die Glieder ---------- */

test('die Übernahme vom Vorgänger ist vollständig, sobald sie gewählt ist', () => {
  // Sie trägt keinen Pfad, sondern einen Verweis.
  assert.equal(eingangBelegt({ from: 'PRECEDING' }), true);
});

test('ein eigenes Verzeichnis auf einer Freigabe braucht seinen Zugang', () => {
  assert.equal(eingangBelegt({ from: 'DIRECTORY', directory: '' }), false);
  assert.equal(eingangBelegt({ from: 'DIRECTORY', directory: 'C:/eingang' }), true);
  assert.equal(eingangBelegt({ from: 'DIRECTORY', directory: '//srv/x', art: 'SHARE' }), false);
  assert.equal(
    eingangBelegt({ from: 'DIRECTORY', directory: '//srv/x', art: 'SHARE', credentialId: 'z1' }),
    true
  );
});

test('das Weiterreichen braucht keinen Pfad, das Ablegen schon', () => {
  assert.equal(ausgangBelegt(undefined), false);
  assert.equal(ausgangBelegt({ to: 'FOLLOWING' }), true);
  assert.equal(ausgangBelegt({ to: 'DIRECTORY', directory: '' }), false);
  assert.equal(ausgangBelegt({ to: 'DIRECTORY', directory: 'C:/ergebnis' }), true);
});
