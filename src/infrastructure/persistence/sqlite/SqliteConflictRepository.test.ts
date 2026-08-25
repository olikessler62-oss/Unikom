import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Konfliktfall } from '../../../domain/conflicts/Konfliktfall.js';
import { openDatabase } from './SqliteDatabase.js';
import { SqliteConflictRepository } from './SqliteConflictRepository.js';

async function ablage(): Promise<{ pfad: string; bestand: SqliteConflictRepository }> {
  const pfad = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-konflikt-')), 'daten');

  return { pfad, bestand: new SqliteConflictRepository(await openDatabase(pfad)) };
}

function fall(teile: Partial<Konfliktfall> = {}): Konfliktfall {
  return {
    id: 'f1',
    tenantId: 'default',
    laufId: 'lauf1',
    datensatz: '4711',
    art: 'WERTEKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: 'Zwei Quellen nennen verschiedene Orte',
    erwartet: 'Einen Wert',
    vorgefunden: 'CRM: „Bonn" · ERP: „Köln"',
    naechsteSchritte: 'Den richtigen Wert auswählen',
    quellen: ['CRM.csv', 'ERP.csv'],
    felder: [
      {
        feld: 'ort',
        typ: 'STRING',
        angebote: [
          { quelle: 'CRM.csv', wert: 'Bonn', metadaten: { regel: 'QUELLENPRIORITAET' } },
          { quelle: 'ERP.csv', wert: 'Köln' },
        ],
      },
    ],
    entstanden: '2026-08-01T10:00:00.000Z',
    geaendert: '2026-08-01T10:00:00.000Z',
    fassung: 1,
    ...teile,
  };
}

test('ein Konfliktfall übersteht das Speichern und Lesen vollständig', async () => {
  const { bestand } = await ablage();
  const original = fall({ ergebnis: { ort: 'Köln' }, entstandenAus: 'alt1' });

  await bestand.save(original);

  /*
   * Verglichen wird über JSON und nicht mit `deepEqual` auf den Objekten:
   * Beim Lesen entstehen Felder, die ausdrücklich `undefined` sind, während
   * sie im Original schlicht fehlen — für `deepStrictEqual` ein Unterschied,
   * fachlich keiner. Der Umweg prüft nebenbei mit, dass sich der Fall
   * überhaupt in JSON abbilden lässt; über die Schnittstelle geht er genau so
   * hinaus.
   */
  assert.deepEqual(JSON.parse(JSON.stringify(await bestand.byId('f1'))), JSON.parse(JSON.stringify(original)));
});

test('das Schema, aus dem der Fall stammt, übersteht den Neustart', async () => {
  /*
   * Ohne diesen Verweis liefe die Korrektur nur gegen die vier ausgelieferten
   * Regeln — ein leeres Pflichtfeld ließe sich durch ein leeres Pflichtfeld
   * „bereinigen". Fiele er beim Schreiben heraus, wäre das nach jedem Neustart
   * so, und niemand sähe es.
   */
  const { pfad, bestand } = await ablage();

  await bestand.save(fall({ profil: 'p1' }));

  const gelesen = await new SqliteConflictRepository(await openDatabase(pfad)).byId('f1');

  assert.equal(gelesen?.profil, 'p1');
});

test('ein Fall ohne Schema bleibt ohne', async () => {
  // Ein Wertekonflikt aus der Zusammenführung stammt aus keinem Schema.
  const { pfad, bestand } = await ablage();

  await bestand.save(fall());

  assert.equal((await new SqliteConflictRepository(await openDatabase(pfad)).byId('f1'))?.profil, undefined);
});

test('eine Sperre übersteht den Neustart', async () => {
  // Nicht kosmetisch: Ein Neustart, der alle Sperren vergisst, lässt beim
  // nächsten Hochfahren zwei Leute in denselben Fall.
  const { pfad } = await ablage();
  const erster = new SqliteConflictRepository(await openDatabase(pfad));

  await erster.save(fall({ sperre: { benutzer: 'anna', benutzerName: 'Anna Meier', seit: '2026-08-01T11:00:00.000Z' } }));

  const nachNeustart = new SqliteConflictRepository(await openDatabase(pfad));
  const gelesen = await nachNeustart.byId('f1');

  assert.equal(gelesen?.sperre?.benutzer, 'anna');
  assert.equal(gelesen?.sperre?.benutzerName, 'Anna Meier');
});

test('der Bearbeitungsstand übersteht den Neustart', async () => {
  // SPEC-07, Abschnitt 10: „Die Wiederaufnahme muss auch am nächsten Tag oder
  // nach einem Neustart genau an diesem Bearbeitungsstand möglich sein."
  const { pfad } = await ablage();
  const erster = new SqliteConflictRepository(await openDatabase(pfad));

  await erster.standSpeichern({
    benutzer: 'anna',
    tenantId: 'default',
    zuletzt: 'f1',
    position: 7,
    filter: { kritikalitaet: ['KRITISCH'], suche: 'Bonn' },
    gruppierung: 'QUELLE',
    sortierung: 'ENTSTEHUNG',
    richtung: 'AB',
    gespeichert: '2026-08-01T11:00:00.000Z',
  });

  const nachNeustart = new SqliteConflictRepository(await openDatabase(pfad));
  const stand = await nachNeustart.standOf('anna', 'default');

  assert.equal(stand?.zuletzt, 'f1');
  assert.equal(stand?.position, 7);
  assert.deepEqual(stand?.filter, { kritikalitaet: ['KRITISCH'], suche: 'Bonn' });
  assert.equal(stand?.gruppierung, 'QUELLE');
  assert.equal(stand?.richtung, 'AB');
});

test('jeder Benutzer hat seinen eigenen Stand', async () => {
  const { bestand } = await ablage();

  await bestand.standSpeichern({ benutzer: 'anna', tenantId: 'default', zuletzt: 'f1', gespeichert: 'a' });
  await bestand.standSpeichern({ benutzer: 'bernd', tenantId: 'default', zuletzt: 'f2', gespeichert: 'b' });

  assert.equal((await bestand.standOf('anna', 'default'))?.zuletzt, 'f1');
  assert.equal((await bestand.standOf('bernd', 'default'))?.zuletzt, 'f2');
});

test('die Historie wächst und wird nie überschrieben', async () => {
  const { bestand } = await ablage();

  await bestand.save(fall());
  await bestand.schrittAnfuegen({ nummer: 1, fallId: 'f1', art: 'ENTSTANDEN', zeitpunkt: 'a', benutzer: 'anna' });
  await bestand.schrittAnfuegen({
    nummer: 2,
    fallId: 'f1',
    art: 'ENTSCHIEDEN',
    zeitpunkt: 'b',
    benutzer: 'anna',
    vorher: { ort: 'Bonn' },
    nachher: { ort: 'Köln' },
    vorgang: 'v1',
  });

  const historie = await bestand.historie('f1');

  assert.equal(historie.length, 2);
  assert.deepEqual(historie[1].nachher, { ort: 'Köln' });
  assert.equal(historie[1].vorgang, 'v1');
});

test('zwei Schritte mit derselben Nummer scheitern, statt sich zu überschreiben', async () => {
  // Zwei gleichzeitige Entscheidungen sollen hart scheitern. Ein stiller
  // Überschreiber verlöre genau die Bearbeitung, die SPEC-07, Abschnitt 11,
  // schützen will.
  const { bestand } = await ablage();

  await bestand.save(fall());
  await bestand.schrittAnfuegen({ nummer: 1, fallId: 'f1', art: 'ENTSTANDEN', zeitpunkt: 'a', benutzer: 'anna' });

  await assert.rejects(() =>
    bestand.schrittAnfuegen({ nummer: 1, fallId: 'f1', art: 'ENTSCHIEDEN', zeitpunkt: 'b', benutzer: 'bernd' })
  );
});

test('gefiltert wird über die Datenbank und über die Werte', async () => {
  const { bestand } = await ablage();

  await bestand.save(fall({ id: 'f1', kritikalitaet: 'KRITISCH' }));
  await bestand.save(fall({ id: 'f2', kritikalitaet: 'WARNUNG', status: 'BEREINIGT', laufId: 'lauf2' }));

  assert.deepEqual((await bestand.list('default', { kritikalitaet: ['KRITISCH'] })).map((f) => f.id), ['f1']);
  assert.deepEqual((await bestand.list('default', { status: ['BEREINIGT'] })).map((f) => f.id), ['f2']);
  assert.deepEqual((await bestand.list('default', { laufId: 'lauf2' })).map((f) => f.id), ['f2']);
  assert.equal((await bestand.list('default', { suche: 'Köln' })).length, 2, 'die Freitextsuche greift auf die Werte zu');
  assert.equal((await bestand.list('anderer')).length, 0, 'ein fremder Mandant sieht nichts');
});

test('eine Zeile mit unlesbarem JSON reißt nicht den ganzen Bestand mit', async () => {
  const { pfad, bestand } = await ablage();
  const database = await openDatabase(pfad);

  await bestand.save(fall());
  database.prepare("UPDATE conflicts SET fields = 'kein json' WHERE id = 'f1'").run();

  const gelesen = await bestand.byId('f1');

  assert.deepEqual(gelesen?.felder, [], 'was sich nicht lesen ließ, fehlt sichtbar');
  assert.equal(gelesen?.ursache, 'Zwei Quellen nennen verschiedene Orte', 'der Rest steht da');
});
