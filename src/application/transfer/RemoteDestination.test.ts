import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * Was ein entferntes Ziel anders macht als ein Verzeichnis.
 *
 * Die Matrix zeigt, dass eine Datei ankommt. Hier steht das, was erst auffällt,
 * wenn jemand am anderen Ende zusieht: dass unter einem Arbeitsnamen
 * hochgeladen wird, dass nichts davon liegen bleibt, und dass die Einstellungen
 * für einen belegten Namen über das Netz genauso gelten wie auf der Platte.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Ziel-Kennwort-2026';
const INHALT = Buffer.from('kunde;betrag\nA;42\n');

interface Bühne {
  application: ReturnType<typeof createPersistentApplication>;
  quelle: string;
  serverRoot: string;
  eingang: string;
  speichere: (overrides?: Partial<TransferJob>) => Promise<void>;
  abbauen: () => Promise<void>;
}

async function bühne(): Promise<Bühne> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ziel-'));
  const quelle = path.join(workspace, 'quelle');
  await fs.mkdir(quelle, { recursive: true });

  const serverRoot = await withSftpRoot({});
  const server = await SftpTestServer.start({ root: serverRoot, username: USERNAME, password: PASSWORD });

  const application = createPersistentApplication(path.join(workspace, 'application-data'), {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
  });

  const credential = await application.credentialService.create({
    name: 'Zielserver',
    type: 'USERNAME_PASSWORD',
    username: USERNAME,
    secret: PASSWORD,
  });

  return {
    application,
    quelle,
    serverRoot,
    eingang: path.join(serverRoot, 'eingang'),
    speichere: async (overrides = {}) => {
      await application.jobRepository.save(
        createTransferJob({
          id: 'fern',
          sourceDirectory: quelle,
          sourceConfig: { type: 'LOCAL', directory: quelle },
          destinationDirectory: '/eingang',
          destinationType: 'SFTP',
          destinationConfig: {
            type: 'SFTP',
            directory: '/eingang',
            host: '127.0.0.1',
            port: server.port,
            hostKeyFingerprint: server.hostKeyFingerprint,
            timeoutSeconds: 15,
          },
          destinationCredentialId: credential.id,
          createDestinationDirectory: true,
          minimumFileAgeSeconds: 0,
          ...overrides,
        })
      );
    },
    abbauen: async () => {
      application.close();
      await server.stop();
      await fs.rm(workspace, { recursive: true, force: true });
    },
  };
}

test('ein Ziel über SFTP übersteht das Speichern und Wiederlesen', async () => {
  const b = await bühne();

  try {
    await b.speichere();
    const gelesen = await b.application.jobRepository.getById('fern');

    // Ginge eines dieser Felder beim Speichern verloren, liefe der Workflow
    // beim nächsten Start still ins Dateisystem — an einen Ort, den niemand
    // eingestellt hat.
    assert.equal(gelesen?.destinationType, 'SFTP');
    assert.equal(gelesen?.destinationConfig?.host, '127.0.0.1');
    assert.equal(typeof gelesen?.destinationCredentialId, 'string');
  } finally {
    await b.abbauen();
  }
});

test('nach einem gelungenen Lauf bleibt kein Arbeitsname auf dem Server liegen', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere();

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS);

    const liegend = await fs.readdir(b.eingang);

    // Ein zurückgelassenes .unikom-part sieht für den Empfänger nach einer
    // abgebrochenen Lieferung aus und lässt ihn nachfragen.
    assert.deepEqual(liegend, ['ORDER_001.csv'], `unerwartet im Eingang: ${liegend.join(', ')}`);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
  } finally {
    await b.abbauen();
  }
});

test('eine Datei wird über das Netz übersprungen, wenn dort schon eine liegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'SKIP' });
    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.filesSkipped, 1);
    assert.equal(await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'), 'utf8'), 'die ältere Lieferung');
  } finally {
    await b.abbauen();
  }
});

test('eine Datei wird über das Netz ersetzt, wenn das eingestellt ist', async () => {
  // Der Fall, der bei SFTP wirklich anders ist: Ein Server lehnt das Umbenennen
  // auf einen belegten Namen ab, statt ihn zu ersetzen. Ohne das Aufräumen
  // davor bliebe die alte Datei stehen und der Lauf meldete trotzdem Erfolg.
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'OVERWRITE' });
    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.filesSucceeded, 1);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
    assert.deepEqual(await fs.readdir(b.eingang), ['ORDER_001.csv']);
  } finally {
    await b.abbauen();
  }
});

test('ein fehlendes Zielverzeichnis wird nicht heimlich angelegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere({ createDestinationDirectory: false });

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.status, TransferRunStatus.FAILED);
    // Und die Quelle ist unangetastet: Gescheitert heißt, dass nichts geschah.
    assert.deepEqual(await fs.readdir(b.quelle), ['ORDER_001.csv']);
  } finally {
    await b.abbauen();
  }
});

test('ein Name, der aus dem Zielverzeichnis führte, wird auch über das Netz abgelehnt', async () => {
  const b = await bühne();

  try {
    await b.speichere();
    const ziel = await b.application.destinationProvider.forJob(
      (await b.application.jobRepository.getById('fern'))!
    );

    assert.throws(() => ziel.resolve('/eingang', '../ORDER_001.csv'), /unsafe|Rejected/i);
    await ziel.dispose?.();
  } finally {
    await b.abbauen();
  }
});
