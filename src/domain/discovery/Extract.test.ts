import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { discover } from './Discovery.js';
import { extractFilename, toCsv } from './Extract.js';

const deutsch = { region: DEFAULT_REGION };

function blockAus(inhalt: string) {
  const { blocks } = discover(inhalt, deutsch);
  assert.ok(blocks[0], 'kein Block erkannt');
  return blocks[0];
}

test('aus dem Block wird eine Datei ohne Anrede und Grußformel', () => {
  const brief = [
    'Sehr geehrte Damen und Herren,',
    '',
    'Artikelnummer   Bezeichnung        Menge   Preis',
    '4711            Schraube M8        500     0,12',
    '4712            Mutter M8          500     0,08',
    '',
    'Mit freundlichen Grüßen',
  ].join('\n');

  assert.equal(
    toCsv(blockAus(brief)),
    ['Artikelnummer;Bezeichnung;Menge;Preis', '4711;Schraube M8;500;0,12', '4712;Mutter M8;500;0,08', ''].join('\r\n')
  );
});

test('ohne Kopfzeile im Block bekommen die Spalten ihre Stelle als Namen', () => {
  const ohneKopf = ['4711;Schraube;500', '4712;Mutter;300'].join('\n');

  assert.match(toCsv(blockAus(ohneKopf)), /^Spalte 1;Spalte 2;Spalte 3/);
});

test('Trennzeichen und Anführungszeichen im Wert werden eingefasst', () => {
  // Ohne diese Behandlung erzeugte ausgerechnet die Bereinigung eine Datei,
  // die beim nächsten Lesen anders zerfällt, als sie geschrieben wurde.
  const block = {
    start: 1,
    end: 1,
    strategy: 'PIPE' as const,
    columns: [
      { name: 'Name', type: 'STRING' as const, confidence: 1, herkunft: 'OBSERVED' as const },
      { name: 'Menge', type: 'INTEGER' as const, confidence: 1, herkunft: 'OBSERVED' as const },
    ],
    rows: [['Meier; Sohn', '500'], ['Die "Alte" Post', '300']],
    signature: ['STRING', 'INTEGER'] as const,
    confidence: 1,
    reasons: [],
  };

  assert.equal(
    toCsv(block),
    ['Name;Menge', '"Meier; Sohn";500', '"Die ""Alte"" Post";300', ''].join('\r\n')
  );
});

test('eine kürzere Zeile verschiebt die Datei nicht', () => {
  const block = blockAus(['a;b;c', '1;2;3', '4;5', '6;7;8'].join('\n'));
  const zeilen = toCsv(block).trimEnd().split('\r\n');

  for (const zeile of zeilen) {
    assert.equal(zeile.split(';').length, 3, zeile);
  }
});

test('der Dateiname trägt den Zeitpunkt und sortiert sich selbst', () => {
  const name = extractFilename('bestellung', new Date(2026, 7, 19, 9, 5, 3));

  assert.equal(name, 'bestellung-2026-08-19-090503.csv');
});
