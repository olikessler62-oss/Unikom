import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { INSTALLED_LICENCE } from '../../domain/installation/InstallationState.js';
import { LicenceExpiredError, type Licence } from '../../domain/licensing/Licence.js';
import { encodeLicencePayload } from '../../domain/licensing/LicenceDocument.js';
import { generateLicenceKeyPair, signLicence } from '../../infrastructure/licensing/LicenceSigning.js';
import { InMemoryInstallationStateRepository } from '../../infrastructure/persistence/InMemoryInstallationStateRepository.js';
import { createInMemoryApplication } from '../runtime/UnikomApplication.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { LicenceService } from './LicenceService.js';

/**
 * These tests are written around what must *not* happen: a period that is over
 * must not move data, a signature that does not hold must not be believed, and
 * a clock set backwards must not revive either.
 */

const vendor = generateLicenceKeyPair();
const NOW = new Date('2026-08-14T10:00:00.000Z');

function at(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

function licenceText(validUntil: Date, overrides: Partial<Licence> = {}, key = vendor.privateKey): string {
  return signLicence(
    {
      id: 'LIC-TEST',
      customer: 'Test GmbH',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      validUntil,
      features: ['REMOTE_SOURCES'],
      warningDays: 14,
      ...overrides,
    },
    key
  );
}

function serviceWith(): { service: LicenceService; state: InMemoryInstallationStateRepository } {
  const state = new InMemoryInstallationStateRepository();

  return { service: new LicenceService(state, { publicKey: vendor.publicKey }), state };
}

test('a licence in force names the modules that were paid for', async () => {
  const { service } = serviceWith();

  const status = await service.install(licenceText(at(60)), NOW);

  assert.equal(status.state, 'ACTIVE');
  assert.equal(status.mayRun, true);
  assert.equal(status.licence?.customer, 'Test GmbH');
  assert.deepEqual(service.features().enabled(), ['REMOTE_SOURCES']);
});

test('the last days are announced, and they still run', async () => {
  const { service } = serviceWith();

  const status = await service.install(licenceText(at(5)), NOW);

  assert.equal(status.state, 'EXPIRING');
  assert.equal(status.mayRun, true, 'warning is not a lockout');
  assert.equal(status.daysRemaining, 5);
  assert.match(status.problem ?? '', /endet am/);
});

test('without a public key nothing is checked and everything runs', async () => {
  const service = new LicenceService(new InMemoryInstallationStateRepository());

  const status = await service.refresh(NOW);

  assert.equal(status.state, 'UNLICENSED');
  assert.equal(status.mayRun, true);
  assert.ok(service.features().enabled().length > 0, 'development keeps every module');
});

test('an expected but absent licence stops runs rather than assuming the best', async () => {
  const { service } = serviceWith();

  const status = await service.refresh(NOW);

  assert.equal(status.state, 'MISSING');
  assert.equal(status.mayRun, false);
});

test('a licence whose content was edited does not hold', async () => {
  const { service } = serviceWith();
  const [prefix, , signature] = licenceText(at(30)).split('.');

  // The signature of the real licence, over a period somebody granted themselves.
  const forged = [
    prefix,
    encodeLicencePayload({
      id: 'LIC-TEST',
      customer: 'Test GmbH',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: at(4000),
      features: ['REMOTE_SOURCES'],
      warningDays: 14,
    }),
    signature,
  ].join('.');

  await assert.rejects(() => service.install(forged, NOW), /Signatur/);
  assert.equal(service.current().state, 'MISSING', 'a rejected licence must not be stored');
});

test('a licence signed with somebody else’s key does not hold', async () => {
  const { service } = serviceWith();
  const stranger = generateLicenceKeyPair();

  await assert.rejects(() => service.install(licenceText(at(30), {}, stranger.privateKey), NOW), /Signatur/);
});

test('an expired licence is not accepted and leaves the working one in place', async () => {
  const { service, state } = serviceWith();
  await service.install(licenceText(at(30)), NOW);

  await assert.rejects(() => service.install(licenceText(at(-1)), NOW), /abgelaufen|endete/);

  const stored = await state.get(INSTALLED_LICENCE);
  assert.equal(stored, licenceText(at(30)), 'the licence in force stays');
  assert.equal((await service.refresh(NOW)).state, 'ACTIVE');
});

test('setting the clock back does not revive an expired licence', async () => {
  const { service } = serviceWith();
  await service.install(licenceText(at(10)), NOW);

  // A day past the end: the installation notices and remembers this moment.
  assert.equal((await service.refresh(at(11))).state, 'EXPIRED');

  // Now the machine's clock goes back to a date the licence still covered.
  const afterTampering = await service.refresh(NOW);

  assert.equal(afterTampering.state, 'EXPIRED');
  assert.equal(afterTampering.mayRun, false);
});

test('the licence that reaches furthest wins, whichever way it arrived', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-licence-period-'));
  const licenceFile = path.join(root, 'unikom.licence');
  await fs.writeFile(licenceFile, `${licenceText(at(3))}\n`, 'utf8');

  const state = new InMemoryInstallationStateRepository();
  const service = new LicenceService(state, { publicKey: vendor.publicKey, licenceFile });

  // The file alone would be in its final days.
  assert.equal((await service.refresh(NOW)).state, 'EXPIRING');

  // Renewed through the interface, without anybody touching the server.
  const renewed = await service.install(licenceText(at(400)), NOW);

  assert.equal(renewed.state, 'ACTIVE');
  assert.equal(renewed.daysRemaining, 400);
});

test('a line-wrapped licence from an e-mail is still read', async () => {
  const { service } = serviceWith();
  const wrapped = licenceText(at(30)).replace(/(.{40})/g, '$1\n');

  assert.equal((await service.install(wrapped, NOW)).state, 'ACTIVE');
});

test('once the paid period is over, no transfer starts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-licence-run-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  const licenceFile = path.join(root, 'unikom.licence');

  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');
  await fs.writeFile(licenceFile, licenceText(at(-1)), 'utf8');

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    licence: { publicKey: vendor.publicKey, licenceFile },
  });

  await application.jobRepository.save(
    createTransferJob({ id: 'job-1', sourceDirectory, destinationDirectory })
  );

  await assert.rejects(
    () => application.runtime.orchestrator.runJobNow('job-1', NOW),
    (error: unknown) => {
      assert.ok(error instanceof LicenceExpiredError);
      assert.match(error.message, /Übertragungen starten erst wieder/);
      return true;
    }
  );

  assert.deepEqual(await fs.readdir(destinationDirectory), [], 'nothing may have been written');
  assert.deepEqual(await application.transferFileRepository.listByJob('job-1'), []);
  application.close();
});

test('the scheduler starts nothing while the period is over, and says why once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-licence-tick-'));
  const sourceDirectory = path.join(root, 'source');
  const licenceFile = path.join(root, 'unikom.licence');

  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'x\n');
  await fs.writeFile(licenceFile, licenceText(at(-1)), 'utf8');

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    licence: { publicKey: vendor.publicKey, licenceFile },
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'job-1',
      sourceDirectory,
      destinationDirectory: path.join(root, 'incoming'),
      schedule: {
        type: 'INTERVAL',
        intervalMinutes: 5,
        timezone: 'Europe/Berlin',
        missedRunPolicy: 'SKIP',
      },
    })
  );

  const result = await application.runtime.runOnce(NOW);

  assert.equal(result.started, 0);
  assert.equal(result.runs.length, 0, 'no run is recorded for an unpaid period');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Zeitraum|Lizenz/);
  application.close();
});

test('a renewed licence lets the next tick run without a restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-licence-renew-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  const licenceFile = path.join(root, 'unikom.licence');

  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');
  await fs.writeFile(licenceFile, licenceText(at(-1)), 'utf8');

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    licence: { publicKey: vendor.publicKey, licenceFile },
  });

  await application.jobRepository.save(
    createTransferJob({ id: 'job-1', sourceDirectory, destinationDirectory })
  );

  await assert.rejects(() => application.runtime.orchestrator.runJobNow('job-1', NOW), LicenceExpiredError);

  // The invoice is settled and the new licence goes in through the interface.
  await application.licenceService.install(licenceText(at(365)), NOW);
  const run = await application.runtime.orchestrator.runJobNow('job-1', NOW);

  assert.ok(run, 'the same job runs once the licence is back');
  assert.deepEqual(await fs.readdir(destinationDirectory), ['ORDER_001.csv']);
  application.close();
});
