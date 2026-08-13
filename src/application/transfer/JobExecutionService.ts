import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceConfig, TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { SourceAdapterFactory } from '../../infrastructure/sources/SourceAdapterFactory.js';
import { TransferExecutionService, type TransferExecutionOptions, type TransferRunResult } from './TransferExecutionService.js';

/**
 * Resolves a job and its source adapter and hands both to the one shared
 * pipeline. Scheduler, UI, CLI and API all enter here, so there is no separate
 * transfer logic for manual and automatic runs (spec section 28).
 */
export class JobExecutionService {
  private readonly transferExecutionService: TransferExecutionService;

  constructor(
    private readonly jobRepository: TransferJobRepository,
    transferExecutionService?: TransferExecutionService,
    private readonly createAdapter: (config: SourceConfig) => SourceAdapter = SourceAdapterFactory.create
  ) {
    this.transferExecutionService =
      transferExecutionService ??
      new TransferExecutionService({ transferFileRepository: new InMemoryTransferFileRepository() });
  }

  async executeById(jobId: string, options: TransferExecutionOptions = {}): Promise<TransferRunResult | undefined> {
    const job = await this.jobRepository.getById(jobId);
    if (!job) {
      return undefined;
    }

    return this.execute(job, options);
  }

  async execute(job: TransferJob, options: TransferExecutionOptions = {}): Promise<TransferRunResult> {
    const adapter = this.createAdapter(job.sourceConfig);
    return this.transferExecutionService.execute(job, adapter, options);
  }
}
