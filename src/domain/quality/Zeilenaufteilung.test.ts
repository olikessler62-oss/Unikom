import assert from 'node:assert/strict';
import test from 'node:test';

import type { Qualitaetsregel } from './Regeln.js';
import { GRUNDSPALTE, grundspalte, teileAuf } from './Zeilenaufteilung.js';

const OPTIONEN = { region: { locale: 'de-DE', timeZone: 'Europe/Berlin' } };

function satz(teile: Record<string, string>) {
  return new Map(Object.entries(teile));
}

function regel(teile: Partial<Qualitaetsregel> = {}): Qualitaetsregel {
  return {
    id: 'kdnr-pflicht',
    name: 'Kundennummer darf nicht leer sein',
    feld: 'Kundennummer',
    pruefung: { art: 'PFLICHT' },
    schwere: 'FEHLER',
    ...teile,
  };
}

/* ---------- Die drei Ausgänge ---------- */

test('ohne Regeln ist alles verarbeitbar', () => {
  /*
   * Der Regelfall für eine Quelle ohne Schema — und keine stillschweigende
   * Zustimmung, sondern das Ergebnis einer Prüfung, die nichts zu prüfen hatte.
   */
  const aufteilung = teileAuf([satz({ a: '1' }), satz({ a: '' })], [], OPTIONEN);

  assert.equal(aufteilung.verarbeitbar.length, 2);
  assert.equal(aufteilung.gescheitert.length, 0);
  assert.equal(aufteilung.pruefbedarf.length, 0);
  assert.deepEqual(aufteilung.verarbeitbar[0].gruende, []);
});

test('ein Fehler nimmt die Zeile heraus, die anderen laufen weiter', () => {
  const aufteilung = teileAuf(
    [satz({ Kundennummer: '4711' }), satz({ Kundennummer: '' }), satz({ Kundennummer: '4713' })],
    [regel()],
    OPTIONEN
  );

  assert.deepEqual(
    aufteilung.verarbeitbar.map((urteil) => urteil.zeile),
    [1, 3]
  );
  assert.deepEqual(
    aufteilung.gescheitert.map((urteil) => urteil.zeile),
    [2]
  );
});

test('ein Konflikt ist kein Fehlschlag', () => {
  /*
   * Er geht an einen Menschen. Wer ihn nach „Gescheitert" räumt, hat die
   * Entscheidung weggeräumt, statt sie zu stellen.
   */
  const aufteilung = teileAuf([satz({ Kundennummer: '' })], [regel({ schwere: 'KONFLIKT' })], OPTIONEN);

  assert.equal(aufteilung.gescheitert.length, 0);
  assert.deepEqual(
    aufteilung.pruefbedarf.map((urteil) => urteil.zeile),
    [1]
  );
});

test('Info und Warnung halten nichts auf', () => {
  const aufteilung = teileAuf(
    [satz({ Kundennummer: '' }), satz({ Kundennummer: '' })],
    [regel({ schwere: 'INFO' }), regel({ id: 'zweite', schwere: 'WARNUNG' })],
    OPTIONEN
  );

  assert.equal(aufteilung.verarbeitbar.length, 2);
  // Sie sind aufgefallen — nur eben ohne Folgen für den Ausgang.
  assert.equal(aufteilung.verarbeitbar[0].befunde.length, 2);
});

test('der schwerste Befund entscheidet, nicht der erste', () => {
  /*
   * Sonst hinge das Ergebnis daran, in welcher Reihenfolge jemand die Regeln
   * angelegt hat — und dieselbe Datei liefe morgen anders durch.
   */
  const warnungZuerst = teileAuf(
    [satz({ Kundennummer: '' })],
    [regel({ id: 'a', schwere: 'WARNUNG' }), regel({ id: 'b', schwere: 'FEHLER' })],
    OPTIONEN
  );

  const fehlerZuerst = teileAuf(
    [satz({ Kundennummer: '' })],
    [regel({ id: 'b', schwere: 'FEHLER' }), regel({ id: 'a', schwere: 'WARNUNG' })],
    OPTIONEN
  );

  assert.equal(warnungZuerst.gescheitert.length, 1);
  assert.equal(fehlerZuerst.gescheitert.length, 1);
});

test('ein Fehler schlägt einen Konflikt in derselben Zeile', () => {
  const aufteilung = teileAuf(
    [satz({ Kundennummer: '' })],
    [regel({ id: 'a', schwere: 'KONFLIKT' }), regel({ id: 'b', schwere: 'FEHLER' })],
    OPTIONEN
  );

  assert.equal(aufteilung.gescheitert.length, 1);
  assert.equal(aufteilung.pruefbedarf.length, 0);
});

/* ---------- Die Gründe ---------- */

test('jede herausgenommene Zeile trägt ihren Grund', () => {
  /*
   * Eine Ablehnungsdatei ohne Grund je Zeile schickt jemanden ins Protokoll,
   * um dort dreißig Meldungen den Zeilennummern zuzuordnen.
   */
  const aufteilung = teileAuf([satz({ Kundennummer: '' })], [regel()], OPTIONEN);

  assert.equal(aufteilung.gescheitert[0].gruende.length, 1);
  assert.match(aufteilung.gescheitert[0].gruende[0], /„Kundennummer" ist leer/);
  // Ursache und Auswirkung in einem Satz — in einer Tabellenzelle gelesen.
  assert.match(aufteilung.gescheitert[0].gruende[0], /zuordnen/);
});

test('Info und Warnung stehen nicht unter den Gründen', () => {
  /*
   * Der Grund ist das, was den Ausgang bestimmt hat. Eine Warnung in einer
   * Zeile, die durchging, als „Grund" auszugeben, hieße einen Grund für etwas
   * zu nennen, das nicht geschehen ist.
   */
  const aufteilung = teileAuf(
    [satz({ Kundennummer: '' })],
    [regel({ id: 'a', schwere: 'WARNUNG' }), regel({ id: 'b', schwere: 'FEHLER' })],
    OPTIONEN
  );

  assert.equal(aufteilung.gescheitert[0].befunde.length, 2);
  assert.equal(aufteilung.gescheitert[0].gruende.length, 1);
});

test('die Zeilennummer zählt ab eins', () => {
  // So, wie ein Mensch sie in einer Tabelle sucht.
  const aufteilung = teileAuf([satz({ Kundennummer: '' })], [regel()], OPTIONEN);

  assert.equal(aufteilung.gescheitert[0].zeile, 1);
});

test('die Zeile selbst reist mit', () => {
  // Ohne sie ließe sich die Ablehnungsdatei nicht schreiben.
  const aufteilung = teileAuf([satz({ Kundennummer: '', Ort: 'Kiel' })], [regel()], OPTIONEN);

  assert.equal(aufteilung.gescheitert[0].satz.get('Ort'), 'Kiel');
});

/* ---------- Die Grundspalte ---------- */

test('die Grundspalte heißt so, wie sie heißt', () => {
  assert.equal(grundspalte(['Kundennummer', 'Ort']), GRUNDSPALTE);
});

test('gibt es die Spalte schon, weicht sie aus', () => {
  /*
   * Sonst überschriebe die Ablehnungsdatei eine echte Spalte — ausgerechnet in
   * der Datei, die jemand liest, um einen Fehler zu suchen.
   */
  assert.equal(grundspalte([GRUNDSPALTE]), `${GRUNDSPALTE}_2`);
  assert.equal(grundspalte([GRUNDSPALTE, `${GRUNDSPALTE}_2`]), `${GRUNDSPALTE}_3`);
});
