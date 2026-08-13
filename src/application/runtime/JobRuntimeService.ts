import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { JobExecutionService } from '../transfer/JobExecutionService.js';
import { TransferExecutionService } from '../transfer/TransferExecutionService.js';
import {
  TransferOrchestratorService,
  type SchedulerTickResult,
} from '../transfer/TransferOrchestratorService.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import type { SourceAdapterProvider } from '../transfer/SourceAdapterProvider.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { RuntimeBootstrapService } from './RuntimeBootstrapService.js';

export interface RuntimeOptions {
  transferFileRepository?: TransferFileRepository;
  runRepository?: TransferRunRepository;
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Supplies source adapters including their resolved credentials. */
  adapterProvider?: SourceAdapterProvider;
  stagingRoot?: string;
  events?: TransferEventListener;
}

/**
 * Hosts the scheduler loop. It owns no transfer logic itself; it only ticks the
 * orchestrator, which in turn uses the shared pipeline.
 */
export class JobRuntimeService {
  private pollingTimer?: NodeJS.Timeout;

  readonly orchestrator: TransferOrchestratorService;
  readonly bootstrap: RuntimeBootstrapService;

  constructor(jobRepository: TransferJobRepository, options: RuntimeOptions = {}) {
    const transferFileRepository = options.transferFileRepository ?? new InMemoryTransferFileRepository();
    const runRepository = options.runRepository ?? new InMemoryTransferRunRepository();

    const transferExecutionService = new TransferExecutionService({
      transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider,
      stagingRoot: options.stagingRoot,
      events: options.events,
    });

    this.orchestrator = new TransferOrchestratorService(
      jobRepository,
      new JobExecutionService(jobRepository, transferExecutionService, options.adapterProvider),
      runRepository
    );
    this.bootstrap = new RuntimeBootstrapService(jobRepository);
  }

  /** Rebuilds the schedules and performs one scheduler tick. */
  async start(now: Date = new Date()): Promise<SchedulerTickResult> {
    await this.bootstrap.reconstructSchedules(now);
    return this.runOnce(now);
  }

  async runOnce(now: Date = new Date()): Promise<SchedulerTickResult> {
    return this.orchestrator.runDueJobs(now);
  }

  startPolling(intervalMs = 60_000): NodeJS.Timeout {
    if (this.pollingTimer) {
      return this.pollingTimer;
    }

    this.pollingTimer = setInterval(() => {
      void this.runOnce(new Date()).catch((error: unknown) => {
        console.error('Job runtime polling failed:', error instanceof Error ? error.message : String(error));
      });
    }, intervalMs);

    return this.pollingTimer;
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }
}
