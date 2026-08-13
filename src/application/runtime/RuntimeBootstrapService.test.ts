import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { RuntimeBootstrapService } from './RuntimeBootstrapService.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { JobSchedule } from '../../domain/transfer/TransferJob.js';

const SCHEDULE: JobSchedule = {
  type: 'DAILY',
  executionTime: '06:30',
  timezone: 'Europe/Berlin',
  missedRunPolicy: 'SKIP',
};

test('schedules are reconstructed after a restart', async () => {
  const repository = new InMemoryTransferJobRepository();
  await repository.save(
    createTransferJob({
      id: 'scheduled-job',
      schedule: SCHEDULE,
      executionMode: 'AUTOMATIC',
      // Everything the previous process knew about timing is gone.
      nextExecutionAt: undefined,
      lastExecutionAt: new Date('2026-08-12T04:30:00.000Z'),
    })
  );

  const bootstrap = new RuntimeBootstrapService(repository);
  const restored = await bootstrap.reconstructSchedules(new Date('2026-08-13T05:00:00.000Z'));

  assert.equal(restored.length, 1);
  assert.equal(restored[0].nextExecutionAt?.toISOString(), '2026-08-14T04:30:00.000Z');

  const stored = await repository.getById('scheduled-job');
  assert.equal(stored?.nextExecutionAt?.toISOString(), '2026-08-14T04:30:00.000Z');
});

test('missed runs are not replayed on startup', async () => {
  const repository = new InMemoryTransferJobRepository();
  await repository.save(
    createTransferJob({
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
      executionMode: 'AUTOMATIC',
      lastExecutionAt: new Date('2026-08-13T02:00:00.000Z'),
    })
  );

  const now = new Date('2026-08-13T06:00:00.000Z');
  const [restored] = await new RuntimeBootstrapService(repository).reconstructSchedules(now);

  // Four hours of downtime must not queue up sixteen runs.
  assert.equal(restored.nextExecutionAt?.toISOString(), '2026-08-13T06:15:00.000Z');
  assert.ok((restored.nextExecutionAt?.getTime() ?? 0) > now.getTime());
});

test('disabled and manual jobs get no schedule', async () => {
  const repository = new InMemoryTransferJobRepository();
  await repository.save(createTransferJob({ id: 'disabled', schedule: SCHEDULE, enabled: false }));
  await repository.save(createTransferJob({ id: 'manual', schedule: SCHEDULE, executionMode: 'MANUAL' }));
  await repository.save(createTransferJob({ id: 'without-schedule', schedule: undefined }));

  const restored = await new RuntimeBootstrapService(repository).reconstructSchedules(new Date());

  assert.equal(restored.length, 0);
});
