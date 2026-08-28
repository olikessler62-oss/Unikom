import assert from 'node:assert/strict';
import test from 'node:test';

import { texte } from './Bestand.js';
import { feldvorschlag, readFixedWidth, type Feld } from './FixedWidth.js';

/** Das Beispiel aus SPEC-03, Abschnitt 6.2, Stelle für Stelle. */
const FELDER: Feld[] = [
  { name: 'Kundennummer', start: 1, laenge: 5 },
  { name: 'Nachname', start: 6, laenge: 20 },
  { name: 'Vorname', start: 26, laenge: 15 },
  { name: 'Geburtsdatum', start: 41, laenge: 10 },
];

function bytes(text: string, kodierung: BufferEncoding = 'utf-8'): Uint8Array {
  return new Uint8Array(Buffer.from(text, kodierung));
}

function zeile(nummer: string, nachname: string, vorname: string, datum: string): string {
  return nummer.padEnd(5) + nachname.padEnd(20) + vorname.padEnd(15) + datum.padEnd(10);
}

test('Felder werden über Position und Länge geschnitten', () => {
  const gelesen = readFixedWidth(
    bytes([zeile('4711', 'Mustermann', 'Anna', '01.03.1980'), zeile('4712', 'Berger', 'Bernd', '15.11.1975')].join('\n')),
    { felder: FELDER }
  );

  assert.deepEqual(gelesen.fields, ['Kundennummer', 'Nachname', 'Vorname', 'Geburtsdatum']);
  assert.deepEqual(texte(gelesen.rows[0]), ['4711', 'Mustermann', 'Anna', '01.03.1980']);
  assert.deepEqual(texte(gelesen.rows[1]), ['4712', 'Berger', 'Bernd', '15.11.1975']);
});

test('ein rechtsbündiges Feld verliert seine führenden Füllzeichen, ein linksbündiges nicht', () => {
  // Eine Kundennummer „00042" ist als Zahl 42 und als Kennung „00042". Welches
  // von beidem gilt, entscheidet die Feldbeschreibung und nicht der Leser.
  const inhalt = '00042' + '00042';
  const gelesen = readFixedWidth(bytes(inhalt), {
    felder: [
      { name: 'Zahl', start: 1, laenge: 5, ausrichtung: 'RECHTS', fuellzeichen: '0' },
      { name: 'Kennung', start: 6, laenge: 5 },
    ],
  });

  assert.deepEqual(texte(gelesen.rows[0]), ['42', '00042']);
});

test('eine zu kurze Zeile ergibt leere Felder — und eine Meldung', () => {
  const gelesen = readFixedWidth(bytes(['4711 Mustermann', zeile('4712', 'Berger', 'Bernd', '15.11.1975')].join('\n')), {
    felder: FELDER,
  });

  assert.deepEqual(texte(gelesen.rows[0]), ['4711', 'Mustermann', '', '']);
  assert.match(gelesen.notes.join(' '), /1 von 2 Zeile\(n\) sind kürzer/);
});

test('sind alle Zeilen zu kurz, ist eher die Beschreibung schuld', () => {
  // Ein Hinweis, der in die richtige Richtung zeigt, spart eine Stunde Suchen
  // in der falschen.
  const gelesen = readFixedWidth(bytes('4711 Mustermann\n4712 Berger'), { felder: FELDER });

  assert.match(gelesen.notes.join(' '), /eher die Feldbeschreibung zu prüfen/);
});

test('ohne Feldbeschreibung wird nicht geraten', () => {
  assert.throws(() => readFixedWidth(bytes('irgendwas'), { felder: [] }), /müssen die Felder beschrieben sein/);
});

test('Umlaute verschieben nichts, solange in Zeichen gezählt wird', () => {
  const gelesen = readFixedWidth(bytes(zeile('4711', 'Müller', 'Jürgen', '01.03.1980')), { felder: FELDER });

  assert.deepEqual(texte(gelesen.rows[0]), ['4711', 'Müller', 'Jürgen', '01.03.1980']);
});

test('bei Umlauten wird gesagt, dass in Zeichen gezählt wurde', () => {
  // Wer die Positionen in Bytes festgelegt hat, bekommt ab dem ersten Umlaut
  // alles verschoben — und es sieht weiterhin aus wie Daten.
  const gelesen = readFixedWidth(bytes(zeile('4711', 'Müller', 'Jürgen', '01.03.1980')), { felder: FELDER });

  assert.match(gelesen.notes.join(' '), /mehr als ein Byte/);
});

test('in Bytes gezählt wird richtig geschnitten und richtig zurückübersetzt', () => {
  // „Müller" belegt sieben Bytes und sechs Zeichen. Wer die Feldbeschreibung in
  // Bytes aufgestellt hat, muss auch in Bytes schneiden — und das Ergebnis
  // muss danach wieder Text sein und nicht „MÃ¼ller".
  const inhalt = 'Müller' + '   ' + 'Bonn';
  const felder: Feld[] = [
    { name: 'Name', start: 1, laenge: 10 },
    { name: 'Ort', start: 11, laenge: 4 },
  ];

  const nachBytes = readFixedWidth(bytes(inhalt), { zaehlung: 'BYTES', felder });

  assert.deepEqual(texte(nachBytes.rows[0]), ['Müller', 'Bonn'], 'kein „MÃ¼ller" im Feld');

  // Dieselben Bytes in Zeichen gezählt ergeben etwas anderes — genau deshalb
  // gibt es die Wahl, und genau deshalb meldet der Leser sie.
  const nachZeichen = readFixedWidth(bytes(inhalt), { felder });

  assert.notDeepEqual(texte(nachZeichen.rows[0]), ['Müller', 'Bonn']);
});

test('windows-1252 wird erkannt und richtig gelesen', () => {
  const gelesen = readFixedWidth(bytes(zeile('4711', 'Müller', 'Jürgen', '01.03.1980'), 'latin1'), { felder: FELDER });

  assert.equal(gelesen.feststellungen.kodierung, 'windows-1252');
  assert.deepEqual(texte(gelesen.rows[0]).slice(0, 3), ['4711', 'Müller', 'Jürgen']);
});

test('die Feldgrenzen lassen sich aus den Daten vorschlagen', () => {
  // Wer eine solche Datei von Hand abzählt, verzählt sich.
  const zeilen = [
    '4711 Mustermann      Anna           01.03.1980',
    '4712 Berger          Bernd          15.11.1975',
  ];

  assert.deepEqual(feldvorschlag(zeilen), [
    { name: 'Feld 1', start: 1, laenge: 4 },
    { name: 'Feld 2', start: 6, laenge: 10 },
    { name: 'Feld 3', start: 22, laenge: 5 },
    { name: 'Feld 4', start: 37, laenge: 10 },
  ]);
});

test('ein Leerzeichen mitten im Wert ist keine Feldgrenze', () => {
  // „Meier Sohn" steht in beiden Zeilen an derselben Stelle — die Lücke ist
  // aber nur in einer Zeile leer, also ist sie keine.
  const zeilen = ['1 Meier Sohn   Köln', '2 Schulz       Bonn'];
  const felder = feldvorschlag(zeilen);

  assert.equal(felder.length, 3, 'Nummer, Name, Ort - nicht vier');
});
