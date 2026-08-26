import assert from 'node:assert/strict';
import test from 'node:test';

import type { Abholung } from './Konsolidierungsschritt.js';
import { ablagestand, type Abholender } from './Ablageorte.js';

const VOLLSTAENDIG: Abholung = {
  archiv: '/archiv',
  arbeit: '/arbeit',
  erledigt: '/erledigt',
  gescheitert: '/gescheitert',
};

function holt(abholung?: Abholung): Abholender {
  return { input: { from: 'DIRECTORY', directory: '/eingang' }, dateien: { abholung } };
}

/* ---------- Wann alles steht ---------- */

test('sind alle vier da, darf der Durchgang zugreifen', () => {
  const stand = ablagestand(holt(VOLLSTAENDIG), 'Konsolidierung');

  assert.equal(stand.art, 'BEREIT');
  // Das Abholverzeichnis steht mit dabei: Wer diesen Zweig in der Hand hat, hat
  // jedes Verzeichnis, das der Zugriff braucht.
  assert.equal(stand.art === 'BEREIT' && stand.verzeichnis, '/eingang');
  assert.deepEqual(stand.art === 'BEREIT' ? stand.orte : undefined, {
    archiv: '/archiv',
    arbeit: '/arbeit',
    erledigt: '/erledigt',
    gescheitert: '/gescheitert',
  });
});

test('Leerraum ringsum gehört nicht zum Pfad', () => {
  const stand = ablagestand(holt({ ...VOLLSTAENDIG, arbeit: '  /arbeit  ' }), 'Konsolidierung');

  assert.equal(stand.art === 'BEREIT' && stand.orte.arbeit, '/arbeit');
});

/* ---------- Wer nicht abholt, braucht nichts ---------- */

test('ein Durchgang, dem die Dateien gereicht werden, braucht keine Ablage', () => {
  /*
   * Es gibt kein Abholverzeichnis, aus dem etwas herauszunehmen wäre. Die vier
   * Angaben zu verlangen wäre eine Pflicht ohne Wirkung — und wer sie
   * ausfüllt, bekäme ein Archiv, in das nie etwas gelegt wird.
   */
  assert.equal(ablagestand({ input: { from: 'PRECEDING' } }, 'Durchgang 2 von 2').art, 'GEREICHT');
});

/* ---------- Was fehlt ---------- */

test('ohne jede Angabe fehlen alle vier', () => {
  const stand = ablagestand(holt(), 'Konsolidierung');

  assert.equal(stand.art, 'UNVOLLSTAENDIG');
  // In der Reihenfolge des Weges, den eine Datei nimmt — nicht der Eingabe.
  assert.deepEqual(stand.art === 'UNVOLLSTAENDIG' ? [...stand.fehlend] : [], [
    'archiv',
    'arbeit',
    'erledigt',
    'gescheitert',
  ]);
});

test('ein leerer Eintrag ist keine Angabe', () => {
  const stand = ablagestand(holt({ ...VOLLSTAENDIG, gescheitert: '   ' }), 'Konsolidierung');

  assert.deepEqual(stand.art === 'UNVOLLSTAENDIG' ? [...stand.fehlend] : [], ['gescheitert']);
});

test('fehlt eines, steht es in der Einzahl da', () => {
  const stand = ablagestand(holt({ ...VOLLSTAENDIG, archiv: undefined }), 'Konsolidierung');

  assert.match(stand.art === 'UNVOLLSTAENDIG' ? stand.hinweis : '', /Es fehlt das Verzeichnis „Archiv"\./);
});

test('fehlen mehrere, stehen sie mit „und" vor dem letzten', () => {
  const stand = ablagestand(holt({ arbeit: '/arbeit' }), 'Konsolidierung');

  assert.match(
    stand.art === 'UNVOLLSTAENDIG' ? stand.hinweis : '',
    /Es fehlen die Verzeichnisse „Archiv", „Erledigt" und „Gescheitert"\./
  );
});

test('genau zwei stehen nur mit „und" dazwischen', () => {
  // Die Grenze der Aufzählung: Bei zweien gibt es kein Komma, nur das „und".
  const stand = ablagestand(holt({ arbeit: '/arbeit', gescheitert: '/gescheitert' }), 'Konsolidierung');

  assert.match(
    stand.art === 'UNVOLLSTAENDIG' ? stand.hinweis : '',
    /Es fehlen die Verzeichnisse „Archiv" und „Erledigt"\./
  );
});

test('der Satz nennt, was geschieht und wo es einzutragen ist', () => {
  /*
   * Drei Dinge, und jedes davon fehlte einmal in einer Meldung, die daraufhin
   * niemand gebrauchen konnte: was fehlt, was deshalb geschieht, wo man es
   * einträgt.
   */
  const stand = ablagestand(holt(), 'Durchgang 2 von 3 (Anreichern)');
  const hinweis = stand.art === 'UNVOLLSTAENDIG' ? stand.hinweis : '';

  assert.match(hinweis, /^Durchgang 2 von 3 \(Anreichern\) liest aus „\/eingang"\./);
  assert.match(hinweis, /bleibt unangetastet liegen/);
  assert.match(hinweis, /unter „Verzeichnisse"/);
});
