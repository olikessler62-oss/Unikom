import path from 'node:path';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import { JsonFileStore, optionalDate, requiredDate } from './JsonFileStore.js';

function reviveRun(raw: Record<string, unknown>): TransferRun {
  return {
    ...(raw as unknown as TransferRun),
    startedAt: requiredDate(raw.startedAt, 'startedAt'),
    completedAt: optionalDate(raw.completedAt),
  };
}

/** Durable run history (spec sections 69-70 and 100). */
export class FileTransferRunRepository implements TransferRunRepository {
  private readonly store: JsonFileStore<TransferRun>;

  constructor(dataDirectory: string) {
    this.store = new JsonFileStore(path.join(dataDirectory, 'transfer-runs.json'), reviveRun);
  }

  async list(): Promise<TransferRun[]> {
    return this.store.readAll();
  }

  async listByJob(jobId: string): Promise<TransferRun[]> {
    return (await this.store.readAll())
      .filter((run) => run.jobId === jobId)
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  }

  async getById(id: string): Promise<TransferRun | undefined> {
    return (await this.store.readAll()).find((run) => run.id === id);
  }

  async save(run: TransferRun): Promise<TransferRun> {
    await this.store.mutate((runs) => {
      const index = runs.findIndex((existing) => existing.id === run.id);
      if (index === -1) {
        return [...runs, run];
      }

      const copy = [...runs];
      copy[index] = run;
      return copy;
    });

    return run;
  }
}
