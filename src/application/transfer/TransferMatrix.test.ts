import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { FtpsTestServer, readTestCertificate, withFtpsRoot } from '../../testing/FtpsTestServer.js';
import { findTestShare } from '../../testing/TestServerConfig.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferEvent } from './TransferEvents.js';

/**
 * Jede Herkunft mit jedem Ablageort, einmal durchgespielt.
 *
 * Ein Ziel ist in Unikom immer ein Pfad im Dateisystem — eine Windows-Freigabe
 * ist deshalb kein eigener Typ, sondern ein Pfad, der über das Netz zeigt. Ihn
 * getrennt zu prüfen lohnt trotzdem: Der Umleiter bringt eigene Sperren, eigene
 * Fehlercodes und eine Latenz mit, die im lokalen Dateisystem niemand sieht.
 *
 * Übertragen wird bewusst kein Text. Der Inhalt trägt CR, LF, ein 0x1A und ein
 * Nullbyte in der Mitte: die vier Zeichen, an denen eine Übertragung im
 * Textmodus eine Datei still verkürzt oder umschreibt. Ein CSV-Test würde das
 * überleben, und der Kunde fände es erst in der Buchhaltung.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Prüf-Kennwort-2026';
const FILENAME = 'ORDER_001.csv';

/** Der Inhalt, an dem sich eine Übertragung im Textmodus verrät. */
function payload(): Buffer {
  return Buffer.concat([
    crypto.randomBytes(2048),
    Buffer.from([0x0d, 0x0a, 0x1a, 0x00, 0x0a, 0x0d]),
    crypto.randomBytes(2048),
  ]);
}

type Application = ReturnType<typeof createPersistentApplication>;

interface StartedSource {
  /** Was der Workflow über seine Herkunft wissen muss. */
  patch: Partial<TransferJob>;
  place(name: string, bytes: Buffer): Promise<void>;
  stop(): Promise<void>;
}

interface SourceKind {
  label: string;
  needsShare: boolean;
  start(application: Application, workspace: string, share?: string): Promise<StartedSource>;
}

interface DestinationKind {
  label: string;
  needsShare: boolean;
  directory(workspace: string, share?: string): Promise<string>;
}

/** Ein eigener Ordner je Lauf, damit parallele Prüfungen sich nicht begegnen. */
function unique(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

const SOURCES: SourceKind[] = [
  {
    label: 'lokales Verzeichnis',
    needsShare: false,
    async start(_application, workspace) {
      const directory = path.join(workspace, 'quelle');
      await fs.mkdir(directory, { recursive: true });

      return {
        patch: {
          sourceType: 'LOCAL',
          sourceConfig: { type: 'LOCAL', directory },
          sourceDirectory: directory,
        },
        place: (name, bytes) => fs.writeFile(path.join(directory, name), bytes),
        stop: async () => {},
      };
    },
  },
  {
    label: 'Freigabe',
    needsShare: true,
    async start(_application, _workspace, share) {
      const directory = path.join(share!, unique('quelle'));
      await fs.mkdir(directory, { recursive: true });

      return {
        patch: {
          sourceType: 'LOCAL',
          sourceConfig: { type: 'LOCAL', directory },
          sourceDirectory: directory,
        },
        place: (name, bytes) => fs.writeFile(path.join(directory, name), bytes),
        stop: () => fs.rm(directory, { recursive: true, force: true }),
      };
    },
  },
  {
    label: 'SFTP',
    needsShare: false,
    async start(application) {
      const root = await withSftpRoot({});
      const server = await SftpTestServer.start({ root, username: USERNAME, password: PASSWORD });
      const credential = await application.credentialService.create({
        name: 'Prüfserver SFTP',
        type: 'USERNAME_PASSWORD',
        username: USERNAME,
        secret: PASSWORD,
      });

      return {
        patch: {
          sourceType: 'SFTP',
          sourceConfig: {
            type: 'SFTP',
            directory: '/',
            host: '127.0.0.1',
            port: server.port,
            hostKeyFingerprint: server.hostKeyFingerprint,
            timeoutSeconds: 15,
          },
          sourceDirectory: '/',
          credentialId: credential.id,
        },
        place: (name, bytes) => fs.writeFile(path.join(root, name), bytes),
        stop: () => server.stop(),
      };
    },
  },
  {
    label: 'FTPS',
    needsShare: false,
    async start(application) {
      const root = await withFtpsRoot({});
      const server = await FtpsTestServer.start({ root, username: USERNAME, password: PASSWORD });
      const credential = await application.credentialService.create({
        name: 'Prüfserver FTPS',
        type: 'USERNAME_PASSWORD',
        username: USERNAME,
        secret: PASSWORD,
      });

      return {
        patch: {
          sourceType: 'FTPS',
          sourceConfig: {
            type: 'FTPS',
            directory: '/',
            host: '127.0.0.1',
            port: server.port,
            tls: true,
            trustedCertificate: await readTestCertificate(),
            timeoutSeconds: 15,
          },
          sourceDirectory: '/',
          credentialId: credential.id,
        },
        place: (name, bytes) => fs.writeFile(path.join(root, name), bytes),
        stop: () => server.stop(),
      };
    },
  },
];

const DESTINATIONS: DestinationKind[] = [
  {
    label: 'lokales Verzeichnis',
    needsShare: false,
    async directory(workspace) {
      return path.join(workspace, 'ziel');
    },
  },
  {
    label: 'Freigabe',
    needsShare: true,
    async directory(_workspace, share) {
      return path.join(share!, unique('ziel'));
    },
  },
];

for (const source of SOURCES) {
  for (const destination of DESTINATIONS) {
    test(`${source.label} → ${destination.label}: die Datei kommt unversehrt an`, async (t) => {
      const share = await findTestShare();

      if ((source.needsShare || destination.needsShare) && !share) {
        // Kein Fehler: Auf einem Bauplatz ohne Freigabe muss die Prüfung grün
        // bleiben, statt eine fehlende Umgebung als Mangel zu melden.
        t.skip('keine Windows-Testfreigabe erreichbar — siehe testserver.local.example.json');
        return;
      }

      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-matrix-'));
      const events: TransferEvent[] = [];

      // Das Arbeitsverzeichnis bleibt immer lokal: Eine SQLite-Datei auf einer
      // Freigabe ist eine bekannte Art, Daten zu verlieren.
      const application = createPersistentApplication(path.join(workspace, 'application-data'), {
        masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
        events: (event) => events.push(event),
      });

      const started = await source.start(application, workspace, share);
      const destinationDirectory = await destination.directory(workspace, share);
      const bytes = payload();

      try {
        await started.place(FILENAME, bytes);

        await application.jobRepository.save(
          createTransferJob({
            id: 'matrix',
            name: `${source.label} nach ${destination.label}`,
            destinationDirectory,
            createDestinationDirectory: true,
            minimumFileAgeSeconds: 0,
            ...started.patch,
          })
        );

        const run = await application.runtime.orchestrator.runJobNow('matrix', new Date());

        assert.equal(run?.status, TransferRunStatus.SUCCESS, JSON.stringify(events.slice(-4)));
        assert.equal(run?.filesSucceeded, 1);

        const arrived = await fs.readFile(path.join(destinationDirectory, FILENAME));
        assert.equal(arrived.equals(bytes), true, 'die abgelegte Datei weicht Byte für Byte ab');

        // Die Prüfsumme steht in der Geschichte, nicht nur auf der Platte: Sie
        // ist der Beleg, mit dem später gegen den Absender argumentiert wird.
        const [registered] = await application.transferFileRepository.listByRun(run?.id ?? '');
        assert.equal(registered.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      } finally {
        application.close();
        await started.stop();
        await fs.rm(destinationDirectory, { recursive: true, force: true });
        await fs.rm(workspace, { recursive: true, force: true });
      }
    });
  }
}
