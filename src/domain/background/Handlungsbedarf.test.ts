import assert from 'node:assert/strict';
import test from 'node:test';

import { KEIN_BEDARF, handlungsbedarf, zusammen } from './Handlungsbedarf.js';
import type { Konfliktfall, Konfliktstatus } from '../conflicts/Konfliktfall.js';
import type { Ergebnisstand } from '../result/Ergebnisstand.js';
import type { Verarbeitungsstatus } from '../result/Freigabe.js';

const ZEITPUNKT = '2026-08-28T02:00:00.000Z';

function fall(status: Konfliktstatus): Konfliktfall {
  return {
    id: `fall-${status}`,
    tenantId: 'kunde-a',
    laufId: 'lauf-1',
    datensatz: '4711',
    art: 'WERTKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status,
    ursache: 'Zwei Quellen, zwei Werte',
    erwartet: 'ein Ort',
    vorgefunden: 'Bonn und Köln',
    naechsteSchritte: 'Einen der beiden wählen',
    quellen: ['nord.csv', 'sued.csv'],
    felder: [],
    entstanden: ZEITPUNKT,
    geaendert: ZEITPUNKT,
    fassung: 1,
  };
}

function stand(status: Verarbeitungsstatus): Ergebnisstand {
  return {
    id: `stand-${status}`,
    tenantId: 'kunde-a',
    laufId: 'lauf-1',
    jobId: 'job-1',
    felder: ['kdnr'],
    zeilen: [['4711']],
    pruefung: {
      befunde: [],
      zahlen: { eingang: 1, ergebnis: 1, felder: 1, zurueckgestellt: 0, nichtVerarbeitet: 0 },
      zusammenfassung: { INFO: 0, WARNUNG: 0, KONFLIKT: 0, FEHLER: 0 },
      blockiert: false,
      sauber: true,
    },
    status,
    entstanden: ZEITPUNKT,
  };
}

/* ---------- Was zählt ---------- */

test('ein offener Konflikt zählt', () => {
  assert.equal(handlungsbedarf([fall('OFFEN')], []).konflikte, 1);
});

test('ein zurückgestellter Konflikt zählt nicht', () => {
  /*
   * Die Entscheidung, an der diese Zahl hängt. Jemand hat den Fall angesehen
   * und vertagt — er ist nicht übersehen worden. Zählte er mit, sänke die Zahl
   * beim Zurückstellen nie, und dann stünde dort dauerhaft eine Vier, die man
   * nicht abarbeiten kann. Eine Zahl, die sich nicht abarbeiten lässt, ist
   * keine Aufforderung mehr, sondern Tapete.
   */
  assert.equal(handlungsbedarf([fall('ZURUECKGESTELLT')], []).konflikte, 0);
});

test('was entschieden ist, zählt nicht mehr', () => {
  const erledigt = [fall('BEREINIGT'), fall('AKZEPTIERT')];

  assert.equal(handlungsbedarf(erledigt, []).konflikte, 0);
});

test('ein Ergebnis, das auf die Freigabe wartet, zählt', () => {
  assert.equal(handlungsbedarf([], [stand('WAITING_FOR_RELEASE')]).freigaben, 1);
});

test('ein gescheitertes Ergebnis wartet nicht — es ist gescheitert', () => {
  assert.equal(handlungsbedarf([], [stand('FAILED')]).freigaben, 0);
});

test('ein freigegebenes Ergebnis zählt nicht', () => {
  assert.equal(handlungsbedarf([], [stand('COMPLETED')]).freigaben, 0);
});

/* ---------- Die Zahl in der Klammer ---------- */

test('die Klammer zeigt beides zusammen', () => {
  const bedarf = handlungsbedarf(
    [fall('OFFEN'), fall('ZURUECKGESTELLT')],
    [stand('WAITING_FOR_RELEASE'), stand('COMPLETED')]
  );

  assert.deepEqual(bedarf, { konflikte: 1, freigaben: 1, gesamt: 2 });
});

test('ohne alles ist die Zahl null', () => {
  assert.deepEqual(handlungsbedarf([], []), KEIN_BEDARF);
});

/* ---------- Über alle Mandanten ---------- */

test('mehrere Mandanten ergeben eine Zahl', () => {
  // Wer acht Kunden betreut, will morgens einmal hinsehen und nicht achtmal.
  const summe = zusammen([
    { konflikte: 2, freigaben: 0, gesamt: 2 },
    { konflikte: 1, freigaben: 3, gesamt: 4 },
  ]);

  assert.deepEqual(summe, { konflikte: 3, freigaben: 3, gesamt: 6 });
});

test('ohne einen einzigen Mandanten bleibt es bei null', () => {
  assert.deepEqual(zusammen([]), KEIN_BEDARF);
});
