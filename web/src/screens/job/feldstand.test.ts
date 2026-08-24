import assert from 'node:assert/strict';
import test from 'node:test';

import type { Job } from '../../api/types.js';
import { emptyJob } from './emptyJob.js';
import { ausgangStand, dateiwahlStand, eingangStand, nachlaufStand, quelleStand, zielStand } from './feldstand.js';

function job(teile: Partial<Job> = {}): Job {
  return { ...emptyJob('default', 'de'), ...teile } as Job;
}

/** Ein UNC-Pfad, aus Zeichen gebaut — als Literal überlebt er kein Werkzeug. */
const UNC = String.fromCharCode(92, 92) + 'SRV' + String.fromCharCode(92) + 'Austausch';

/* ---------- Grau: nichts eingetragen ---------- */

test('ein frischer Workflow steht auf grau, wo eine Eingabe fehlt', () => {
  /*
   * Grau lädt zum Ausfüllen ein. Wäre es grün, sagte der Punkt nichts — und man
   * gewöhnte sich an, ihn zu übersehen.
   */
  const frisch = job();

  assert.equal(quelleStand(frisch), 'LEER');
  assert.equal(zielStand(frisch), 'LEER');
});

test('eine Voreinstellung ist eine Antwort — auch ungefragt', () => {
  /*
   * „Welche Dateien" steht von Anfang an auf grün: CSV ist voreingestellt, und
   * damit ist die Frage beantwortet. Das ist derselbe Fall wie eine Fläche aus
   * reinen Auswahlfeldern — dort steht die Antwort auch, ohne dass jemand sie
   * angefasst hat.
   *
   * Der Test stand vorher andersherum, und das war richtig, solange die Liste
   * leer begann. Grau bleibt dem vorbehalten, wo wirklich nichts steht: einem
   * Pfad etwa, den nur der Betreiber kennt.
   */
  assert.equal(dateiwahlStand(job()), 'GUELTIG');

  // Wer die Liste leert und keinen Namen einträgt, steht wieder auf grau.
  assert.equal(dateiwahlStand(job({ allowedExtensions: [] })), 'LEER');
});

test('eine Fläche aus reinen Auswahlfeldern ist nie leer', () => {
  // Dort *steht* eine Antwort, auch wenn niemand sie angefasst hat.
  assert.equal(nachlaufStand(job()), 'GUELTIG');
});

test('Leerzeichen sind kein Verzeichnis', () => {
  assert.equal(quelleStand(job({ sourceType: 'LOCAL', sourceDirectory: '   ' })), 'LEER');
});

/* ---------- Gelb: angefangen, etwas Nötiges fehlt ---------- */

test('eine Freigabe ohne Zugang ist unvollständig, nicht falsch', () => {
  /*
   * Der Pfad stimmt, es fehlt eine Angabe — das ist Weitermachen und kein
   * Nachsehen. Rot wäre hier eine Übertreibung, die beim nächsten echten Fehler
   * nicht mehr auffällt.
   */
  const ohne = job({ sourceType: 'SHARE', sourceDirectory: UNC });

  assert.equal(quelleStand(ohne), 'UNVOLLSTAENDIG');
  assert.equal(quelleStand({ ...ohne, credentialId: 'z1' }), 'GUELTIG');
});

test('SFTP ohne Server oder Zugang ist unvollständig', () => {
  const nur = job({ sourceType: 'SFTP', sourceDirectory: '/eingang' });

  assert.equal(quelleStand(nur), 'UNVOLLSTAENDIG');
  assert.equal(quelleStand({ ...nur, sourceConfig: { ...nur.sourceConfig, host: 'srv' } }), 'UNVOLLSTAENDIG');
  assert.equal(
    quelleStand({ ...nur, sourceConfig: { ...nur.sourceConfig, host: 'srv' }, credentialId: 'z1' }),
    'GUELTIG'
  );
});

test('Verschieben ohne Archivverzeichnis ist unvollständig', () => {
  assert.equal(nachlaufStand(job({ sourceSuccessAction: 'MOVE' })), 'UNVOLLSTAENDIG');
  assert.equal(nachlaufStand(job({ sourceSuccessAction: 'MOVE', sourceArchiveDirectory: 'C:/archiv' })), 'GUELTIG');
});

/* ---------- Rot: eingetragen und in sich falsch ---------- */

test('eine Freigabe, die keine ist, steht auf rot', () => {
  /*
   * Ein Laufwerkspfad als Freigabe ergäbe einen Workflow, der einen Zugang mit
   * sich trägt, den nichts benutzt — er liefe scheinbar richtig und griffe die
   * ganze Zeit auf die eigene Platte zu. Der Server weist das beim Speichern
   * ab; der Punkt sagt es vorher.
   */
  assert.equal(
    quelleStand(job({ sourceType: 'SHARE', sourceDirectory: 'D:/Daten', credentialId: 'z1' })),
    'FEHLERHAFT'
  );
  assert.equal(
    zielStand(job({ destinationType: 'SHARE', destinationDirectory: 'D:/Daten', destinationCredentialId: 'z1' })),
    'FEHLERHAFT'
  );
});

test('ein Schrägstrich-UNC gilt als Freigabe', () => {
  // Windows nimmt beide Richtungen. Rot wegen eines Schrägstrichs wäre ein
  // Fehler, den es nicht gibt.
  assert.equal(
    quelleStand(job({ sourceType: 'SHARE', sourceDirectory: '//srv/austausch', credentialId: 'z1' })),
    'GUELTIG'
  );
});

/* ---------- Grün ---------- */

test('ein örtliches Verzeichnis genügt sich selbst', () => {
  assert.equal(quelleStand(job({ sourceType: 'LOCAL', sourceDirectory: 'C:/eingang' })), 'GUELTIG');
  assert.equal(zielStand(job({ destinationDirectory: 'C:/ausgang' })), 'GUELTIG');
});

test('erst ein Namensanfang oder eine Endung ist eine Entscheidung', () => {
  assert.equal(dateiwahlStand(job({ filenamePrefix: 'Filiale_' })), 'GUELTIG');
  assert.equal(dateiwahlStand(job({ allowedExtensions: ['.csv'] })), 'GUELTIG');
});

/* ---------- Die Glieder ---------- */

test('die Übernahme vom Vorgänger ist vollständig, sobald sie gewählt ist', () => {
  // Sie trägt keinen Pfad, sondern einen Verweis.
  assert.equal(eingangStand({ from: 'PRECEDING' }), 'GUELTIG');
});

test('ein eigenes Verzeichnis auf einer Freigabe braucht seinen Zugang', () => {
  assert.equal(eingangStand({ from: 'DIRECTORY', directory: '' }), 'LEER');
  assert.equal(eingangStand({ from: 'DIRECTORY', directory: 'C:/eingang' }), 'GUELTIG');
  assert.equal(eingangStand({ from: 'DIRECTORY', directory: UNC, art: 'SHARE' }), 'UNVOLLSTAENDIG');
  assert.equal(eingangStand({ from: 'DIRECTORY', directory: 'C:/x', art: 'SHARE', credentialId: 'z1' }), 'FEHLERHAFT');
  assert.equal(eingangStand({ from: 'DIRECTORY', directory: UNC, art: 'SHARE', credentialId: 'z1' }), 'GUELTIG');
});

test('das Weiterreichen braucht keinen Pfad, das Ablegen schon', () => {
  assert.equal(ausgangStand(undefined), 'LEER');
  assert.equal(ausgangStand({ to: 'FOLLOWING' }), 'GUELTIG');
  assert.equal(ausgangStand({ to: 'DIRECTORY', directory: '' }), 'LEER');
  assert.equal(ausgangStand({ to: 'DIRECTORY', directory: 'C:/ergebnis' }), 'GUELTIG');
});
