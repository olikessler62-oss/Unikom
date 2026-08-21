import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { CONFIDENCE_THRESHOLD, recogniseField, SAMPLE_SIZE } from './Recognition.js';

const deutsch = { region: DEFAULT_REGION };
const amerikanisch = { region: { locale: 'en-US', timeZone: 'America/New_York' } };

/** n Werte, davon `abweichend` Stück anders. */
function spalte(wert: string, anzahl: number, abweichend: { wert: string; anzahl: number } = { wert: '', anzahl: 0 }) {
  return [...Array(anzahl - abweichend.anzahl).fill(wert), ...Array(abweichend.anzahl).fill(abweichend.wert)];
}

test('eine saubere Zahlenspalte wird sicher erkannt', () => {
  const ergebnis = recogniseField('Betrag', spalte('1.234,56', 40), deutsch);

  assert.equal(ergebnis.type, 'DECIMAL');
  assert.equal(ergebnis.confidence, 1);
  assert.equal(ergebnis.certain, true);
});

test('ganze Zahlen werden von Dezimalzahlen unterschieden', () => {
  assert.equal(recogniseField('Anzahl', spalte('42', 20), deutsch).type, 'INTEGER');
  assert.equal(recogniseField('Preis', spalte('42,50', 20), deutsch).type, 'DECIMAL');
});

test('ein einzelner Ausreißer kippt die Spalte nicht, wird aber benannt', () => {
  // 99 von 100 — über der Schwelle. Das Feld ist eine Zahl, und der eine Wert
  // ist der Prüffall. Andersherum wäre die ganze Spalte Text und der Fehler
  // unsichtbar.
  const ergebnis = recogniseField('Betrag', spalte('1.234,56', 100, { wert: 'k. A.', anzahl: 1 }), deutsch);

  assert.equal(ergebnis.type, 'DECIMAL');
  assert.equal(ergebnis.certain, true);
  assert.ok(ergebnis.confidence >= CONFIDENCE_THRESHOLD);
  assert.deepEqual(ergebnis.outliers, ['k. A.'], 'der abweichende Wert wird mitgegeben, nicht verschwiegen');
});

test('zwei Zahlenformate ohne Mehrheit ergeben keinen sicheren Typ', () => {
  // Die Hälfte deutsch, die Hälfte amerikanisch geschrieben. Beides zusammen
  // ist keine Spalte, sondern zwei — das muss ein Mensch entscheiden.
  const gemischt = [...Array(50).fill('1.234,56'), ...Array(50).fill('1,234.56')];
  const ergebnis = recogniseField('Betrag', gemischt, deutsch);

  assert.equal(ergebnis.certain, false);
  assert.ok(ergebnis.note?.includes('Schwelle'), ergebnis.note);
});

test('eine Textspalte mit ein paar Zahlen darin bleibt Text', () => {
  const bemerkungen = [...Array(30).fill('Lieferung verspätet'), ...Array(5).fill('2026')];
  const ergebnis = recogniseField('Bemerkung', bemerkungen, deutsch);

  assert.equal(ergebnis.type, 'STRING');
  assert.equal(ergebnis.certain, true);
});

test('dieselbe Spalte ergibt unter zwei Regionen zwei Ergebnisse', () => {
  // 1,234 ist deutsch eine Dezimalzahl und amerikanisch eine ganze Zahl.
  // Beide Male sicher — und genau deshalb entscheidet die Region und nicht
  // die Erkennung.
  const werte = spalte('1,234', 30);

  assert.equal(recogniseField('Wert', werte, deutsch).type, 'DECIMAL');
  assert.equal(recogniseField('Wert', werte, amerikanisch).type, 'INTEGER');
});

test('eine Zahlenspalte in der fremden Schreibweise ist schlicht Text', () => {
  /*
   * Das Tausendertrennzeichen entscheidet mit: `1,234.56` geht unter de-DE
   * nicht als Zahl auf und landet in derselben Schublade wie „meier, anna" —
   * STRING, und zwar sicher. Wer daraus einen Vorschlag „hier könnte man am
   * Komma aufteilen" ableitet, schlägt vor, Beträge in Vor- und Nachnamen zu
   * zerlegen. Umgekehrt gilt dasselbe: `1.234,56` unter en-US.
   */
  const amerikanisch56 = spalte('1,234.56', 30);
  const deutsch56 = spalte('1.234,56', 30);

  const alsText = recogniseField('Betrag', amerikanisch56, deutsch);

  assert.equal(alsText.type, 'STRING');
  assert.equal(alsText.certain, true, 'und zwar ohne jeden Zweifel — das ist das Tückische');
  assert.equal(recogniseField('Betrag', amerikanisch56, amerikanisch).type, 'DECIMAL');

  assert.equal(recogniseField('Betrag', deutsch56, amerikanisch).type, 'STRING');
  assert.equal(recogniseField('Betrag', deutsch56, deutsch).type, 'DECIMAL');
});

test('Leerwerte zählen nicht gegen den Typ', () => {
  const werte = [...Array(20).fill('42'), ...Array(10).fill(''), 'N/A', '-'];
  const ergebnis = recogniseField('Anzahl', werte, deutsch);

  assert.equal(ergebnis.type, 'INTEGER');
  assert.equal(ergebnis.certain, true);
  assert.equal(ergebnis.empty, 12);
  assert.equal(ergebnis.checked, 20);
});

test('eine durchgehend leere Spalte behauptet keinen Typ', () => {
  const ergebnis = recogniseField('Zusatz', Array(50).fill(''), deutsch);

  assert.equal(ergebnis.type, 'NULL');
  assert.equal(ergebnis.certain, false);
  assert.ok(ergebnis.note?.includes('Kein einziger Wert'));
});

test('Wahrheitswerte werden erkannt, Einsen und Nullen nicht', () => {
  assert.equal(recogniseField('Aktiv', spalte('Ja', 20, { wert: 'Nein', anzahl: 8 }), deutsch).type, 'BOOLEAN');

  // Eine Spalte aus 1 und 0 ist häufiger eine Anzahl als ein Ja/Nein.
  assert.equal(recogniseField('Menge', spalte('1', 20, { wert: '0', anzahl: 8 }), deutsch).type, 'INTEGER');
});

test('bei mehrdeutigen Datumsangaben steht ein Hinweis dabei', () => {
  const ergebnis = recogniseField('Datum', spalte('04/03/2026', 20), deutsch);

  assert.equal(ergebnis.type, 'DATE');
  assert.equal(ergebnis.certain, true);
  assert.match(ergebnis.note ?? '', /anderen Tag/);
});

test('eindeutige Datumsangaben brauchen keinen Hinweis', () => {
  const ergebnis = recogniseField('Datum', spalte('2026-03-04', 20), deutsch);

  assert.equal(ergebnis.type, 'DATE');
  assert.equal(ergebnis.note, undefined);
});

test('die Stichprobe wird erweitert, wenn 100 Werte nicht reichen', () => {
  // In den ersten 100 stehen 4 Abweichler — 96 %, unter der Schwelle. Über
  // 1.000 Werte gesehen sind es 4 von 1.000, also 99,6 %.
  const werte = [...spalte('42', 100, { wert: 'x', anzahl: 4 }), ...Array(900).fill('42')];
  const ergebnis = recogniseField('Anzahl', werte, deutsch);

  assert.equal(ergebnis.certain, true);
  assert.equal(ergebnis.checked, 1000, 'es wurde erweitert');
  assert.ok(ergebnis.confidence > CONFIDENCE_THRESHOLD);
});

test('die Erweiterung endet bei 1.000 und erfindet keine Sicherheit', () => {
  // Gleichmäßig 10 % Abweichler: Mehr Stichprobe ändert daran nichts, und
  // genau dann darf kein Ergebnis auf gut Glück entstehen.
  const werte = Array.from({ length: 5000 }, (_, index) => (index % 10 === 0 ? 'unbekannt' : '42'));
  const ergebnis = recogniseField('Anzahl', werte, deutsch);

  assert.equal(ergebnis.certain, false);
  assert.equal(ergebnis.checked, 1000, 'mehr als 1.000 Werte werden nicht geprüft');
});

test('bei sicherer Aussage wird die Stichprobe nicht erweitert', () => {
  const werte = Array(5000).fill('42');
  const ergebnis = recogniseField('Anzahl', werte, deutsch);

  assert.equal(ergebnis.checked, SAMPLE_SIZE, 'die Prüfung endet, sobald sie sicher ist');
});
