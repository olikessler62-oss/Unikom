import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import type { Qualitaetsregel } from '../../domain/quality/Regeln.js';
import { QualityService } from './QualityService.js';

const dienst = new QualityService();
const JETZT = new Date('2026-08-19T00:00:00.000Z');

function auftrag(teil: Partial<Parameters<QualityService['bearbeite']>[0]> = {}) {
  return {
    felder: ['customerId', 'email', 'quantity'],
    zeilen: [['  4711 ', 'Anna@Example.ORG', '5']],
    region: DEFAULT_REGION,
    jetzt: JETZT,
    ...teil,
  };
}

test('erst normalisieren, dann konvertieren, dann prüfen', () => {
  // Andersherum liefe die Prüfung gegen Werte, die noch ein Leerzeichen tragen,
  // und meldete Fehler, die keine sind.
  const bericht = dienst.bearbeite(
    auftrag({
      regeln: {
        customerId: { normalisierung: { trimmen: true }, ziel: 'INTEGER' },
        email: { normalisierung: { format: 'EMAIL' } },
      },
    })
  );

  assert.deepEqual(bericht.zeilen[0], ['4711', 'Anna@example.org', '5']);
  assert.deepEqual(bericht.befunde, [], 'nach der Normalisierung ist alles in Ordnung');
});

test('ohne Normalisierung schlägt dieselbe Zeile fehl — der Beweis für die Reihenfolge', () => {
  // Die Formatregel für E-Mail duldet kein Leerzeichen. Prüfte Unikom vor dem
  // Normalisieren, meldete es einen Fehler, den es selbst gleich behoben hätte.
  const zeilen = [['4711', ' anna@example.org ', '5']];

  const ohne = dienst.bearbeite(auftrag({ zeilen }));
  const mit = dienst.bearbeite(auftrag({ zeilen, regeln: { email: { normalisierung: { trimmen: true } } } }));

  assert.equal(ohne.zusammenfassung.KONFLIKT, 1);
  assert.match(ohne.befunde[0].ursache, /entspricht nicht dem erwarteten Format/);
  assert.deepEqual(mit.befunde, [], 'mit Normalisierung ist derselbe Wert in Ordnung');
});

test('jede Veränderung wird ausgewiesen, mit ihren Schritten', () => {
  // Eine Verarbeitung, die die Eingangsdaten überschreibt, nimmt sich die
  // einzige Möglichkeit, hinterher nachzusehen.
  const bericht = dienst.bearbeite(
    auftrag({ regeln: { customerId: { normalisierung: { trimmen: true } } } })
  );

  assert.equal(bericht.aenderungen.length, 1);
  assert.deepEqual(bericht.aenderungen[0], {
    zeile: 1,
    feld: 'customerId',
    vorher: '  4711 ',
    nachher: '4711',
    schritte: ['Leerzeichen am Rand entfernt'],
  });
});

test('ein Konflikt trennt eine Zeile ab, hält aber nichts an', () => {
  // SPEC-08, Abschnitt 8: Gültige Datensätze sollen unabhängig davon
  // weiterverarbeitet werden können.
  const bericht = dienst.bearbeite(
    auftrag({
      zeilen: [
        ['4711', 'anna@example.org', '5'],
        ['4712', 'kein-mail', '-3'],
        ['4713', 'bernd@example.org', '9'],
      ],
      regeln: { quantity: { ziel: 'INTEGER' } },
    })
  );

  assert.deepEqual(bericht.pruefzeilen, [2]);
  assert.equal(bericht.blockiert, false);
  assert.equal(bericht.zeilen.length, 3, 'alle Zeilen stehen weiterhin im Ergebnis');
});

test('eine Regel mit der Schwere FEHLER hält alles an', () => {
  const streng: Qualitaetsregel = {
    id: 'kunde-pflicht',
    name: 'Kundennummer ist Pflicht',
    feld: 'customerId',
    pruefung: { art: 'PFLICHT' },
    schwere: 'FEHLER',
  };

  const bericht = dienst.bearbeite(
    auftrag({ zeilen: [['', 'anna@example.org', '5']], qualitaet: [streng] })
  );

  assert.equal(bericht.blockiert, true);
  assert.equal(bericht.zusammenfassung.FEHLER, 1);
});

test('der Hinweis auf eine zweistellige Jahreszahl ist eine Information, kein Konflikt', () => {
  const bericht = dienst.bearbeite(
    auftrag({
      felder: ['birthDate'],
      zeilen: [['01.03.80']],
      regeln: { birthDate: { ziel: 'DATE' } },
      qualitaet: [],
    })
  );

  assert.equal(bericht.zusammenfassung.INFO, 1);
  assert.equal(bericht.zusammenfassung.KONFLIKT, 0);
  assert.match(bericht.befunde[0].ursache, /zweistellig/);
});

test('eine Telefonnummer mit (0) ergibt eine Warnung und bleibt stehen', () => {
  const bericht = dienst.bearbeite(
    auftrag({
      felder: ['phone'],
      zeilen: [['+49 (0) 30 123456']],
      regeln: { phone: { normalisierung: { format: 'TELEFON' } } },
      qualitaet: [],
    })
  );

  assert.equal(bericht.zusammenfassung.WARNUNG, 1);
  assert.equal(bericht.zeilen[0][0], '+49(0)30123456');
});

test('die Zusammenfassung zählt jede Stufe für sich', () => {
  const bericht = dienst.bearbeite(
    auftrag({
      felder: ['customerId', 'email', 'birthDate'],
      zeilen: [
        ['4711', 'anna@example.org', '01.03.80'],
        ['', 'kein-mail', '01.03.1980'],
      ],
    })
  );

  assert.equal(bericht.zusammenfassung.KONFLIKT, 2, 'leere Kundennummer und ungültige E-Mail');
  assert.equal(bericht.zusammenfassung.FEHLER, 0);
});

test('das Ergebnis nennt die Felder in der Reihenfolge, in der sie kamen', () => {
  const bericht = dienst.bearbeite(auftrag());

  assert.deepEqual(bericht.felder, ['customerId', 'email', 'quantity']);
});
