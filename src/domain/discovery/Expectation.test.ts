import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { discover, discoverFields } from './Discovery.js';
import { alsVorgabe, combine, type Strukturvorgabe } from './Expectation.js';

const deutsch = { region: DEFAULT_REGION };

const BESTELLUNG = [
  'Sehr geehrte Damen und Herren,',
  '',
  'Artikelnummer   Bezeichnung        Menge   Preis',
  '4711            Schraube M8        500     0,12',
  '4712            Mutter M8          500     0,08',
  '4713            Unterlegscheibe    1000    0,04',
  '',
  'Mit freundlichen Grüßen',
].join('\n');

const HINTERLEGT: Strukturvorgabe = {
  verbindlichkeit: 'HINWEIS',
  columns: 4,
  spalten: [
    { position: 1, name: 'Artikelnummer', type: 'INTEGER' },
    { position: 2, name: 'Bezeichnung', type: 'STRING' },
    { position: 3, name: 'Menge', type: 'INTEGER' },
    { position: 4, name: 'Preis', type: 'DECIMAL' },
  ],
};

test('Konfiguration und Automatik stützen einander', () => {
  // FR_008, Abschnitt 3: nicht ODER, sondern UND. Wenn beide dasselbe sagen,
  // ist das mehr wert als jede Aussage für sich.
  const { blocks } = discover(BESTELLUNG, deutsch);
  const ergebnis = combine(blocks, HINTERLEGT, 'BEIDE');

  assert.equal(ergebnis.configurationMatch, 1);
  assert.ok(ergebnis.overallConfidence > ergebnis.patternMatch, 'zusammen sicherer als allein');
  assert.deepEqual(ergebnis.abweichungen, []);

  for (const spalte of ergebnis.columns) {
    assert.equal(spalte.herkunft, 'CONFIRMED', 'von beiden Seiten bestätigt');
  }
});

test('ein Widerspruch wird gezeigt, nicht stillschweigend entschieden', () => {
  // FR_008, Abschnitt 6.
  const abweichend: Strukturvorgabe = {
    verbindlichkeit: 'VORGABE',
    spalten: [{ position: 3, name: 'Liefertermin', type: 'DATE' }],
  };

  const { blocks } = discover(BESTELLUNG, deutsch);
  const ergebnis = combine(blocks, abweichend, 'BEIDE');

  assert.equal(ergebnis.abweichungen.length, 1);
  assert.deepEqual(ergebnis.abweichungen[0], {
    position: 3,
    name: 'Liefertermin',
    hinterlegt: 'DATE',
    erkannt: 'INTEGER',
  });
  assert.ok(ergebnis.notes.some((note) => note.includes('bitte prüfen')));

  // Bei einer harten Vorgabe gilt sie — aber sichtbar, nicht heimlich.
  assert.equal(ergebnis.columns[2].type, 'DATE');
  assert.equal(ergebnis.columns[2].herkunft, 'CONFIGURED');
});

test('ein Hinweis darf von eindeutigen Daten überstimmt werden', () => {
  // FR_008, Abschnitt 4: Hinweis, Einschränkung und harte Vorgabe sind drei
  // verschiedene Dinge — und der Unterschied muss sich auswirken.
  const hinweis: Strukturvorgabe = {
    verbindlichkeit: 'HINWEIS',
    spalten: [{ position: 3, name: 'Liefertermin', type: 'DATE' }],
  };

  const { blocks } = discover(BESTELLUNG, deutsch);
  const ergebnis = combine(blocks, hinweis, 'BEIDE');

  assert.equal(ergebnis.columns[2].type, 'INTEGER', 'die Daten haben den Vorrang');
  assert.equal(ergebnis.abweichungen.length, 1, 'die Abweichung wird trotzdem berichtet');
  assert.ok(ergebnis.notes.some((note) => note.includes('Daten haben den Vorrang')));
});

test('eine Einschränkung siebt Blöcke aus, die ihr nicht genügen', () => {
  const inhalt = [
    'Kundennummer',
    '10001 | Müller GmbH',
    '10002 | Weber AG',
    '',
    '',
    'Positionen',
    '4711 | Schraube | 500 | 0,12',
    '4712 | Mutter | 500 | 0,08',
  ].join('\n');

  const { blocks } = discover(inhalt, deutsch);
  assert.equal(blocks.length, 2);

  const ergebnis = combine(blocks, { verbindlichkeit: 'EINSCHRAENKUNG', minColumns: 4 }, 'BEIDE');

  assert.equal(ergebnis.block?.columns.length, 4, 'der zweispaltige Block fällt heraus');
  assert.ok(ergebnis.notes.some((note) => note.includes('weniger als 4 Spalten')));
});

test('eine Regel findet ihren Block über die Kopfzeile', () => {
  const inhalt = [
    'Kunden',
    'Nr | Name | Ort',
    '10001 | Müller | Köln',
    '10002 | Weber | Bonn',
    '',
    '',
    'Artikelnummer | Bezeichnung | Menge',
    '4711 | Schraube | 500',
    '4712 | Mutter | 500',
  ].join('\n');

  const { blocks } = discover(inhalt, deutsch);
  const ergebnis = combine(blocks, { verbindlichkeit: 'HINWEIS', beginntNach: 'Artikelnummer' }, 'BEIDE');

  assert.equal(ergebnis.block?.rows[0][0], '4711', 'der zweite Block, nicht der erste');
});

test('nur nach Einstellungen: die Daten werden nicht befragt', () => {
  const { blocks } = discover(BESTELLUNG, deutsch);
  const ergebnis = combine(blocks, HINTERLEGT, 'EINSTELLUNGEN');

  assert.deepEqual(
    ergebnis.columns.map((spalte) => spalte.herkunft),
    ['CONFIGURED', 'CONFIGURED', 'CONFIGURED', 'CONFIGURED']
  );
  assert.ok(ergebnis.notes.some((note) => note.includes('nicht geprüft')));
});

test('nur automatisch: die Struktur kommt allein aus den Daten', () => {
  const { blocks } = discover(BESTELLUNG, deutsch);
  const ergebnis = combine(blocks, HINTERLEGT, 'AUTOMATIK');

  assert.deepEqual(
    ergebnis.columns.map((spalte) => spalte.herkunft),
    ['OBSERVED', 'OBSERVED', 'OBSERVED', 'OBSERVED']
  );
  assert.equal(ergebnis.abweichungen.length, 0);
});

test('aus einem bestätigten Block wird eine hinterlegte Struktur', () => {
  // FR_008, Abschnitt 7: Gelernt wird aus der Bestätigung eines Menschen,
  // nicht aus dem bloßen Erkennen.
  const { blocks } = discover(BESTELLUNG, deutsch);
  const gelernt = alsVorgabe(blocks[0]);

  assert.equal(gelernt.columns, 4);
  assert.deepEqual(gelernt.spalten?.map((spalte) => spalte.type), ['INTEGER', 'STRING', 'INTEGER', 'DECIMAL']);
  assert.deepEqual(gelernt.spalten?.map((spalte) => spalte.name), [
    'Artikelnummer',
    'Bezeichnung',
    'Menge',
    'Preis',
  ]);

  // Und beim nächsten Eingang trägt sie.
  const wieder = combine(discover(BESTELLUNG, deutsch).blocks, gelernt, 'BEIDE');
  assert.equal(wieder.configurationMatch, 1);
});

test('dieselbe Engine über schon zerlegte Zeilen — der Weg für Excel', () => {
  // Das Blatt mit Vorspann: Die Daten beginnen nicht in der ersten Zeile.
  const blatt = [
    ['Auswertung Vertrieb', '', ''],
    ['Stand: 19.08.2026', '', ''],
    ['', '', ''],
    ['Kundennr', 'Name', 'Umsatz'],
    ['1001', 'Berger GmbH', '1.234,56'],
    ['1002', 'Schmitt KG', '89,90'],
    ['1003', 'Weber AG', '450,00'],
  ];

  const { blocks } = discoverFields(blatt, deutsch);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 5, 'die Daten beginnen in Zeile 5');
  assert.equal(blocks[0].headerLine, 4);
  assert.deepEqual(
    blocks[0].columns.map((spalte) => spalte.name),
    ['Kundennr', 'Name', 'Umsatz']
  );
  assert.deepEqual(
    blocks[0].columns.map((spalte) => spalte.type),
    ['INTEGER', 'STRING', 'DECIMAL']
  );
});
