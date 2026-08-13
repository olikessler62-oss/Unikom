import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

export class InMemoryTransferJobRepository implements TransferJobRepository {
  private readonly jobs = new Map<string, TransferJob>();

  async list(): Promise<TransferJob[]> {
    return [...this.jobs.values()];
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return this.jobs.get(id);
  }

  async save(job: TransferJob): Promise<TransferJob> {
    this.jobs.set(job.id, { ...job, updatedAt: new Date() });
    return this.jobs.get(job.id)!;
  }

  async delete(id: string): Promise<void> {
    this.jobs.delete(id);
  }
}
