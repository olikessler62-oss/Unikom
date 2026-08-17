import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { FtpsTestServer, readTestCertificate, withFtpsRoot } from '../../testing/FtpsTestServer.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * FTPS als Ziel, geprüft an den Stellen, an denen FTP wirklich anders ist.
 *
 * Die Matrix zeigt bereits, dass eine Datei ankommt. Was hier steht, sind die
 * Unterschiede zum SFTP-Ziel, und es sind mehr, als die gemeinsame
 * Schnittstelle vermuten lässt:
 *
 * - FTP kennt kein „gibt es das?". Vorhandensein wird aus der Auflistung des
 *   übergeordneten Verzeichnisses beantwortet — die einzige Frage, die ein
 *   FTP-Server verlässlich beherrscht.
 * - Die Änderungszeit heißt anders und kommt in einer anderen Genauigkeit, was
 *   für das Wegräumen alter Arbeitsdateien zählt.
 * - Die Datenverbindung ist eine zweite Verbindung. Was bei SFTP ein Kanal ist,
 *   sind hier zwei, und beide können einzeln scheitern.
 *
 * Ein echter Hoster wäre besser als der eigene Server. Der Zugang, der für die
 * Prüfung zur Verfügung steht, bietet allerdings kein FTPS an — auf Port 21
 * und 990 antwortet dort nichts. Bis das anders ist, prüft das hier gegen
 * einen echten FTPS-Server mit echtem TLS, nur eben einen von uns.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Ziel-Kennwort-2026';
const INHALT = Buffer.from('kunde;betrag\nA;42\n');

interface Bühne {
  application: ReturnType<typeof createPersistentApplication>;
  quelle: string;
  eingang: string;
  speichere: (overrides?: Partial<TransferJob>) => Promise<void>;
  abbauen: () => Promise<void>;
}

async function bühne(): Promise<Bühne> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ftpsziel-'));
  const quelle = path.join(workspace, 'quelle');
  await fs.mkdir(quelle, { recursive: true });

  const serverRoot = await withFtpsRoot({});
  const server = await FtpsTestServer.start({ root: serverRoot, username: USERNAME, password: PASSWORD });

  const application = createPersistentApplication(path.join(workspace, 'application-data'), {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
  });

  const zugang = await application.credentialService.create({
    name: 'FTPS-Zielserver',
    type: 'USERNAME_PASSWORD',
    username: USERNAME,
    secret: PASSWORD,
  });

  return {
    application,
    quelle,
    eingang: path.join(serverRoot, 'eingang'),
    speichere: async (overrides = {}) => {
      await application.jobRepository.save(
        createTransferJob({
          id: 'ftps',
          sourceDirectory: quelle,
          sourceConfig: { type: 'LOCAL', directory: quelle },
          destinationDirectory: '/eingang',
          destinationType: 'FTPS',
          destinationConfig: {
            type: 'FTPS',
            directory: '/eingang',
            host: '127.0.0.1',
            port: server.port,
            tls: true,
            trustedCertificate: await readTestCertificate(),
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

test('das Zielverzeichnis wird angelegt und die Datei landet vollständig darin', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere();

    const run = await b.application.runtime.orchestrator.runJobNow('ftps', new Date());

    assert.equal(run?.status, TransferRunStatus.SUCCESS);
    assert.deepEqual(await fs.readdir(b.eingang), ['ORDER_001.csv']);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
  } finally {
    await b.abbauen();
  }
});

test('eine belegte Stelle wird erkannt, obwohl FTP nicht danach fragen kann', async () => {
  // Der eigentliche Unterschied: Ohne ein „gibt es das?" muss das Vorhandensein
  // aus der Auflistung kommen. Wäre die Antwort immer „nein", würde jede Datei
  // stumm überschrieben, auch wenn „Überspringen" eingestellt ist.
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'SKIP' });
    const run = await b.application.runtime.orchestrator.runJobNow('ftps', new Date());

    assert.equal(run?.filesSkipped, 1);
    assert.equal(await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'), 'utf8'), 'die ältere Lieferung');
  } finally {
    await b.abbauen();
  }
});

test('ersetzen räumt die alte Datei weg, bevor umbenannt wird', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'OVERWRITE' });
    const run = await b.application.runtime.orchestrator.runJobNow('ftps', new Date());

    assert.equal(run?.filesSucceeded, 1);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
    assert.deepEqual(await fs.readdir(b.eingang), ['ORDER_001.csv']);
  } finally {
    await b.abbauen();
  }
});

test('eine alte Arbeitsdatei wird weggeräumt, eine frische nicht', async () => {
  // Die Änderungszeit kommt bei FTP aus der Auflistung und heißt dort anders
  // als bei SFTP. Wird sie falsch gelesen, räumt der Kehraus entweder nie auf
  // oder nimmt einem laufenden Upload die Datei weg — beides fällt hier auf.
  const b = await bühne();

  try {
    await fs.mkdir(b.eingang, { recursive: true });

    const alt = path.join(b.eingang, 'ORDER_009.csv.TR-abgebrochen.unikom-part');
    const frisch = path.join(b.eingang, 'ORDER_008.csv.TR-laeuft.unikom-part');
    await fs.writeFile(alt, 'Rest eines abgebrochenen Laufs');
    await fs.writeFile(frisch, 'ein Lauf, der gerade hochlädt');

    const vorgestern = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(alt, vorgestern, vorgestern);

    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere();

    const run = await b.application.runtime.orchestrator.runJobNow('ftps', new Date());
    assert.equal(run?.filesSucceeded, 1);

    const liegend = await fs.readdir(b.eingang);
    assert.equal(liegend.includes('ORDER_009.csv.TR-abgebrochen.unikom-part'), false, 'die alte liegt noch da');
    assert.equal(liegend.includes('ORDER_008.csv.TR-laeuft.unikom-part'), true, 'die frische wurde weggeräumt');
  } finally {
    await b.abbauen();
  }
});

test('der Lauf hinterlässt jeden Schritt der FTPS-Zielseite im Protokoll', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere({ logLevel: 'DEBUG' });

    const run = await b.application.runtime.orchestrator.runJobNow('ftps', new Date());
    const zeilen = (await b.application.logRepository.list({ runId: run!.id, limit: 10_000 })).map(
      (zeile) => zeile.message
    );

    const erwartet: [string, RegExp][] = [
      ['Auflösen des Zielpfads', /Zielverzeichnis .* wird gelesen als \/eingang/],
      ['Verbinden samt TLS-Art', /Verbindung zu 127\.0\.0\.1.*TLS, Zertifikat geprüft/],
      ['Anmeldung gelungen', /Verbunden und angemeldet über explizites TLS/],
      ['Beschreibbarkeit belegt', /ist vorhanden und beschreibbar/],
      ['Hochladen angekündigt', /Wird hochgeladen nach .*unikom-part/],
      ['Umbenennen angekündigt', /Wird umbenannt nach \/eingang\/ORDER_001\.csv/],
      ['Vollständigkeit bestätigt', /liegt vollständig/],
    ];

    for (const [was, muster] of erwartet) {
      assert.ok(
        zeilen.some((zeile) => muster.test(zeile)),
        `${was} steht nicht im Protokoll. Geschrieben wurde:\n${zeilen.join('\n')}`
      );
    }

    assert.equal(zeilen.some((zeile) => zeile.includes(PASSWORD)), false, 'das Kennwort steht im Protokoll');
  } finally {
    await b.abbauen();
  }
});
