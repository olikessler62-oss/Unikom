import assert from 'node:assert/strict';
import test from 'node:test';

import type { Quelle } from '../consolidation/Quellen.js';
import type { Qualitaetsregel } from './Regeln.js';
import { befundzeilen, GENANNTE_ZEILEN, nummerVon, saetzeAus, teileQuelleAuf } from './Quellenaufteilung.js';

const OPTIONEN = { region: { locale: 'de-DE', timeZone: 'Europe/Berlin' } };

function quelle(teile: Partial<Quelle> = {}): Quelle {
  return {
    id: 'q1',
    name: 'Kunden.csv',
    felder: ['Kundennummer', 'Ort'],
    zeilen: [
      ['4711', 'Bonn'],
      ['', 'Köln'],
      ['4713', 'Kiel'],
    ],
    ...teile,
  };
}

const PFLICHT: Qualitaetsregel = {
  id: 'kdnr-pflicht',
  name: 'Kundennummer darf nicht leer sein',
  feld: 'Kundennummer',
  pruefung: { art: 'PFLICHT' },
  schwere: 'FEHLER',
};

/* ---------- Aus Zeilen werden Datensätze ---------- */

test('jede Zeile wird zum Datensatz unter den Feldnamen', () => {
  const saetze = saetzeAus(quelle());

  assert.equal(saetze.length, 3);
  assert.equal(saetze[0].get('Kundennummer'), '4711');
  assert.equal(saetze[0].get('Ort'), 'Bonn');
});

test('eine kurze Zeile bekommt leere Felder, keine fehlenden', () => {
  /*
   * CSV-Zeilen enden gern früher als die Kopfzeile. Eine Pflichtregel muss
   * anschlagen, wenn die Spalte fehlt — und nicht schweigen, weil es das Feld
   * im Datensatz gar nicht gibt.
   */
  const saetze = saetzeAus(quelle({ zeilen: [['4711']] }));

  assert.equal(saetze[0].has('Ort'), true);
  assert.equal(saetze[0].get('Ort'), '');
});

test('Werte über die Kopfzeile hinaus fallen fort', () => {
  // Sie haben keinen Namen, unter dem eine Regel sie ansprechen könnte.
  const saetze = saetzeAus(quelle({ zeilen: [['4711', 'Bonn', 'übrig']] }));

  assert.deepEqual([...saetze[0].keys()], ['Kundennummer', 'Ort']);
});

/* ---------- Die Aufteilung ---------- */

test('die verarbeitbaren Zeilen bleiben in der Quelle, die anderen nicht', () => {
  const aufteilung = teileQuelleAuf(quelle(), [PFLICHT], OPTIONEN);

  assert.deepEqual(aufteilung.verarbeitbar.zeilen, [
    ['4711', 'Bonn'],
    ['4713', 'Kiel'],
  ]);
  assert.equal(aufteilung.gescheitert.length, 1);
  assert.equal(aufteilung.pruefbedarf.length, 0);
});

test('alles andere an der Quelle bleibt, wie es war', () => {
  // Name, Kennung und Blatt sind es, woran später jede Herkunft hängt.
  const aufteilung = teileQuelleAuf(quelle({ blatt: 'Tabelle1' }), [PFLICHT], OPTIONEN);

  assert.equal(aufteilung.verarbeitbar.id, 'q1');
  assert.equal(aufteilung.verarbeitbar.name, 'Kunden.csv');
  assert.equal(aufteilung.verarbeitbar.blatt, 'Tabelle1');
  assert.deepEqual(aufteilung.verarbeitbar.felder, ['Kundennummer', 'Ort']);
});

test('ohne Regeln bleibt die Quelle vollständig', () => {
  const aufteilung = teileQuelleAuf(quelle(), [], OPTIONEN);

  assert.equal(aufteilung.verarbeitbar.zeilen.length, 3);
  assert.equal(aufteilung.gescheitert.length, 0);
});

test('ein Konflikt geht an einen Menschen und nicht ins Gescheiterte', () => {
  const aufteilung = teileQuelleAuf(quelle(), [{ ...PFLICHT, schwere: 'KONFLIKT' }], OPTIONEN);

  assert.equal(aufteilung.gescheitert.length, 0);
  assert.equal(aufteilung.pruefbedarf.length, 1);
  assert.equal(aufteilung.verarbeitbar.zeilen.length, 2);
});

/* ---------- Die Zeilennummern ---------- */

test('die Nummer ist die der Datei und nicht die Stelle im Block', () => {
  /*
   * Bei blockweiser Verarbeitung trägt ein Block nur einen Teil der Zeilen.
   * Wer die Stelle zählt, schreibt „Zeile 2" in die Ablehnungsdatei, während
   * der Fehler in Zeile 2002 steht — und das sieht plausibel aus.
   */
  const aufteilung = teileQuelleAuf(quelle({ zeilenNummern: [2001, 2002, 2003] }), [PFLICHT], OPTIONEN);

  assert.equal(aufteilung.gescheitert[0].zeile, 2002);
});

test('was übrig bleibt, trägt seine Nummern mit', () => {
  const aufteilung = teileQuelleAuf(quelle({ zeilenNummern: [2001, 2002, 2003] }), [PFLICHT], OPTIONEN);

  assert.deepEqual(aufteilung.verarbeitbar.zeilenNummern, [2001, 2003]);
});

test('auch eine ungeteilte Quelle bekommt Nummern', () => {
  /*
   * Sonst hinge die Richtigkeit jeder Herkunftsangabe daran, ob zufällig alle
   * Zeilen durchgekommen sind.
   */
  const aufteilung = teileQuelleAuf(quelle(), [PFLICHT], OPTIONEN);

  assert.deepEqual(aufteilung.verarbeitbar.zeilenNummern, [1, 3]);
});

test('ohne eigene Nummern zählt die Quelle ab eins', () => {
  assert.equal(nummerVon(quelle(), 0), 1);
  assert.equal(nummerVon(quelle(), 2), 3);
});

test('mit eigenen Nummern zählt sie diese', () => {
  assert.equal(nummerVon(quelle({ zeilenNummern: [7, 8, 9] }), 0), 7);
  assert.equal(nummerVon(quelle({ zeilenNummern: [7, 8, 9] }), 2), 9);
});

/* ---------- Der Grund reist mit ---------- */

test('jede herausgenommene Zeile trägt Grund und Satz', () => {
  const aufteilung = teileQuelleAuf(quelle(), [PFLICHT], OPTIONEN);

  assert.match(aufteilung.gescheitert[0].gruende[0], /„Kundennummer" ist leer/);
  assert.equal(aufteilung.gescheitert[0].satz.get('Ort'), 'Köln');
});

/* ---------- Was im Protokoll landet ---------- */

function berichteMit(zeilen: number, schwere: 'FEHLER' | 'KONFLIKT' = 'FEHLER') {
  const daten = Array.from({ length: zeilen }, (_wert, stelle) => ['', `Ort ${stelle}`]);

  return [teileQuelleAuf(quelle({ zeilen: daten }), [{ ...PFLICHT, schwere }], OPTIONEN)];
}

test('auch ein sauberer Durchgang steht im Protokoll', () => {
  /*
   * „Nichts im Protokoll" hieße sonst zweierlei — alles in Ordnung, oder es
   * wurde gar nicht geprüft. Die beiden auseinanderzuhalten ist genau das,
   * wonach jemand sucht, wenn ein Ergebnis nicht stimmt.
   */
  const zeilen = befundzeilen('Kunden.csv', [teileQuelleAuf(quelle(), [], OPTIONEN)]);

  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /3 Zeilen gegen das Schema geprüft, nichts zu beanstanden/);
});

test('eine leere Quelle sagt gar nichts', () => {
  // Es gibt nichts zu berichten, und eine Zeile „0 Zeilen geprüft" ist Lärm.
  assert.deepEqual(befundzeilen('Leer.csv', [teileQuelleAuf(quelle({ zeilen: [] }), [PFLICHT], OPTIONEN)]), []);
});

test('der Kopf nennt alle drei Ausgänge', () => {
  const zeilen = befundzeilen('Kunden.csv', [teileQuelleAuf(quelle(), [PFLICHT], OPTIONEN)]);

  assert.match(zeilen[0], /3 Zeilen/);
  assert.match(zeilen[0], /2 verarbeitbar/);
  assert.match(zeilen[0], /1 gescheitert/);
  assert.match(zeilen[0], /0 zur Prüfung/);
});

test('beanstandete Zeilen stehen mit Nummer und Grund darunter', () => {
  const zeilen = befundzeilen('Kunden.csv', [teileQuelleAuf(quelle(), [PFLICHT], OPTIONEN)]);

  assert.match(zeilen[1], /Zeile 2:/);
  assert.match(zeilen[1], /„Kundennummer" ist leer/);
});

test('bei vielen Zeilen wird gekürzt — und gesagt, wie viele fehlen', () => {
  /*
   * Dreitausend Zeilen einzeln zu nennen macht das Protokoll unlesbar; nur
   * eine Zahl zu nennen schickt jemanden mit leeren Händen in die Datei.
   * Verschwiegen wird nichts.
   */
  const zeilen = befundzeilen('Viele.csv', berichteMit(12));

  assert.equal(zeilen.length, 1 + GENANNTE_ZEILEN + 1);
  assert.match(zeilen[zeilen.length - 1], /und 7 weitere Zeilen mit Befund/);
});

test('genau so viele, wie genannt werden dürfen, brauchen keinen Nachsatz', () => {
  const zeilen = befundzeilen('Knapp.csv', berichteMit(GENANNTE_ZEILEN));

  assert.equal(zeilen.length, 1 + GENANNTE_ZEILEN);
  assert.ok(!zeilen.some((zeile) => /weitere Zeilen/.test(zeile)));
});

test('genannt wird nach Zeilennummer, nicht nach Ausgang', () => {
  /*
   * Sonst hinge die Auswahl daran, welche Regel zuerst angelegt wurde — und
   * dieselbe Datei ergäbe morgen ein anderes Protokoll.
   */
  const gemischt = teileQuelleAuf(
    quelle({ zeilen: [['', 'a'], ['4712', 'b'], ['', 'c']] }),
    [PFLICHT, { ...PFLICHT, id: 'ort-konflikt', feld: 'Ort', pruefung: { art: 'AUS_LISTE', werte: ['b'] }, schwere: 'KONFLIKT' }],
    OPTIONEN
  );

  const nummern = befundzeilen('Gemischt.csv', [gemischt])
    .slice(1)
    .map((zeile) => Number(/Zeile (\d+):/.exec(zeile)?.[1]));

  assert.deepEqual(nummern, [...nummern].sort((eine, andere) => eine - andere));
});

/* ---------- Regeln über Felder, die es nicht gibt ---------- */

test('eine Regel über ein Feld, das es nicht gibt, bleibt außen vor', () => {
  /*
   * Sie anzuwenden hieße: jede Zeile gescheitert, dreitausend Absagen für einen
   * Grund, der nicht einmal stimmt. Die Daten sind in Ordnung — es fehlen die
   * Überschriften.
   */
  const aufteilung = teileQuelleAuf(quelle(), [{ ...PFLICHT, feld: 'Kundennummer_XY' }], OPTIONEN);

  assert.equal(aufteilung.gescheitert.length, 0);
  assert.equal(aufteilung.verarbeitbar.zeilen.length, 3);
  assert.deepEqual(aufteilung.fehlendeFelder, ['Kundennummer_XY']);
});

test('die übrigen Regeln gelten weiter', () => {
  const aufteilung = teileQuelleAuf(quelle(), [PFLICHT, { ...PFLICHT, id: 'x', feld: 'Gibtsnicht' }], OPTIONEN);

  assert.equal(aufteilung.gescheitert.length, 1);
  assert.deepEqual(aufteilung.fehlendeFelder, ['Gibtsnicht']);
});

test('dasselbe fehlende Feld steht nur einmal da', () => {
  const aufteilung = teileQuelleAuf(
    quelle(),
    [
      { ...PFLICHT, id: 'a', feld: 'Gibtsnicht' },
      { ...PFLICHT, id: 'b', feld: 'Gibtsnicht' },
    ],
    OPTIONEN
  );

  assert.deepEqual(aufteilung.fehlendeFelder, ['Gibtsnicht']);
});

test('das Protokoll nennt die Spalten und den häufigsten Grund', () => {
  const zeilen = befundzeilen('Kunden.csv', [
    teileQuelleAuf(quelle(), [{ ...PFLICHT, feld: 'Kundennummer_XY' }], OPTIONEN),
  ]);

  assert.match(zeilen[0], /„Kundennummer_XY"/);
  assert.match(zeilen[0], /gibt es in der Datei nicht/);
  assert.match(zeilen[0], /Kopfzeile wurde nicht erkannt/);
});

test('auch eine leere Quelle meldet fehlende Spalten', () => {
  // Sonst bliebe das Schema stumm, gerade wo gar nichts ankam.
  const zeilen = befundzeilen('Leer.csv', [
    teileQuelleAuf(quelle({ zeilen: [] }), [{ ...PFLICHT, feld: 'Gibtsnicht' }], OPTIONEN),
  ]);

  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /„Gibtsnicht"/);
});
