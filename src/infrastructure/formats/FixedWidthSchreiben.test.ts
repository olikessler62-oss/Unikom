import assert from 'node:assert/strict';
import test from 'node:test';

import { texte } from './Bestand.js';
import { readFixedWidth } from './FixedWidth.js';
import { alsFestbreitenBytes, felderAus, pruefeFelder, schreibeFixedWidth } from './FixedWidthSchreiben.js';

const KUNDEN = felderAus([
  { name: 'kdnr', laenge: 5, ausrichtung: 'RECHTS', fuellzeichen: '0' },
  { name: 'name', laenge: 15 },
  { name: 'ort', laenge: 10 },
]);

const ZEILEN = [
  ['42', 'Meier', 'Bonn'],
  ['4711', 'Schulz', 'Köln'],
];

test('die Werte stehen an den beschriebenen Stellen', () => {
  const ausgabe = schreibeFixedWidth(['kdnr', 'name', 'ort'], ZEILEN, { felder: KUNDEN });
  const [erste] = ausgabe.text.split(String.fromCharCode(13));

  assert.equal(erste, '00042Meier          Bonn      ');
  assert.equal(erste.length, 30);
});

test('was geschrieben wurde, liest der Leser wieder ein', () => {
  /*
   * Die Probe, die zählt. Ein Schreiber, der seine eigene Beschreibung anders
   * auslegt als der Leser, ergibt eine Datei, die nur beim Empfänger auffällt —
   * und dort als Datenfehler, nicht als Formatfehler.
   */
  const ausgabe = schreibeFixedWidth(['kdnr', 'name', 'ort'], ZEILEN, { felder: KUNDEN });
  const gelesen = readFixedWidth(alsFestbreitenBytes(ausgabe), { felder: KUNDEN });

  assert.deepEqual(gelesen.fields, ['kdnr', 'name', 'ort']);
  assert.deepEqual(
    gelesen.rows.map(texte),
    ZEILEN
  );
});

test('das Füllzeichen steht auf der Seite, an der aufgefüllt wird', () => {
  // Eine rechtsbündige Kundennummer bekommt führende Nullen, ein linksbündiger
  // Name Leerzeichen dahinter.
  const ausgabe = schreibeFixedWidth(['kdnr', 'name', 'ort'], [['7', 'Ay', 'Ulm']], { felder: KUNDEN });

  assert.match(ausgabe.text, /^00007Ay {13}Ulm {7}/);
});

/* ---------- Was nicht passt ---------- */

test('ein zu langer Wert wird nicht heimlich gekürzt, sondern gemeldet', () => {
  /*
   * Aus „Meiersheimer-Krüger" würde „Meiersheimer-Kr", und das sähe der
   * Empfänger als vollständigen Namen an. Aus einer Kundennummer würde eine
   * andere Kundennummer.
   */
  const ausgabe = schreibeFixedWidth(['kdnr', 'name', 'ort'], [['42', 'Meiersheimer-Krüger', 'Bonn']], {
    felder: KUNDEN,
  });

  assert.equal(ausgabe.ueberlaeufe.length, 1);
  assert.deepEqual(ausgabe.ueberlaeufe[0], {
    zeile: 1,
    feld: 'name',
    wert: 'Meiersheimer-Krüger',
    laenge: 19,
    erlaubt: 15,
  });
  assert.doesNotMatch(ausgabe.text, /Meiersheimer/, 'nichts Halbes steht in der Datei');
});

test('kürzen ist erlaubt, wenn es ausdrücklich dasteht', () => {
  const felder = felderAus([{ name: 'name', laenge: 5, kuerzen: true }]);
  const ausgabe = schreibeFixedWidth(['name'], [['Meiersheimer']], { felder });

  assert.equal(ausgabe.text.trim(), 'Meier');
  assert.deepEqual(ausgabe.ueberlaeufe, []);
});

test('rechtsbündig gekürzt wird vorn', () => {
  // Beides ist Datenverlust, nur an verschiedenen Enden — und bei einer Zahl
  // ist das hintere Ende das falsche.
  const felder = felderAus([{ name: 'betrag', laenge: 4, ausrichtung: 'RECHTS', kuerzen: true }]);

  assert.equal(schreibeFixedWidth(['betrag'], [['1234567']], { felder }).text.trim(), '4567');
});

/* ---------- Die Feldbeschreibung ---------- */

test('überlappende Felder werden abgelehnt', () => {
  // Sie ergäben eine Datei, die niemand mehr zurücklesen kann — und das fiele
  // erst dem Empfänger auf.
  const maengel = pruefeFelder([
    { name: 'a', start: 1, laenge: 10 },
    { name: 'b', start: 5, laenge: 5 },
  ]);

  assert.equal(maengel.length, 1);
  assert.match(maengel[0], /überlappen/);
});

test('ohne Feldbeschreibung wird nicht geschrieben', () => {
  assert.throws(() => schreibeFixedWidth(['a'], [['1']], { felder: [] }), /welches Feld an welcher Stelle/);
});

test('eine Lücke zwischen zwei Feldern bleibt eine Lücke', () => {
  /*
   * Die Feldbeschreibung bestimmt die Stellen, nicht die Reihenfolge der Werte.
   * Wer aneinanderhängt, verschiebt die halbe Zeile, sobald jemand die
   * Beschreibung umsortiert.
   */
  const ausgabe = schreibeFixedWidth(['a', 'b'], [['x', 'y']], {
    felder: [
      { name: 'b', start: 10, laenge: 1 },
      { name: 'a', start: 1, laenge: 1 },
    ],
  });

  assert.equal(ausgabe.text.split(String.fromCharCode(13))[0], 'x        y');
});

test('ein Feld, für das kein Wert vorliegt, bleibt leer und fällt nicht weg', () => {
  // Sonst verschöbe sich alles dahinter.
  const ausgabe = schreibeFixedWidth(['kdnr'], [['42']], { felder: KUNDEN });

  assert.equal(ausgabe.text.split(String.fromCharCode(13))[0], '00042' + ' '.repeat(25));
});

test('eine Kopfzeile ist selbst eine Zeile fester Breite', () => {
  const ausgabe = schreibeFixedWidth(['kdnr', 'name', 'ort'], ZEILEN, { felder: KUNDEN, kopfzeile: true });
  const [kopf] = ausgabe.text.split(String.fromCharCode(13));

  // Die Beschriftung folgt der Ausrichtung ihres Feldes: über der
  // rechtsbündigen Kundennummer steht sie rechtsbündig, über ihrer eigenen
  // Kante. Gefüllt wird dabei mit Leerzeichen — Nullen vor einem Feldnamen
  // wären keine Beschriftung mehr.
  assert.equal(kopf, ' kdnrname           ort       ');
  assert.equal(kopf.length, 30);
  assert.deepEqual(ausgabe.ueberlaeufe, [], 'ein zu langer Feldname ist kein Prüffall');
});

test('felderAus zählt die Stellen selbst', () => {
  // Von Hand jedes start einzutragen ist die Stelle, an der sich jemand
  // verzählt — und der Fehler fällt erst dem Empfänger auf.
  const felder = felderAus([
    { name: 'a', laenge: 3 },
    { name: 'b', laenge: 5 },
    { name: 'c', laenge: 2 },
  ]);

  assert.deepEqual(
    felder.map((feld) => feld.start),
    [1, 4, 9]
  );
});
