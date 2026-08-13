import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { TransferRun } from '../../domain/transfer/TransferRunRepository.js';

export class TransferRunService {
  constructor(private readonly repository: TransferRunRepository) {}

  async create(run: TransferRun): Promise<TransferRun> {
    return this.repository.save(run);
  }

  async getById(id: string): Promise<TransferRun | undefined> {
    return this.repository.getById(id);
  }

  async list(): Promise<TransferRun[]> {
    return this.repository.list();
  }
}
