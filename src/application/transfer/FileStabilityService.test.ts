import test from 'node:test';
import assert from 'node:assert/strict';
import { FileStabilityService, type StabilityProbe } from './FileStabilityService.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { StabilityCheckConfig } from '../../domain/transfer/TransferJob.js';

// The waiting is stubbed out so the suite does not spend the configured
// interval in real time.
const service = new FileStabilityService(async () => {});

const lastModified = new Date('2026-08-13T06:44:00.000Z');
const file: SourceFile = {
  name: 'ORDER_001.csv',
  fullPath: '/export/orders/ORDER_001.csv',
  size: 1_240_000,
  lastModified,
  isDirectory: false,
};

function config(overrides: Partial<StabilityCheckConfig> = {}): StabilityCheckConfig {
  return {
    enabled: true,
    intervalSeconds: 5,
    requiredStableChecks: 2,
    compareSize: true,
    compareLastModified: true,
    ...overrides,
  };
}

function probeReturning(...measurements: (StabilityProbe | undefined)[]) {
  let index = 0;
  return async () => measurements[Math.min(index++, measurements.length - 1)];
}

test('a disabled stability check passes without measuring', async () => {
  let probed = false;
  const result = await service.check(file, config({ enabled: false }), async () => {
    probed = true;
    return { size: file.size, lastModified };
  });

  assert.equal(result.stable, true);
  assert.equal(result.performedChecks, 0);
  assert.equal(probed, false);
});

test('an unchanged file size makes the file stable', async () => {
  const result = await service.check(file, config(), probeReturning({ size: 1_240_000, lastModified }));

  assert.equal(result.stable, true);
  assert.equal(result.performedChecks, 2);
});

test('a growing file is not stable', async () => {
  const result = await service.check(file, config(), probeReturning({ size: 1_510_000, lastModified }));

  assert.equal(result.stable, false);
  assert.match(result.message, /still being written/);
});

test('a changed modification time makes the file unstable', async () => {
  const result = await service.check(
    file,
    config(),
    probeReturning({ size: 1_240_000, lastModified: new Date(lastModified.getTime() + 5_000) })
  );

  assert.equal(result.stable, false);
});

test('a changed modification time is tolerated when the comparison is switched off', async () => {
  const result = await service.check(
    file,
    config({ compareLastModified: false }),
    probeReturning({ size: 1_240_000, lastModified: new Date(lastModified.getTime() + 5_000) })
  );

  assert.equal(result.stable, true);
});

test('a file that disappears mid-check is not stable', async () => {
  const result = await service.check(file, config(), probeReturning(undefined));

  assert.equal(result.stable, false);
  assert.match(result.message, /disappeared/);
});

test('more required checks lead to more measurements', async () => {
  let probes = 0;
  const result = await service.check(file, config({ requiredStableChecks: 4 }), async () => {
    probes += 1;
    return { size: 1_240_000, lastModified };
  });

  assert.equal(result.stable, true);
  assert.equal(result.performedChecks, 4);
  // The discovery listing counts as the first measurement.
  assert.equal(probes, 3);
});

test('a file that stabilises only after a change is rejected for this run', async () => {
  const result = await service.check(
    file,
    config({ requiredStableChecks: 3 }),
    probeReturning({ size: 1_300_000, lastModified }, { size: 1_300_000, lastModified })
  );

  assert.equal(result.stable, false);
  assert.equal(result.performedChecks, 2);
});
