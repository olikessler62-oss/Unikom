import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';

export class TransferJobService {
  constructor(private readonly repository: TransferJobRepository) {}

  async getAll(): Promise<TransferJob[]> {
    return this.repository.list();
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return this.repository.getById(id);
  }

  async create(job: TransferJob): Promise<TransferJob> {
    return this.repository.save(job);
  }

  async update(id: string, patch: Partial<TransferJob>): Promise<TransferJob | undefined> {
    const existing = await this.repository.getById(id);
    if (!existing) {
      return undefined;
    }

    const updated: TransferJob = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };

    return this.repository.save(updated);
  }
}
