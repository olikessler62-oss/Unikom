import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { JobExecutionService } from './JobExecutionService.js';
import { TransferExecutionService } from './TransferExecutionService.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { SourceAdapterProvider } from './SourceAdapterProvider.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';

test('job execution service runs a transfer job from repository config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-jobexec-'));
  const sourceDir = path.join(tempDir, 'source');
  const destinationDir = path.join(tempDir, 'dest');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const repository = new InMemoryTransferJobRepository();
  const service = new JobExecutionService(
    repository,
    new TransferExecutionService({
      transferFileRepository: new InMemoryTransferFileRepository(),
      stagingRoot: path.join(tempDir, 'application-data'),
    })
  );

  const job: TransferJob = {
    id: 'job-1',
    tenantId: 'default',
    name: 'Local CSV Import',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDir },
    sourceDirectory: sourceDir,
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_*',
    caseSensitivePrefix: false,
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.tmp'],
    minimumFileAgeSeconds: 0,
    stabilityCheck: {
      enabled: false,
      intervalSeconds: 0,
      requiredStableChecks: 0,
      compareSize: false,
      compareLastModified: false,
    },
    destinationDirectory: destinationDir,
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: {
      enabled: false,
      provider: 'NONE',
    },
    sourceSuccessAction: 'KEEP',
    executionMode: 'AUTOMATIC',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await repository.save(job);

  const result = await service.executeById('job-1');

  assert.equal(result?.status, TransferRunStatus.SUCCESS);
  assert.equal(result?.filesSucceeded, 1);
  assert.equal(await fs.access(path.join(destinationDir, 'ORDER_001.csv')).then(() => true, () => false), true);
});

test('an unknown job id yields no run', async () => {
  const service = new JobExecutionService(new InMemoryTransferJobRepository());

  assert.equal(await service.executeById('does-not-exist'), undefined);
});

/* ---- Daten holen ---------------------------------------------------------
 *
 * Ob überhaupt geholt wird, entscheidet genau eine Zeile: der Adapter wird nur
 * gebaut, wenn das Glied „Daten übertragen" eingeschaltet ist. Die Tests unten
 * fassen nicht das Ergebnis an, sondern diese Entscheidung — denn ihr Fehlschlag
 * sähe harmlos aus. Ein Workflow, der nichts holen soll und trotzdem eine
 * Verbindung aufbaut, liefert dasselbe Ergebnis wie einer, der es richtig macht;
 * er verlangt nur nebenbei ein Modul, das der Kunde nicht gekauft hat, und
 * klopft bei einem Server an, mit dem er nichts zu tun hat.
 *
 * Deshalb ein Doppelgänger statt eines echten Verzeichnisses: Er kann sagen,
 * ob er gefragt wurde. Ein Zielverzeichnis kann das nicht.
 */

/** Ein Quelladapter, der mitschreibt, was mit ihm geschah. */
function spyAdapter(files: SourceFile[] = []) {
  const seen = { connected: 0, listed: [] as { directory: string; recursive: boolean }[], disposed: 0 };

  const adapter: SourceAdapter = {
    testConnection: async () => {
      seen.connected += 1;
      return { ok: true, message: 'Doppelgänger' };
    },
    listFiles: async (directory: string, recursive: boolean) => {
      seen.listed.push({ directory, recursive });
      return files;
    },
    downloadFile: async (file, targetPath) => ({ ok: true, message: 'kopiert', localPath: targetPath }),
    dispose: async () => {
      seen.disposed += 1;
    },
  };

  return { adapter, seen };
}

/** Ein Anbieter, der zählt, wie oft nach einer Quelle gefragt wurde. */
function spyProvider(adapter?: SourceAdapter) {
  const asked: string[] = [];

  const provider = {
    asked,
    forJob: async (job: TransferJob) => {
      asked.push(job.id);

      if (!adapter) {
        throw new Error('Es wurde eine Quelle verlangt, obwohl keine gebraucht wird');
      }

      return adapter;
    },
  } as unknown as SourceAdapterProvider;

  return { provider, asked };
}

async function runWith(job: TransferJob, provider: SourceAdapterProvider) {
  const repository = new InMemoryTransferJobRepository();
  await repository.save(job);

  const service = new JobExecutionService(
    repository,
    new TransferExecutionService({
      transferFileRepository: new InMemoryTransferFileRepository(),
      stagingRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-holen-')),
    }),
    provider
  );

  return service.executeById(job.id);
}

test('a workflow that fetches asks for its source and reads the configured directory', async () => {
  const { adapter, seen } = spyAdapter();
  const { provider, asked } = spyProvider(adapter);

  const job = createTransferJob({
    id: 'holt',
    sourceDirectory: '/eingang',
    includeSubdirectories: true,
  });

  const result = await runWith(job, provider);

  assert.deepEqual(asked, ['holt']);
  assert.equal(seen.connected, 1);
  // Genau das Verzeichnis des Jobs, und mit seiner Einstellung für Unterordner.
  assert.deepEqual(seen.listed, [{ directory: '/eingang', recursive: true }]);
  // Nichts gefunden ist kein Fehler — die Quelle war erreichbar und leer.
  assert.equal(result?.status, TransferRunStatus.SUCCESS_NO_FILES);
  assert.equal(result?.filesFound, 0);
});

test('a workflow with fetching switched off opens no connection at all', async () => {
  // Ohne Adapter: Wird trotzdem einer verlangt, wirft der Anbieter.
  const { provider, asked } = spyProvider();

  const job = createTransferJob({ id: 'holt-nicht', transfer: { enabled: false } });

  const result = await runWith(job, provider);

  assert.deepEqual(asked, [], 'Es wurde nach einer Quelle gefragt, obwohl der Workflow nichts holt');
  assert.equal(result?.status, TransferRunStatus.FAILED);
  assert.match(result!.message ?? '', /holt keine Dateien/);
});

test('a switched-off transfer holds even when a later link is switched on', async () => {
  const { provider, asked } = spyProvider();

  const job = createTransferJob({
    id: 'nur-konsolidieren',
    transfer: { enabled: false },
    consolidation: { enabled: true, input: { from: 'DIRECTORY', directory: '/eingang' } },
  });

  const result = await runWith(job, provider);

  // Das Glied ist noch nicht gebaut, also bricht der Lauf ab — aber geholt
  // wurde davor schon nichts, und das ist die Zusage.
  assert.deepEqual(asked, []);
  assert.equal(result?.status, TransferRunStatus.FAILED);
  assert.match(result!.message ?? '', /Es wurde nichts geholt/);
});

test('the connection is closed again, also when the run fails', async () => {
  const { adapter, seen } = spyAdapter();
  adapter.testConnection = async () => ({ ok: false, message: 'Quelle nicht erreichbar' });

  const { provider } = spyProvider(adapter);
  const result = await runWith(createTransferJob({ id: 'bricht-ab' }), provider);

  assert.equal(result?.status, TransferRunStatus.FAILED);
  // Ohne das bliebe nach jedem gescheiterten Lauf eine Verbindung offen, und
  // das fällt erst auf, wenn der Server keine mehr annimmt.
  assert.equal(seen.disposed, 1);
});

test('a source that cannot be built says why, instead of failing silently', async () => {
  // Genau die Fehler, die beim Holen entstehen: Modul nicht lizenziert, Zugang
  // fehlt, Zugang gehört einem anderen Mandanten. Sie entstehen, bevor die erste
  // Datei angefasst wird — und dürfen deshalb nicht anders behandelt werden als
  // eine Quelle, die nicht antwortet.
  const provider = {
    forJob: async () => {
      throw new Error('Connecting "Kunde A" to SFTP needs the module REMOTE_SOURCES');
    },
  } as unknown as SourceAdapterProvider;

  const result = await runWith(createTransferJob({ id: 'ohne-modul' }), provider);

  assert.equal(result?.status, TransferRunStatus.FAILED);
  assert.match(result?.message ?? '', /REMOTE_SOURCES/);
});
