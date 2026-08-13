import path from 'node:path';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { JsonFileStore, optionalDate, requiredDate } from './JsonFileStore.js';

function reviveJob(raw: Record<string, unknown>): TransferJob {
  return {
    ...(raw as unknown as TransferJob),
    lastExecutionAt: optionalDate(raw.lastExecutionAt),
    nextExecutionAt: optionalDate(raw.nextExecutionAt),
    createdAt: requiredDate(raw.createdAt, 'createdAt'),
    updatedAt: requiredDate(raw.updatedAt, 'updatedAt'),
  };
}

/**
 * Durable job storage. Because the schedule, lastExecutionAt and
 * nextExecutionAt are part of the record, an automatic job survives a restart
 * (spec sections 31 and 110).
 */
export class FileTransferJobRepository implements TransferJobRepository {
  private readonly store: JsonFileStore<TransferJob>;

  constructor(dataDirectory: string) {
    this.store = new JsonFileStore(path.join(dataDirectory, 'transfer-jobs.json'), reviveJob);
  }

  async list(): Promise<TransferJob[]> {
    return this.store.readAll();
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return (await this.store.readAll()).find((job) => job.id === id);
  }

  async save(job: TransferJob): Promise<TransferJob> {
    const stored: TransferJob = { ...job, updatedAt: new Date() };

    await this.store.mutate((jobs) => {
      const index = jobs.findIndex((existing) => existing.id === job.id);
      if (index === -1) {
        return [...jobs, stored];
      }

      const copy = [...jobs];
      copy[index] = stored;
      return copy;
    });

    return stored;
  }

  async delete(id: string): Promise<void> {
    await this.store.mutate((jobs) => jobs.filter((job) => job.id !== id));
  }
}
