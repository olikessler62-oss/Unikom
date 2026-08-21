import assert from 'node:assert/strict';
import test from 'node:test';

import { texte } from './Bestand.js';
import { parseXml, readXml } from './Xml.js';

function bytes(text: string, kodierung: BufferEncoding = 'utf-8'): Uint8Array {
  return new Uint8Array(Buffer.from(text, kodierung));
}

const BESTELLUNG = `<?xml version="1.0" encoding="UTF-8"?>
<bestellungen>
  <bestellung nr="1">
    <kunde id="4711">Mustermann</kunde>
    <ort>Köln</ort>
    <betrag>12,50</betrag>
  </bestellung>
  <bestellung nr="2">
    <kunde id="4712">Berger</kunde>
    <ort>Bonn</ort>
    <betrag>8,00</betrag>
  </bestellung>
</bestellungen>`;

test('das wiederholte Element wird als Datensatz gelesen', () => {
  const gelesen = readXml(bytes(BESTELLUNG));

  assert.equal(gelesen.rows.length, 2);
  assert.match(gelesen.notes.join(' '), /Als Datensatz gelesen: „bestellung" \(2 Stück\)/);
});

test('Attribute sind eigene Felder mit @', () => {
  // SPEC-03, Abschnitt 8: „Kunde.@id" muss adressierbar sein.
  const gelesen = readXml(bytes(BESTELLUNG));

  assert.deepEqual(gelesen.fields, ['@nr', 'kunde.@id', 'kunde', 'ort', 'betrag']);
  assert.deepEqual(texte(gelesen.rows[0]), ['1', '4711', 'Mustermann', 'Köln', '12,50']);
});

test('verschachtelte Elemente werden mit Punkten flachgelegt', () => {
  const gelesen = readXml(
    bytes('<kunden><kunde><adresse><ort>Köln</ort><plz>50667</plz></adresse></kunde><kunde/></kunden>')
  );

  assert.deepEqual(gelesen.fields, ['adresse.ort', 'adresse.plz', 'kunde']);
});

test('wiederholte Kinder bekommen einen Index', () => {
  const gelesen = readXml(
    bytes(
      '<b><auftrag><pos>A</pos><pos>B</pos></auftrag><auftrag><pos>C</pos><pos>D</pos></auftrag></b>'
    )
  );

  assert.deepEqual(gelesen.fields, ['pos[0]', 'pos[1]']);
  assert.deepEqual(texte(gelesen.rows[0]), ['A', 'B']);
});

test('Zeichenverweise werden aufgelöst', () => {
  const gelesen = readXml(
    bytes('<l><e>Meier &amp; S&#246;hne</e><e>&lt;spitz&gt;</e></l>')
  );

  assert.deepEqual(texte(gelesen.rows[0]), ['Meier & Söhne']);
  assert.deepEqual(texte(gelesen.rows[1]), ['<spitz>']);
});

test('CDATA steht wörtlich darin', () => {
  const gelesen = readXml(bytes('<l><e><![CDATA[a < b & c]]></e><e>x</e></l>'));

  assert.deepEqual(texte(gelesen.rows[0]), ['a < b & c']);
});

test('Kommentare und Verarbeitungsanweisungen stören nicht', () => {
  const gelesen = readXml(
    bytes('<?xml version="1.0"?><!-- ein Wort --><l><e>a</e><!-- noch eins --><?pi weg?><e>b</e></l>')
  );

  assert.equal(gelesen.rows.length, 2);
});

/* ---------- Sicherheit ---------- */

test('eine Datei mit eigenen Entitäten wird abgewiesen', () => {
  // XXE: Über Entitäten wird fremder Inhalt eingeschleust. Dieser Leser kennt
  // sie nicht — und liest die Datei deshalb gar nicht erst ohne sie.
  const angriff = `<?xml version="1.0"?>
<!DOCTYPE l [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<l><e>&xxe;</e></l>`;

  assert.throws(() => readXml(bytes(angriff)), /deklariert eigene Entitäten/);
});

test('auch die Milliarden-Lacher-Datei kommt nicht durch', () => {
  const angriff = `<?xml version="1.0"?>
<!DOCTYPE l [
  <!ENTITY a "aaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
]>
<l><e>&b;</e></l>`;

  assert.throws(() => readXml(bytes(angriff)), /deklariert eigene Entitäten/);
});

test('ein Verweis auf eine unbekannte Entität rutscht nicht als Text durch', () => {
  assert.throws(() => readXml(bytes('<l><e>&fremd;</e></l>')), /Entität/);
});

test('eine harmlose Dokumenttypangabe stört nicht', () => {
  const gelesen = readXml(bytes('<?xml version="1.0"?><!DOCTYPE l SYSTEM "l.dtd"><l><e>a</e><e>b</e></l>'));

  assert.equal(gelesen.rows.length, 2);
});

/* ---------- Namensräume und Kodierung ---------- */

test('Namensraumpräfixe bleiben stehen, solange niemand etwas anderes sagt', () => {
  // „kunde:Name" und „lieferant:Name" sind zwei Felder. Sie stillschweigend zu
  // einem zu machen wäre ein Datenverlust.
  const inhalt =
    '<l xmlns:k="urn:k"><e><k:name>Müller</k:name></e><e><k:name>Berger</k:name></e></l>';

  assert.deepEqual(readXml(bytes(inhalt)).fields, ['k:name']);
  assert.deepEqual(readXml(bytes(inhalt), { praefixe: 'ENTFERNEN' }).fields, ['name']);
});

test('auf die Präfixe wird hingewiesen', () => {
  const gelesen = readXml(bytes('<l><e><k:name>A</k:name></e><e><k:name>B</k:name></e></l>'));

  assert.match(gelesen.notes.join(' '), /Namensraumpräfixe/);
});

test('die Kodierung aus der Deklaration gilt', () => {
  const inhalt = '<?xml version="1.0" encoding="windows-1252"?><l><e>Müller</e><e>Jürgen</e></l>';
  const gelesen = readXml(bytes(inhalt, 'latin1'));

  assert.equal(gelesen.feststellungen.kodierung, 'windows-1252');
  assert.deepEqual(texte(gelesen.rows[0]), ['Müller']);
});

/* ---------- Grenzfälle ---------- */

test('eine Datei mit genau einem Datensatz ist keine leere', () => {
  const gelesen = readXml(bytes('<kunde id="1"><ort>Köln</ort></kunde>'));

  assert.equal(gelesen.rows.length, 1);
  assert.match(gelesen.notes.join(' '), /als ein einzelner Datensatz/);
});

test('ein ausdrücklich benanntes Element gilt vor der Suche', () => {
  const inhalt = '<l><a><x>1</x></a><b><y>2</y><y>3</y><y>4</y></b></l>';
  const gelesen = readXml(bytes(inhalt), { datensatz: 'a' });

  assert.equal(gelesen.rows.length, 1);
  assert.deepEqual(gelesen.fields, ['x']);
});

test('ein Element, das es nicht gibt, wird gemeldet', () => {
  assert.throws(() => readXml(bytes('<l><e>a</e></l>'), { datensatz: 'kunde' }), /kommt in dieser Datei nicht vor/);
});

test('ein nicht geschlossenes Element wird gemeldet, statt halb gelesen zu werden', () => {
  assert.throws(() => parseXml('<l><e>a</l>'), /„e" wird mit „l" geschlossen/);
});

test('selbstschließende Elemente sind leer und nicht fehlend', () => {
  const gelesen = readXml(bytes('<l><e><a>1</a><b/></e><e><a>2</a><b>x</b></e></l>'));

  assert.deepEqual(gelesen.fields, ['a', 'b']);
  assert.equal(gelesen.rows[0][1].declared, 'EMPTY');
  assert.equal(gelesen.rows[1][1].text, 'x');
});
