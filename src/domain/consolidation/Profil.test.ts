import assert from 'node:assert/strict';
import test from 'node:test';

import type { Strukturvorgabe } from '../discovery/Expectation.js';
import type { Qualitaetsregel } from '../quality/Regeln.js';
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

/* ---------- Was den JSON-Schema-Umweg ersetzt ---------- */

const PFLICHT: Qualitaetsregel = {
  id: 'artikelnummer-pflicht',
  name: 'Artikelnummer darf nicht leer sein',
  feld: 'Artikelnummer',
  pruefung: { art: 'PFLICHT' },
  schwere: 'KONFLIKT',
};

test('ein Profil trägt seine Regeln von Anfang an', () => {
  /*
   * Sie ersetzen die JSON-Schema-Datei, die niemand von Hand schreiben wollte.
   * Am Profil und nicht am Workflow: Was ein gültiger Wert ist, hängt an der
   * Quelle und nicht an dem, was man gerade mit ihr vorhat.
   */
  const angelegt = neuesProfil({
    id: 'p2',
    tenantId: 'default',
    name: 'Bestellung mit Regeln',
    vorgabe: VORGABE,
    regeln: [PFLICHT],
    schluessel: { felder: ['Artikelnummer'] },
    jetzt: JETZT,
  });

  assert.deepEqual(aktuelleVersion(angelegt).regeln, [PFLICHT]);
  assert.deepEqual(aktuelleVersion(angelegt).schluessel, { felder: ['Artikelnummer'] });
});

test('eine geänderte Regel ergibt eine neue Version', () => {
  /*
   * Sonst änderte sich still, was ein Lauf vom März für gültig hielt — und das
   * Protokoll daneben behäuptete etwas anderes als das Ergebnis.
   */
  const geaendert = fortschreiben(profil(), { regeln: [PFLICHT] }, undefined, JETZT);

  assert.equal(geaendert.neu, true);
  assert.equal(versionOf(geaendert.profil, 1)?.regeln, undefined, 'Version 1 ist unberührt');
  assert.deepEqual(versionOf(geaendert.profil, 2)?.regeln, [PFLICHT]);
});

test('ein geänderter Schlüssel ergibt eine neue Version', () => {
  const geaendert = fortschreiben(profil(), { schluessel: { felder: ['Bezeichnung'] } }, undefined, JETZT);

  assert.equal(geaendert.neu, true);
  assert.deepEqual(aktuelleVersion(geaendert.profil).schluessel, { felder: ['Bezeichnung'] });
});

test('Regeln und Schlüssel erbt eine Version wie alles andere', () => {
  const mitRegeln = fortschreiben(
    profil(),
    { regeln: [PFLICHT], schluessel: { felder: ['Artikelnummer'] } },
    undefined,
    JETZT
  ).profil;

  const danach = fortschreiben(mitRegeln, { einstellungen: { stichprobe: 250 } }, undefined, JETZT);

  assert.deepEqual(aktuelleVersion(danach.profil).regeln, [PFLICHT]);
  assert.deepEqual(aktuelleVersion(danach.profil).schluessel, { felder: ['Artikelnummer'] });
});

test('dieselben Regeln noch einmal ergeben keine Version', () => {
  const mitRegeln = fortschreiben(profil(), { regeln: [PFLICHT] }, undefined, JETZT).profil;
  const gleich = fortschreiben(mitRegeln, { regeln: [{ ...PFLICHT }] }, undefined, JETZT);

  assert.equal(gleich.neu, false);
  assert.equal(gleich.profil.versionen.length, 2);
});
