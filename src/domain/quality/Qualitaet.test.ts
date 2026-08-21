import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { konvertiere } from './Konvertierung.js';
import { leerart, normalisiereWert } from './Normalisierung.js';
import { AUSGELIEFERTE_REGELN, blockiert, pruefe, zeilenMitKonflikt, type Qualitaetsregel } from './Regeln.js';

const DEUTSCH = { region: DEFAULT_REGION };

/* ---------- Normalisierung (SPEC-04, Abschnitt 2) ---------- */

test('Leerzeichen am Rand fallen fort — das ist Normalisierung', () => {
  const ergebnis = normalisiereWert(' 4711 ', { trimmen: true });

  assert.equal(ergebnis.wert, '4711');
  assert.deepEqual(ergebnis.schritte, ['Leerzeichen am Rand entfernt']);
});

test('jeder Schritt wird zurückgemeldet', () => {
  // Eine Normalisierung, die niemand sieht, ist von einer Korrektur nicht mehr
  // zu unterscheiden.
  const ergebnis = normalisiereWert('  Meier   Söhne  ', {
    trimmen: true,
    mehrfachLeerzeichen: true,
    schreibweise: 'GROSS',
  });

  assert.equal(ergebnis.wert, 'MEIER SÖHNE');
  assert.equal(ergebnis.schritte.length, 3);
});

test('was sich nicht ändert, wird nicht als Schritt gemeldet', () => {
  const ergebnis = normalisiereWert('4711', { trimmen: true, mehrfachLeerzeichen: true });

  assert.deepEqual(ergebnis.schritte, []);
});

test('bei der E-Mail wird nur der Teil hinter dem @ kleingeschrieben', () => {
  // Der Domänenteil ist unabhängig von der Schreibung; der Teil davor darf es
  // nicht sein — sonst wäre es eine Änderung der Bedeutung.
  const ergebnis = normalisiereWert('Anna.Berger@Example.ORG', { format: 'EMAIL' });

  assert.equal(ergebnis.wert, 'Anna.Berger@example.org');
});

test('die IBAN verliert ihre Lesegruppen und wird groß', () => {
  assert.equal(normalisiereWert('de89 3704 0044 0532 0130 00', { format: 'IBAN' }).wert, 'DE89370400440532013000');
});

test('beim Telefon endet die Normalisierung an der Klammer — und sagt es', () => {
  // Ob die Null in „(0)" zur Nummer gehört, hängt an der Landesvorwahl. Das ist
  // eine Auslegung, keine Schreibweise.
  const ergebnis = normalisiereWert('+49 (0) 30 12 34-56', { format: 'TELEFON' });

  assert.equal(ergebnis.wert, '+49(0)30123456');
  assert.match(ergebnis.hinweise.join(' '), /Auslegung und keine Schreibweise/);
});

test('NULL, leer und lauter Leerzeichen sind drei verschiedene Dinge', () => {
  // In vielen Systemen verschmelzen sie zu einem — und dann ist nicht mehr zu
  // sagen, ob ein Feld nie gefüllt wurde oder jemand es geleert hat.
  assert.equal(leerart(null), 'NULL');
  assert.equal(leerart(''), 'LEER');
  assert.equal(leerart('   '), 'NUR_LEERZEICHEN');
  assert.equal(leerart('x'), 'GEFUELLT');
  assert.equal(leerart('N/A', ['N/A']), 'NULL');
});

/* ---------- Konvertierung (SPEC-04, Abschnitt 4) ---------- */

test('eindeutige Umsetzungen sind erlaubt', () => {
  const zahl = konvertiere('12345', 'INTEGER', DEUTSCH);
  const datum = konvertiere('18.08.2026', 'DATE', DEUTSCH);

  assert.deepEqual(zahl, { ok: true, typ: 'INTEGER', wert: 12345, text: '12345' });
  assert.equal(datum.ok && datum.wert, '2026-08-18');
});

test('Nachkommastellen abzuschneiden ist kein Dienst, sondern ein Verlust', () => {
  // Aus 56 Cent je Datensatz werden über ein Jahr Beträge, die niemand mehr
  // erklären kann — und die Datei sieht dabei die ganze Zeit richtig aus.
  const ergebnis = konvertiere('1.234,56', 'INTEGER', DEUTSCH);

  assert.equal(ergebnis.ok, false);
  assert.equal(!ergebnis.ok && ergebnis.art, 'VERLUST');
  assert.match(!ergebnis.ok ? ergebnis.auswirkung : '', /Datenverlust/);
});

test('was keine Zahl ist, wird keine Zahl', () => {
  const ergebnis = konvertiere('ABC123', 'INTEGER', DEUTSCH);

  assert.equal(!ergebnis.ok && ergebnis.art, 'UNGUELTIG');
});

test('ein Überlauf wird abgebrochen, nicht gerundet', () => {
  // Über 2^53 rechnet JavaScript still weiter und rundet dabei: Eine
  // Kundennummer, die sich beim Einlesen um eins ändert, findet niemand.
  const ergebnis = konvertiere('9007199254740993', 'INTEGER', DEUTSCH);

  assert.equal(!ergebnis.ok && ergebnis.art, 'UEBERLAUF');
});

test('eine unbekannte Schreibweise für wahr und falsch ist ein Konflikt', () => {
  assert.equal(konvertiere('Ja', 'BOOLEAN', DEUTSCH).ok, true);
  assert.equal(konvertiere('vielleicht', 'BOOLEAN', DEUTSCH).ok, false);

  // Eigene Schreibweisen lassen sich einrichten.
  const eigen = konvertiere('X', 'BOOLEAN', { ...DEUTSCH, booleans: { wahr: ['X'], falsch: [''] } });

  assert.equal(eigen.ok && eigen.wert, true);
});

test('1 und 0 gelten nicht von selbst als wahr und falsch', () => {
  // In einer Mengenspalte heißt 1 nun einmal eins.
  assert.equal(konvertiere('1', 'BOOLEAN', DEUTSCH).ok, false);
});

test('ein leerer Wert ist erlaubt, solange das Feld es zulässt', () => {
  assert.equal(konvertiere('', 'INTEGER', DEUTSCH).ok, true);
  assert.equal(konvertiere('', 'INTEGER', { ...DEUTSCH, leerErlaubt: false }).ok, false);
});

test('eine zweistellige Jahreszahl wird gelesen — und angemerkt', () => {
  const ergebnis = konvertiere('01.03.80', 'DATE', DEUTSCH);

  assert.equal(ergebnis.ok && ergebnis.wert, '1980-03-01');
  assert.match((ergebnis.ok && ergebnis.hinweis) || '', /zweistellig/);
});

test('ein Datum in fremder Schreibweise sagt, wonach gelesen wurde', () => {
  const ergebnis = konvertiere('2026-13-45', 'DATE', DEUTSCH);

  assert.equal(ergebnis.ok, false);
  assert.match(!ergebnis.ok ? ergebnis.auswirkung : '', /Region an den Mandanten/);
});

/* ---------- Qualitätsregeln (SPEC-04 §5, SPEC-08 §5 bis §9) ---------- */

function satz(eintraege: Record<string, string>) {
  return new Map(Object.entries(eintraege));
}

test('ein Pflichtfeld, das leer ist, wird gemeldet', () => {
  const befunde = pruefe(satz({ customerId: '' }), 1, AUSGELIEFERTE_REGELN, DEUTSCH);

  assert.equal(befunde.length, 1);
  assert.equal(befunde[0].schwere, 'KONFLIKT');
  assert.match(befunde[0].ursache, /ist leer/);
  assert.match(befunde[0].auswirkung, /nicht eindeutig zuordnen/);
});

test('ein Feld, das es gar nicht gibt, ist etwas anderes als ein leeres', () => {
  const befunde = pruefe(satz({ ort: 'Köln' }), 1, AUSGELIEFERTE_REGELN, DEUTSCH);

  assert.match(befunde[0].ursache, /kommt in diesem Bestand nicht vor/);
});

test('jeder Befund nennt Ursache und Auswirkung getrennt', () => {
  // Ein einzelnes Textfeld füllt sich mit „Validierungsfehler in Feld 3", und
  // niemand weiß danach, was zu tun ist.
  const befunde = pruefe(satz({ customerId: '1', email: 'kein-mail', quantity: '-5' }), 1, AUSGELIEFERTE_REGELN, DEUTSCH);

  assert.ok(befunde.length >= 2);

  for (const befund of befunde) {
    assert.ok(befund.ursache.length > 0, 'Ursache');
    assert.ok(befund.auswirkung.length > 0, 'Auswirkung');
    assert.notEqual(befund.ursache, befund.auswirkung);
  }
});

test('ein Geburtsdatum in der Zukunft wird gemeldet, mit dem wahrscheinlichen Grund', () => {
  const befunde = pruefe(
    satz({ customerId: '1', birthDate: '01.03.2080' }),
    1,
    AUSGELIEFERTE_REGELN,
    { ...DEUTSCH, jetzt: new Date('2026-08-19T00:00:00.000Z') }
  );

  assert.equal(befunde.length, 1);
  assert.match(befunde[0].auswirkung, /zweistellige Jahreszahl/);
});

test('eine Regel greift nur, wenn ihre Bedingung zutrifft', () => {
  // WENN Zahlungsart = „Lastschrift" DANN muss IBAN vorhanden sein.
  const regel: Qualitaetsregel = {
    id: 'iban-bei-lastschrift',
    name: 'Bei Lastschrift wird die IBAN gebraucht',
    feld: 'iban',
    pruefung: { art: 'PFLICHT' },
    schwere: 'KONFLIKT',
    wenn: { feld: 'zahlungsart', ist: 'Lastschrift' },
  };

  const mit = pruefe(satz({ zahlungsart: 'Lastschrift', iban: '' }), 1, [regel], DEUTSCH);
  const ohne = pruefe(satz({ zahlungsart: 'Rechnung', iban: '' }), 1, [regel], DEUTSCH);

  assert.equal(mit.length, 1);
  assert.match(mit[0].auswirkung, /Weil zahlungsart „Lastschrift" ist/);
  assert.deepEqual(ohne, [], 'eine Regel, die nicht greift, schweigt');
});

test('ein Wert außerhalb der Liste wird gemeldet, mit der Liste dabei', () => {
  const regel: Qualitaetsregel = {
    id: 'land',
    name: 'Land muss bekannt sein',
    feld: 'country',
    pruefung: { art: 'AUS_LISTE', werte: ['DE', 'AT', 'CH'] },
    schwere: 'WARNUNG',
  };

  const befunde = pruefe(satz({ country: 'XX' }), 3, [regel], DEUTSCH);

  assert.equal(befunde[0].zeile, 3);
  assert.match(befunde[0].auswirkung, /DE, AT, CH/);
});

test('nicht jede Auffälligkeit blockiert die Verarbeitung', () => {
  // SPEC-08, Abschnitt 9: Nur ein Fehler hält alles an; ein Konflikt trennt
  // einen Datensatz ab und lässt die übrigen laufen.
  const konflikte = pruefe(satz({ customerId: '' }), 1, AUSGELIEFERTE_REGELN, DEUTSCH);

  assert.equal(blockiert(konflikte), false);
  assert.deepEqual(zeilenMitKonflikt(konflikte), [1]);

  const fehler = pruefe(
    satz({ customerId: '' }),
    1,
    [{ ...AUSGELIEFERTE_REGELN[3], schwere: 'FEHLER' as const }],
    DEUTSCH
  );

  assert.equal(blockiert(fehler), true);
});

test('ein sauberer Datensatz erzeugt keinen einzigen Befund', () => {
  // Ein Bericht, in dem für jede nicht zutreffende Regel eine Zeile steht, ist
  // einer, in dem niemand mehr das Wesentliche findet.
  const befunde = pruefe(
    satz({ customerId: '4711', email: 'anna@example.org', quantity: '5', birthDate: '01.03.1980' }),
    1,
    AUSGELIEFERTE_REGELN,
    { ...DEUTSCH, jetzt: new Date('2026-08-19T00:00:00.000Z') }
  );

  assert.deepEqual(befunde, []);
});
