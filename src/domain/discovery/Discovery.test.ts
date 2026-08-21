import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { discover } from './Discovery.js';

const deutsch = { region: DEFAULT_REGION };

test('die Daten aus einer Bestellung im Fließtext werden gefunden', () => {
  // Das Beispiel aus FR_007. Anrede, Bitte und Grußformel gehören nicht dazu,
  // und das ist kein Fehler, sondern der Normalfall.
  const brief = [
    'Sehr geehrte Damen und Herren,',
    '',
    'hiermit bestellen wir folgende Artikel.',
    '',
    'Bitte liefern Sie schnellstmöglich.',
    '',
    'Artikelnummer   Bezeichnung        Menge   Preis',
    '4711            Schraube M8        500     0,12',
    '4712            Mutter M8          500     0,08',
    '4713            Unterlegscheibe    1000    0,04',
    '',
    'Bitte bestätigen Sie den Auftrag.',
    '',
    'Mit freundlichen Grüßen',
    'Max Mustermann',
  ].join('\n');

  const { blocks } = discover(brief, deutsch);

  assert.equal(blocks.length, 1, 'genau ein Datenblock');

  const [block] = blocks;

  assert.equal(block.start, 8);
  assert.equal(block.end, 10);
  assert.equal(block.rows.length, 3);
  assert.equal(block.headerLine, 7, 'die Kopfzeile steht unmittelbar darüber');
  assert.deepEqual(
    block.columns.map((spalte) => spalte.name),
    ['Artikelnummer', 'Bezeichnung', 'Menge', 'Preis']
  );
  assert.deepEqual(
    block.columns.map((spalte) => spalte.type),
    ['INTEGER', 'STRING', 'INTEGER', 'DECIMAL']
  );
  assert.ok(block.confidence >= 0.9, `Zuversicht ${block.confidence}`);
});

test('auch ohne ausgerichtete Spalten, mit einfachen Leerzeichen', () => {
  // Der Copy-&-Paste-Fall aus FR_007, Abschnitt 10. „Schraube M8" enthält
  // selbst ein Leerzeichen und ist trotzdem ein Feld.
  const eingefuegt = [
    'Sehr geehrte Damen und Herren,',
    '',
    'wir bestellen:',
    '',
    '4711 Schraube M8 500 0,12',
    '4712 Mutter M8 500 0,08',
    '4713 Scheibe 1000 0,04',
    '',
    'Vielen Dank.',
  ].join('\n');

  const { blocks } = discover(eingefuegt, deutsch);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].rows.length, 3);
  assert.equal(blocks[0].columns.length, 4, 'vier Spalten, nicht fünf');
  assert.deepEqual(blocks[0].rows[0], ['4711', 'Schraube M8', '500', '0,12']);
});

test('eine einzelne Leerzeile beendet den Block nicht', () => {
  const inhalt = ['4711 | Müller | 500', '4712 | Meier  | 300', '', '4713 | Schulz | 400', '4714 | Weber  | 200'].join(
    '\n'
  );

  const { blocks } = discover(inhalt, deutsch);

  assert.equal(blocks.length, 1, 'die Leerzeile in der Mitte trennt nicht');
  assert.equal(blocks[0].rows.length, 4);
});

test('mehrere Blöcke werden getrennt gefunden', () => {
  // FR_007, Abschnitt 13: nicht „einen" Block suchen, sondern alle.
  const bestellung = [
    'Bestellung',
    '',
    'Kundendaten:',
    '10001 | Müller GmbH | Frankfurt',
    '10002 | Weber AG | Köln',
    '',
    '',
    'Bestellpositionen:',
    '4711 | Schraube | 500',
    '4712 | Mutter | 500',
    '4713 | Scheibe | 250',
  ].join('\n');

  const { blocks, notes } = discover(bestellung, deutsch);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].rows.length, 2);
  assert.equal(blocks[1].rows.length, 3);
  assert.ok(
    notes.some((note) => note.includes('entscheidet ein Mensch')),
    'bei mehreren Blöcken wird nicht stillschweigend einer gewählt'
  );
});

test('eine abweichende Zeile fliegt nicht aus dem Block', () => {
  // FR_007, Abschnitt 7: tolerant, aber nicht blind.
  const inhalt = [
    '4711 | Schraube | 04.03.2026 | 0,12',
    '4712 | Mutter | 15.01.2026 | 0,08',
    '4713 | Scheibe | auf Anfrage | 0,04',
    '4714 | Winkel | 28.02.2026 | 0,15',
  ].join('\n');

  const { blocks } = discover(inhalt, deutsch);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].rows.length, 4, 'die dritte Zeile bleibt drin');
  assert.equal(blocks[0].columns[2].type, 'DATE');
  assert.ok(blocks[0].columns[2].confidence < 1, 'die Spalte weiß, dass sie nicht ganz sauber ist');
});

test('reiner Fließtext ergibt keinen Datenblock', () => {
  // FR_007, Abschnitt 17: „Keine eindeutige Datenstruktur erkannt" ist ein
  // richtiges Ergebnis. Wer aus jedem Absatz eine Tabelle macht, ist nicht
  // schlau, sondern lästig.
  const brief = [
    'Sehr geehrte Frau Berger,',
    '',
    'vielen Dank für Ihre Nachricht vom vergangenen Freitag.',
    'Wir werden die Angelegenheit prüfen und melden uns.',
    '',
    'Mit freundlichen Grüßen',
    'Max Mustermann',
  ].join('\n');

  const { blocks, notes } = discover(brief, deutsch);

  assert.deepEqual(blocks, []);
  assert.ok(notes.some((note) => note.includes('Keine eindeutige Datenstruktur')));
});

test('eine gewöhnliche CSV-Datei ist nur ein Sonderfall davon', () => {
  const csv = ['Kundennr;Name;Betrag', '1001;Berger GmbH;1.234,56', '1002;Schmitt KG;89,90', '1003;Weber AG;450,00'].join(
    '\n'
  );

  const { blocks } = discover(csv, deutsch);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].strategy, 'SEMIKOLON');
  assert.equal(blocks[0].headerLine, 1);
  assert.deepEqual(
    blocks[0].columns.map((spalte) => spalte.type),
    ['INTEGER', 'STRING', 'DECIMAL']
  );
});

test('was außerhalb der Blöcke liegt, wird benannt statt verschwiegen', () => {
  const inhalt = ['Guten Tag,', '', '1001;Berger;100', '1002;Schmitt;200', '', 'Viele Grüße'].join('\n');

  const { blocks, ignoredLines } = discover(inhalt, deutsch);

  assert.equal(blocks.length, 1);
  assert.deepEqual(ignoredLines, [1, 2, 5, 6]);
});

test('die Zuversicht lässt sich begründen', () => {
  const { blocks } = discover(['1001;Berger;100', '1002;Schmitt;200', '1003;Weber;300'].join('\n'), deutsch);

  // Eine Zahl ohne Begründung ist eine Behauptung. Der Block sagt, woraus sie
  // entstanden ist.
  assert.ok(blocks[0].reasons.length >= 2, blocks[0].reasons.join(' / '));
  assert.ok(blocks[0].reasons.some((grund) => grund.includes('gleichem Muster')));
});

test('jede Spalte weiß, woher ihre Aussage stammt', () => {
  const { blocks } = discover(['1001;Berger;100', '1002;Schmitt;200'].join('\n'), deutsch);

  for (const spalte of blocks[0].columns) {
    assert.equal(spalte.herkunft, 'OBSERVED', 'aus den Daten gelesen, nicht vorgegeben');
  }
});
