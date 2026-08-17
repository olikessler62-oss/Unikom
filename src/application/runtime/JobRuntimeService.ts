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
import type { DestinationAdapterProvider } from '../transfer/DestinationAdapterProvider.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import type { FeatureSet } from '../../domain/licensing/Feature.js';
import type { RunGate } from '../../domain/licensing/Licence.js';
import type { RunControlRegistry } from '../transfer/RunControlRegistry.js';
import type { ProcessingStageRegistry } from '../processing/ProcessingStageRegistry.js';
import type { RunProtocolWriter } from '../logging/RunProtocolWriter.js';
import type { RetentionService } from '../retention/RetentionService.js';
import { RuntimeBootstrapService } from './RuntimeBootstrapService.js';

export interface RuntimeOptions {
  transferFileRepository?: TransferFileRepository;
  runRepository?: TransferRunRepository;
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Supplies source adapters including their resolved credentials. */
  adapterProvider?: SourceAdapterProvider;
  /** Dasselbe für die Zielseite; fehlt es, schreibt jeder Lauf ins Dateisystem. */
  destinationProvider?: DestinationAdapterProvider;
  stagingRoot?: string;
  events?: TransferEventListener;
  /** Which modules this installation may use; defaults to all of them. */
  features?: FeatureSet;
  /** Stages behind STEP_1_COMPLETED; absent means Step 1 alone. */
  processingStages?: ProcessingStageRegistry;
  /** Deletes expired log and history entries once a day; absent means never. */
  retentionService?: RetentionService;
  /** Asked before any transfer starts; absent means the paid period is not checked. */
  runGate?: RunGate;
  /** Makes running transfers steerable; absent means they only run to the end. */
  runControls?: RunControlRegistry;
  /** Legt das Protokoll ab, wenn ein Workflow es verlangt; sonst geschieht nichts. */
  protocols?: RunProtocolWriter;
}

/**
 * Hosts the scheduler loop. It owns no transfer logic itself; it only ticks the
 * orchestrator, which in turn uses the shared pipeline.
 */
export class JobRuntimeService {
  private pollingTimer?: NodeJS.Timeout;
  /** Calendar day the retention last ran on, so a tick a minute does not. */
  private retentionAppliedOn?: string;
  private readonly retentionService?: RetentionService;

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
      features: options.features,
      processingStages: options.processingStages,
      destinationProvider: options.destinationProvider,
    });

    this.orchestrator = new TransferOrchestratorService(
      jobRepository,
      new JobExecutionService(jobRepository, transferExecutionService, options.adapterProvider, options.runGate),
      runRepository,
      undefined,
      options.runGate,
      options.runControls,
      options.protocols
    );
    this.bootstrap = new RuntimeBootstrapService(jobRepository);
    this.retentionService = options.retentionService;
  }

  /** Rebuilds the schedules and performs one scheduler tick. */
  async start(now: Date = new Date()): Promise<SchedulerTickResult> {
    await this.bootstrap.reconstructSchedules(now);
    return this.runOnce(now);
  }

  async runOnce(now: Date = new Date()): Promise<SchedulerTickResult> {
    const result = await this.orchestrator.runDueJobs(now);
    await this.applyRetentionOncePerDay(now);

    return result;
  }

  /**
   * Runs after the transfers, not before: a run that just finished should show
   * up in the history a user looks at, and deleting first would only ever hit
   * the same records a moment later anyway.
   *
   * A failure here must not stop the scheduler. Retention is housekeeping; a
   * full disk or a locked database is a reason to complain, not to stop
   * transferring.
   */
  private async applyRetentionOncePerDay(now: Date): Promise<void> {
    const today = now.toISOString().slice(0, 10);

    if (!this.retentionService || this.retentionAppliedOn === today) {
      return;
    }

    this.retentionAppliedOn = today;

    try {
      await this.retentionService.apply(now);
    } catch (error) {
      console.error('Retention failed:', error instanceof Error ? error.message : String(error));
    }
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
