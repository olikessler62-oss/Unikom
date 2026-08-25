import assert from 'node:assert/strict';
import test from 'node:test';

import { VERHALTEN_ALLGEMEIN, verhaltenVon, zeigtSichWieder } from './Konfliktverhalten.js';

const JETZT = new Date('2026-08-24T09:00:00.000Z');

function vor(stunden: number): string {
  return new Date(JETZT.getTime() - stunden * 3_600_000).toISOString();
}

/* ---------- Die Vererbung ---------- */

test('ohne Einstellung gilt die Voreinstellung', () => {
  assert.deepEqual(verhaltenVon(undefined), VERHALTEN_ALLGEMEIN);
  assert.deepEqual(verhaltenVon({}), VERHALTEN_ALLGEMEIN);
});

test('voreingestellt ist die Wiedervorlage und nicht das lauteste', () => {
  /*
   * Ein Fenster, das bei jedem Klick wiederkommt, wird nach der dritten Woche
   * weggeklickt, ohne gelesen zu werden. Wer es so will, stellt es ein.
   */
  assert.equal(VERHALTEN_ALLGEMEIN.vorlage, 'WIEDERVORLAGE');
});

test('wer nur die Frist ändert, verstellt nichts anderes mit', () => {
  const verhalten = verhaltenVon({ wiedervorlageStunden: 4 });

  assert.equal(verhalten.wiedervorlageStunden, 4);
  assert.equal(verhalten.vorlage, VERHALTEN_ALLGEMEIN.vorlage);
  assert.equal(verhalten.akzeptierenErlaubt, VERHALTEN_ALLGEMEIN.akzeptierenErlaubt);
});

test('das Verbot des Akzeptierens überlebt die Vererbung', () => {
  // `false` ist ein Wert und nicht „nichts eingestellt" — die naheliegendste
  // Art, diese Einstellung versehentlich wirkungslos zu machen.
  assert.equal(verhaltenVon({ akzeptierenErlaubt: false }).akzeptierenErlaubt, false);
});

/* ---------- Wann sich ein Fall wieder zeigt ---------- */

test('was noch nie jemand gesehen hat, zeigt sich in jeder Einstellung', () => {
  for (const vorlage of ['EINMAL', 'WIEDERVORLAGE', 'BEI_JEDEM_OEFFNEN'] as const) {
    assert.equal(zeigtSichWieder(undefined, verhaltenVon({ vorlage }), JETZT), true, vorlage);
  }
});

test('EINMAL zeigt sich kein zweites Mal', () => {
  // Fort ist der Fall damit nicht: Er steht weiter in der Glocke.
  assert.equal(zeigtSichWieder(vor(1), verhaltenVon({ vorlage: 'EINMAL' }), JETZT), false);
  assert.equal(zeigtSichWieder(vor(1000), verhaltenVon({ vorlage: 'EINMAL' }), JETZT), false);
});

test('BEI_JEDEM_OEFFNEN zeigt sich auch eine Sekunde später wieder', () => {
  assert.equal(zeigtSichWieder(vor(0), verhaltenVon({ vorlage: 'BEI_JEDEM_OEFFNEN' }), JETZT), true);
});

test('die Wiedervorlage wartet ihre Frist ab', () => {
  const verhalten = verhaltenVon({ vorlage: 'WIEDERVORLAGE', wiedervorlageStunden: 24 });

  assert.equal(zeigtSichWieder(vor(23), verhalten, JETZT), false);
  assert.equal(zeigtSichWieder(vor(25), verhalten, JETZT), true);
});

test('genau auf die Stunde zählt als abgelaufen', () => {
  /*
   * Sonst zeigte sich ein Fall bei einer Frist von 24 Stunden erst nach
   * 24 Stunden und einem Taktschlag — und beim nächsten Lauf wieder nicht,
   * weil der Takt danebenfiel.
   */
  const verhalten = verhaltenVon({ vorlage: 'WIEDERVORLAGE', wiedervorlageStunden: 24 });

  assert.equal(zeigtSichWieder(vor(24), verhalten, JETZT), true);
});

test('ein kaputter Zeitstempel lässt den Fall wieder auftauchen', () => {
  /*
   * Die bequeme Lesart wäre „eben erst gezeigt" — und dann verschwände ein
   * offener Konflikt wegen eines unlesbaren Datums.
   */
  assert.equal(zeigtSichWieder('kein Datum', verhaltenVon({ vorlage: 'WIEDERVORLAGE' }), JETZT), true);
  assert.equal(zeigtSichWieder('', verhaltenVon({ vorlage: 'WIEDERVORLAGE' }), JETZT), true);
});

test('ein Zeitstempel aus der Zukunft hält den Fall zurück, statt ihn zu wiederholen', () => {
  /*
   * Eine verstellte Uhr ist kein Grund, jemandem dasselbe Fenster im Takt
   * vorzuhalten. Er steht weiter in der Glocke, und die Frist läuft ab.
   */
  const gleich = new Date(JETZT.getTime() + 3_600_000).toISOString();

  assert.equal(zeigtSichWieder(gleich, verhaltenVon({ vorlage: 'WIEDERVORLAGE' }), JETZT), false);
});

/* ---------- Ganz oder in Teilen ---------- */

test('voreingestellt bleibt eine Lieferung ganz', () => {
  /*
   * Nicht, weil es besser wäre, sondern weil es das ist, was bisher geschah.
   * Wer aus dreitausend Zeilen 2.983 bekommt und es nicht weiß, bucht einen
   * Monatsabschluss auf unvollständigen Daten.
   */
  assert.equal(VERHALTEN_ALLGEMEIN.auslieferung, 'NUR_VOLLSTAENDIG');
  assert.equal(verhaltenVon({}).auslieferung, 'NUR_VOLLSTAENDIG');
});

test('wer das Teilen erlaubt, verstellt nichts anderes mit', () => {
  const verhalten = verhaltenVon({ auslieferung: 'IN_TEILEN' });

  assert.equal(verhalten.auslieferung, 'IN_TEILEN');
  assert.equal(verhalten.vorlage, VERHALTEN_ALLGEMEIN.vorlage);
  assert.equal(verhalten.akzeptierenErlaubt, VERHALTEN_ALLGEMEIN.akzeptierenErlaubt);
});
