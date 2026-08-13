import type { TransferJob } from './TransferJob.js';

export interface TransferJobRepository {
  list(): Promise<TransferJob[]>;
  getById(id: string): Promise<TransferJob | undefined>;
  save(job: TransferJob): Promise<TransferJob>;
  delete(id: string): Promise<void>;
}
