import assert from 'node:assert/strict';
import test from 'node:test';

import type { Benachrichtigung } from '../../domain/background/Benachrichtigung.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { alsSse, neueMeldungen, unterschied, type Laufstand } from './EventStream.js';

function stand(teile: Partial<Laufstand> = {}): Laufstand {
  return { status: TransferRunStatus.RUNNING, verarbeitet: 0, gelungen: 0, fehlgeschlagen: 0, ...teile };
}

const KEINE = new Map<string, Laufstand>();

test('ein neuer laufender Lauf meldet sich als gestartet', () => {
  const ereignisse = unterschied(KEINE, new Map([['lauf1', stand()]]));

  assert.deepEqual(
    ereignisse.map((ereignis) => ereignis.name),
    ['PROCESSING_STARTED']
  );
});

test('beim ersten Blick werden alte Läufe nicht als gestartet gemeldet', () => {
  /*
   * Sonst wären beim Öffnen der Seite alle Läufe der letzten Woche „gerade
   * gestartet" — und die Anzeige zeigte einen Betrieb, den es nicht gibt.
   */
  const ereignisse = unterschied(KEINE, new Map([['alt', stand({ status: TransferRunStatus.SUCCESS })]]));

  assert.deepEqual(ereignisse, []);
});

test('ein Lauf, an dem sich nichts getan hat, erzeugt kein Ereignis', () => {
  // Ein Strom, der jede Sekunde denselben Stand wiederholt, ist einer, den
  // niemand liest.
  const vorher = new Map([['lauf1', stand({ verarbeitet: 3 })]]);

  assert.deepEqual(unterschied(vorher, new Map([['lauf1', stand({ verarbeitet: 3 })]])), []);
});

test('Fortschritt wird gemeldet, sobald sich die Zahl bewegt', () => {
  const vorher = new Map([['lauf1', stand({ verarbeitet: 3 })]]);
  const ereignisse = unterschied(vorher, new Map([['lauf1', stand({ verarbeitet: 4, gelungen: 4 })]]));

  assert.equal(ereignisse[0].name, 'PROGRESS_CHANGED');
  assert.equal(ereignisse[0].daten.verarbeitet, 4);
});

test('ein Abschluss ist etwas anderes als ein Fortschritt', () => {
  const vorher = new Map([['lauf1', stand({ verarbeitet: 4 })]]);

  assert.equal(
    unterschied(vorher, new Map([['lauf1', stand({ status: TransferRunStatus.SUCCESS, verarbeitet: 4 })]]))[0].name,
    'PROCESSING_COMPLETED'
  );
});

test('ein Fehlschlag ist etwas anderes als ein Abschluss', () => {
  const vorher = new Map([['lauf1', stand({ verarbeitet: 4 })]]);

  assert.equal(
    unterschied(vorher, new Map([['lauf1', stand({ status: TransferRunStatus.FAILED, verarbeitet: 4 })]]))[0].name,
    'ERROR'
  );
});

test('ein Lauf, der aus der Liste fällt, erzeugt kein Ereignis', () => {
  // Die Aufbewahrungsfrist räumt Läufe fort. Daraus ein Ereignis zu machen,
  // hieße den Bildschirm über etwas zu benachrichtigen, das niemanden angeht.
  const vorher = new Map([['alt', stand()]]);

  assert.deepEqual(unterschied(vorher, KEINE), []);
});

/* ---------- Meldungen ---------- */

function meldung(teile: Partial<Benachrichtigung> = {}): Benachrichtigung {
  return {
    id: 'm1',
    tenantId: 'default',
    anlass: 'LAUF_FEHLER',
    stufe: 'KRITISCH',
    titel: 'Fehler',
    text: 'Etwas ging schief',
    entstanden: '2026-08-20T12:00:00.000Z',
    ...teile,
  };
}

test('eine neue Meldung geht durch, eine bekannte nicht', () => {
  const bekannt = new Set(['m1']);

  assert.deepEqual(neueMeldungen(bekannt, [meldung()]), []);
  assert.equal(neueMeldungen(bekannt, [meldung({ id: 'm2' })]).length, 1);
});

test('ein Konfliktbestand bekommt sein eigenes Ereignis', () => {
  // Die Oberfläche behandelt ihn anders als eine gewöhnliche Meldung: Er führt
  // zu einer Liste, an der jemand arbeiten muss.
  const ereignisse = neueMeldungen(new Set(), [meldung({ anlass: 'KONFLIKTE_ENTSTANDEN', stufe: 'AKTION_ERFORDERLICH' })]);

  assert.equal(ereignisse[0].name, 'CONFLICT_FOUND');
});

/* ---------- Schreibweise ---------- */

test('ein Zeilenumbruch im Text zerreißt das Ereignis nicht', () => {
  /*
   * Ein rohes Zeilenende im Datenfeld beendet für den Browser das Ereignis —
   * der Rest der Meldung käme als abgeschnittener Unsinn an. JSON enthält
   * keine rohen Umbrüche.
   */
  const text = ['Erste Zeile', 'Zweite Zeile'].join(String.fromCharCode(10));
  const roh = alsSse({ name: 'NOTIFICATION', daten: { text } });

  const zeilen = roh.split(String.fromCharCode(10)).filter((zeile) => zeile !== '');

  assert.equal(zeilen.length, 2, 'genau die Ereigniszeile und die Datenzeile');
  assert.equal(zeilen[0], 'event: NOTIFICATION');
  assert.equal(JSON.parse(zeilen[1].slice('data: '.length)).text, text, 'der Text kommt vollständig an');
});

test('ein Ereignis endet mit einer Leerzeile', () => {
  // Ohne sie wartet der Browser auf die Fortsetzung und zeigt nichts an.
  const roh = alsSse({ name: 'PROGRESS_CHANGED', daten: { laufId: 'x' } });
  const ende = String.fromCharCode(10) + String.fromCharCode(10);

  assert.ok(roh.endsWith(ende));
});
