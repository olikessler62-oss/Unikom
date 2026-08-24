import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from './Http.js';
import { regelnAus, schluesselAus, vorgabeAus } from './Profileingabe.js';

/** Was abgewiesen wird, wird mit 400 abgewiesen — und mit einem Satz, der weiterhilft. */
function abgewiesen(tun: () => unknown, worin: RegExp): void {
  assert.throws(tun, (fehler: unknown) => {
    assert.ok(fehler instanceof ApiError, 'ein ApiError und kein beliebiger Wurf');
    assert.equal(fehler.status, 400);
    assert.match(fehler.message, worin);

    return true;
  });
}

/* ---------- Die Struktur ---------- */

test('nichts übergeben heißt: nichts ändern', () => {
  /*
   * Der Unterschied, an dem alles hängt: `undefined` lässt die vorhandene
   * Vorgabe stehen. Gäbe es hier ein leeres Gebilde zurück, löschte jede
   * Speicherung des Reiters „Allgemein" die Spaltenliste.
   */
  assert.equal(vorgabeAus(undefined), undefined);
  assert.equal(vorgabeAus(null), undefined);
  assert.equal(regelnAus(undefined), undefined);
  assert.equal(schluesselAus(undefined), undefined);
});

test('eine Struktur kommt vollständig durch', () => {
  const vorgabe = vorgabeAus({
    verbindlichkeit: 'EINSCHRAENKUNG',
    columns: 3,
    minColumns: 2,
    beginntNach: 'Artikelnummer',
    spalten: [
      { position: 1, name: 'Artikelnummer', type: 'INTEGER' },
      { position: 2, name: 'Bezeichnung', type: 'STRING' },
    ],
  });

  assert.deepEqual(vorgabe, {
    verbindlichkeit: 'EINSCHRAENKUNG',
    columns: 3,
    minColumns: 2,
    beginntNach: 'Artikelnummer',
    spalten: [
      { position: 1, name: 'Artikelnummer', type: 'INTEGER' },
      { position: 2, name: 'Bezeichnung', type: 'STRING' },
    ],
  });
});

test('leere Felder stehen nicht im Ergebnis', () => {
  /*
   * `{ columns: undefined }` und `{}` sind für den Versionsvergleich nicht
   * dasselbe. Bliebe der leere Schlüssel stehen, entstünde bei jeder
   * Speicherung eine neue Profilversion, ohne dass sich etwas geändert hat.
   */
  const vorgabe = vorgabeAus({ verbindlichkeit: 'HINWEIS' });

  assert.deepEqual(Object.keys(vorgabe as object), ['verbindlichkeit']);
});

test('eine unbekannte Verbindlichkeit wird abgewiesen und die Liste genannt', () => {
  abgewiesen(() => vorgabeAus({ verbindlichkeit: 'STRENG' }), /HINWEIS, EINSCHRAENKUNG, VORGABE/);
  abgewiesen(() => vorgabeAus({}), /HINWEIS/);
});

test('ein unbekannter Spaltentyp wird abgewiesen', () => {
  abgewiesen(
    () => vorgabeAus({ verbindlichkeit: 'HINWEIS', spalten: [{ position: 1, type: 'ZAHL' }] }),
    /STRING, INTEGER/
  );
});

test('eine Spalte ohne Stelle wird abgewiesen', () => {
  // Ab 1, so wie ein Mensch zählt. Eine Null wäre eine Spalte, die es nicht gibt.
  abgewiesen(() => vorgabeAus({ verbindlichkeit: 'HINWEIS', spalten: [{ name: 'Ohne' }] }), /Stelle ab 1/);
  abgewiesen(() => vorgabeAus({ verbindlichkeit: 'HINWEIS', spalten: [{ position: 0 }] }), /Stelle ab 1/);
});

test('eine Spaltenzahl aus Text wird abgewiesen', () => {
  abgewiesen(() => vorgabeAus({ verbindlichkeit: 'HINWEIS', columns: '3' }), /muss eine Zahl sein/);
});

/* ---------- Die Regeln ---------- */

const PFLICHT = {
  id: 'kdnr-pflicht',
  name: 'Kundennummer darf nicht leer sein',
  feld: 'Kundennummer',
  pruefung: { art: 'PFLICHT' },
  schwere: 'KONFLIKT',
};

test('die fünf Prüfarten kommen durch', () => {
  const regeln = regelnAus([
    PFLICHT,
    { ...PFLICHT, id: 'r2', pruefung: { art: 'NICHT_ZUKUNFT' } },
    {
      ...PFLICHT,
      id: 'r3',
      pruefung: { art: 'FORMAT', muster: '^[0-9]+$', beschreibung: 'nur Ziffern' },
    },
    { ...PFLICHT, id: 'r4', pruefung: { art: 'BEREICH', min: 0, max: 99 } },
    { ...PFLICHT, id: 'r5', pruefung: { art: 'AUS_LISTE', werte: ['EUR', 'CHF'] } },
  ]);

  assert.deepEqual(
    regeln?.map((regel) => regel.pruefung.art),
    ['PFLICHT', 'NICHT_ZUKUNFT', 'FORMAT', 'BEREICH', 'AUS_LISTE']
  );
});

test('eine Bedingung über ein anderes Feld kommt mit', () => {
  /*
   * Das ist, was ein JSON Schema nur mit `if/then` könnte — und was Unikoms
   * JSON-Prüfung nie geprüft hat: `WENN Zahlungsart = Lastschrift DANN IBAN`.
   */
  const regeln = regelnAus([{ ...PFLICHT, wenn: { feld: 'Zahlungsart', ist: 'Lastschrift' } }]);

  assert.deepEqual(regeln?.[0].wenn, { feld: 'Zahlungsart', ist: 'Lastschrift' });
});

test('eine unbekannte Prüfart wird abgewiesen und die Arten genannt', () => {
  abgewiesen(
    () => regelnAus([{ ...PFLICHT, pruefung: { art: 'required' } }]),
    /PFLICHT, FORMAT, BEREICH, NICHT_ZUKUNFT, AUS_LISTE/
  );
});

test('ein Muster, das sich nicht lesen lässt, wird sofort abgewiesen', () => {
  /*
   * Und nicht erst im Nachtlauf. Dort hielte es eine Verarbeitung auf, und der
   * Fehler stünde in einem Protokoll statt in dem Formular, in dem er entstand.
   */
  abgewiesen(
    () => regelnAus([{ ...PFLICHT, pruefung: { art: 'FORMAT', muster: '[', beschreibung: 'kaputt' } }]),
    /lässt sich nicht lesen/
  );
});

test('ein Format ohne Beschreibung wird abgewiesen', () => {
  // Ohne sie liest der Benutzer im Befund einen regulären Ausdruck.
  abgewiesen(
    () => regelnAus([{ ...PFLICHT, pruefung: { art: 'FORMAT', muster: '^a$' } }]),
    /Beschreibung/
  );
});

test('ein Bereich ohne Grenzen und ein verdrehter Bereich werden abgewiesen', () => {
  abgewiesen(() => regelnAus([{ ...PFLICHT, pruefung: { art: 'BEREICH' } }]), /Kleinst- oder einen Größtwert/);
  abgewiesen(
    () => regelnAus([{ ...PFLICHT, pruefung: { art: 'BEREICH', min: 10, max: 1 } }]),
    /liegt über dem Größtwert/
  );
});

test('eine leere Auswahlliste wird abgewiesen', () => {
  // Eine Liste ohne Werte verböte jeden Wert — das meint niemand.
  abgewiesen(() => regelnAus([{ ...PFLICHT, pruefung: { art: 'AUS_LISTE', werte: [] } }]), /Auswahlliste/);
});

test('zwei Regeln mit derselben Kennung werden abgewiesen', () => {
  /*
   * Sonst sind sie später nicht mehr auseinanderzuhalten — nicht im Befund,
   * nicht in der Oberfläche, nicht beim Löschen.
   */
  abgewiesen(() => regelnAus([PFLICHT, { ...PFLICHT, name: 'Anders' }]), /mehrfach/);
});

test('eine Regel ohne Feld wird abgewiesen', () => {
  abgewiesen(() => regelnAus([{ ...PFLICHT, feld: '  ' }]), /Feld/);
});

test('ein unbekannter Schweregrad wird abgewiesen', () => {
  abgewiesen(() => regelnAus([{ ...PFLICHT, schwere: 'SCHLIMM' }]), /INFO, WARNUNG, KONFLIKT, FEHLER/);
});

/* ---------- Der Schlüssel ---------- */

test('ein Schlüssel kommt mit Feldern, Quellen und Vergleich durch', () => {
  const schluessel = schluesselAus({
    felder: ['Nachname', 'Geburtsdatum'],
    jeQuelle: { adressen: ['Name', 'Geburtstag'] },
    vergleich: { grossKleinEgal: true, umlauteEgal: true },
  });

  assert.deepEqual(schluessel, {
    felder: ['Nachname', 'Geburtsdatum'],
    jeQuelle: { adressen: ['Name', 'Geburtstag'] },
    vergleich: { grossKleinEgal: true, umlauteEgal: true },
  });
});

test('ein Schlüssel ohne Felder wird abgewiesen', () => {
  // Er ordnete sonst jeden Datensatz jedem zu.
  abgewiesen(() => schluesselAus({ felder: [] }), /mindestens ein Feld/);
  abgewiesen(() => schluesselAus({}), /mindestens ein Feld/);
});

test('eine Quelle mit zu wenigen Feldnamen wird abgewiesen', () => {
  /*
   * Gleich viele und in derselben Reihenfolge: Sonst stünde nicht fest, welcher
   * Name welchen Teil meint, und ein zusammengesetzter Schlüssel bräche über
   * den Quellen auseinander.
   */
  abgewiesen(
    () => schluesselAus({ felder: ['Nachname', 'Geburtsdatum'], jeQuelle: { adressen: ['Name'] } }),
    /2 Feldname/
  );
});

test('eine unbekannte Vergleichsregel wird abgewiesen', () => {
  abgewiesen(
    () => schluesselAus({ felder: ['Nachname'], vergleich: { akzenteEgal: true } }),
    /grossKleinEgal, leerzeichenEgal, umlauteEgal, satzzeichenEgal/
  );
});

test('eine Liste, wo ein Objekt hingehört, wird abgewiesen', () => {
  abgewiesen(() => vorgabeAus([]), /als Objekt/);
  abgewiesen(() => regelnAus({}), /als Liste/);
});
