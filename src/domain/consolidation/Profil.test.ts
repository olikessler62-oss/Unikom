import assert from 'node:assert/strict';
import test from 'node:test';

import type { Strukturvorgabe } from '../discovery/Expectation.js';
import { aktuelleVersion, fortschreiben, neuesProfil, versionOf } from './Profil.js';

const VORGABE: Strukturvorgabe = {
  verbindlichkeit: 'HINWEIS',
  columns: 2,
  spalten: [
    { position: 1, name: 'Artikelnummer', type: 'INTEGER' },
    { position: 2, name: 'Bezeichnung', type: 'STRING' },
  ],
};

const JETZT = new Date('2026-08-19T10:00:00.000Z');

function profil() {
  return neuesProfil({
    id: 'p1',
    tenantId: 'default',
    name: 'Bestellung Müller GmbH',
    vorgabe: VORGABE,
    erstelltVon: 'u-1',
    erstelltVonName: 'anna',
    jetzt: JETZT,
  });
}

test('ein neues Profil beginnt bei Version 1', () => {
  const angelegt = profil();

  assert.equal(angelegt.versionen.length, 1);
  assert.equal(aktuelleVersion(angelegt).version, 1);
  assert.equal(aktuelleVersion(angelegt).erstelltVonName, 'anna');
});

test('eine Änderung erzeugt eine neue Version und lässt die alte stehen', () => {
  const spaeter = new Date('2026-09-01T08:00:00.000Z');
  const geaendert = fortschreiben(
    profil(),
    { einstellungen: { locale: 'en-US' }, notiz: 'Lieferant schreibt jetzt amerikanisch' },
    { id: 'u-2', name: 'bernd' },
    spaeter
  );

  assert.equal(geaendert.neu, true);
  assert.equal(geaendert.profil.versionen.length, 2);
  assert.equal(versionOf(geaendert.profil, 1)?.einstellungen.locale, undefined, 'Version 1 ist unberührt');
  assert.equal(versionOf(geaendert.profil, 2)?.einstellungen.locale, 'en-US');
  assert.equal(versionOf(geaendert.profil, 2)?.notiz, 'Lieferant schreibt jetzt amerikanisch');
});

test('was eine Version nicht ändert, erbt sie von ihrer Vorgängerin', () => {
  const geaendert = fortschreiben(profil(), { einstellungen: { stichprobe: 250 } }, undefined, JETZT);

  assert.deepEqual(aktuelleVersion(geaendert.profil).vorgabe, VORGABE);
});

test('eine Fortschreibung ohne Änderung erzeugt keine Version — und sagt es', () => {
  // Eine Kette aus zwanzig gleichen Versionen ist keine Geschichte, sondern
  // Rauschen: Wer darin sucht, wann sich etwas geändert hat, findet zwanzig
  // Kandidaten und keine Antwort.
  const angelegt = profil();
  const gleich = fortschreiben(angelegt, { vorgabe: VORGABE }, undefined, new Date('2026-09-01T08:00:00.000Z'));

  assert.equal(gleich.neu, false);
  assert.equal(gleich.profil.versionen.length, 1);
  assert.equal(gleich.profil, angelegt, 'dasselbe Profil, nicht eine Kopie davon');
});

test('eine Version lässt sich nicht nachträglich ändern', () => {
  // `readonly` verschwindet beim Übersetzen. Ein Lauf, der Version 1 benutzt
  // hat, muss auch dann Version 1 vorfinden, wenn irgendwo im Code jemand ein
  // Feld setzt.
  const angelegt = profil();
  const version = aktuelleVersion(angelegt);

  assert.throws(() => {
    (version as { notiz?: string }).notiz = 'heimlich geändert';
  }, TypeError);

  assert.throws(() => {
    version.vorgabe.spalten![0].name = 'etwas anderes';
  }, TypeError);
});

test('auch nach einer Fortschreibung bleibt die alte Version eingefroren', () => {
  const geaendert = fortschreiben(profil(), { einstellungen: { locale: 'en-US' } }, undefined, JETZT);
  const erste = versionOf(geaendert.profil, 1)!;

  assert.throws(() => {
    (erste as { version: number }).version = 99;
  }, TypeError);
});

test('die Versionsnummern laufen fortlaufend weiter', () => {
  let stand = profil();

  for (const grenze of [10, 20, 30]) {
    stand = fortschreiben(stand, { einstellungen: { jahrhundertGrenze: grenze } }, undefined, JETZT).profil;
  }

  assert.deepEqual(
    stand.versionen.map((version) => version.version),
    [1, 2, 3, 4]
  );
});
