import assert from 'node:assert/strict';
import test from 'node:test';

import { wirksameEinstellungen, type Mandanteneinstellungen } from './Einstellungen.js';
import {
  KONFIDENZ_MINDESTENS,
  pruefeEinstellungen,
  senktNurDieTyperkennung,
  STICHPROBE_MINDESTENS,
} from './Einstellungspruefung.js';
import { CONFIDENCE_THRESHOLD } from './Recognition.js';

function fehlerVon(einstellungen: Mandanteneinstellungen): string[] {
  return pruefeEinstellungen(einstellungen).map((fehler) => fehler.name);
}

test('leere Einstellungen sind gültig', () => {
  // Nichts einzustellen ist der Normalfall: Dann gilt, was Unikom mitbringt.
  assert.deepEqual(pruefeEinstellungen({}), []);
});

test('brauchbare Werte gehen durch', () => {
  assert.deepEqual(
    pruefeEinstellungen({
      jahrhundertGrenze: 50,
      nullWerte: ['', 'N/A'].slice(1),
      stichprobe: 100,
      stichprobeGrenze: 1000,
      mindestKonfidenz: 0.97,
    }),
    []
  );
});

/* ---------- Jahrhundertgrenze ---------- */

test('eine Jahrhundertgrenze über 99 ist keine zweistellige Jahreszahl', () => {
  // Bei 150 schaltete sich die zweistellige Lesart still ab.
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: 150 }), ['jahrhundertGrenze']);
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: -1 }), ['jahrhundertGrenze']);
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: 50.5 }), ['jahrhundertGrenze']);
});

test('die Ränder 0 und 99 gelten', () => {
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: 0 }), []);
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: 99 }), []);
});

test('der Grund nennt den Wert und erklärt die Wirkung', () => {
  // Eine Fehlermeldung, die nur „ungültig" sagt, ist eine Sackgasse.
  const [fehler] = pruefeEinstellungen({ jahrhundertGrenze: 150 });

  assert.match(fehler.grund, /150/);
  assert.match(fehler.grund, /49 zu 2049/);
});

/* ---------- Nullwerte ---------- */

test('ein leerer Nullwert hat keine Wirkung und wird abgelehnt', () => {
  /*
   * Ein leeres Feld gilt ohnehin als nichts. Der Eintrag stünde nur da und
   * ließe vermuten, es sei etwas eingestellt.
   */
  assert.deepEqual(fehlerVon({ nullWerte: ['N/A', '  '] }), ['nullWerte']);
});

test('derselbe Nullwert zweimal wird gemeldet', () => {
  assert.deepEqual(fehlerVon({ nullWerte: ['N/A', 'N/A'] }), ['nullWerte']);
});

test('mehrere verschiedene Nullwerte sind der Regelfall', () => {
  assert.deepEqual(fehlerVon({ nullWerte: ['N/A', '-', 'keine Angabe', 'NULL'] }), []);
});

/* ---------- Stichprobe ---------- */

test('eine winzige Stichprobe wird abgelehnt', () => {
  // Aus drei Werten einen Feldtyp abzuleiten ergibt Typen, die vor der ersten
  // echten Lieferung gelten und danach nicht mehr.
  assert.deepEqual(fehlerVon({ stichprobe: 3 }), ['stichprobe']);
  assert.deepEqual(fehlerVon({ stichprobe: STICHPROBE_MINDESTENS }), []);
});

test('eine Obergrenze unter der Stichprobe macht aus der Erweiterung eine Kürzung', () => {
  /*
   * Die Grenze ist das, worauf erweitert wird, wenn die Stichprobe nicht
   * reicht. Darunter bekäme ausgerechnet der unsichere Fall weniger Belege als
   * der sichere.
   */
  assert.deepEqual(fehlerVon({ stichprobe: 100, stichprobeGrenze: 50 }), ['stichprobeGrenze']);
});

test('eine Obergrenze gleich der Stichprobe geht durch', () => {
  // Sie heißt dann nur: nicht erweitern.
  assert.deepEqual(fehlerVon({ stichprobe: 100, stichprobeGrenze: 100 }), []);
});

test('eine Obergrenze allein wird für sich geprüft', () => {
  assert.deepEqual(fehlerVon({ stichprobeGrenze: 2 }), ['stichprobeGrenze']);
});

/* ---------- Mindestkonfidenz ---------- */

test('eine Mindestkonfidenz unter der Hälfte wird abgelehnt', () => {
  // Darunter passt nicht einmal die Mehrheit der Werte zum erkannten Typ.
  assert.deepEqual(fehlerVon({ mindestKonfidenz: 0.3 }), ['mindestKonfidenz']);
  assert.deepEqual(fehlerVon({ mindestKonfidenz: KONFIDENZ_MINDESTENS }), []);
});

test('mehr als eins gibt es nicht', () => {
  assert.deepEqual(fehlerVon({ mindestKonfidenz: 1.2 }), ['mindestKonfidenz']);
  assert.deepEqual(fehlerVon({ mindestKonfidenz: 1 }), []);
});

test('eine Zahl, die keine ist, wird abgelehnt', () => {
  assert.deepEqual(fehlerVon({ mindestKonfidenz: Number.NaN }), ['mindestKonfidenz']);
});

test('eine gesenkte Mindestkonfidenz lockert nur die Typerkennung', () => {
  /*
   * Sie dient zwei Dingen. Für die Frage, ab wann Unikom einen Wertekonflikt
   * selbst entscheiden darf, gilt 0,97 als Untergrenze — gleich, was hier
   * steht. Ein Kunde darf die Typerkennung lockern; er darf sich damit keine
   * automatischen Entscheidungen erkaufen, die sonst ein Mensch träfe.
   */
  assert.equal(senktNurDieTyperkennung(0.8), true);
  assert.equal(senktNurDieTyperkennung(CONFIDENCE_THRESHOLD), false);
  assert.equal(senktNurDieTyperkennung(undefined), false);
});

/* ---------- Und sie wirken wirklich ---------- */

test('was am Mandanten steht, überstimmt die Voreinstellung', () => {
  // Die eigentliche Zusage: Die Ebene, die gewinnt, ist die des Mandanten.
  const wirksam = wirksameEinstellungen({ nullWerte: ['keine Angabe'], jahrhundertGrenze: 30 }, undefined);

  assert.deepEqual(wirksam.nullWerte, ['keine Angabe']);
  assert.equal(wirksam.jahrhundertGrenze, 30);
});

test('mehrere Fehler kommen zusammen und nicht einzeln', () => {
  // Sonst korrigiert jemand vier Mal hintereinander je einen Wert.
  assert.deepEqual(fehlerVon({ jahrhundertGrenze: 150, stichprobe: 2, mindestKonfidenz: 5 }).sort(), [
    'jahrhundertGrenze',
    'mindestKonfidenz',
    'stichprobe',
  ]);
});
