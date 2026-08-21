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
import type { ShareAccessProvider } from '../transfer/ShareAccessProvider.js';
import type { ShareConnectionService } from '../../infrastructure/filesystem/ShareConnectionService.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import type { FeatureSet } from '../../domain/licensing/Feature.js';
import type { RunGate } from '../../domain/licensing/Licence.js';
import type { RunControlRegistry } from '../transfer/RunControlRegistry.js';
import type { ProcessingStageRegistry } from '../processing/ProcessingStageRegistry.js';
import type { RetentionService } from '../retention/RetentionService.js';
import type { Konsolidierungsumgebung } from '../workflow/WorkflowExecutionService.js';
import { WorkflowExecutionService } from '../workflow/WorkflowExecutionService.js';
import { ausgeblieben, type Versaeumnis } from '../../domain/scheduling/Ausbleiben.js';
import { RuntimeBootstrapService } from './RuntimeBootstrapService.js';

export interface RuntimeOptions {
  transferFileRepository?: TransferFileRepository;
  runRepository?: TransferRunRepository;
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Supplies source adapters including their resolved credentials. */
  adapterProvider?: SourceAdapterProvider;
  /** Dasselbe für die Zielseite; fehlt es, schreibt jeder Lauf ins Dateisystem. */
  destinationProvider?: DestinationAdapterProvider;
  /** Verbindet Freigaben mit eigenem Zugang; fehlt es, gilt die Identität des Dienstes. */
  shares?: ShareConnectionService;
  shareAccess?: ShareAccessProvider;
  stagingRoot?: string;
  events?: TransferEventListener;
  /** Which modules this installation may use; defaults to all of them. */
  features?: FeatureSet;
  /** Stages behind STEP_1_COMPLETED; absent means Step 1 alone. */
  processingStages?: ProcessingStageRegistry;
  /** Deletes expired log and history entries once a day; absent means never. */
  retentionService?: RetentionService;
  /**
   * Räumt die Ausleitungen des Konfliktbestands nach Frist fort (SPEC-07 §5);
   * fehlt sie, bleibt jede Ausleitung liegen.
   */
  ausleitungen?: { bereinige(optionen: { jetzt?: Date }): Promise<unknown> };
  /** Asked before any transfer starts; absent means the paid period is not checked. */
  runGate?: RunGate;
  /** Makes running transfers steerable; absent means they only run to the end. */
  runControls?: RunControlRegistry;
  /**
   * Was der Lauf nach dem Uebertragen tut.
   *
   * Fehlt sie, endet ein Lauf mit dem ersten Glied — so lief das Erzeugnis,
   * solange die Konsolidierung nur ueber die Schnittstelle zu erreichen war.
   * Ein Workflow mit eingeschaltetem Konsolidierungsschritt liefe dann still
   * ohne ihn, und genau das war der offene Punkt.
   */
  konsolidierung?: Konsolidierungsumgebung;
  /**
   * Wer erfährt, dass ein Termin verstrichen ist, ohne dass etwas geschah.
   *
   * Fehlt sie, wird nicht nachgesehen — dann meldet sich eine ausgebliebene
   * Verarbeitung überhaupt nicht, und das ist genau die Lücke, die es zu
   * schließen galt.
   */
  terminwache?: (versaeumt: Versaeumnis[]) => Promise<void>;
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
  private readonly ausleitungen?: { bereinige(optionen: { jetzt?: Date }): Promise<unknown> };

  readonly orchestrator: TransferOrchestratorService;
  readonly bootstrap: RuntimeBootstrapService;
  private readonly jobRepository: TransferJobRepository;
  private readonly terminwache?: (versaeumt: Versaeumnis[]) => Promise<void>;

  constructor(jobRepository: TransferJobRepository, options: RuntimeOptions = {}) {
    this.jobRepository = jobRepository;
    this.terminwache = options.terminwache;
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
      shares: options.shares,
      shareAccess: options.shareAccess,
    });

    /*
     * Die Konsolidierung legt sich **um** die Uebertragung und ersetzt sie
     * nicht: Zeitplan, Doppellaufsperre und Lauf-Eintrag bleiben beim
     * Orchestrator, der davon nichts wissen muss.
     */
    const uebertragung = new JobExecutionService(
      jobRepository,
      transferExecutionService,
      options.adapterProvider,
      options.runGate
    );

    this.orchestrator = new TransferOrchestratorService(
      jobRepository,
      options.konsolidierung
        ? new WorkflowExecutionService(uebertragung, options.konsolidierung)
        : uebertragung,
      runRepository,
      undefined,
      options.runGate,
      options.runControls
    );
    this.bootstrap = new RuntimeBootstrapService(jobRepository);
    this.retentionService = options.retentionService;
    this.ausleitungen = options.ausleitungen;
  }

  /** Rebuilds the schedules and performs one scheduler tick. */
  async start(now: Date = new Date()): Promise<SchedulerTickResult> {
    await this.bootstrap.reconstructSchedules(now);
    return this.runOnce(now);
  }

  async runOnce(now: Date = new Date()): Promise<SchedulerTickResult> {
    await this.pruefeVersaeumnisse(now);

    const result = await this.orchestrator.runDueJobs(now);
    await this.applyRetentionOncePerDay(now);

    return result;
  }

  /**
   * Zuerst nachsehen, was verpasst wurde — dann arbeiten.
   *
   * In dieser Reihenfolge, weil der Tick die versäumten Termine gleich darauf
   * nachholt und `nextExecutionAt` weiterstellt. Danach wäre die Spur fort, und
   * ein Ausfall der ganzen Nacht sähe aus wie ein Lauf, der ein bisschen spät
   * war.
   *
   * Ein Fehler hier hält den Zeitplan nicht auf. Eine Meldung über einen
   * ausgebliebenen Lauf ist wichtig; sie zum Anlass zu nehmen, auch die
   * übrigen Läufe ausfallen zu lassen, wäre grotesk.
   */
  private async pruefeVersaeumnisse(now: Date): Promise<void> {
    if (!this.terminwache) {
      return;
    }

    try {
      const versaeumt = ausgeblieben(await this.jobRepository.list(), now);

      if (versaeumt.length > 0) {
        await this.terminwache(versaeumt);
      }
    } catch (error) {
      console.error('Terminwache failed:', error instanceof Error ? error.message : String(error));
    }
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

    if ((!this.retentionService && !this.ausleitungen) || this.retentionAppliedOn === today) {
      return;
    }

    this.retentionAppliedOn = today;

    try {
      await this.retentionService?.apply(now);
    } catch (error) {
      console.error('Retention failed:', error instanceof Error ? error.message : String(error));
    }

    /*
     * Eigener Versuch: Die Ausleitungen sind Dateien, die Aufbewahrung der
     * Protokolle ist Datenbankarbeit. Scheitert das eine, soll das andere
     * trotzdem laufen — sonst hängt das Forträumen der Konfliktdateien an einer
     * gesperrten Datenbank.
     */
    try {
      await this.ausleitungen?.bereinige({ jetzt: now });
    } catch (error) {
      console.error('Bereinigung der Ausleitungen fehlgeschlagen:', error instanceof Error ? error.message : String(error));
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
