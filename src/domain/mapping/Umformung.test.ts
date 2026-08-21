import assert from 'node:assert/strict';
import test from 'node:test';

import { forme, fuehreZusammen, NAMENSPARTIKEL, teileAuf, type Schritt } from './Umformung.js';

function wert(text: string, ...schritte: Schritt[]): string {
  return forme(text, schritte).wert;
}

/* ---------- Die einfachen Schritte ---------- */

test('Leerzeichen am Rand fallen weg', () => {
  // Der häufigste Fall überhaupt — und der, der still Gruppierungen sprengt:
  // „ Meier" und „Meier" sind für jeden Schlüssel zwei verschiedene Kunden.
  assert.equal(wert('  Meier  ', { art: 'TRIMMEN' }), 'Meier');
});

test('Groß und klein', () => {
  assert.equal(wert('Meier', { art: 'GROSS' }), 'MEIER');
  assert.equal(wert('MEIER', { art: 'KLEIN' }), 'meier');
});

test('Wortanfänge groß, auch hinter Bindestrich und Apostroph', () => {
  assert.equal(wert('meier-schulz', { art: 'ANFANGSGROSS' }), 'Meier-Schulz');
  assert.equal(wert('MÜLLER', { art: 'ANFANGSGROSS' }), 'Müller');
  assert.equal(wert("o'brien", { art: 'ANFANGSGROSS' }), "O'Brien");
});

test('Ersetzen sucht wörtlich und nicht als Muster', () => {
  /*
   * Ein regulärer Ausdruck wäre mächtiger und in einem Formularfeld die falsche
   * Mächtigkeit: Wer „." eingibt, meint einen Punkt — und niemand rechnet damit,
   * dass sein Ersetzen jedes Zeichen trifft.
   */
  assert.equal(wert('A.B.C', { art: 'ERSETZEN', suchen: '.', ersetzen: '-' }), 'A-B-C');
});

test('ein leeres Suchmuster tut nichts', () => {
  // Es träfe zwischen jedes Zeichen und fügte den Ersatz überall ein.
  assert.equal(wert('Meier', { art: 'ERSETZEN', suchen: '', ersetzen: 'X' }), 'Meier');
});

test('Voranstellen und Anhängen lassen ein leeres Feld leer', () => {
  /*
   * Aus einem Feld, das nichts enthält, würde sonst eines, das „Herr " enthält
   * — und die Vollständigkeitsprüfung zählte es als gefüllt.
   */
  assert.equal(wert('', { art: 'VORANSTELLEN', text: 'Herr ' }), '');
  assert.equal(wert('', { art: 'ANHAENGEN', text: ' GmbH' }), '');
  assert.equal(wert('Meier', { art: 'VORANSTELLEN', text: 'Herr ' }), 'Herr Meier');
});

test('ein Ausschnitt zählt ab 1, wie ein Mensch', () => {
  assert.equal(wert('4711-Bonn', { art: 'AUSSCHNITT', von: 1, bis: 4 }), '4711');
  assert.equal(wert('4711-Bonn', { art: 'AUSSCHNITT', von: 6 }), 'Bonn');
});

test('ein Ausschnitt jenseits des Wertes lässt ihn stehen und sagt es', () => {
  // Ihn zu leeren wäre der stille Verlust, den Abschnitt 9 ausschließt.
  const ergebnis = forme('kurz', [{ art: 'AUSSCHNITT', von: 20 }]);

  assert.equal(ergebnis.wert, 'kurz');
  assert.match(ergebnis.hinweis ?? '', /nur 4 Zeichen/);
});

test('mehrere Schritte laufen der Reihe nach', () => {
  assert.equal(wert('  meier  ', { art: 'TRIMMEN' }, { art: 'ANFANGSGROSS' }), 'Meier');
});

test('jeder wirksame Schritt wird festgehalten', () => {
  // „Die Entstehung automatisch erzeugter Zielwerte muss nachvollziehbar
  // dokumentiert werden."
  const ergebnis = forme('  meier  ', [{ art: 'TRIMMEN' }, { art: 'GROSS' }]);

  assert.equal(ergebnis.schritte.length, 2);
  assert.match(ergebnis.schritte[0], /Leerzeichen am Rand entfernt/);
  assert.match(ergebnis.schritte[1], /„meier" → „MEIER"/);
});

test('ein Schritt ohne Wirkung steht nicht im Protokoll', () => {
  // Sonst besteht die Nachvollziehbarkeit aus Zeilen, in denen nichts geschah.
  assert.deepEqual(forme('Meier', [{ art: 'TRIMMEN' }]).schritte, []);
});

/* ---------- Datum und Zahl ---------- */

test('ein Datum wird umgeschrieben, ohne die Region zu raten', () => {
  /*
   * `04/03/2026` ist in Deutschland der 4. März und in den USA der 3. April.
   * Beide Lesarten ergeben ein gültiges Datum — deshalb steht die Leseart an
   * der Regel und wird nicht erschlossen.
   */
  const deutsch: Schritt = { art: 'DATUM', gelesenAls: 'DAY_FIRST', schreibeAls: 'ISO' };
  const amerikanisch: Schritt = { art: 'DATUM', gelesenAls: 'MONTH_FIRST', schreibeAls: 'ISO' };

  assert.equal(wert('04/03/2026', deutsch), '2026-03-04');
  assert.equal(wert('04/03/2026', amerikanisch), '2026-04-03');
});

test('ein Datum lässt sich auch in die deutsche Schreibweise bringen', () => {
  assert.equal(wert('2026-03-04', { art: 'DATUM', gelesenAls: 'DAY_FIRST', schreibeAls: 'TAG_ZUERST' }), '04.03.2026');
});

test('was sich nicht als Datum lesen lässt, bleibt stehen', () => {
  /*
   * Es in ein leeres Feld zu verwandeln wäre der stille Verlust — und
   * ausgerechnet die Zeile, die nicht ins Schema passt, ist die interessante.
   */
  const ergebnis = forme('demnächst', [{ art: 'DATUM', gelesenAls: 'DAY_FIRST', schreibeAls: 'ISO' }]);

  assert.equal(ergebnis.wert, 'demnächst');
  assert.match(ergebnis.hinweis ?? '', /nicht als Datum lesen/);
});

test('eine Zahl wechselt die Schreibweise', () => {
  assert.equal(wert('1.234,56', { art: 'ZAHL', gelesenAls: 'de-DE', schreibeAls: 'en-US' }), '1234.56');
  assert.equal(wert('1234.56', { art: 'ZAHL', gelesenAls: 'en-US', schreibeAls: 'de-DE' }), '1234,56');
});

test('Nachkommastellen lassen sich festlegen', () => {
  assert.equal(
    wert('1234,5', { art: 'ZAHL', gelesenAls: 'de-DE', schreibeAls: 'de-DE', nachkommastellen: 2 }),
    '1234,50'
  );
});

test('was keine Zahl ist, bleibt stehen', () => {
  const ergebnis = forme('etwa zwölf', [{ art: 'ZAHL', gelesenAls: 'de-DE', schreibeAls: 'en-US' }]);

  assert.equal(ergebnis.wert, 'etwa zwölf');
  assert.match(ergebnis.hinweis ?? '', /nicht als Zahl lesen/);
});

test('ein leerer Wert bleibt leer und ist kein Fehler', () => {
  assert.deepEqual(forme('', [{ art: 'DATUM', gelesenAls: 'DAY_FIRST', schreibeAls: 'ISO' }]).hinweis, undefined);
  assert.deepEqual(forme('', [{ art: 'ZAHL', gelesenAls: 'de-DE', schreibeAls: 'en-US' }]).hinweis, undefined);
});

/* ---------- Zusammenführen ---------- */

const ZEILE = new Map([
  ['vorname', 'Anna'],
  ['nachname', 'Meier'],
  ['titel', ''],
]);

test('zwei Felder werden eines', () => {
  const ergebnis = fuehreZusammen(ZEILE, { ziel: 'name', quellen: ['vorname', 'nachname'], trenner: ' ' });

  assert.equal(ergebnis.wert, 'Anna Meier');
  assert.deepEqual(ergebnis.verwendet, ['vorname', 'nachname']);
});

test('ein leeres Feld zieht keinen Trenner nach sich', () => {
  /*
   * Sonst entstünde „ Anna Meier" mit führendem Leerzeichen — und das ist für
   * jede spätere Gruppierung ein anderer Wert.
   */
  const ergebnis = fuehreZusammen(ZEILE, { ziel: 'name', quellen: ['titel', 'vorname', 'nachname'], trenner: ' ' });

  assert.equal(ergebnis.wert, 'Anna Meier');
  assert.deepEqual(ergebnis.leer, ['titel'], 'aber es steht dabei, dass es leer war');
});

test('ein fehlendes Feld ist dasselbe wie ein leeres', () => {
  const ergebnis = fuehreZusammen(ZEILE, { ziel: 'name', quellen: ['gibtesnicht', 'nachname'], trenner: ' ' });

  assert.equal(ergebnis.wert, 'Meier');
  assert.deepEqual(ergebnis.leer, ['gibtesnicht']);
});

test('nach dem Verbinden dürfen weitere Schritte folgen', () => {
  const ergebnis = fuehreZusammen(ZEILE, {
    ziel: 'name',
    quellen: ['nachname', 'vorname'],
    trenner: ', ',
    schritte: [{ art: 'GROSS' }],
  });

  assert.equal(ergebnis.wert, 'MEIER, ANNA');
});

test('das Zusammenführen steht im Protokoll', () => {
  const ergebnis = fuehreZusammen(ZEILE, { ziel: 'name', quellen: ['vorname', 'nachname'], trenner: ' ' });

  assert.match(ergebnis.schritte[0], /vorname \+ nachname verbunden/);
});

/* ---------- Aufteilen ---------- */

test('ein Name zerfällt am Komma', () => {
  const ergebnis = teileAuf('Meier, Anna', {
    quelle: 'name',
    ziele: ['nachname', 'vorname'],
    trennung: { art: 'ZEICHEN', zeichen: ',' },
  });

  assert.equal(ergebnis.werte.get('nachname'), 'Meier');
  assert.equal(ergebnis.werte.get('vorname'), 'Anna');
  assert.equal(ergebnis.pruefhinweis, undefined);
});

test('mehr Teile als Zielfelder werden vorgelegt, nicht abgeschnitten', () => {
  /*
   * Die Zusage aus Abschnitt 9: „Bei Transformationen dürfen keine
   * Quellinformationen unbeabsichtigt verloren gehen." Ein abgeschnittener
   * Namensteil sieht im Ergebnis aus wie ein Name — und der Kunde hieße von da
   * an anders.
   */
  const ergebnis = teileAuf('Meier von der Heide', {
    quelle: 'name',
    ziele: ['vorname', 'nachname'],
    trennung: { art: 'ZEICHEN', zeichen: ' ' },
  });

  assert.equal(ergebnis.werte.size, 0, 'nichts wurde übernommen');
  assert.match(ergebnis.pruefhinweis ?? '', /4 Teile/);
  assert.match(ergebnis.pruefhinweis ?? '', /von/);
});

test('wer den Überschuss ans letzte Feld will, bekommt ihn dort', () => {
  const ergebnis = teileAuf('Anna Meier von der Heide', {
    quelle: 'name',
    ziele: ['vorname', 'nachname'],
    trennung: { art: 'ZEICHEN', zeichen: ' ' },
    ueberschuss: 'AN_LETZTES',
  });

  assert.equal(ergebnis.werte.get('vorname'), 'Anna');
  assert.equal(ergebnis.werte.get('nachname'), 'Meier von der Heide');
});

test('weniger Teile als Zielfelder lassen die übrigen leer', () => {
  // Kein Prüffall: Es ging nichts verloren, es war nur nichts da.
  const ergebnis = teileAuf('Meier', {
    quelle: 'name',
    ziele: ['nachname', 'vorname'],
    trennung: { art: 'ZEICHEN', zeichen: ',' },
  });

  assert.equal(ergebnis.werte.get('nachname'), 'Meier');
  assert.equal(ergebnis.werte.has('vorname'), false);
  assert.equal(ergebnis.pruefhinweis, undefined);
});

test('an festen Stellen trennen — für Kennungen mit fester Breite', () => {
  const ergebnis = teileAuf('DE47110', {
    quelle: 'kennung',
    ziele: ['land', 'nummer'],
    trennung: { art: 'STELLEN', stellen: [2] },
  });

  assert.equal(ergebnis.werte.get('land'), 'DE');
  assert.equal(ergebnis.werte.get('nummer'), '47110');
});

test('ein leerer Wert ergibt leere Zielfelder und keinen Prüffall', () => {
  const ergebnis = teileAuf('   ', {
    quelle: 'name',
    ziele: ['vorname', 'nachname'],
    trennung: { art: 'ZEICHEN', zeichen: ' ' },
  });

  assert.equal(ergebnis.werte.size, 0);
  assert.equal(ergebnis.pruefhinweis, undefined);
});

test('die Aufteilung steht im Protokoll', () => {
  const ergebnis = teileAuf('Meier, Anna', {
    quelle: 'name',
    ziele: ['nachname', 'vorname'],
    trennung: { art: 'ZEICHEN', zeichen: ',' },
  });

  assert.match(ergebnis.schritte[0], /aufgeteilt in „Meier", „Anna"/);
});

test('jeder Teil darf noch umgeformt werden', () => {
  const ergebnis = teileAuf('meier, anna', {
    quelle: 'name',
    ziele: ['nachname', 'vorname'],
    trennung: { art: 'ZEICHEN', zeichen: ',' },
    schritte: [{ art: 'ANFANGSGROSS' }],
  });

  assert.equal(ergebnis.werte.get('nachname'), 'Meier');
  assert.equal(ergebnis.werte.get('vorname'), 'Anna');
});

test('der Überschuss wird mit demselben Zeichen wieder verbunden', () => {
  // Aus „von der Heide" darf nicht „vonderHeide" werden.
  const ergebnis = teileAuf('Anna;Meier;von;der;Heide', {
    quelle: 'name',
    ziele: ['vorname', 'nachname'],
    trennung: { art: 'ZEICHEN', zeichen: ';' },
    ueberschuss: 'AN_LETZTES',
  });

  assert.equal(ergebnis.werte.get('nachname'), 'Meier;von;der;Heide');
});

test('ein leerer Wert ergibt auch bei festen Stellen keine Zielfelder', () => {
  /*
   * Beim Trennzeichen fallen leere Teile ohnehin weg. An festen Stellen nicht:
   * Dort zerfiele „   " in zwei leere Teile, und beide Zielfelder stünden
   * danach als „gefüllt mit nichts" da — die Vollständigkeitsprüfung zählte sie
   * mit und fragte, wo ihre Werte blieben.
   */
  const ergebnis = teileAuf('   ', {
    quelle: 'kennung',
    ziele: ['land', 'nummer'],
    trennung: { art: 'STELLEN', stellen: [2] },
  });

  assert.equal(ergebnis.werte.size, 0);
  assert.equal(ergebnis.pruefhinweis, undefined);
});

/* ---------- Namenspartikel ---------- */

test('Partikel bleiben klein — sonst entsteht ein Name, den niemand so schreibt', () => {
  assert.equal(wert('BERT VON DER HEIDE', { art: 'ANFANGSGROSS' }), 'Bert von der Heide');
  assert.equal(wert('anna van den berg', { art: 'ANFANGSGROSS' }), 'Anna van den Berg');
  assert.equal(wert('LUDWIG VAN BEETHOVEN', { art: 'ANFANGSGROSS' }), 'Ludwig van Beethoven');
});

test('auch die romanischen und nordischen Vorsätze', () => {
  assert.equal(wert('LEONARDO DA VINCI', { art: 'ANFANGSGROSS' }), 'Leonardo da Vinci');
  assert.equal(wert('CHARLES DE GAULLE', { art: 'ANFANGSGROSS' }), 'Charles de Gaulle');
  assert.equal(wert('JUAN PEREZ Y GARCIA', { art: 'ANFANGSGROSS' }), 'Juan Perez y Garcia');
});

test('ein Partikel, das allein steht, wird groß', () => {
  /*
   * Ein Feld, in dem nur „von" steht, ist kein Name mit Vorsatz, sondern ein
   * Wert für sich — klein gelassen sähe er aus wie ein Fehler.
   */
  assert.equal(wert('von', { art: 'ANFANGSGROSS' }), 'Von');
  assert.equal(wert('  de  ', { art: 'ANFANGSGROSS' }), '  De  ');
});

test('ein Partikel am Anfang bleibt trotzdem klein, wenn ein Name folgt', () => {
  // Deutsche Schreibweise: „von der Heide", nicht „Von der Heide".
  assert.equal(wert('VON DER HEIDE', { art: 'ANFANGSGROSS' }), 'von der Heide');
});

test('wer jedes Wort groß will, gibt eine leere Liste an', () => {
  // Für Felder, in denen keine Namen stehen — eine Produktbezeichnung etwa.
  assert.equal(wert('der grosse wagen', { art: 'ANFANGSGROSS', partikel: [] }), 'Der Grosse Wagen');
});

test('eine eigene Liste sticht die Voreinstellung', () => {
  /*
   * Im Niederländischen wird das Tussenvoegsel groß, sobald der Vorname fehlt.
   * Das hängt am Zusammenhang und nicht am Wort — wer es so braucht, tauscht
   * die Liste, statt auf eine Regel zu hoffen, die es errät.
   */
  assert.equal(wert('anna van den berg', { art: 'ANFANGSGROSS', partikel: ['van'] }), 'Anna van Den Berg');
});

test('Bindestrich und Apostroph bleiben Wortgrenzen', () => {
  assert.equal(wert('meier-schulz', { art: 'ANFANGSGROSS' }), 'Meier-Schulz');
  assert.equal(wert("o'brien", { art: 'ANFANGSGROSS' }), "O'Brien");
});

test('mehrfache Leerzeichen werden nicht nebenbei geputzt', () => {
  // Umgeformt wird, was verlangt ist — nicht nebenbei etwas anderes. Wer
  // putzen will, nimmt TRIMMEN.
  assert.equal(wert('anna  meier', { art: 'ANFANGSGROSS' }), 'Anna  Meier');
});

test('die Voreinstellung deckt das Deutsche und seine Nachbarn ab', () => {
  for (const partikel of ['von', 'van', 'de', 'der', 'den', 'du', 'di', 'zu', 'la']) {
    assert.ok(NAMENSPARTIKEL.includes(partikel), partikel);
  }
});
