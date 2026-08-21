import assert from 'node:assert/strict';
import test from 'node:test';

import { texte, type Gelesen } from '../../infrastructure/formats/Bestand.js';
import { readFixedWidth } from '../../infrastructure/formats/FixedWidth.js';
import { readJson } from '../../infrastructure/formats/Json.js';
import { readXml } from '../../infrastructure/formats/Xml.js';
import { alsBytes } from './Faelle.js';
import { STRUKTURFAELLE, type Strukturfall } from './Strukturen.js';

/**
 * Der Katalog wird gelesen, nicht beschrieben.
 *
 * Jeder Fall trägt seine erwartete Antwort bei sich; hier läuft er durch den
 * Leser, der für ihn zuständig ist. Damit ist der Katalog zugleich die
 * Beschreibung dessen, was UniCom können muss — und `npm run testdaten`
 * schreibt genau dieselben Dateien auf die Platte.
 */
function lies(fall: Strukturfall): Gelesen {
  const bytes = alsBytes(fall.inhalt, fall.encoding);

  switch (fall.format) {
    case 'FIXED':
      return readFixedWidth(bytes, { felder: fall.felder ?? [] });
    case 'JSON':
      return readJson(bytes);
    default:
      return readXml(bytes);
  }
}

for (const fall of STRUKTURFAELLE) {
  test(`${fall.name}: ${fall.zweck}`, () => {
    if (fall.erwartet.abgewiesen) {
      assert.throws(() => lies(fall), new RegExp(fall.erwartet.abgewiesen));
      return;
    }

    const gelesen = lies(fall);

    if (fall.erwartet.fields) {
      assert.deepEqual(gelesen.fields, fall.erwartet.fields, 'Feldnamen');
    }

    if (fall.erwartet.zeilen !== undefined) {
      assert.equal(gelesen.rows.length, fall.erwartet.zeilen, 'Zeilenzahl');
    }

    if (fall.erwartet.ersteZeile) {
      assert.deepEqual(texte(gelesen.rows[0]), fall.erwartet.ersteZeile, 'erste Datenzeile');
    }

    if (fall.erwartet.meldung) {
      assert.match(gelesen.notes.join(' | '), new RegExp(fall.erwartet.meldung), 'erwartete Meldung');
    }
  });
}

test('jeder Fall, der nicht allein lösbar ist, sagt auch etwas', () => {
  // Ein Prüffall, der stillschweigend ein Ergebnis liefert, ist kein Prüffall,
  // sondern ein Fehler mit gutem Ruf.
  for (const fall of STRUKTURFAELLE.filter((eintrag) => !eintrag.loesbar)) {
    assert.ok(
      fall.erwartet.meldung || fall.erwartet.abgewiesen,
      `„${fall.name}" ist als nicht allein lösbar geführt, erwartet aber weder eine Meldung noch eine Abweisung`
    );
  }
});

test('die Dateinamen sind eindeutig', () => {
  const namen = STRUKTURFAELLE.map((fall) => fall.name);

  assert.equal(new Set(namen).size, namen.length);
});
