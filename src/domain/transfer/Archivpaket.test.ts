import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHIV_TAGE, darfPaketFort, paketAbgelaufen, type Archivpaket } from './Archivpaket.js';

const HEUTE = new Date('2026-08-25T12:00:00.000Z');

function vorTagen(tage: number): string {
  return new Date(HEUTE.getTime() - tage * 24 * 60 * 60 * 1000).toISOString();
}

function paket(erstellt: string, entferntAm?: string): Pick<Archivpaket, 'erstellt' | 'entferntAm'> {
  return { erstellt, entferntAm };
}

const DURCH = { abgeschlossen: true };

/* ---------- Die Frist ---------- */

test('voreingestellt bleibt ein Paket neunzig Tage', () => {
  /*
   * Lang genug für „was kam im letzten Quartal herein" — kurz genug, dass
   * daraus kein Lager wird. Länger als die Ausleitungen (dreißig Tage), weil es
   * etwas anderes ist: Eine Ausleitung ist eine Abschrift zum Bearbeiten, das
   * Archiv ist das Original.
   */
  assert.equal(ARCHIV_TAGE, 90);
  assert.equal(paketAbgelaufen(paket(vorTagen(89)), { jetzt: HEUTE }), false);
  assert.equal(paketAbgelaufen(paket(vorTagen(91)), { jetzt: HEUTE }), true);
});

test('genau auf den Tag zählt als abgelaufen', () => {
  assert.equal(paketAbgelaufen(paket(vorTagen(90)), { jetzt: HEUTE }), true);
});

test('null heißt niemals — dieselbe Bedeutung wie bei den Ausleitungen', () => {
  /*
   * Zwei Aufbewahrungsangaben, bei denen die Null Verschiedenes hieße, wären
   * die Falle, in die genau einmal jemand tritt.
   */
  assert.equal(paketAbgelaufen(paket(vorTagen(3650)), { tage: 0, jetzt: HEUTE }), false);
  assert.equal(paketAbgelaufen(paket(vorTagen(3650)), { tage: -1, jetzt: HEUTE }), false);
});

test('ein unlesbarer Zeitpunkt gilt als nicht abgelaufen', () => {
  /*
   * Die Alternative wäre, ein Original wegen eines kaputten Zeitstempels
   * fortzuräumen. Unter zwei Fehlern ist das der teurere.
   */
  assert.equal(paketAbgelaufen(paket('kein Datum'), { tage: 1, jetzt: HEUTE }), false);
});

/* ---------- Die drei Bedingungen ---------- */

test('abgelaufen und der Lauf ist durch: dann darf es fort', () => {
  assert.equal(darfPaketFort(paket(vorTagen(200)), DURCH, { jetzt: HEUTE }), true);
});

test('solange der Lauf nicht durch ist, bleibt das Original liegen', () => {
  /*
   * Es ist das, woraus der Korrekturlauf rechnen wird. Eine Frist, die es
   * vorher fortnimmt, macht die Konfliktbearbeitung wertlos — man entscheidet
   * zwanzig Fälle und hat nichts mehr, worauf man sie anwenden könnte.
   */
  assert.equal(darfPaketFort(paket(vorTagen(200)), { abgeschlossen: false }, { jetzt: HEUTE }), false);
});

test('ein unbekannter Lauf hält es ebenfalls', () => {
  /*
   * Die unbequemere Antwort und die richtige: Eine Frist, die im Zweifel
   * löscht, löscht irgendwann das, was jemand gebraucht hätte.
   */
  assert.equal(darfPaketFort(paket(vorTagen(200)), undefined, { jetzt: HEUTE }), false);
});

test('was schon fort ist, wird nicht noch einmal angefasst', () => {
  // Zweimal löschen ist kein Fortschritt.
  assert.equal(darfPaketFort(paket(vorTagen(200), vorTagen(1)), DURCH, { jetzt: HEUTE }), false);
});

test('die Frist gilt auch für einen abgeschlossenen Lauf', () => {
  assert.equal(darfPaketFort(paket(vorTagen(2)), DURCH, { jetzt: HEUTE }), false);
});
