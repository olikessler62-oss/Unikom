import type { RunGate } from '../../domain/licensing/Licence.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { transfers } from '../../domain/transfer/WorkflowStages.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { SourceAdapterProvider } from './SourceAdapterProvider.js';
import {
  TransferExecutionService,
  type TransferExecutionOptions,
  type TransferRunResult,
} from './TransferExecutionService.js';

/**
 * Resolves a job, builds its source adapter and hands both to the one shared
 * pipeline. Scheduler, UI, CLI and API all enter here, so there is no separate
 * transfer logic for manual and automatic runs (spec section 28).
 *
 * It also owns the adapter's lifetime: whatever happens during the run, the
 * network connection is closed again.
 */
export class JobExecutionService {
  private readonly transferExecutionService: TransferExecutionService;

  constructor(
    private readonly jobRepository: TransferJobRepository,
    transferExecutionService?: TransferExecutionService,
    private readonly adapterProvider: SourceAdapterProvider = new SourceAdapterProvider(),
    /** The last gate in front of a transfer; absent means nothing to ask. */
    private readonly runGate?: RunGate
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
    // Checked again here, not only where the run is recorded: this is the one
    // path every caller takes, and a paid period that is over must not be able
    // to move data because some new entry point forgot to ask. Before the
    // adapter, so an expired licence opens no connection at all.
    await this.runGate?.assertMayRun(options.now);

    // A workflow that does not fetch gets no adapter at all. Building one would
    // open a connection nothing uses — and would demand the remote-sources
    // module from a customer whose job never leaves the local disk, because the
    // source fields still hold whatever was last typed into them.
    let adapter;

    try {
      adapter = transfers(job) ? await this.adapterProvider.forJob(job) : undefined;
    } catch (error) {
      /*
       * Hier scheitert das Holen, bevor es angefangen hat: ein Modul, das die
       * Installation nicht hat, ein gelöschter Zugang, einer, der einem anderen
       * Mandanten gehört. Die Ausnahme flog bisher am Lauf vorbei — in der
       * Historie stand „fehlgeschlagen" und im Protokoll nichts, und genau diese
       * Gründe sind die, die jemand lesen muss.
       *
       * Also wird daraus ein gewöhnlicher Lauf mit Begründung, statt eines
       * Fehlers, den nur die Konsole sieht.
       */
      return this.transferExecutionService.execute(job, undefined, {
        ...options,
        sourceProblem: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      return await this.transferExecutionService.execute(job, adapter, options);
    } finally {
      await adapter?.dispose?.();
    }
  }
}
