import assert from 'node:assert/strict';
import test from 'node:test';

import { alsMuster, alsZeilen, dateiname, gefuellte, kuerze } from './dateizeilen.js';

/** Ein Windows-Trennzeichen, aus seinem Kode gebaut — als Literal überlebt es kein Werkzeug. */
const BACK = String.fromCharCode(92);

/* ---------- Aus dem Muster werden Zeilen ---------- */

test('nichts eingetragen ergibt eine leere Zeile', () => {
  /*
   * Und keine leere Liste: Ohne Zeile stünde die Fläche ohne Eingabefeld da,
   * und es gäbe keinen Ort, an dem das erste Muster entsteht.
   */
  assert.deepEqual(alsZeilen(undefined), [undefined]);
  assert.deepEqual(alsZeilen(''), [undefined]);
  assert.deepEqual(alsZeilen('  ,  , '), [undefined]);
});

test('das Komma trennt, Leerzeichen daneben zählen nicht', () => {
  assert.deepEqual(alsZeilen('Filiale_*.csv,  Umsatz_*.csv'), [
    { art: 'NAME', wert: 'Filiale_*.csv' },
    { art: 'NAME', wert: 'Umsatz_*.csv' },
  ]);
});

test('von Sternen eingefasst heißt: ein Merkmal im Namen', () => {
  /*
   * Das ist die Rückrichtung dessen, was `alsMuster` schreibt. Ohne sie käme
   * jede gespeicherte Merkmalszeile als Dateiname zurück, und wer die Fläche
   * erneut öffnete, sähe die Sterne, die er nie getippt hat.
   */
  assert.deepEqual(alsZeilen('*Umsatz*'), [{ art: 'MERKMAL', wert: 'Umsatz' }]);
});

test('ein Stern in der Mitte bleibt ein Dateiname', () => {
  /*
   * `*a*b*` ist ein Muster und kein Merkmal — „a*b" irgendwo im Namen zu suchen
   * wäre etwas anderes, als was dasteht. Im Zweifel wörtlich: So trifft die
   * Zeile dieselben Dateien wie zuvor, nur die Sorte daneben stimmt nicht.
   */
  assert.deepEqual(alsZeilen('*a*b*'), [{ art: 'NAME', wert: '*a*b*' }]);
});

test('ein einzelner Stern ist kein Merkmal ohne Wert', () => {
  /*
   * `*` und `**` sind zu kurz, um etwas einzufassen. Als Merkmal gelesen
   * ergäben sie ein leeres Merkmal — und das träfe alles, statt zu filtern.
   */
  assert.deepEqual(alsZeilen('*'), [{ art: 'NAME', wert: '*' }]);
  assert.deepEqual(alsZeilen('**'), [{ art: 'NAME', wert: '**' }]);
});

/* ---------- Aus den Zeilen wird das Muster ---------- */

test('ein Merkmal wird zu Sternen links und rechts', () => {
  assert.equal(alsMuster([{ art: 'MERKMAL', wert: 'Umsatz' }]), '*Umsatz*');
});

test('ein Dateiname steht da, wie er ist', () => {
  assert.equal(alsMuster([{ art: 'NAME', wert: 'Filiale_*.csv' }]), 'Filiale_*.csv');
});

test('leere Zeilen fallen fort, und ohne Zeile gibt es kein Muster', () => {
  /*
   * `undefined` und nicht `''`: Ein leeres Muster hieße im Auftrag „nichts
   * eingetragen", eine leere Zeichenkette stünde als Angabe da, die nie trifft.
   */
  assert.equal(alsMuster([undefined, { art: 'NAME', wert: '  ' }]), undefined);
  assert.equal(alsMuster([]), undefined);
  assert.equal(alsMuster([undefined, { art: 'NAME', wert: 'a.csv' }, undefined]), 'a.csv');
});

test('mehrere Zeilen werden durch Komma und Leerzeichen getrennt', () => {
  assert.equal(
    alsMuster([
      { art: 'NAME', wert: 'a.csv' },
      { art: 'MERKMAL', wert: 'Umsatz' },
    ]),
    'a.csv, *Umsatz*'
  );
});

test('was hin und zurück geht, bleibt dasselbe', () => {
  /*
   * Die Runde ist der eigentliche Vertrag: Gespeichert wird die Zeichenkette,
   * bedient werden die Zeilen. Liefen die beiden auseinander, änderte sich der
   * Auftrag beim bloßen Ansehen der Fläche.
   */
  for (const muster of ['a.csv', '*Umsatz*', 'a.csv, *Umsatz*, Filiale_?.txt']) {
    assert.equal(alsMuster(alsZeilen(muster)), muster);
  }
});

/* ---------- Was in den Auftrag geht ---------- */

test('nur Zeilen mit Inhalt gehen in den Auftrag', () => {
  assert.deepEqual(gefuellte([undefined, { art: 'NAME', wert: ' ' }, { art: 'NAME', wert: 'a.csv' }]), [
    { art: 'NAME', wert: 'a.csv' },
  ]);
});

/* ---------- Kürzen ---------- */

test('zuerst fallen die leeren Zeilen fort', () => {
  /*
   * Wer die Zahl senkt, will Platz schaffen und nicht etwas verlieren. Die
   * leere Zeile in der Mitte ist das Erste, was fort kann — obwohl sie nicht
   * unten steht.
   */
  const rest = kuerze([{ art: 'NAME', wert: 'a' }, undefined, { art: 'NAME', wert: 'b' }], 2);

  assert.deepEqual(rest, [
    { art: 'NAME', wert: 'a' },
    { art: 'NAME', wert: 'b' },
  ]);
});

test('reichen die leeren nicht, fällt von unten weg', () => {
  const rest = kuerze(
    [
      { art: 'NAME', wert: 'a' },
      { art: 'NAME', wert: 'b' },
      { art: 'NAME', wert: 'c' },
    ],
    2
  );

  assert.deepEqual(rest, [
    { art: 'NAME', wert: 'a' },
    { art: 'NAME', wert: 'b' },
  ]);
});

test('eine Zeile bleibt immer stehen', () => {
  /*
   * Auch bei Ziel null: Ohne Zeile gäbe es kein Feld mehr, in das man die
   * nächste Datei eintragen könnte — die Fläche wäre nicht mehr zu bedienen.
   */
  assert.deepEqual(kuerze([{ art: 'NAME', wert: 'a' }], 0), [undefined]);
});

test('kürzer als das Ziel bleibt, wie es ist', () => {
  const reihen = [{ art: 'NAME' as const, wert: 'a' }, undefined];

  assert.deepEqual(kuerze(reihen, 5), reihen);
});

/* ---------- Der Dateiname ---------- */

test('aus einem Pfad wird der letzte Teil', () => {
  /*
   * Beide Trennzeichen: Aus dem Auswahlfenster kommt ein Pfad mit `/`, aus
   * Windows einer mit dem anderen — und gemischt kommen sie auch vor.
   */
  assert.equal(dateiname('Ordner/Unter/Datei.csv'), 'Datei.csv');
  assert.equal(dateiname('Ordner' + BACK + 'Datei.csv'), 'Datei.csv');
  assert.equal(dateiname('C:' + BACK + 'Daten/Ordner' + BACK + 'Datei.csv'), 'Datei.csv');
});

test('ohne Trennzeichen ist der Pfad schon der Name', () => {
  assert.equal(dateiname('Datei.csv'), 'Datei.csv');
});
