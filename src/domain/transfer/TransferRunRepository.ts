import type { TransferRun } from './TransferRun.js';

export interface TransferRunRepository {
  list(): Promise<TransferRun[]>;
  listByJob(jobId: string): Promise<TransferRun[]>;
  getById(id: string): Promise<TransferRun | undefined>;
  save(run: TransferRun): Promise<TransferRun>;
}

export type { TransferRun };
