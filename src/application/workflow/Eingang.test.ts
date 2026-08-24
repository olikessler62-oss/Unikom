import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import { writeXlsx } from '../../testing/consolidation/Xlsx.js';
import { istLesbar, liesDatei, passt, passtEndung } from './Eingang.js';

const deutsch = { region: DEFAULT_REGION };

/* ---------- Welche Datei mitkommt ---------- */

test('ohne Muster kommt jede Datei mit', () => {
  assert.equal(passt('irgendwas.csv'), true);
  assert.equal(passt('irgendwas.csv', '   '), true);
});

test('der Stern steht für beliebig viel, das Fragezeichen für genau eins', () => {
  assert.equal(passt('Filiale_Nord.csv', 'Filiale_*.csv'), true);
  assert.equal(passt('Filiale_Nord.csv', 'Filiale_????.csv'), true);
  assert.equal(passt('Filiale_Nordwest.csv', 'Filiale_????.csv'), false);
});

test('ein Punkt im Muster ist ein Punkt und kein beliebiges Zeichen', () => {
  /*
   * Unmaskiert stünde er im regulären Ausdruck für „irgendein Zeichen" — und
   * „UmsatzX2026.csv" gälte als Treffer eines Musters für „Umsatz.2026".
   */
  assert.equal(passt('Umsatz.2026.csv', 'Umsatz.2026.csv'), true);
  assert.equal(passt('UmsatzX2026.csv', 'Umsatz.2026.csv'), false);
});

test('Klammern im Namen sprengen das Muster nicht', () => {
  // „Bericht (1).csv" ist der Name, den jeder Browser beim zweiten Herunterladen vergibt.
  assert.equal(passt('Bericht (1).csv', 'Bericht (1).csv'), true);
});

test('ein Muster passt unabhängig von der Schreibweise', () => {
  // Windows unterscheidet im Dateisystem nicht; ein Muster, das nur dort passt,
  // wäre auf einem Linux-Server ein Fehler, den niemand beim Einrichten bemerkt.
  assert.equal(passt('FILIALE_NORD.CSV', 'Filiale_*.csv'), true);
});

test('das Muster greift auf den ganzen Namen, nicht auf einen Teil davon', () => {
  assert.equal(passt('alt_Filiale_Nord.csv', 'Filiale_*.csv'), false);
});

test('nur Formate mit Leser gelten als lesbar', () => {
  assert.equal(istLesbar('a.CSV'), true);
  assert.equal(istLesbar('a.xlsx'), true);
  assert.equal(istLesbar('a.pdf'), false);
});

/* ---------- Was aus einer Datei wird ---------- */

function csv(name: string, felder: string[], zeilen: string[][]) {
  return { name, bytes: alsBytes(schreibeCsv(felder, zeilen)) };
}

test('aus einer CSV wird eine Quelle, die ihren Dateinamen trägt', () => {
  const { quellen } = liesDatei(csv('Bestellungen.csv', ['kdnr', 'ort'], [['4711', 'Bonn']]), deutsch);

  assert.equal(quellen.length, 1);
  assert.equal(quellen[0].name, 'Bestellungen.csv');
  assert.deepEqual(quellen[0].felder, ['kdnr', 'ort']);
  assert.deepEqual(quellen[0].zeilen, [['4711', 'Bonn']]);
});

test('der Zeitpunkt der Datei geht an den Datenstand', () => {
  // Ohne ihn kann keine Aktualitätsregel entscheiden, welcher Wert der neuere ist.
  const datei = { ...csv('a.csv', ['x'], [['1']]), geaendert: '2026-08-01T00:00:00.000Z' };
  const { quellen } = liesDatei(datei, { ...deutsch, eingelesen: '2026-08-20T00:00:00.000Z' });

  assert.deepEqual(quellen[0].stand, {
    geaendert: '2026-08-01T00:00:00.000Z',
    eingelesen: '2026-08-20T00:00:00.000Z',
  });
});

test('eine Datei ohne Leser wird übergangen und sagt es', () => {
  // Stillschweigend zu überspringen hieße, dass jemand am Ergebnis rätselt,
  // warum eine Datei fehlt, die im Verzeichnis liegt.
  const { quellen, hinweise } = liesDatei({ name: 'Bericht.pdf', bytes: new Uint8Array() }, deutsch);

  assert.deepEqual(quellen, []);
  assert.match(hinweise[0], /Bericht\.pdf/);
  assert.match(hinweise[0], /keinen Leser/);
});

/* ---------- Arbeitsmappen ---------- */

test('eine Mappe mit einem einzigen Blatt braucht keine Auswahl', () => {
  const bytes = writeXlsx([{ name: 'Kunden', rows: [['kdnr', 'ort'], [4711, 'Bonn'], [4712, 'Köln']] }]);
  const { quellen } = liesDatei({ name: 'Kunden.xlsx', bytes }, deutsch);

  assert.equal(quellen.length, 1);
  assert.equal(quellen[0].blatt, 'Kunden');
  assert.deepEqual(quellen[0].zeilen, [
    ['4711', 'Bonn'],
    ['4712', 'Köln'],
  ]);
});

test('bei mehreren Blättern wird keines ersatzweise genommen', () => {
  /*
   * SPEC-06, Abschnitt 8: „Ein Bericht, der stillschweigend ‚Tabelle1' liest,
   * ist schlimmer als gar kein Bericht — er sieht richtig aus."
   */
  const bytes = writeXlsx([
    { name: 'Nord', rows: [['kdnr', 'ort'], [1, 'Bonn'], [2, 'Köln']] },
    { name: 'Süd', rows: [['kdnr', 'ort'], [3, 'Ulm'], [4, 'Kiel']] },
  ]);

  const { quellen, hinweise } = liesDatei({ name: 'Filialen.xlsx', bytes }, deutsch);

  assert.deepEqual(quellen, []);
  assert.match(hinweise[0], /Nord, Süd/);
});

test('das ausgewählte Blatt wird gelesen — und zwar genau dieses', () => {
  const bytes = writeXlsx([
    { name: 'Nord', rows: [['kdnr', 'ort'], [1, 'Bonn'], [2, 'Köln']] },
    { name: 'Süd', rows: [['kdnr', 'ort'], [3, 'Ulm'], [4, 'Kiel']] },
  ]);

  const { quellen } = liesDatei({ name: 'Filialen.xlsx', bytes }, { ...deutsch, blatt: { name: 'Süd' } });

  assert.equal(quellen[0].blatt, 'Süd');
  assert.deepEqual(quellen[0].zeilen, [
    ['3', 'Ulm'],
    ['4', 'Kiel'],
  ]);
  assert.equal(quellen[0].id, 'Filialen.xlsx#Süd');
});

test('ein ausgewähltes Blatt, das es nicht gibt, wird nicht ersetzt', () => {
  const bytes = writeXlsx([{ name: 'Nord', rows: [['kdnr'], [1]] }]);
  const { quellen, hinweise } = liesDatei({ name: 'F.xlsx', bytes }, { ...deutsch, blatt: { name: 'Umsatz 2026' } });

  assert.deepEqual(quellen, []);
  assert.match(hinweise[0], /Umsatz 2026/);
});

test('ein Blatt mit einem einzigen Datensatz wird gemeldet und nicht stillschweigend leer', () => {
  /*
   * Kopfzeile plus eine Zeile ist für die Blocksuche nicht eindeutig: Beide
   * Zeilen könnten die Kopfzeile sein. Sie rät nicht — und dass nichts
   * herauskam, muss dann dastehen. Eine Quelle mit null Zeilen sähe aus wie
   * eine leere Datei, und der Lauf ginge weiter, als wäre alles in Ordnung.
   * Aufzulösen ist der Fall über ein Eingangsprofil — dort bestätigt ein
   * Mensch die Struktur einmal, und danach steht sie fest.
   */
  const bytes = writeXlsx([{ name: 'K', rows: [['kdnr', 'ort'], [4711, 'Bonn']] }]);
  const { quellen, hinweise } = liesDatei({ name: 'Einzeln.xlsx', bytes }, deutsch);

  assert.deepEqual(quellen[0].zeilen, []);
  assert.ok(
    hinweise.some((hinweis) => /kein zusammenhängender Datenblock/.test(hinweis)),
    hinweise.join(' | ')
  );
});

/* ---------- Welches Format mitkommt ---------- */

test('ohne Auswahl kommt jedes lesbare Format mit', () => {
  // Die bisherige Regel bleibt die Regel: Wer nichts auswählt, schränkt nichts ein.
  assert.equal(passtEndung('a.csv'), true);
  assert.equal(passtEndung('a.csv', []), true);
  assert.equal(passtEndung('a.xlsx', ['  ', '']), true);
});

test('mit Auswahl kommt nur mit, was genannt ist', () => {
  assert.equal(passtEndung('Umsatz.csv', ['csv']), true);
  assert.equal(passtEndung('Umsatz.xml', ['csv']), false);
  assert.equal(passtEndung('Umsatz.xml', ['csv', 'xml']), true);
});

test('der Punkt und die Schreibweise sind gleichgültig', () => {
  /*
   * Wer die Endung ohne Punkt tippt, hat nicht etwas anderes gemeint. Ein
   * Filter, der daran scheitert, nähme jede Nacht nichts mit — und im
   * Protokoll stünde nur, dass nichts zu tun war.
   */
  assert.equal(passtEndung('Umsatz.CSV', ['csv']), true);
  assert.equal(passtEndung('Umsatz.csv', ['.CSV']), true);
  assert.equal(passtEndung('Umsatz.csv', [' csv ']), true);
});

test('die Endung steht am Ende und nicht irgendwo', () => {
  // Sonst käme `csv_Archiv.zip` mit, weil der Name die drei Buchstaben enthält.
  assert.equal(passtEndung('csv_Archiv.zip', ['csv']), false);
  assert.equal(passtEndung('Umsatz.csv.gz', ['csv']), false);
});

test('eine Datei ohne Punkt trägt keine Endung', () => {
  assert.equal(passtEndung('csv', ['csv']), false);
});
