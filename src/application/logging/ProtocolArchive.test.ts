import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { randomBytes } from 'node:crypto';

import { createInMemoryApplication, createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { ProtocolArchive } from './ProtocolArchive.js';
import { RunProtocolWriter } from './RunProtocolWriter.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { LogEntry } from '../../domain/logging/LogEntry.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';

/**
 * Das Ablegen ist für den Lauf gedacht, dem niemand zusieht. Geprüft wird
 * deshalb vor allem, was dabei schiefgehen darf und was nicht: Ein Workflow,
 * der nichts eingeschaltet hat, legt nichts ab; ein voller Datenträger lässt
 * einen gelungenen Lauf nicht scheitern.
 */

const RUN: RunDetail = {
  runId: 'TR-8f2c',
  jobId: 'kunde-a',
  jobName: 'Kunde A – Bestellungen',
  status: TransferRunStatus.SUCCESS,
  startedAt: new Date('2026-08-17T03:45:00.000Z'),
  completedAt: new Date('2026-08-17T03:45:10.000Z'),
  durationMs: 10_000,
  filesFound: 1,
  filesProcessed: 1,
  filesSucceeded: 1,
  filesSkipped: 0,
  filesFailed: 0,
  files: [],
  logs: [],
};

function entry(message: string): LogEntry {
  return { timestamp: new Date('2026-08-17T03:45:01.000Z'), level: 'INFO', message, runId: RUN.runId };
}

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'unikom-archiv-'));
}

test('das Protokoll landet nach Jahr und Monat sortiert', async () => {
  const root = await workspace();
  const archive = new ProtocolArchive(root);

  const written = await archive.save(RUN, [entry('eine Zeile')]);

  // Ein flaches Verzeichnis hätte nach zwei Jahren zwanzigtausend Dateien.
  assert.match(written.path.replace(/\\/g, '/'), /protokolle\/2026\/08\/Kunde-A-Bestellungen_.*\.log$/);
  assert.match(await fs.readFile(written.path, 'utf8'), /Unikom — Laufprotokoll/);
});

test('ein eigenes Verzeichnis wird benutzt, wenn der Workflow eines nennt', async () => {
  const root = await workspace();
  const eigenes = path.join(root, 'P-Laufwerk');

  const written = await new ProtocolArchive(root).save(RUN, [entry('x')], eigenes);

  assert.equal(written.path.startsWith(eigenes), true, written.path);
});

test('zu alte Protokolle werden weggeräumt, jüngere nicht', async () => {
  const root = await workspace();
  const archive = new ProtocolArchive(root);

  const alt = await archive.save({ ...RUN, startedAt: new Date('2026-01-05T02:00:00.000Z'), runId: 'TR-alt' }, [
    entry('alt'),
  ]);
  const neu = await archive.save(RUN, [entry('neu')]);

  const deleted = await archive.prune(new Date('2026-06-01T00:00:00.000Z'));

  assert.equal(deleted, 1);
  assert.equal(await exists(alt.path), false);
  assert.equal(await exists(neu.path), true);
});

test('leergeräumte Monats- und Jahresordner bleiben nicht zurück', async () => {
  const root = await workspace();
  const archive = new ProtocolArchive(root);
  await archive.save({ ...RUN, startedAt: new Date('2026-01-05T02:00:00.000Z') }, [entry('alt')]);

  await archive.prune(new Date('2026-06-01T00:00:00.000Z'));

  assert.equal(await exists(path.join(root, 'protokolle', '2026', '01')), false);
  assert.equal(await exists(path.join(root, 'protokolle', '2026')), false);
});

test('ein Lauf ohne eine einzige Zeile hinterlässt keine leere Datei', async () => {
  const root = await workspace();
  const writer = new RunProtocolWriter({ list: async () => [], deleteOlderThan: async () => 0 }, new ProtocolArchive(root));

  const written = await writer.write(createTransferJob({ saveProtocol: true }), {
    id: 'TR-leer',
    jobId: 'kunde-a',
    status: TransferRunStatus.SUCCESS_NO_FILES,
    startedAt: new Date(),
    filesFound: 0,
    filesProcessed: 0,
    filesSucceeded: 0,
    filesSkipped: 0,
    filesFailed: 0,
  });

  assert.equal(written, undefined);
  assert.equal(await exists(path.join(root, 'protokolle')), false);
});

test('ohne die Einstellung wird nichts abgelegt', async () => {
  const root = await workspace();
  const source = path.join(root, 'quelle');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'kunde;betrag\nA;1\n');

  const application = createInMemoryApplication({ stagingRoot: path.join(root, 'application-data') });
  await application.jobRepository.save(
    createTransferJob({
      id: 'kunde-a',
      sourceDirectory: source,
      destinationDirectory: path.join(root, 'ziel'),
      minimumFileAgeSeconds: 0,
      stabilityCheck: {
        enabled: false,
        intervalSeconds: 0,
        requiredStableChecks: 0,
        compareSize: false,
        compareLastModified: false,
      },
    })
  );

  await application.runtime.orchestrator.runJobNow('kunde-a', new Date());

  assert.equal(await exists(path.join(root, 'protokolle')), false, 'voreingestellt wird nichts geschrieben');
  application.close();
});

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false
  );
}

test('ein eingeschalteter Workflow legt sein Protokoll nach dem Lauf ab', async () => {
  // Der ganze Weg: Lauf, Memo, Datei — mit der dauerhaften Verdrahtung, denn
  // nur die hat ein Datenverzeichnis.
  const root = await workspace();
  const source = path.join(root, 'quelle');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'kunde;betrag\nA;1\n');

  const application = createPersistentApplication(root, {
    masterKeyProvider: new StaticMasterKeyProvider(randomBytes(32)),
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'kunde-a',
      name: 'Kunde A – Bestellungen',
      sourceDirectory: source,
      destinationDirectory: path.join(root, 'ziel'),
      saveProtocol: true,
      minimumFileAgeSeconds: 0,
      stabilityCheck: {
        enabled: false,
        intervalSeconds: 0,
        requiredStableChecks: 0,
        compareSize: false,
        compareLastModified: false,
      },
    })
  );

  const run = await application.runtime.orchestrator.runJobNow('kunde-a', new Date());
  assert.equal(run?.filesSucceeded, 1);

  const monat = String(new Date().getMonth() + 1).padStart(2, '0');
  const verzeichnis = path.join(root, 'protokolle', String(new Date().getFullYear()), monat);
  const [abgelegt] = await fs.readdir(verzeichnis);

  assert.match(abgelegt, /^Kunde-A-Bestellungen_.*\.log$/);

  const text = await fs.readFile(path.join(verzeichnis, abgelegt), 'utf8');
  assert.match(text, /Workflow {4}Kunde A – Bestellungen/);
  assert.match(text, /ORDER_001\.csv/);
  assert.match(text, /Keine Fehler, keine Warnungen\./);

  application.close();
});

test('eine unbeschreibbare Ablage lässt den Lauf nicht scheitern', async () => {
  // Ein voller Datenträger im Protokollverzeichnis wäre ein schlechter Grund,
  // eine gelungene Übertragung als Fehler zu melden.
  const root = await workspace();
  const source = path.join(root, 'quelle');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'kunde;betrag\nA;1\n');

  // Eine Datei dort, wo das Protokollverzeichnis hinsoll: Das Anlegen scheitert.
  const gesperrt = path.join(root, 'gesperrt');
  await fs.writeFile(gesperrt, 'keine Ablage, sondern eine Datei');

  const application = createPersistentApplication(root, {
    masterKeyProvider: new StaticMasterKeyProvider(randomBytes(32)),
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'kunde-a',
      sourceDirectory: source,
      destinationDirectory: path.join(root, 'ziel'),
      saveProtocol: true,
      protocolDirectory: gesperrt,
      minimumFileAgeSeconds: 0,
      stabilityCheck: {
        enabled: false,
        intervalSeconds: 0,
        requiredStableChecks: 0,
        compareSize: false,
        compareLastModified: false,
      },
    })
  );

  const run = await application.runtime.orchestrator.runJobNow('kunde-a', new Date());

  assert.equal(run?.status, 'SUCCESS');
  assert.equal(run?.filesSucceeded, 1);
  application.close();
});
