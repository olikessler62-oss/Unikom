import assert from 'node:assert/strict';
import test from 'node:test';

import type { Archivpaket } from '../../domain/transfer/Archivpaket.js';
import { InMemoryPaketRepository } from '../../infrastructure/persistence/InMemoryPaketRepository.js';
import { Archivbereinigung } from './Archivbereinigung.js';
import type { Dateiablage } from './Dateiablage.js';

const JETZT = new Date('2026-08-26T03:00:00.000Z');

function paket(teile: Partial<Archivpaket> = {}): Archivpaket {
  return {
    id: teile.id ?? 'p1',
    tenantId: teile.tenantId ?? 'default',
    jobId: 'job1',
    laufId: teile.laufId ?? 'TR-1',
    pfad: teile.pfad ?? '/archiv/Nachtlauf_TR-1.zip.enc',
    name: teile.name ?? 'Nachtlauf_TR-1.zip.enc',
    dateien: 3,
    // Weit über jeder Frist, damit die Frist nie der Grund ist, wenn ein Test
    // etwas anderes prüft.
    erstellt: teile.erstellt ?? '2020-01-01T00:00:00.000Z',
    entferntAm: teile.entferntAm,
  };
}

/** Merkt sich, was fortgenommen wurde — und kann sich weigern. */
function ablageDoppel(klemmt?: string) {
  const entfernt: string[] = [];

  return {
    entfernt,
    ablage: {
      async entferne(pfad: string) {
        if (pfad === klemmt) {
          throw new Error('Zugriff verweigert');
        }

        entfernt.push(pfad);
      },
    } as unknown as Dateiablage,
  };
}

async function bereinige(
  pakete: Archivpaket[],
  optionen: { abgeschlossen?: boolean; tage?: number; klemmt?: string; zeilen?: string[] } = {}
) {
  const bestand = new InMemoryPaketRepository();

  for (const eines of pakete) {
    await bestand.save(eines);
  }

  const { entfernt, ablage } = ablageDoppel(optionen.klemmt);
  const ergebnis = await new Archivbereinigung(
    bestand,
    ablage,
    { log: (eintrag) => optionen.zeilen?.push(eintrag.message) },
    { abgeschlossen: async () => optionen.abgeschlossen ?? true },
    { tage: async () => optionen.tage }
  ).bereinige({ jetzt: JETZT });

  return { ergebnis, entfernt, bestand };
}

/* ---------- Der Regelfall ---------- */

test('ein abgelaufenes Paket eines abgeschlossenen Laufs wird fortgenommen', async () => {
  const { ergebnis, entfernt } = await bereinige([paket()]);

  assert.equal(ergebnis.entfernt, 1);
  assert.deepEqual(entfernt, ['/archiv/Nachtlauf_TR-1.zip.enc']);
});

test('der Eintrag bleibt stehen und trägt, wann die Datei fort ist', async () => {
  /*
   * Wer im März wissen will, warum ein Paket vom Januar nicht mehr da ist,
   * findet hier die Antwort und nicht eine Lücke, die nach einem Fehler
   * aussieht.
   */
  const { bestand } = await bereinige([paket()]);

  assert.equal((await bestand.list())[0].entferntAm, JETZT.toISOString());
});

/* ---------- Die drei Bedingungen ---------- */

test('solange der Lauf nicht durch ist, bleibt das Original liegen', async () => {
  /*
   * Ein Paket ist das Original einer Lieferung. Solange sein Lauf offene Fälle
   * hat, ist es genau das, woraus der Korrekturlauf rechnen wird — eine Frist,
   * die es vorher fortnimmt, macht die Konfliktbearbeitung wertlos.
   */
  const { ergebnis, entfernt } = await bereinige([paket()], { abgeschlossen: false });

  assert.deepEqual(entfernt, []);
  assert.equal(ergebnis.geschuetzt, 1);
  assert.equal(ergebnis.entfernt, 0);
});

test('ein frisches Paket bleibt liegen', async () => {
  const { entfernt } = await bereinige([paket({ erstellt: '2026-08-25T03:00:00.000Z' })]);

  assert.deepEqual(entfernt, []);
});

test('null Tage räumt nichts fort, sondern schaltet ab', async () => {
  const { entfernt } = await bereinige([paket()], { tage: 0 });

  assert.deepEqual(entfernt, []);
});

test('was schon fort ist, wird nicht noch einmal angefasst', async () => {
  // Sonst meldete jede Bereinigung dieselben Fehlschläge über Dateien, die es
  // nicht mehr gibt.
  const { ergebnis, entfernt } = await bereinige([paket({ entferntAm: '2026-08-01T00:00:00.000Z' })]);

  assert.deepEqual(entfernt, []);
  assert.equal(ergebnis.geschuetzt, 0, 'und es zählt auch nicht als geschützt');
});

/* ---------- Ohne Auskunft wird nichts fortgeräumt ---------- */

test('ohne Auskunft über die Läufe bleibt alles liegen', async () => {
  const bestand = new InMemoryPaketRepository();
  await bestand.save(paket());

  const { entfernt, ablage } = ablageDoppel();
  const ergebnis = await new Archivbereinigung(bestand, ablage).bereinige({ jetzt: JETZT });

  assert.deepEqual(entfernt, []);
  assert.equal(ergebnis.entfernt, 0);
});

/* ---------- Was sich nicht löschen lässt ---------- */

test('ein Fehlschlag wird gemeldet und nicht verschwiegen', async () => {
  /*
   * Sonst hielte der Eintrag die Datei für fortgeräumt, und sie läge noch
   * jahrelang da.
   */
  const zeilen: string[] = [];
  const { ergebnis, bestand } = await bereinige([paket()], {
    klemmt: '/archiv/Nachtlauf_TR-1.zip.enc',
    zeilen,
  });

  assert.equal(ergebnis.fehler.length, 1);
  assert.equal(ergebnis.entfernt, 0);
  assert.equal((await bestand.list())[0].entferntAm, undefined, 'der Eintrag lügt nicht');
  assert.ok(zeilen.some((zeile) => /ließ sich nicht forträumen/.test(zeile)));
});

test('ein Fehlschlag hält die übrigen nicht auf', async () => {
  const { entfernt } = await bereinige(
    [paket(), paket({ id: 'p2', pfad: '/archiv/zweites.zip.enc', laufId: 'TR-2' })],
    { klemmt: '/archiv/Nachtlauf_TR-1.zip.enc' }
  );

  assert.deepEqual(entfernt, ['/archiv/zweites.zip.enc']);
});

/* ---------- Das Protokoll ---------- */

test('je Paket eine Zeile, mit Datum und Anzahl', async () => {
  /*
   * Ein Archiv ist das Original einer Lieferung. Dass es fort ist, gehört
   * einzeln ins Protokoll und nicht in eine Tagessumme.
   */
  const zeilen: string[] = [];

  await bereinige([paket()], { zeilen });

  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /Archivpaket fortgeräumt: „Nachtlauf_TR-1\.zip\.enc"/);
  assert.match(zeilen[0], /angelegt am 2020-01-01/);
  assert.match(zeilen[0], /3 Eingangsdatei\(en\)/);
});
