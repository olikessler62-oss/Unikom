import assert from 'node:assert/strict';
import test from 'node:test';

import { texte, type Gelesen } from './Bestand.js';
import { readJson, writeJson } from './Json.js';
import { readXml, writeXml } from './Xml.js';
import { STRUKTURFAELLE } from '../../testing/consolidation/Strukturen.js';
import { alsBytes } from '../../testing/consolidation/Faelle.js';

/**
 * Der Weg zurück (SPEC-03, Abschnitt 7 und 8).
 *
 * Die stärkste Prüfung, die es hier gibt, ist die Rundreise: lesen, schreiben,
 * wieder lesen. Kommt dabei etwas anderes heraus, als hineinging, ist einer der
 * beiden Wege falsch — und zwar unabhängig davon, ob die geschriebene Datei
 * hübsch aussieht.
 */
function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf-8'));
}

function inhaltVon(gelesen: Gelesen): { fields: string[]; rows: string[][] } {
  return { fields: gelesen.fields, rows: gelesen.rows.map(texte) };
}

const VERSCHACHTELT = JSON.stringify({
  bestellungen: [
    {
      nr: 1001,
      kunde: { id: 4711, name: 'Meier & Söhne', adresse: { ort: 'Köln' } },
      positionen: [{ artikel: 'Schraube', menge: 500 }, { artikel: 'Mutter', menge: 250 }],
      bezahlt: true,
      notiz: null,
    },
    {
      nr: 1002,
      kunde: { id: 4712, name: 'Berger', adresse: { ort: 'Bonn' } },
      positionen: [{ artikel: 'Scheibe', menge: 100 }, { artikel: 'Bolzen', menge: 50 }],
      bezahlt: false,
      notiz: 'eilig',
    },
  ],
});

test('JSON: gelesen, geschrieben, wieder gelesen — derselbe Inhalt', () => {
  const gelesen = readJson(bytes(VERSCHACHTELT));
  const geschrieben = writeJson(gelesen, { wurzel: 'bestellungen' });
  const erneut = readJson(bytes(geschrieben.text));

  assert.deepEqual(inhaltVon(erneut), inhaltVon(gelesen));
});

test('JSON: die Verschachtelung entsteht wirklich wieder', () => {
  // Sonst wäre die Rundreise auch mit einer flachen Datei bestanden.
  const geschrieben = writeJson(readJson(bytes(VERSCHACHTELT)), { wurzel: 'bestellungen' });
  const gebilde = JSON.parse(geschrieben.text) as any;

  assert.equal(gebilde.bestellungen[0].kunde.adresse.ort, 'Köln');
  assert.equal(gebilde.bestellungen[0].positionen[1].artikel, 'Mutter');
});

test('JSON: die Typen überleben die Rundreise', () => {
  // Aus 42 darf nicht „42" werden. Genau dafür trägt die Zelle ihren erklärten
  // Typ mit.
  const geschrieben = writeJson(readJson(bytes(VERSCHACHTELT)));
  const gebilde = JSON.parse(geschrieben.text) as any;

  assert.equal(typeof gebilde[0].nr, 'number');
  assert.equal(typeof gebilde[0].bezahlt, 'boolean');
  assert.equal(gebilde[0].notiz, null);
  assert.equal(typeof gebilde[0].kunde.name, 'string');
});

test('JSON: Array oder benannte Liste ist ein Unterschied, und er lässt sich wählen', () => {
  // SPEC-03, Abschnitt 7: Für den Empfänger ist beides nicht dasselbe.
  const gelesen = readJson(bytes(VERSCHACHTELT));

  assert.ok(JSON.parse(writeJson(gelesen).text) instanceof Array);
  assert.ok(!(JSON.parse(writeJson(gelesen, { wurzel: 'customers' }).text) instanceof Array));
  assert.ok(JSON.parse(writeJson(gelesen, { wurzel: 'customers' }).text).customers instanceof Array);
});

test('JSON: aus einer flachen Tabelle wird eine definierte Struktur', () => {
  // Das ist die Umkehrung, um die es in der Spec geht: Eine CSV soll ein
  // verschachteltes JSON ergeben können, ohne dass ihre Spalten schon so heißen.
  const flach: Gelesen = {
    fields: ['Nr', 'Ort', 'PLZ'],
    rows: [
      [
        { text: '1', declared: 'STRING' },
        { text: 'Köln', declared: 'STRING' },
        { text: '50667', declared: 'STRING' },
      ],
    ],
    feststellungen: {},
    ragged: [],
    notes: [],
  };

  const geschrieben = writeJson(flach, {
    wurzel: 'kunden',
    zuordnung: { Nr: 'nummer', Ort: 'adresse.ort', PLZ: 'adresse.plz' },
  });

  assert.deepEqual(JSON.parse(geschrieben.text), {
    kunden: [{ nummer: '1', adresse: { ort: 'Köln', plz: '50667' } }],
  });
});

test('JSON: ein Pfad, der einen anderen verdrängen würde, wird gemeldet', () => {
  // Ein Feld, das ein anderes still überschreibt, ist ein Datenverlust an der
  // Stelle, an der niemand mehr hinsieht.
  const flach: Gelesen = {
    fields: ['a', 'b'],
    rows: [
      [
        { text: 'wert', declared: 'STRING' },
        { text: 'tiefer', declared: 'STRING' },
      ],
    ],
    feststellungen: {},
    ragged: [],
    notes: [],
  };

  const geschrieben = writeJson(flach, { zuordnung: { a: 'x', b: 'x.y' } });

  assert.match(geschrieben.notes.join(' '), /verlangt unter „x" ein Objekt/);
});

const XML_QUELLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<bestellungen>',
  '  <bestellung nr="1001">',
  '    <kunde id="4711">Meier &amp; Söhne</kunde>',
  '    <adresse><ort>Köln</ort><plz>50667</plz></adresse>',
  '    <pos>Winkel &lt; 90 Grad</pos><pos>Mutter</pos>',
  '  </bestellung>',
  '  <bestellung nr="1002">',
  '    <kunde id="4712">Berger</kunde>',
  '    <adresse><ort>Bonn</ort><plz>53111</plz></adresse>',
  '    <pos>Scheibe</pos><pos>Bolzen</pos>',
  '  </bestellung>',
  '</bestellungen>',
].join('\n');

test('XML: gelesen, geschrieben, wieder gelesen — derselbe Inhalt', () => {
  const gelesen = readXml(bytes(XML_QUELLE));
  const geschrieben = writeXml(gelesen, { wurzel: 'bestellungen', datensatz: 'bestellung' });
  const erneut = readXml(bytes(geschrieben.text));

  assert.deepEqual(inhaltVon(erneut), inhaltVon(gelesen));
});

test('XML: Attribute bleiben Attribute', () => {
  // Aus „kunde.@id" darf kein Element `<id>` werden — dann läse der Empfänger
  // etwas anderes, als er geschickt bekommen hat.
  const geschrieben = writeXml(readXml(bytes(XML_QUELLE)), {
    wurzel: 'bestellungen',
    datensatz: 'bestellung',
  });

  assert.match(geschrieben.text, /<bestellung nr="1001">/);
  assert.match(geschrieben.text, /<kunde id="4711">/);
});

test('XML: Sonderzeichen werden geschützt', () => {
  // „Meier & Söhne" roh geschrieben ergibt eine Datei, die kein Parser der Welt
  // wieder aufmacht.
  const geschrieben = writeXml(readXml(bytes(XML_QUELLE)), { datensatz: 'bestellung' });

  assert.match(geschrieben.text, /Meier &amp; Söhne/);
  assert.doesNotMatch(geschrieben.text, /Meier & Söhne/);
});

test('XML: ein Feldname, der kein Elementname ist, wird umbenannt — und das steht dabei', () => {
  const flach: Gelesen = {
    fields: ['Bestell Nr.', '2teSpalte'],
    rows: [
      [
        { text: '1', declared: 'STRING' },
        { text: 'x', declared: 'STRING' },
      ],
    ],
    feststellungen: {},
    ragged: [],
    notes: [],
  };

  const geschrieben = writeXml(flach);

  assert.match(geschrieben.text, /<Bestell_Nr>1<\/Bestell_Nr>/);
  assert.match(geschrieben.text, /<_2teSpalte>/);
  assert.match(geschrieben.notes.join(' '), /„Bestell Nr" taugt nicht als XML-Name/);
  assert.match(geschrieben.notes.join(' '), /„2teSpalte" taugt nicht als XML-Name/);
});

test('XML: aus einer flachen Tabelle wird eine definierte Struktur mit Attributen', () => {
  const flach: Gelesen = {
    fields: ['Nr', 'Ort'],
    rows: [
      [
        { text: '1', declared: 'STRING' },
        { text: 'Köln', declared: 'STRING' },
      ],
    ],
    feststellungen: {},
    ragged: [],
    notes: [],
  };

  const geschrieben = writeXml(flach, {
    wurzel: 'kunden',
    datensatz: 'kunde',
    zuordnung: { Nr: '@nr', Ort: 'adresse.ort' },
  });

  assert.match(geschrieben.text, /<kunde nr="1">/);
  assert.match(geschrieben.text, /<ort>Köln<\/ort>/);
});

test('XML: ein leerer Wert wird ein leeres Element, kein leeres Attribut', () => {
  // `nr=""` behauptet eine Angabe, die es nicht gibt.
  const flach: Gelesen = {
    fields: ['Nr', 'Ort'],
    rows: [
      [
        { text: '', declared: 'EMPTY' },
        { text: '', declared: 'EMPTY' },
      ],
    ],
    feststellungen: {},
    ragged: [],
    notes: [],
  };

  const geschrieben = writeXml(flach, { zuordnung: { Nr: '@nr', Ort: 'ort' } });

  assert.doesNotMatch(geschrieben.text, /nr=""/);
  assert.match(geschrieben.text, /<ort\/>/);
});

/* ---------- Der Katalog macht die Rundreise mit ---------- */

for (const fall of STRUKTURFAELLE.filter((eintrag) => eintrag.format === 'JSON' && !eintrag.erwartet.abgewiesen)) {
  test(`${fall.name}: überlebt die Rundreise durch JSON`, () => {
    const gelesen = readJson(alsBytes(fall.inhalt, fall.encoding));
    const erneut = readJson(bytes(writeJson(gelesen).text));

    assert.deepEqual(inhaltVon(erneut), inhaltVon(gelesen));
  });
}

for (const fall of STRUKTURFAELLE.filter((eintrag) => eintrag.format === 'XML' && !eintrag.erwartet.abgewiesen)) {
  test(`${fall.name}: überlebt die Rundreise durch XML`, () => {
    const gelesen = readXml(alsBytes(fall.inhalt, fall.encoding));

    /*
     * Beim Zurücklesen wird der Name des Datensatzes genannt. Er steht in der
     * geschriebenen Datei, aber der Leser kann ihn bei **einem** Datensatz
     * nicht erraten — siehe die Prüfung darunter.
     */
    const erneut = readXml(bytes(writeXml(gelesen, { datensatz: 'zeile' }).text), { datensatz: 'zeile' });

    assert.deepEqual(inhaltVon(erneut), inhaltVon(gelesen));
  });
}

test('bei genau einem Datensatz muss der Name genannt werden — und der Leser sagt das', () => {
  /*
   * Die Grenze der Erkennung, offen ausgewiesen: Ein wiederholtes Element gibt
   * sich zu erkennen, ein einzelnes nicht. `<daten><zeile>…</zeile></daten>`
   * kann „ein Datensatz namens zeile" heißen oder „ein Datensatz namens daten
   * mit einem Feld zeile" — beides ist gültiges XML, und nur der Absender weiß
   * es. Deshalb steht der Name im Profil und nicht im Leser.
   */
  const gelesen = readXml(bytes('<bestellung nr="1"><ort>Köln</ort></bestellung>'));
  const geschrieben = writeXml(gelesen, { datensatz: 'zeile' });

  const geraten = readXml(bytes(geschrieben.text));
  const genannt = readXml(bytes(geschrieben.text), { datensatz: 'zeile' });

  assert.deepEqual(genannt.fields, gelesen.fields);
  assert.notDeepEqual(geraten.fields, gelesen.fields);
  assert.match(geraten.notes.join(' '), /kein wiederholtes Element/);
});

test('von JSON nach XML und zurück bleibt der Inhalt derselbe', () => {
  // Der eigentliche Zweck des gemeinsamen Formats: Ein Kunde liefert JSON, ein
  // anderer will XML, und dazwischen darf nichts verlorengehen.
  const gelesen = readJson(bytes(VERSCHACHTELT));
  const alsXml = writeXml(gelesen, { wurzel: 'bestellungen', datensatz: 'bestellung' });
  const zurueck = readXml(bytes(alsXml.text));

  assert.deepEqual(zurueck.fields, gelesen.fields);
  assert.deepEqual(
    zurueck.rows.map(texte),
    gelesen.rows.map(texte),
    'die Werte sind dieselben - nur ihre erklärten Typen kennt XML nicht'
  );
});
