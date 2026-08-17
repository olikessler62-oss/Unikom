import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  allFeatures,
  noModules,
  transferOnly,
  FeatureNotLicensedError,
  StaticFeatureSet,
} from '../../domain/licensing/Feature.js';
import { assertJobIsLicensed, requiredFeaturesFor } from './JobLicensing.js';
import { SourceAdapterProvider } from '../transfer/SourceAdapterProvider.js';
import { TransferJobService } from '../transfer/TransferJobService.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { createInMemoryApplication } from '../runtime/UnikomApplication.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { FileTransferStatus } from '../../domain/transfer/TransferRun.js';

const localJob = createTransferJob();

const sftpJob = createTransferJob({
  id: 'job-sftp',
  name: 'Customer B Orders',
  sourceType: 'SFTP',
  sourceConfig: { type: 'SFTP', host: 'sftp.example.com', port: 22, directory: '/out' },
});

const encryptingJob = createTransferJob({
  id: 'job-encrypted',
  encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'key-1' },
});

test('moving files is a module of its own, and an installation without it may not', () => {
  // It used to be the free base product. That only held while every other module
  // was an addition to it; once consolidation can be bought alone, giving the
  // transfer away would hand over the module that carries the rest.
  assert.deepEqual(requiredFeaturesFor(localJob), ['TRANSFER']);

  assert.throws(() => assertJobIsLicensed(localJob, noModules()), FeatureNotLicensedError);
  assertJobIsLicensed(localJob, transferOnly());
});

test('a remote source and an encrypted destination each name their module', () => {
  assert.deepEqual(requiredFeaturesFor(sftpJob), ['REMOTE_SOURCES', 'TRANSFER']);
  assert.deepEqual(requiredFeaturesFor(encryptingJob), ['ENCRYPTION', 'TRANSFER']);
});

test('SFTP and FTPS belong to the same module', () => {
  const ftpsJob = createTransferJob({
    sourceType: 'FTPS',
    sourceConfig: { type: 'FTPS', host: 'ftps.example.com', port: 990, directory: '/out' },
  });
  // Remote access is a capability inside the transfer, not a product beside it:
  // it needs both, and neither alone is enough.
  const remote = new StaticFeatureSet(['REMOTE_SOURCES', 'TRANSFER']);

  assertJobIsLicensed(sftpJob, remote);
  assertJobIsLicensed(ftpsJob, remote);

  assert.throws(
    () => assertJobIsLicensed(sftpJob, new StaticFeatureSet(['REMOTE_SOURCES'])),
    FeatureNotLicensedError
  );
});

test('saving a job without its module fails with the module named', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository(), noModules());

  await assert.rejects(
    () => service.create(sftpJob),
    (error: unknown) => {
      assert.ok(error instanceof FeatureNotLicensedError);
      assert.equal(error.feature, 'REMOTE_SOURCES');
      assert.match(error.message, /Entfernte Quellen \(SFTP, FTPS\)/);
      return true;
    }
  );
});

test('an update is checked against the merged job, not the patch', async () => {
  const repository = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repository, transferOnly());
  await service.create(localJob);

  // Switching the source over arrives as two unremarkable field changes.
  await assert.rejects(
    () =>
      service.update(localJob.id, {
        sourceType: 'SFTP',
        sourceConfig: { type: 'SFTP', host: 'sftp.example.com', port: 22, directory: '/out' },
      }),
    FeatureNotLicensedError
  );

  const stored = await repository.getById(localJob.id);
  assert.equal(stored?.sourceType, 'LOCAL', 'the rejected change must not have been written');
});

test('jobs that a downgrade left unrunnable can be named', async () => {
  const repository = new InMemoryTransferJobRepository();
  // Saved while the module was still licensed, hence past the service.
  await repository.save(localJob);
  await repository.save(sftpJob);

  const unlicensed = await new TransferJobService(repository, transferOnly()).listUnlicensed();

  assert.equal(unlicensed.length, 1);
  assert.equal(unlicensed[0].job.id, 'job-sftp');
  assert.deepEqual(unlicensed[0].missing, ['REMOTE_SOURCES']);
});

test('no remote adapter is built without the module, even for a stored job', async () => {
  const provider = new SourceAdapterProvider(undefined, noModules());

  await assert.rejects(() => provider.forJob(sftpJob), FeatureNotLicensedError);
  // The base product still works.
  await provider.forJob(localJob);
});

test('with the module the adapter is built as before', async () => {
  const adapter = await new SourceAdapterProvider(undefined, allFeatures()).forJob(sftpJob);

  assert.ok(adapter);
});

test('an unlicensed encryption refuses instead of storing in the clear', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-licence-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    features: noModules(),
    encryptionKeyProvider: { getKey: async () => 'a-passphrase-for-the-test' },
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-a',
      sourceDirectory,
      destinationDirectory,
      encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'key-1' },
    })
  );

  await application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const [record] = await application.transferFileRepository.listByJob('customer-a');
  assert.equal(record.status, FileTransferStatus.FAILED);
  assert.match(record.errorMessage ?? '', /Verschlüsselte Ablage/);

  // The decisive part: nothing reached the destination, least of all plaintext.
  assert.deepEqual(await fs.readdir(destinationDirectory).catch(() => []), []);
});
