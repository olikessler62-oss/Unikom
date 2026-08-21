import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { aktuelleVersion, neuesProfil } from '../../../domain/consolidation/Profil.js';
import { openDatabase } from './SqliteDatabase.js';
import { SqliteProfilRepository } from './SqliteProfilRepository.js';

const VORGABE = {
  verbindlichkeit: 'HINWEIS' as const,
  columns: 2,
  spalten: [
    { position: 1, name: 'Nummer', type: 'INTEGER' as const },
    { position: 2, name: 'Ort', type: 'STRING' as const },
  ],
};

async function datenbank() {
  return openDatabase(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-profil-')), 'daten'));
}

test('ein Profil übersteht das Speichern und Lesen mit allen Versionen', async () => {
  const database = await datenbank();
  const ablage = new SqliteProfilRepository(database);
  const jetzt = new Date('2026-08-19T10:00:00.000Z');

  const angelegt = neuesProfil({
    id: 'p1',
    tenantId: 'default',
    name: 'Bestellung Müller GmbH',
    vorgabe: VORGABE,
    einstellungen: { locale: 'fr-FR' },
    erstelltVonName: 'anna',
    jetzt,
  });

  await ablage.save({
    ...angelegt,
    versionen: [
      ...angelegt.versionen,
      {
        version: 2,
        erstellt: new Date('2026-09-01T08:00:00.000Z'),
        erstelltVonName: 'bernd',
        notiz: 'Lieferant schreibt jetzt amerikanisch',
        vorgabe: VORGABE,
        einstellungen: { locale: 'en-US' },
      },
    ],
  });

  const gelesen = await ablage.getById('p1');

  assert.equal(gelesen?.versionen.length, 2);
  assert.equal(aktuelleVersion(gelesen!).einstellungen.locale, 'en-US');
  assert.equal(gelesen?.versionen[0].einstellungen.locale, 'fr-FR');
  assert.deepEqual(gelesen?.versionen[1].erstellt, new Date('2026-09-01T08:00:00.000Z'));
  assert.equal(gelesen?.versionen[1].notiz, 'Lieferant schreibt jetzt amerikanisch');

  database.close();
});

test('ein gelesenes Profil ist eingefroren', async () => {
  // Sonst wäre die Unveränderlichkeit eine Eigenschaft des Arbeitsspeichers und
  // ginge beim ersten Neustart verloren.
  const database = await datenbank();
  const ablage = new SqliteProfilRepository(database);

  await ablage.save(neuesProfil({ id: 'p1', tenantId: 'default', name: 'Profil', vorgabe: VORGABE }));

  const gelesen = await ablage.getById('p1');

  assert.throws(() => {
    (aktuelleVersion(gelesen!) as { version: number }).version = 9;
  }, TypeError);

  database.close();
});

test('eine Struktur aus der Zeit vor den Versionen wird zu Version 1', async () => {
  // Vor Etappe 2 stand im Dokument eine nackte Strukturvorgabe. Was ein Kunde
  // damals bestätigt hat, muss danach dasselbe sein — und nicht verschwinden.
  const database = await datenbank();

  database
    .prepare(
      `INSERT INTO structure_profiles
         (id, tenant_id, name, description, document, confirmed_by, confirmed_by_name, matches, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'alt',
      'default',
      'Bestellung von früher',
      null,
      JSON.stringify(VORGABE),
      'u-1',
      'anna',
      7,
      '2026-01-15T09:00:00.000Z',
      '2026-01-15T09:00:00.000Z'
    );

  const gelesen = await new SqliteProfilRepository(database).getById('alt');
  const version = aktuelleVersion(gelesen!);

  assert.equal(gelesen?.versionen.length, 1);
  assert.equal(version.version, 1);
  assert.deepEqual(version.vorgabe, VORGABE);
  assert.deepEqual(version.einstellungen, {}, 'es wird keine Einstellung dazuerfunden');
  assert.equal(version.erstelltVonName, 'anna');
  assert.deepEqual(version.erstellt, new Date('2026-01-15T09:00:00.000Z'));
  assert.equal(gelesen?.matches, 7, 'der Trefferzähler bleibt');

  database.close();
});

test('nach dem ersten Speichern steht das Profil in der neuen Form da', async () => {
  const database = await datenbank();
  const ablage = new SqliteProfilRepository(database);

  database
    .prepare(
      `INSERT INTO structure_profiles (id, tenant_id, name, document, matches, created_at, updated_at)
       VALUES ('alt', 'default', 'Alt', ?, 0, '2026-01-15T09:00:00.000Z', '2026-01-15T09:00:00.000Z')`
    )
    .run(JSON.stringify(VORGABE));

  await ablage.save((await ablage.getById('alt'))!);

  const dokument = database.prepare('SELECT document FROM structure_profiles WHERE id = ?').get('alt') as unknown as {
    document: string;
  };

  assert.ok(JSON.parse(dokument.document).versionen, 'die Umstellung geschieht beim Speichern, nicht bei jedem Lesen');

  database.close();
});

test('Profile werden je Mandant getrennt gehalten', async () => {
  const database = await datenbank();
  const ablage = new SqliteProfilRepository(database);

  await ablage.save(neuesProfil({ id: 'p1', tenantId: 'nord', name: 'Nord', vorgabe: VORGABE }));
  await ablage.save(neuesProfil({ id: 'p2', tenantId: 'sued', name: 'Süd', vorgabe: VORGABE }));

  assert.deepEqual((await ablage.list('nord')).map((profil) => profil.name), ['Nord']);

  database.close();
});
