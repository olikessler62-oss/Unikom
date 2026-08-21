import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Tenant } from '../../../domain/tenants/Tenant.js';
import { openDatabase } from './SqliteDatabase.js';
import { SqliteTenantRepository } from './SqliteTenantRepository.js';

async function ablage(): Promise<{ pfad: string; bestand: SqliteTenantRepository }> {
  const pfad = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-mandant-')), 'daten');

  return { pfad, bestand: new SqliteTenantRepository(await openDatabase(pfad)) };
}

function mandant(teile: Partial<Tenant> = {}): Tenant {
  return {
    id: 'default',
    name: 'Standard',
    enabled: true,
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    updatedAt: new Date('2026-01-01T08:00:00.000Z'),
    ...teile,
  };
}

/* ---------- Was jahrelang verlorenging ---------- */

test('die Meldewege überstehen einen Neustart', async () => {
  /*
   * Sie wurden entgegengenommen und fielen beim Schreiben heraus: Die Tabelle
   * hatte keine Spalte dafür. Nach jedem Neustart galt wieder die
   * Voreinstellung — und niemand sah es, weil eine Voreinstellung genauso
   * aussieht wie eine Einstellung, die man vergessen hat.
   */
  const { pfad, bestand } = await ablage();

  await bestand.save(
    mandant({
      benachrichtigung: {
        empfaenger: ['betrieb@example.com'],
        postausgang: { host: 'smtp.example.com', port: 587, absender: 'unikom@example.com', verschluesselung: 'STARTTLS' },
      },
    })
  );

  const nachNeustart = new SqliteTenantRepository(await openDatabase(pfad));
  const gelesen = await nachNeustart.getById('default');

  assert.deepEqual(gelesen?.benachrichtigung?.empfaenger, ['betrieb@example.com']);
  assert.equal(gelesen?.benachrichtigung?.postausgang?.host, 'smtp.example.com');
});

test('die Konsolidierungseinstellungen überstehen einen Neustart', async () => {
  // Sie sind die Spitze der Einstellungshierarchie (SPEC-02 §40). War sie leer,
  // galt überall die Voreinstellung.
  const { pfad, bestand } = await ablage();

  await bestand.save(mandant({ consolidation: { mindestKonfidenz: 0.95, nullWerte: ['k. A.'] } }));

  const gelesen = await new SqliteTenantRepository(await openDatabase(pfad)).getById('default');

  assert.equal(gelesen?.consolidation?.mindestKonfidenz, 0.95);
  assert.deepEqual(gelesen?.consolidation?.nullWerte, ['k. A.']);
});

test('die Aufbewahrungsfrist der Ausleitungen übersteht einen Neustart', async () => {
  const { pfad, bestand } = await ablage();

  await bestand.save(mandant({ ausleitungenTage: 3 }));

  assert.equal((await new SqliteTenantRepository(await openDatabase(pfad)).getById('default'))?.ausleitungenTage, 3);
});

test('null Tage sind etwas anderes als keine Angabe', async () => {
  /*
   * Abgeschaltet gegen „nichts eingetragen". Würde die Null zu `undefined`,
   * räumte die Bereinigung ab morgen wieder nach der Voreinstellung fort —
   * genau bei dem Kunden, der sie ausdrücklich abgeschaltet hat.
   */
  const { pfad, bestand } = await ablage();

  await bestand.save(mandant({ ausleitungenTage: 0 }));

  const gelesen = await new SqliteTenantRepository(await openDatabase(pfad)).getById('default');

  assert.equal(gelesen?.ausleitungenTage, 0);

  const ohne = await ablage();

  await ohne.bestand.save(mandant());

  assert.equal(
    (await new SqliteTenantRepository(await openDatabase(ohne.pfad)).getById('default'))?.ausleitungenTage,
    undefined
  );
});

test('was fort ist, bleibt fort', async () => {
  // `undefined` speichern heißt: Die Einstellung ist genommen, nicht „ändere
  // nichts" — das entscheidet eine Ebene höher.
  const { pfad, bestand } = await ablage();

  await bestand.save(mandant({ ausleitungenTage: 3, consolidation: { mindestKonfidenz: 0.9 } }));
  await bestand.save(mandant({ updatedAt: new Date('2026-02-01T08:00:00.000Z') }));

  const gelesen = await new SqliteTenantRepository(await openDatabase(pfad)).getById('default');

  assert.equal(gelesen?.ausleitungenTage, undefined);
  assert.equal(gelesen?.consolidation, undefined);
});

test('ein kaputter Eintrag nimmt nicht den ganzen Mandanten mit', async () => {
  // Er verliert die Einstellung und behält Namen, Verzeichnis und Läufe.
  const { pfad, bestand } = await ablage();
  const datenbank = await openDatabase(pfad);

  await bestand.save(mandant({ rootDirectory: 'C:/kunde' }));

  datenbank.prepare("UPDATE tenants SET consolidation = '{kaputt' WHERE id = 'default'").run();

  const gelesen = await new SqliteTenantRepository(datenbank).getById('default');

  assert.equal(gelesen?.name, 'Standard');
  assert.equal(gelesen?.rootDirectory, 'C:/kunde');
  assert.equal(gelesen?.consolidation, undefined);
});
