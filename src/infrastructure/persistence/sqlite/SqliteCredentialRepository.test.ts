import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Credential } from '../../../domain/credentials/Credential.js';
import { openDatabase } from './SqliteDatabase.js';
import { SqliteCredentialRepository } from './SqliteCredentialRepository.js';

/*
 * Die Freigabe am Zugang muss einen Neustart überstehen. Sonst sieht es wie
 * gestern aus: Die Einstellung wird entgegengenommen, lebt im Arbeitsspeicher
 * und ist am Morgen fort — und eine leere Angabe sieht genauso aus wie eine,
 * die nie gemacht wurde.
 */

async function ablage(): Promise<{ pfad: string; bestand: SqliteCredentialRepository }> {
  const pfad = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-zugang-')), 'daten');

  return { pfad, bestand: new SqliteCredentialRepository(await openDatabase(pfad)) };
}

function zugang(teile: Partial<Credential> = {}): Credential {
  return {
    id: 'z1',
    name: 'Freigabe Austausch',
    type: 'USERNAME_PASSWORD',
    username: 'dienst',
    encryptedSecret: 'verschlossen',
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    updatedAt: new Date('2026-01-01T08:00:00.000Z'),
    ...teile,
  };
}

test('die Freigabe am Zugang übersteht einen Neustart', async () => {
  const { pfad, bestand } = await ablage();
  const freigabe = String.fromCharCode(92, 92) + 'SERVER01' + String.fromCharCode(92) + 'Austausch';

  await bestand.save(zugang({ freigabe }));

  const gelesen = await new SqliteCredentialRepository(await openDatabase(pfad)).getById('z1');

  assert.equal(gelesen?.freigabe, freigabe);
  assert.equal(gelesen?.username, 'dienst');
});

test('ein Zugang ohne Freigabe bleibt einer ohne', async () => {
  // Nicht als leere Zeichenkette: Die würde beim Suchen auf jeden Pfad passen.
  const { pfad, bestand } = await ablage();

  await bestand.save(zugang());

  assert.equal((await new SqliteCredentialRepository(await openDatabase(pfad)).getById('z1'))?.freigabe, undefined);
});

test('eine genommene Freigabe bleibt genommen', async () => {
  const { pfad, bestand } = await ablage();

  await bestand.save(zugang({ freigabe: String.fromCharCode(92, 92) + 'SERVER01' + String.fromCharCode(92) + 'Alt' }));
  await bestand.save(zugang({ updatedAt: new Date('2026-02-01T08:00:00.000Z') }));

  assert.equal((await new SqliteCredentialRepository(await openDatabase(pfad)).getById('z1'))?.freigabe, undefined);
});
