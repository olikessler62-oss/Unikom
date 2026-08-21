import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { MAPPEN } from './Mappen.js';
import { crc32, spaltenName, writeXlsx } from './Xlsx.js';

/**
 * Liest einen Eintrag aus dem Archiv zurück — nur so weit, wie der Test es
 * braucht. Der richtige Leser entsteht mit der Excel-Unterstützung; bis dahin
 * prüft dies, dass geschrieben wurde, was geschrieben werden sollte.
 */
function eintrag(archiv: Buffer, name: string): string {
  let stelle = 0;

  while (stelle < archiv.length - 4 && archiv.readUInt32LE(stelle) === 0x04034b50) {
    const gepackteLaenge = archiv.readUInt32LE(stelle + 18);
    const namensLaenge = archiv.readUInt16LE(stelle + 26);
    const extraLaenge = archiv.readUInt16LE(stelle + 28);
    const eintragName = archiv.subarray(stelle + 30, stelle + 30 + namensLaenge).toString('utf-8');
    const beginn = stelle + 30 + namensLaenge + extraLaenge;

    if (eintragName === name) {
      return inflateRawSync(archiv.subarray(beginn, beginn + gepackteLaenge)).toString('utf-8');
    }

    stelle = beginn + gepackteLaenge;
  }

  throw new Error(`Im Archiv gibt es „${name}" nicht`);
}

test('die Mappe ist ein gültiges ZIP-Archiv mit den erwarteten Teilen', () => {
  const mappe = writeXlsx([{ name: 'Kunden', rows: [['a']] }]);

  assert.equal(mappe.readUInt32LE(0), 0x04034b50, 'Signatur des ersten Eintrags');
  assert.ok(mappe.includes(Buffer.from('[Content_Types].xml')));
  assert.ok(mappe.includes(Buffer.from('xl/workbook.xml')));
  assert.ok(mappe.includes(Buffer.from('xl/_rels/workbook.xml.rels')));
});

test('jedes Blatt bekommt einen eigenen Teil und einen Eintrag in der Mappe', () => {
  const mappe = writeXlsx([
    { name: 'Kunden', rows: [['a']] },
    { name: 'Adressen', rows: [['b']] },
    { name: 'Umsätze 2026', rows: [['c']] },
  ]);

  const workbook = eintrag(mappe, 'xl/workbook.xml');

  assert.match(workbook, /name="Kunden"/);
  assert.match(workbook, /name="Adressen"/);
  assert.match(workbook, /name="Umsätze 2026"/, 'Umlaute überstehen den Weg durch das Archiv');

  for (const nummer of [1, 2, 3]) {
    assert.ok(eintrag(mappe, `xl/worksheets/sheet${nummer}.xml`).includes('<sheetData>'));
  }
});

test('Zahlen bleiben Zahlen und Text bleibt Text', () => {
  const blatt = eintrag(writeXlsx([{ name: 'B', rows: [['Betrag', 1234.56]] }]), 'xl/worksheets/sheet1.xml');

  // Eine Zahl als Text zu schreiben wäre der stille Fehler: Excel zeigt sie
  // gleich an, und beim Rechnen fehlt sie.
  assert.match(blatt, /<c r="B1"><v>1234\.56<\/v><\/c>/);
  assert.match(blatt, /<c r="A1" t="inlineStr"><is><t[^>]*>Betrag<\/t><\/is><\/c>/);
});

test('Sonderzeichen im Text zerlegen die Datei nicht', () => {
  const blatt = eintrag(writeXlsx([{ name: 'B', rows: [['Klein & Co <GmbH>']] }]), 'xl/worksheets/sheet1.xml');

  assert.match(blatt, /Klein &amp; Co &lt;GmbH&gt;/);
});

test('dieselbe Mappe ergibt zweimal dieselben Bytes', () => {
  // Ohne festen Zeitstempel sähe jede erzeugte Testdatei nach einer Änderung
  // aus, und niemand könnte zwei Läufe vergleichen.
  const einmal = writeXlsx([{ name: 'Kunden', rows: [['a', 1]] }]);
  const nochmal = writeXlsx([{ name: 'Kunden', rows: [['a', 1]] }]);

  assert.deepEqual(einmal, nochmal);
});

test('die Prüfsumme ist die des ZIP-Formats', () => {
  // Bekannter Wert für "123456789" — stimmt sie nicht, lehnt Excel die Datei ab.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('Spaltennamen laufen über Z hinaus', () => {
  assert.equal(spaltenName(0), 'A');
  assert.equal(spaltenName(25), 'Z');
  assert.equal(spaltenName(26), 'AA');
  assert.equal(spaltenName(51), 'AZ');
  assert.equal(spaltenName(52), 'BA');
});

test('eine Mappe ohne Blatt ist keine Mappe', () => {
  assert.throws(() => writeXlsx([]), /ohne Tabellenblatt/);
});

for (const mappe of MAPPEN) {
  test(`${mappe.name} — ${mappe.zweck}`, () => {
    const archiv = writeXlsx(mappe.sheets);
    const workbook = eintrag(archiv, 'xl/workbook.xml');

    for (const blatt of mappe.erwartet.blaetter ?? mappe.sheets.map((sheet) => sheet.name)) {
      assert.ok(workbook.includes(`name="${blatt}"`), `Blatt „${blatt}" fehlt in der Mappe`);
    }
  });
}
