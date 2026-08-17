import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { Aes256GcmEncryptionProvider } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * Die vier Kombinationen aus Verschlüsselung und Übertragung — jetzt mit einem
 * Server als Ziel.
 *
 * Sie sind einzeln längst geprüft, aber nur gegen ein Verzeichnis. Der Weg ist
 * jetzt ein anderer: Zwischen dem Verschlüsseln und dem endgültigen Namen
 * liegen ein Hochladen und ein Umbenennen. Eine Vertauschung dort — Klartext
 * abgelegt, wo Geheimtext gemeint war — wäre der eine Fehler, den niemand
 * bemerkt und jeder bereut.
 *
 * Nachgesehen wird deshalb nicht, was der Lauf meldet, sondern was auf der
 * Platte des Servers liegt.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Ziel-Kennwort-2026';
const SCHLUESSEL = 'prüfschlüssel-für-die-vier-fälle';
const KLARTEXT = 'kunde;betrag\nMUELLER;42\nSCHMIDT;17\n';
/** Steht im Klartext und darf in keinem Geheimtext auftauchen. */
const MARKE = 'MUELLER';

interface Bühne {
  application: ReturnType<typeof createPersistentApplication>;
  quelle: string;
  eingang: string;
  schlüsselId: string;
  lauf: (overrides: Partial<TransferJob>) => Promise<void>;
  abbauen: () => Promise<void>;
}

async function bühne(): Promise<Bühne> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-krypto-'));
  const quelle = path.join(workspace, 'quelle');
  await fs.mkdir(quelle, { recursive: true });

  const serverRoot = await withSftpRoot({});
  const server = await SftpTestServer.start({ root: serverRoot, username: USERNAME, password: PASSWORD });

  const application = createPersistentApplication(path.join(workspace, 'application-data'), {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
  });

  const zugang = await application.credentialService.create({
    name: 'Zielserver',
    type: 'USERNAME_PASSWORD',
    username: USERNAME,
    secret: PASSWORD,
  });

  const schlüssel = await application.credentialService.create({
    name: 'Schlüssel für Kunde A',
    type: 'ENCRYPTION_KEY',
    secret: SCHLUESSEL,
  });

  return {
    application,
    quelle,
    eingang: path.join(serverRoot, 'eingang'),
    schlüsselId: schlüssel.id,
    lauf: async (overrides) => {
      await application.jobRepository.save(
        createTransferJob({
          id: 'krypto',
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
          destinationCredentialId: zugang.id,
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

/** Was am Ziel liegt: der Name und ob es der Klartext ist. */
async function abgelegt(eingang: string): Promise<{ name: string; klartext: boolean; inhalt: Buffer }> {
  const [name] = await fs.readdir(eingang);
  const inhalt = await fs.readFile(path.join(eingang, name));

  return { name, inhalt, klartext: inhalt.includes(MARKE) };
}

test('verschlüsselt geholt und verschlüsselt abgelegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), KLARTEXT);
    await b.lauf({
      encryptionConfig: {
        enabled: true,
        provider: 'AES_256_GCM',
        keyCredentialId: b.schlüsselId,
        onPickup: true,
      },
    });

    const run = await b.application.runtime.orchestrator.runJobNow('krypto', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS);

    const amZiel = await abgelegt(b.eingang);
    assert.equal(amZiel.name, 'ORDER_001.csv.enc');
    assert.equal(amZiel.klartext, false, 'am Ziel liegt Klartext, obwohl Geheimtext gemeint war');
  } finally {
    await b.abbauen();
  }
});

test('verschlüsselt geholt und entschlüsselt abgelegt', async () => {
  // Der Fall fürs Konsolidieren: Über die Leitung geht nichts Lesbares, am
  // Ziel liegt es offen, weil dort weitergearbeitet wird.
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), KLARTEXT);
    await b.lauf({
      encryptionConfig: {
        enabled: false,
        provider: 'AES_256_GCM',
        keyCredentialId: b.schlüsselId,
        onPickup: true,
      },
    });

    const run = await b.application.runtime.orchestrator.runJobNow('krypto', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS);

    const amZiel = await abgelegt(b.eingang);
    assert.equal(amZiel.name, 'ORDER_001.csv');
    assert.equal(amZiel.inhalt.toString(), KLARTEXT);
  } finally {
    await b.abbauen();
  }
});

test('offen geholt und verschlüsselt abgelegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), KLARTEXT);
    await b.lauf({
      encryptionConfig: {
        enabled: true,
        provider: 'AES_256_GCM',
        keyCredentialId: b.schlüsselId,
        onPickup: false,
      },
    });

    const run = await b.application.runtime.orchestrator.runJobNow('krypto', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS);

    const amZiel = await abgelegt(b.eingang);
    assert.equal(amZiel.name, 'ORDER_001.csv.enc');
    assert.equal(amZiel.klartext, false);

    // Und der Geheimtext ist keiner, wenn er sich nicht wieder öffnen lässt.
    const wieder = path.join(b.quelle, 'wieder-offen.csv');
    await new Aes256GcmEncryptionProvider().decrypt(
      path.join(b.eingang, amZiel.name),
      wieder,
      SCHLUESSEL
    );
    assert.equal(await fs.readFile(wieder, 'utf8'), KLARTEXT);
  } finally {
    await b.abbauen();
  }
});

test('verschlüsselt geliefert und entschlüsselt abgelegt', async () => {
  // Die Quelle liefert Geheimtext, den ein Absender mit unserem Schlüssel
  // erzeugt hat. Am Ziel soll er offen liegen.
  const b = await bühne();

  try {
    const offen = path.join(b.quelle, 'klar.csv');
    await fs.writeFile(offen, KLARTEXT);
    await new Aes256GcmEncryptionProvider().encrypt(offen, path.join(b.quelle, 'ORDER_001.csv'), SCHLUESSEL);
    await fs.rm(offen);

    await b.lauf({
      sourceEncryption: { enabled: true, keyCredentialId: b.schlüsselId },
      encryptionConfig: { enabled: false, provider: 'NONE' },
    });

    const run = await b.application.runtime.orchestrator.runJobNow('krypto', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS, JSON.stringify(run));

    const amZiel = await abgelegt(b.eingang);
    assert.equal(amZiel.inhalt.toString(), KLARTEXT);
  } finally {
    await b.abbauen();
  }
});

