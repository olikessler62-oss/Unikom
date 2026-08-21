import assert from 'node:assert/strict';
import test from 'node:test';

import { recogniseTypedField } from '../../domain/consolidation/Recognition.js';
import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { MAPPEN } from '../../testing/consolidation/Mappen.js';
import { alsTageszahl, writeXlsx } from '../../testing/consolidation/Xlsx.js';
import { alsDatum, discoverSheet, istDatumsformat, readXlsx, spaltenIndex } from './Xlsx.js';

const deutsch = { region: DEFAULT_REGION };

test('eine Mappe kommt mit allen Blättern und in ihrer Reihenfolge zurück', () => {
  const mappe = readXlsx(
    writeXlsx([
      { name: 'Kunden', rows: [['Nr'], [1001]] },
      { name: 'Adressen', rows: [['Nr'], [1001]] },
      { name: 'Umsätze 2026', rows: [['Nr'], [1001]] },
    ])
  );

  assert.deepEqual(
    mappe.sheets.map((blatt) => blatt.name),
    ['Kunden', 'Adressen', 'Umsätze 2026']
  );
});

test('Zahlen kommen als Zahlen zurück, nicht als Text zum Erraten', () => {
  const [blatt] = readXlsx(writeXlsx([{ name: 'B', rows: [['Betrag'], [1234.56], [89.9]] }])).sheets;

  assert.deepEqual(blatt.rows[1][0], { text: '1234.56', declared: 'NUMBER' });
  assert.equal(blatt.rows[0][0].declared, 'STRING');
});

test('ein Datum bleibt ein Datum und wird keine fünfstellige Zahl', () => {
  // In der Datei steht 46085. Ohne das Zellformat zu lesen, käme genau diese
  // Zahl heraus — und niemand sähe der Spalte an, dass sie ein Datum war.
  const roh = writeXlsx([{ name: 'B', rows: [['Datum'], [{ datum: '2026-03-04' }]] }]);
  const [blatt] = readXlsx(roh).sheets;

  assert.deepEqual(blatt.rows[1][0], { text: '2026-03-04', declared: 'DATE' });
});

test('die Tageszahl trifft den Tag, über den Excel-Fehler von 1900 hinweg', () => {
  for (const tag of ['2026-03-04', '2000-02-29', '1980-01-01', '1900-03-01']) {
    assert.equal(alsDatum(alsTageszahl(tag)), tag, tag);
  }

  // Der berühmte Fehler: Excel kennt einen 29. Februar 1900. Ab Tageszahl 61
  // verschiebt er alles um einen Tag.
  assert.equal(alsDatum(61), '1900-03-01');
  assert.equal(alsDatum(59), '1900-02-28');
});

test('leere Zellen zwischen gefüllten verschieben nichts', () => {
  // Excel lässt leere Zellen einfach weg. Wer die Zellen der Reihe nach
  // einsammelt, schiebt ab da jede Spalte um eins nach links.
  const [blatt] = readXlsx(writeXlsx([{ name: 'B', rows: [['A', '', 'C'], [1, '', 3]] }])).sheets;

  assert.equal(blatt.rows[1].length, 3);
  assert.equal(blatt.rows[1][0].text, '1');
  assert.equal(blatt.rows[1][1].declared, 'EMPTY');
  assert.equal(blatt.rows[1][2].text, '3');
});

test('Sonderzeichen überstehen den Weg durch das Archiv', () => {
  const [blatt] = readXlsx(writeXlsx([{ name: 'B', rows: [['Klein & Co <GmbH> "alt"'], ['Müller Straße'] ] }])).sheets;

  assert.equal(blatt.rows[0][0].text, 'Klein & Co <GmbH> "alt"');
  assert.equal(blatt.rows[1][0].text, 'Müller Straße');
});

test('ein leeres Blatt ist ein Blatt ohne Zeilen, kein Fehler', () => {
  const mappe = readXlsx(
    writeXlsx([
      { name: 'Kunden', rows: [['Nr'], [1001]] },
      { name: 'Tabelle2', rows: [] },
      { name: 'Umsätze', rows: [['Nr'], [1001]] },
    ])
  );

  assert.equal(mappe.sheets.length, 3);
  assert.deepEqual(mappe.sheets[1].rows, []);
  assert.equal(mappe.sheets[2].rows.length, 2, 'das leere Blatt verschiebt die folgenden nicht');
});

test('was keine Mappe ist, wird als solches gemeldet', () => {
  assert.throws(() => readXlsx(Buffer.from('Kundennr;Name\n1001;Berger')), /kein ZIP-Archiv/);
});

test('eigene Zahlenformate werden auf Datum geprüft, ohne auf Text hereinzufallen', () => {
  assert.equal(istDatumsformat('dd.mm.yyyy'), true);
  assert.equal(istDatumsformat('0.00'), false);
  assert.equal(istDatumsformat('#,##0.00 €'), false);
  // Ein „m" in Anführungszeichen ist Text, kein Monat.
  assert.equal(istDatumsformat('0 "Meter"'), false);
  assert.equal(istDatumsformat('hh:mm:ss'), true);
});

test('Spaltenbezüge jenseits von Z', () => {
  assert.equal(spaltenIndex('A1'), 0);
  assert.equal(spaltenIndex('Z9'), 25);
  assert.equal(spaltenIndex('AA1'), 26);
  assert.equal(spaltenIndex('BA1'), 52);
});

test('die Typerkennung übernimmt, was die Mappe selbst weiß', () => {
  const [blatt] = readXlsx(
    writeXlsx([
      {
        name: 'Umsätze',
        rows: [
          ['Betrag', 'Datum'],
          [1234.56, { datum: '2026-03-04' }],
          [89.9, { datum: '2026-01-15' }],
          [12500, { datum: '2026-02-28' }],
        ],
      },
    ])
  ).sheets;

  const betrag = recogniseTypedField('Betrag', blatt.rows.slice(1).map((zeile) => zeile[0]), deutsch);
  const datum = recogniseTypedField('Datum', blatt.rows.slice(1).map((zeile) => zeile[1]), deutsch);

  assert.equal(betrag.type, 'DECIMAL');
  assert.equal(betrag.certain, true);
  assert.match(betrag.note ?? '', /nicht erraten/);

  assert.equal(datum.type, 'DATE');
  assert.equal(datum.certain, true);
});

test('eine Spalte mit gemischten Arten ist ein Prüffall', () => {
  const [blatt] = readXlsx(
    writeXlsx([
      {
        name: 'Gemischt',
        rows: [['Wert'], [1234.56], [{ datum: '2026-03-04' }], [89.9], [{ datum: '2026-01-15' }]],
      },
    ])
  ).sheets;

  const ergebnis = recogniseTypedField('Wert', blatt.rows.slice(1).map((zeile) => zeile[0]), deutsch);

  assert.equal(ergebnis.certain, false);
  assert.match(ergebnis.note ?? '', /mehrere Arten/);
});

test('sagt die Mappe nur „Text", wird wieder erkannt', () => {
  // Zahlen, die als Text in der Tabelle stehen — das kommt aus jedem Export,
  // der einmal durch ein Fremdsystem gelaufen ist.
  const [blatt] = readXlsx(
    writeXlsx([{ name: 'B', rows: [['Betrag'], ['1.234,56'], ['89,90'], ['450,00']] }])
  ).sheets;

  const ergebnis = recogniseTypedField('Betrag', blatt.rows.slice(1).map((zeile) => zeile[0]), deutsch);

  assert.equal(ergebnis.type, 'DECIMAL', 'als Text hinterlegte Zahlen werden nach der Region gelesen');
  assert.equal(ergebnis.certain, true);
});

for (const mappe of MAPPEN) {
  test(`${mappe.name} — gelesen`, () => {
    const gelesen = readXlsx(writeXlsx(mappe.sheets));

    assert.deepEqual(
      gelesen.sheets.map((blatt) => blatt.name),
      mappe.erwartet.blaetter ?? mappe.sheets.map((blatt) => blatt.name)
    );

    for (const [blattName, felder] of Object.entries(mappe.erwartet.typen ?? {})) {
      const blatt = gelesen.sheets.find((eintrag) => eintrag.name === blattName);

      assert.ok(blatt, `Blatt „${blattName}" fehlt`);

      const [kopf, ...koerper] = blatt.rows;

      for (const [feld, typ] of Object.entries(felder)) {
        const spalte = kopf.findIndex((zelle) => zelle.text === feld);

        assert.ok(spalte >= 0, `Feld „${feld}" steht nicht in der Kopfzeile von „${blattName}"`);

        const erkannt = recogniseTypedField(feld, koerper.map((zeile) => zeile[spalte] ?? { text: '', declared: 'EMPTY' }), {
          region: mappe.region,
        });

        assert.equal(erkannt.type, typ, `Typ von „${feld}" in „${blattName}" (${erkannt.note ?? ''})`);
      }
    }
  });
}

test('Text aus der gemeinsamen Zeichenkettentabelle wird gelesen', () => {
  // So schreibt echtes Excel fast immer: Der Text steht nicht in der Zelle,
  // sondern einmal in einer Tabelle, und die Zelle nennt nur seine Nummer.
  // Wer nur den einfachen Weg liest, bekommt bei einer echten Datei Zahlen
  // statt Namen — und merkt es an den Feldnamen zuerst.
  const roh = writeXlsx(
    [
      {
        name: 'Kunden',
        rows: [
          ['Kundennr', 'Name', 'Ort'],
          [1001, 'Berger GmbH', 'Köln'],
          [1002, 'Schmitt KG', 'Köln'],
        ],
      },
    ],
    { sharedStrings: true }
  );

  assert.ok(roh.includes(Buffer.from('xl/sharedStrings.xml')), 'die Mappe hat wirklich eine Zeichenkettentabelle');

  const [blatt] = readXlsx(roh).sheets;

  assert.deepEqual(
    blatt.rows[0].map((zelle) => zelle.text),
    ['Kundennr', 'Name', 'Ort']
  );
  assert.equal(blatt.rows[1][1].text, 'Berger GmbH');
  assert.equal(blatt.rows[2][2].text, 'Köln', 'derselbe Text zweimal verwendet');
  assert.equal(blatt.rows[1][0].declared, 'NUMBER');
});

test('beide Schreibweisen ergeben dieselben Werte', () => {
  const blaetter = [
    { name: 'B', rows: [['Name', 'Betrag'], ['Berger GmbH', 1234.56], ['Müller & Co', 89.9]] },
  ];

  const einfach = readXlsx(writeXlsx(blaetter)).sheets[0];
  const mitTabelle = readXlsx(writeXlsx(blaetter, { sharedStrings: true })).sheets[0];

  assert.deepEqual(einfach.rows, mitTabelle.rows);
});

test('ein Blatt mit Vorspann: die Daten beginnen nicht in A1', () => {
  // Fall 19 aus dem Katalog — bis eben ungelöst. Die Discovery-Engine findet
  // den Block; die Überschrift darüber ist kein Fehler, sondern Umgebung.
  const mappe = MAPPEN.find((eintrag) => eintrag.name === '19-blatt-mit-vorspann');
  assert.ok(mappe);

  const [blatt] = readXlsx(writeXlsx(mappe.sheets)).sheets;
  const { blocks, ignoredLines } = discoverSheet(blatt, { region: mappe.region });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 5, 'die Daten stehen ab Zeile 5');
  assert.equal(blocks[0].headerLine, 4);
  assert.deepEqual(
    blocks[0].columns.map((spalte) => spalte.name),
    ['Kundennr', 'Name', 'Umsatz']
  );
  assert.deepEqual(ignoredLines, [1, 2, 3], 'Überschrift und Leerzeile gehören nicht dazu');
});
