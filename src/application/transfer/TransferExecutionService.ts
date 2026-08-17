import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { DestinationAdapter } from '../../domain/destination/DestinationAdapter.js';
import { LocalDestinationAdapter } from '../../infrastructure/destinations/local/LocalDestinationAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import { DEFAULT_JOB_LOG_LEVEL, type DateNotation, type TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { RunControl } from '../../domain/transfer/RunControl.js';
import { activeStages, STAGE_LABELS } from '../../domain/transfer/WorkflowStages.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import {
  UnavailableEncryptionKeyProvider,
  type EncryptionKeyProvider,
} from '../../domain/encryption/EncryptionKeyProvider.js';
import {
  Aes256GcmEncryptionProvider,
  type EncryptionProvider as FileEncryptionProvider,
} from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { allFeatures, FeatureNotLicensedError, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { FileProcessingContext } from '../../domain/processing/FileProcessingContext.js';
import { ProcessingStageError } from '../../domain/processing/ProcessingStage.js';
import type { ProcessingStageRegistry } from '../processing/ProcessingStageRegistry.js';
import { FileSelectionService } from './FileSelectionService.js';
import { FileStabilityService } from './FileStabilityService.js';
import { FileIntegrityService } from './FileIntegrityService.js';
import { DuplicateDetectionService } from './DuplicateDetectionService.js';
import { StagingService } from './StagingService.js';
import { EncryptedPickupService } from './EncryptedPickupService.js';
import { DEFAULT_RETRY_CONFIG, RetryPolicy, type RetryAttemptInfo } from './RetryPolicy.js';
import { noopEventListener, type TransferEventListener, type TransferEventName } from './TransferEvents.js';
import type { ShareConnectionService } from '../../infrastructure/filesystem/ShareConnectionService.js';
import type { ShareAccessProvider } from './ShareAccessProvider.js';

/** System default from spec section 79; parallelism is never unbounded. */
export const DEFAULT_MAX_CONCURRENT_FILES = 3;

/**
 * Directory a file actually sits in. With `includeSubdirectories` the job's
 * source directory is not specific enough: two files of the same name in two
 * subdirectories would otherwise share one identity and the second would be
 * discarded as a duplicate of the first (spec section 40).
 */
/**
 * A failure with everything that was known about it.
 *
 * Node hangs the real reason on `cause` — a refused connection, a full disk, a
 * permission — and the message on top is usually the polite summary. Both go
 * into the log, because the summary alone sends people looking in the wrong
 * place, and a code like `EACCES` at the end of the line ends the search.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const code = (error as NodeJS.ErrnoException).code;

  if (code) {
    parts.push(`[${code}]`);
  }

  let cause = error.cause;
  // Bounded: a cycle in the chain would otherwise write until the disk is full.
  for (let depth = 0; cause instanceof Error && depth < 4; depth += 1) {
    parts.push(`← ${cause.message}`);
    cause = cause.cause;
  }

  return parts.join(' ');
}

/**
 * Warum eine Datei nicht genommen wurde, als Satz.
 *
 * Der Grund ist im Modell ein Code — er wird verglichen, gezählt und gespeichert
 * — und im Protokoll ein Satz, weil das Protokoll gelesen wird. Beides an einer
 * Stelle zu haben hieße, sich für eines von beidem zu entscheiden.
 */
const REJECTION_REASONS: Record<string, string> = {
  DIRECTORY: 'ist ein Verzeichnis',
  TEMPORARY_EXTENSION: 'trägt die Endung eines unfertigen Uploads',
  PREFIX_MISMATCH: 'passt nicht zum eingestellten Dateinamen',
  EXTENSION_MISMATCH: 'hat keine der berücksichtigten Endungen',
  AGE_UNKNOWN: 'hat keinen Zeitstempel, das Mindestalter ist nicht nachweisbar',
  TOO_YOUNG: 'ist jünger als das eingestellte Mindestalter',
};

function directoryOf(file: SourceFile, fallback: string): string {
  const separator = Math.max(file.fullPath.lastIndexOf('/'), file.fullPath.lastIndexOf('\\'));

  if (separator < 0) {
    return fallback;
  }

  return file.fullPath.slice(0, separator) || '/';
}

/**
 * The stamp a renamed file carries: `31012026_235959` where the day comes
 * first, `01312026_235959` where the month does.
 *
 * Local time, not UTC: the operator holds this name next to the run in the
 * history, and that one is shown in their own time. Two names for one moment
 * would be a puzzle to solve every time.
 *
 * The clock is 24 hours in both notations, including the American one. Twelve
 * hours would need an AM or PM to stay unambiguous, and that turns a name that
 * sorts by itself into one that needs reading.
 */
function timestampSuffix(moment: Date, notation: DateNotation = 'DAY_FIRST'): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  const day = pad(moment.getDate());
  const month = pad(moment.getMonth() + 1);
  const date = notation === 'MONTH_FIRST' ? `${month}${day}` : `${day}${month}`;

  return (
    `${date}${moment.getFullYear()}` +
    `_${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}`
  );
}

/**
 * State shared by all files of one run. The two claim sets keep concurrent
 * files from stepping on each other: without them two files with identical
 * content would both be stored, and two RENAME conflicts would pick the same
 * free name.
 */
interface RunContext {
  runId: string;
  stagingDirectory: string;
  claimedHashes: Set<string>;
  claimedDestinations: Set<string>;
  retry: RetryPolicy;
  /** The moment the run stands for — the stamp a renamed file gets. */
  startedAt: Date;
  /** Wohin dieser Lauf schreibt. Gehört dem Lauf, nicht dem Dienst. */
  destination: DestinationAdapter;
}

export interface FileOutcome {
  filename: string;
  status: FileTransferStatus;
  destinationPath?: string;
  sha256?: string;
  message: string;
}

export interface TransferRunResult {
  runId: string;
  jobId: string;
  status: TransferRunStatus;
  filesFound: number;
  filesSelected: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
  outcomes: FileOutcome[];
  message: string;
}

export interface TransferExecutionDependencies {
  transferFileRepository: TransferFileRepository;
  fileSelectionService?: FileSelectionService;
  stabilityService?: FileStabilityService;
  integrityService?: FileIntegrityService;
  duplicateDetectionService?: DuplicateDetectionService;
  stagingService?: StagingService;
  encryptionProvider?: FileEncryptionProvider;
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Root of the internal working area; `staging/<run-id>` is created below it. */
  stagingRoot?: string;
  events?: TransferEventListener;
  /** Injectable so tests do not wait out the real retry delays. */
  retryWait?: (milliseconds: number) => Promise<void>;
  /** Which modules this installation may use; defaults to all of them. */
  features?: FeatureSet;
  /** Stages that run behind STEP_1_COMPLETED; absent means Step 1 alone. */
  processingStages?: ProcessingStageRegistry;
  /**
   * Woher das Ziel eines Workflows kommt. Fehlt es, schreibt jeder Lauf ins
   * Dateisystem — so verhielt sich das Erzeugnis, bevor es entfernte Ziele gab.
   */
  destinationProvider?: OpensDestinations;
  /**
   * Stellt Freigabe-Verbindungen her, wo ein Zugang hinterlegt ist. Fehlt es,
   * werden Freigaben mit der Identität des Dienstes erreicht — so wie bisher.
   */
  shares?: ShareConnectionService;
  /** Löst die Zugänge dafür auf; ohne das bleibt `shares` wirkungslos. */
  shareAccess?: ShareAccessProvider;
}

/**
 * Das eine, was der Lauf von außen braucht, um sein Ziel zu bekommen. Als
 * Form benannt statt als Klasse, damit ein Test ein einzelnes offenes Ziel
 * hineinreichen kann statt einer Zugangsverwaltung.
 */
export interface OpensDestinations {
  forJob(job: TransferJob): Promise<DestinationAdapter>;
}

export interface TransferExecutionOptions {
  runId?: string;
  now?: Date;
  /** Lets somebody pause or cancel this run while it is under way. */
  control?: RunControl;
  /**
   * Why there is no source, when the caller already knows.
   *
   * Building the adapter happens before this service is entered — that is where
   * a missing module, a deleted credential or one belonging to another client
   * shows up. Those failures used to travel as exceptions past the run and were
   * recorded as "failed" with nothing to read. They come in through here
   * instead, so they end up in the log like every other reason a run stopped.
   */
  sourceProblem?: string;
}

/**
 * Chain links a job has switched on that this build cannot walk yet. The editor
 * already saves the wiring for steps ② and ③ — where they read, where they
 * write — while the processing itself is still being built.
 *
 * Remove an entry here the moment its engine exists; this list is the single
 * place that decides whether such a job may run.
 */
export function unbuiltStages(job: TransferJob): string[] {
  return activeStages(job)
    .filter((stage) => stage !== 'TRANSFER')
    .map((stage) => `"${STAGE_LABELS[stage]}"`);
}

/**
 * The single transfer pipeline. Scheduler, UI, CLI and API all execute through
 * this service, so manual and automatic runs behave identically (spec section 28).
 *
 * The order of steps is the one prescribed by section 76 and must not be
 * rearranged: a file only reaches its destination after it was validated and,
 * where configured, encrypted, and the source file is only touched once the
 * whole chain including persistence succeeded (section 60).
 */
export class TransferExecutionService {
  private readonly transferFileRepository: TransferFileRepository;
  private readonly fileSelectionService: FileSelectionService;
  private readonly stabilityService: FileStabilityService;
  private readonly integrityService: FileIntegrityService;
  private readonly duplicateDetectionService: DuplicateDetectionService;
  private readonly stagingService: StagingService;
  private readonly encryptionProvider: FileEncryptionProvider;
  private readonly encryptionKeyProvider: EncryptionKeyProvider;
  private readonly encryptedPickupService: EncryptedPickupService;
  private readonly stagingRoot: string;
  private readonly emit: TransferEventListener;
  private readonly retryWait?: (milliseconds: number) => Promise<void>;
  private readonly features: FeatureSet;
  private readonly processingStages?: ProcessingStageRegistry;
  private readonly destinationProvider?: OpensDestinations;
  private readonly shares?: ShareConnectionService;
  private readonly shareAccess?: ShareAccessProvider;

  constructor(dependencies: TransferExecutionDependencies) {
    this.transferFileRepository = dependencies.transferFileRepository;
    this.fileSelectionService = dependencies.fileSelectionService ?? new FileSelectionService();
    this.stabilityService = dependencies.stabilityService ?? new FileStabilityService();
    this.integrityService = dependencies.integrityService ?? new FileIntegrityService();
    this.duplicateDetectionService =
      dependencies.duplicateDetectionService ?? new DuplicateDetectionService(dependencies.transferFileRepository);
    this.stagingService = dependencies.stagingService ?? new StagingService();
    this.encryptionProvider = dependencies.encryptionProvider ?? new Aes256GcmEncryptionProvider();
    this.encryptionKeyProvider = dependencies.encryptionKeyProvider ?? new UnavailableEncryptionKeyProvider();
    this.encryptedPickupService = new EncryptedPickupService(this.encryptionProvider);
    this.stagingRoot = dependencies.stagingRoot ?? path.join(process.cwd(), 'application-data');
    this.emit = dependencies.events ?? noopEventListener;
    this.retryWait = dependencies.retryWait;
    this.features = dependencies.features ?? allFeatures();
    this.processingStages = dependencies.processingStages;
    this.destinationProvider = dependencies.destinationProvider;
    this.shares = dependencies.shares;
    this.shareAccess = dependencies.shareAccess;
  }

  /**
   * `sourceAdapter` is optional because step ① is optional: a workflow that only
   * consolidates a directory has no source to connect to, and building one for
   * it would ask for a module it does not use.
   */
  /**
   * Ein Lauf, umschlossen von den Freigabe-Verbindungen, die er braucht.
   *
   * Die Verbindung liegt um den **ganzen** Lauf und nicht um einzelne Dateien:
   * Windows kennt die Sitzung zum Server, und sie je Datei auf- und abzubauen
   * hieße, sie hunderte Male herzustellen — und zwischendurch könnte ein
   * anderer Workflow dazwischenfahren. Quelle und Ziel werden ineinander
   * geschachtelt, damit auch der Fall trägt, in dem beide Seiten Freigaben mit
   * eigenen Zugängen sind.
   */
  async execute(
    job: TransferJob,
    sourceAdapter: SourceAdapter | undefined,
    options: TransferExecutionOptions = {}
  ): Promise<TransferRunResult> {
    if (!this.shares || !this.shareAccess) {
      return this.executeWithinShares(job, sourceAdapter, options);
    }

    const runId = options.runId ?? `TR-${randomUUID()}`;
    const trace = (message: string): void => this.event('SHARE_STEP', runId, job, undefined, message);

    const [quelle, ziel] = await Promise.all([
      this.shareAccess.forSource(job),
      this.shareAccess.forDestination(job),
    ]);

    return this.shares.withConnection(job.sourceDirectory, quelle, trace, () =>
      this.shares!.withConnection(job.destinationDirectory, ziel, trace, () =>
        this.executeWithinShares(job, sourceAdapter, { ...options, runId })
      )
    );
  }

  private async executeWithinShares(
    job: TransferJob,
    sourceAdapter: SourceAdapter | undefined,
    options: TransferExecutionOptions = {}
  ): Promise<TransferRunResult> {
    const runId = options.runId ?? `TR-${randomUUID()}`;
    const now = options.now ?? new Date();

    this.event('TRANSFER_RUN_STARTED', runId, job, undefined, `Lauf gestartet für Workflow „${job.name}“`);

    // From here the source narrates into the same log as the run: connecting,
    // the host key, which path it read the input as, every listing and every
    // move. Without it the protocol jumps from "run started" to a failure whose
    // cause happened in between, on the other side of a socket.
    if (sourceAdapter) {
      sourceAdapter.trace = (message, details) =>
        this.event('SOURCE_STEP', runId, job, undefined, message, details);
    }

    // The chain is configurable ahead of the engines that will walk it. Running
    // step ① and quietly dropping the rest would deliver unprocessed data under
    // the name of a workflow that promises processing — the one outcome nobody
    // would notice. So the run stops and says which link is missing.
    const unbuilt = unbuiltStages(job);
    if (unbuilt.length > 0) {
      return this.finish(
        runId,
        job,
        TransferRunStatus.FAILED,
        0,
        0,
        [],
        `Dieser Workflow hat ${unbuilt.join(' und ')} eingeschaltet, und dieser Teil der Kette ist noch nicht ` +
          'gebaut. Es wurde nichts geholt: Nur die übrigen Schritte laufen zu lassen hieße, Daten weiterzureichen, ' +
          'die verarbeitet werden sollten.'
      );
    }

    // Reached only if a job without step ① got past the checks above — which
    // means its other steps are switched off too, and there is nothing to do.
    const source = sourceAdapter;
    if (!source) {
      return this.finish(
        runId,
        job,
        TransferRunStatus.FAILED,
        0,
        0,
        [],
        options.sourceProblem ??
          'Dieser Workflow holt keine Dateien, und kein anderer Schritt ist eingeschaltet. Es gibt nichts zu tun.'
      );
    }

    const retry = new RetryPolicy(job.retry ?? DEFAULT_RETRY_CONFIG, this.retryWait);

    const connectionTest = await source.testConnection();
    if (!connectionTest.ok) {
      return this.finish(runId, job, TransferRunStatus.FAILED, 0, 0, [], `Connection failed: ${connectionTest.message}`);
    }

    let discovered: SourceFile[];
    try {
      discovered = await retry.run(
        async () => (await source.listFiles(job.sourceDirectory, job.includeSubdirectories)).filter(
          (file) => !file.isDirectory
        ),
        ({ attempt, delaySeconds }) => {
          void source.dispose?.();
          this.event(
            'FILE_RETRYING',
            runId,
            job,
            undefined,
            `Die Quelle konnte in Versuch ${attempt} nicht gelesen werden, neuer Versuch in ${delaySeconds} s`
          );
        }
      );
    } catch (error) {
      return this.finish(
        runId,
        job,
        TransferRunStatus.FAILED,
        0,
        0,
        [],
        `Listing the source directory failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const selected = discovered.filter((file) => {
      const result = this.fileSelectionService.evaluate(file, this.criteriaFor(job), now);
      this.event(
        'FILE_DISCOVERED',
        runId,
        job,
        file.name,
        result.selected
          ? 'Datei entspricht den Auswahlregeln'
          : `${file.name} wird nicht genommen: ${REJECTION_REASONS[result.reason ?? ''] ?? result.reason}`
      );
      return result.selected;
    });

    if (selected.length === 0) {
      this.warnAboutStarlessPattern(runId, job, discovered.length);

      return this.finish(
        runId,
        job,
        TransferRunStatus.SUCCESS_NO_FILES,
        discovered.length,
        0,
        [],
        `${discovered.length} Dateien gesichtet, keine passende gefunden`
      );
    }

    const destination = await this.destinationFor(job);
    destination.trace = (message, details) =>
      this.event('DESTINATION_STEP', runId, job, undefined, message, details);

    await this.ensureDestinationDirectory(job, runId, destination);
    const stagingDirectory = await this.stagingService.prepareStagingDirectory(this.stagingRoot, runId);
    this.event('RUN_STEP', runId, job, undefined, `Arbeitsbereich vorbereitet: ${stagingDirectory}`);

    const context: RunContext = {
      runId,
      stagingDirectory,
      claimedHashes: new Set(),
      claimedDestinations: new Set(),
      retry,
      startedAt: now,
      destination,
    };

    let outcomes: FileOutcome[];
    try {
      outcomes = await this.processConcurrently(selected, job, source, context, options.control);
    } finally {
      await this.stagingService.cleanup(stagingDirectory);
      this.event('RUN_STEP', runId, job, undefined, `Arbeitsbereich aufgeräumt: ${stagingDirectory}`);
      // Eine Netzverbindung zum Ziel gehört dem Lauf, nicht dem Dienst: Sie
      // wird hier freigegeben, auch wenn der Lauf gescheitert ist.
      await destination.dispose?.();
    }

    // A cancelled run keeps what it managed to transfer — those files are
    // complete and registered — but says plainly that it did not finish.
    if (options.control?.state() === 'CANCELLED') {
      this.event(
        'RUN_CANCELLED',
        runId,
        job,
        undefined,
        `Abgebrochen: ${outcomes.length} von ${selected.length} ausgewählten Dateien waren zu diesem Zeitpunkt fertig`
      );

      return this.finish(
        runId,
        job,
        TransferRunStatus.CANCELLED,
        discovered.length,
        selected.length,
        outcomes,
        `Abgebrochen nach ${outcomes.length} von ${selected.length} ausgewählten Dateien`
      );
    }

    return this.finish(runId, job, undefined, discovered.length, selected.length, outcomes);
  }

  /**
   * Processes several files at once but never without a limit (spec section 79).
   * Results keep the discovery order so a run report stays readable.
   */
  private async processConcurrently(
    files: SourceFile[],
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    context: RunContext,
    control?: RunControl
  ): Promise<FileOutcome[]> {
    const limit = Math.max(1, job.maxConcurrentFiles ?? DEFAULT_MAX_CONCURRENT_FILES);
    const outcomes = new Array<FileOutcome | undefined>(files.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      for (let index = next++; index < files.length; index = next++) {
        // The one place where a run can be held or stopped: between two files.
        // Inside one, the destination would be left with half of it.
        if (control && !(await control.beforeFile())) {
          return;
        }

        const file = files[index];
        this.event('FILE_SELECTED', context.runId, job, file.name, 'Datei zur Übernahme ausgewählt');
        // A single failing file must never stop the remaining ones (section 62).
        outcomes[index] = await this.processFile(file, job, sourceAdapter, context);
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));

    // A cancellation leaves gaps where files were never started; they are not
    // outcomes and must not be counted as skipped.
    return outcomes.filter((outcome): outcome is FileOutcome => outcome !== undefined);
  }

  private async processFile(
    file: SourceFile,
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    context: RunContext
  ): Promise<FileOutcome> {
    const { runId, stagingDirectory } = context;
    const startedAt = new Date();
    const transferFileId = randomUUID();
    const sourcePath = directoryOf(file, job.sourceDirectory);

    const record = (status: FileTransferStatus, patch: Partial<TransferFile> = {}): TransferFile => ({
      id: transferFileId,
      transferRunId: runId,
      jobId: job.id,
      sourcePath,
      sourceFilename: file.name,
      sourceSize: file.size,
      sourceLastModified: file.lastModified,
      status,
      startedAt,
      completedAt: new Date(),
      ...patch,
    });

    try {
      const stability = await this.stabilityService.check(file, job.stabilityCheck, async (candidate) => {
        const current = await sourceAdapter.listFiles(job.sourceDirectory, job.includeSubdirectories);
        const found = current.find((entry) => entry.fullPath === candidate.fullPath);
        return found ? { size: found.size, lastModified: found.lastModified } : undefined;
      });

      if (!stability.stable) {
        await this.transferFileRepository.save(record(FileTransferStatus.WAITING_FOR_STABILITY));
        return { filename: file.name, status: FileTransferStatus.WAITING_FOR_STABILITY, message: stability.message };
      }
      this.event('FILE_STABLE', runId, job, file.name, stability.message);

      const knownSourceFile = await this.duplicateDetectionService.checkSourceFile(job.id, sourcePath, file);
      this.event(
        'FILE_CHECKED',
        runId,
        job,
        file.name,
        knownSourceFile.duplicate
          ? `Schon übernommen: ${knownSourceFile.message}`
          : `Noch nicht übernommen — ${file.name} in ${sourcePath}`
      );
      if (knownSourceFile.duplicate) {
        await this.transferFileRepository.save(record(FileTransferStatus.SKIPPED, { resolution: 'DUPLICATE' }));
        return { filename: file.name, status: FileTransferStatus.SKIPPED, message: knownSourceFile.message };
      }

      // Encrypting on pickup has to be settled before a single byte is fetched:
      // the licence, the key and the source's ability to stream. Finding a gap
      // afterwards would be too late — the plaintext would already exist.
      const encryptionRequested = job.encryptionConfig.enabled && job.encryptionConfig.provider === 'AES_256_GCM';
      const encryptOnPickup = job.encryptionConfig.onPickup === true;

      if (encryptOnPickup) {
        if (!this.features.isEnabled('ENCRYPTION')) {
          throw new FeatureNotLicensedError('ENCRYPTION', `Fetching "${file.name}" encrypted`);
        }

        if (!this.encryptedPickupService.supports(sourceAdapter)) {
          throw new Error(
            `„${file.name}“ soll beim Abholen verschlüsselt werden, aber diese Quelle kann die Datei nicht als ` +
              'Strom liefern. Der Lauf wird abgelehnt, statt die Datei unverschlüsselt zu schreiben.'
          );
        }
      }

      const attempts = (job.retry ?? DEFAULT_RETRY_CONFIG).attempts;

      const onRetry = ({ attempt, error, delaySeconds }: RetryAttemptInfo): void => {
        // A dropped connection cannot be reused; the adapter reconnects lazily.
        void sourceAdapter.dispose?.();

        // Eine Warnung sagt genauso viel wie ein Fehler: welche Datei, welcher
        // Versuch von wie vielen, warum, mit Systemcode und Ursachenkette — und
        // was als Nächstes geschieht. Ohne das Letzte liest sich jede Warnung
        // wie ein Abbruch, obwohl der Lauf gerade weitermacht.
        this.event(
          'FILE_RETRYING',
          runId,
          job,
          file.name,
          `${file.name}: Versuch ${attempt} von ${attempts} scheiterte an einem vorübergehenden Fehler. ` +
            `Nächster Versuch in ${delaySeconds} s. Ursache: ${describeFailure(error)}`,
          { attempt, attempts, delaySeconds, verbindung: 'wird neu aufgebaut' }
        );
      };

      // Download into staging under a validated name (sections 42 and 96).
      let stagedPath = this.stagingService.stagedPathFor(stagingDirectory, file.name, transferFileId);
      let finalFilename = file.name;
      let sha256: string;

      if (encryptOnPickup) {
        this.event(
          'FILE_DOWNLOADING',
          runId,
          job,
          file.name,
          `${file.name} wird geholt und dabei verschlüsselt`
        );
        const key = await this.encryptionKeyProvider.getKey(job.encryptionConfig.keyCredentialId);
        const pickup = await context.retry.run(
          () => this.encryptedPickupService.pickup(sourceAdapter, file, stagedPath, key),
          onRetry
        );
        this.event('FILE_DOWNLOADED', runId, job, file.name, 'Übertragung abgeschlossen');

        // The size is compared against what the source announced, exactly as
        // the integrity check does for a downloaded file. It has to happen on
        // the counted plaintext: the encrypted file is longer by its header
        // and tag, so measuring it would compare two different things.
        if (file.size !== undefined && pickup.size !== file.size) {
          throw new Error(`File size mismatch: expected ${file.size}, got ${pickup.size}`);
        }

        sha256 = pickup.sha256;
        finalFilename = `${file.name}.enc`;
        this.event('FILE_VALIDATED', runId, job, file.name, 'Prüfung bestanden, SHA-256 berechnet');
        this.event('FILE_ENCRYPTED', runId, job, file.name, 'Verschlüsselung mit AES-256-GCM beim Abholen abgeschlossen');
      } else {
        this.event('FILE_DOWNLOADING', runId, job, file.name, `${file.name} wird geholt`);
        await context.retry.run(async () => {
          const download = await sourceAdapter.downloadFile(file, stagedPath);
          if (!download.ok) {
            throw new Error(download.message);
          }
        }, onRetry);
        this.event('FILE_DOWNLOADED', runId, job, file.name, 'Übertragung abgeschlossen');

        this.event('FILE_VALIDATING', runId, job, file.name, `${file.name} wird geprüft, Prüfsumme wird berechnet`);
        const verification = await this.integrityService.verifyFile(stagedPath, { expectedSize: file.size });
        if (!verification.ok || !verification.sha256) {
          throw new Error(verification.message);
        }
        sha256 = verification.sha256;
        this.event('FILE_VALIDATED', runId, job, file.name, 'Prüfung bestanden, SHA-256 berechnet');
      }

      // Opening what the source delivered locked. This happens before the
      // content is compared and before anything is locked again: from here on
      // the run works with the content, not with somebody else's envelope.
      if (job.sourceEncryption?.enabled) {
        this.event('FILE_DECRYPTING', runId, job, file.name, `${file.name} wird geöffnet — die Quelle hat sie verschlüsselt geliefert`);
        const opened = await this.openIncomingFile(file, job, stagedPath, finalFilename);

        stagedPath = opened.path;
        finalFilename = opened.filename;
        sha256 = opened.sha256;

        if (opened.decrypted) {
          this.event('FILE_DECRYPTED', runId, job, file.name, 'Die Datei der Quelle wurde geöffnet');
        }
      }

      // Two files of identical content under different names are only a
      // duplicate if the job says so. Which files a source provides is its own
      // decision, and withholding one it sent is the riskier assumption.
      if (job.detectContentDuplicates) {
        const knownContent = await this.duplicateDetectionService.checkContent(job.id, sha256);
        // Claiming the hash right after the repository check closes the window
        // in which two concurrently processed files with identical content
        // would both pass. There is no await between the check and the claim,
        // so this is atomic for the run.
        const contentAlreadyClaimed = context.claimedHashes.has(sha256);
        context.claimedHashes.add(sha256);

        if (knownContent.duplicate || contentAlreadyClaimed) {
          // Recording the resolution here is what stops the next run from
          // downloading this file again just to hash it (spec section 39).
          await this.transferFileRepository.save(
            record(FileTransferStatus.SKIPPED, { sha256, resolution: 'DUPLICATE' })
          );
          return {
            filename: file.name,
            status: FileTransferStatus.SKIPPED,
            sha256,
            message: contentAlreadyClaimed
              ? 'Derselbe Inhalt wurde in diesem Lauf bereits übernommen'
              : knownContent.message,
          };
        }
      }

      // A file that was encrypted on the way in, and is meant to lie readable
      // in the destination: opened here, in staging, and nowhere else. This is
      // the combination a following step needs — consolidating or converting
      // works on records, and an envelope has none — and it is also the answer
      // for a destination somebody reads with their own tools.
      //
      // What it buys and what it does not: the file never travelled readable
      // and no readable copy was ever written by the fetch. From this line on
      // there is one, in staging, until the move. That window is the price of
      // a readable destination, and it is short and inside our own directory.
      if (encryptOnPickup && !encryptionRequested) {
        this.event('FILE_DECRYPTING', runId, job, file.name, `${file.name} wird wieder geöffnet, weil sie lesbar abgelegt werden soll`);
        const key = await this.encryptionKeyProvider.getKey(job.encryptionConfig.keyCredentialId);
        const openedPath = `${stagedPath}.opened`;

        // The failure is named after this step, not after the cipher. What the
        // provider reports — modified, or wrong key — is misleading here: the
        // file was locked by this same run seconds ago, so what changed is the
        // key the job points at, and that is what somebody has to go and look at.
        let opened;
        try {
          opened = await this.encryptionProvider.decrypt(stagedPath, openedPath, key);
        } catch (error) {
          throw new Error(
            `„${file.name}“ konnte nach dem Abholen nicht wieder geöffnet werden: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }

        if (!opened.ok) {
          throw new Error(`„${file.name}“ konnte nach dem Abholen nicht wieder geöffnet werden: ${opened.message}`);
        }

        await fs.rm(stagedPath, { force: true });
        stagedPath = openedPath;
        // The envelope extension goes with the envelope.
        finalFilename = file.name;
        this.event('FILE_DECRYPTED', runId, job, file.name, 'Vor der Ablage wieder geöffnet');
      }

      // Encryption happens while the file is still in staging, never after it
      // reached the destination (section 45). A job that already encrypted on
      // pickup is finished here — there is no plaintext left to protect.
      const stagedPathBeforeEncryption = stagedPath;
      if (encryptionRequested && !encryptOnPickup) {
        if (!this.features.isEnabled('ENCRYPTION')) {
          // Refusing here rather than storing in the clear: the job asked for
          // an encrypted file, and quietly delivering an unencrypted one is
          // the worse of the two outcomes.
          throw new FeatureNotLicensedError('ENCRYPTION', `Storing "${file.name}" encrypted`);
        }

        this.event('FILE_ENCRYPTING', runId, job, file.name, `${file.name} wird mit AES-256-GCM verschlüsselt`);
        const key = await this.encryptionKeyProvider.getKey(job.encryptionConfig.keyCredentialId);
        const encryptedPath = `${stagedPath}.enc`;
        const encryption = await this.encryptionProvider.encrypt(stagedPath, encryptedPath, key);
        if (!encryption.ok) {
          // Named after the file and the step, not only after the cipher: the
          // reader of this line wants to know which file stayed behind.
          throw new Error(`${file.name} konnte nicht verschlüsselt werden: ${encryption.message}`);
        }

        await fs.rm(stagedPath, { force: true });
        stagedPath = encryptedPath;
        // Built from the current name, not from the source name: a file that
        // arrived encrypted and was opened would otherwise carry the envelope
        // extension twice.
        finalFilename = `${finalFilename}.enc`;
        this.event('FILE_ENCRYPTED', runId, job, file.name, 'Verschlüsselung mit AES-256-GCM abgeschlossen');
      }

      const destination = await this.resolveDestinationPath(job, finalFilename, context);

      if (context.destination.nameOf(destination.path) !== finalFilename && !destination.skip) {
        // Der Name im Ziel weicht vom Namen der Datei ab. Wer das Ziel später
        // durchsieht, findet sonst einen Namen, den kein Protokoll erklärt.
        this.event(
          'FILE_RENAMED',
          runId,
          job,
          file.name,
          `${finalFilename} liegt dort schon — abgelegt wird unter ${context.destination.nameOf(destination.path)}`
        );
      }

      if (destination.skip) {
        await this.transferFileRepository.save(record(FileTransferStatus.SKIPPED, { sha256 }));
        return {
          filename: file.name,
          status: FileTransferStatus.SKIPPED,
          sha256,
          message: `${finalFilename} liegt schon im Ziel, und die Einstellung lautet „Überspringen“`,
        };
      }

      this.event('FILE_STORING', runId, job, file.name, `${file.name} wird abgelegt als ${destination.path}`);
      await context.destination.place(stagedPath, destination.path, runId);
      const destinationSize = await context.destination.sizeOf(destination.path);
      this.event('FILE_STORED', runId, job, file.name, 'Datei erfolgreich abgelegt');

      await this.transferFileRepository.save(
        record(FileTransferStatus.SUCCESS, {
          resolution: 'TRANSFERRED',
          destinationPath: context.destination.parentOf(destination.path),
          destinationFilename: context.destination.nameOf(destination.path),
          destinationSize,
          sha256,
        })
      );

      // Only now, with everything persisted, may the source file be touched.
      const sourceActionMessage = await this.applySourceSuccessAction(job, sourceAdapter, file);
      this.event(
        'SOURCE_FILE_SETTLED',
        runId,
        job,
        file.name,
        sourceActionMessage ??
          {
            KEEP: `${file.name} bleibt in der Quelle liegen`,
            MOVE: `${file.name} wurde ins Archiv verschoben`,
            DELETE: `${file.name} wurde in der Quelle gelöscht`,
          }[job.sourceSuccessAction]
      );

      this.event('FILE_COMPLETED', runId, job, file.name, 'Datei fertig');
      this.event('STEP_1_COMPLETED', runId, job, file.name, 'STEP_1_COMPLETED', {
        destinationFilename: context.destination.nameOf(destination.path),
        sha256,
      });

      // Everything from here on happens after Step 1 is finished and can no
      // longer invalidate it; the source file has already been dealt with.
      const stageMessage = await this.runProcessingStages(runId, job, file, {
        runId,
        jobId: job.id,
        sourceFile: file,
        originalFilename: file.name,
        currentFilename: context.destination.nameOf(destination.path),
        temporaryPath: stagedPathBeforeEncryption,
        currentFilePath: destination.path,
        finalDestinationPath: destination.path,
        fileSize: destinationSize,
        sha256,
        encrypted: finalFilename !== file.name,
        metadata: {},
      });

      return {
        filename: file.name,
        status: FileTransferStatus.SUCCESS,
        destinationPath: destination.path,
        sha256,
        message: [
          'STEP_1_COMPLETED',
          sourceActionMessage ? `(${sourceActionMessage})` : undefined,
          stageMessage,
        ]
          .filter(Boolean)
          .join(' '),
      };
    } catch (error) {
      const message = describeFailure(error);
      await this.transferFileRepository.save(
        record(FileTransferStatus.FAILED, { errorMessage: message, errorCode: 'TRANSFER_FAILED' })
      );
      this.event('FILE_FAILED', runId, job, file.name, message);

      return { filename: file.name, status: FileTransferStatus.FAILED, message };
    }
  }

  /**
   * Hands the finished file to the stages behind Step 1 (spec sections 75-76).
   * Without registered stages this does nothing, which is the base product.
   *
   * A failing stage does not turn the transfer into a failure: Step 1 is
   * complete and persisted, the source file is already archived or deleted, and
   * reporting it as failed would invite a retry that re-downloads a file which
   * arrived perfectly well. It is logged as an error and named in the outcome.
   */
  private async runProcessingStages(
    runId: string,
    job: TransferJob,
    file: SourceFile,
    context: FileProcessingContext
  ): Promise<string | undefined> {
    if (!this.processingStages || this.processingStages.isEmpty) {
      return undefined;
    }

    try {
      await this.processingStages.run(context, (stage) => {
        this.event('PROCESSING_STAGE_COMPLETED', runId, job, file.name, `Schritt „${stage}“ abgeschlossen`);
      });

      return undefined;
    } catch (error) {
      const stage = error instanceof ProcessingStageError ? error.stage : 'unknown';
      const message = error instanceof Error ? error.message : String(error);

      this.event('PROCESSING_STAGE_FAILED', runId, job, file.name, message, { stage });

      return `— die Weiterverarbeitung scheiterte in Schritt „${stage}“`;
    }
  }

  /**
   * MOVE and DELETE are best effort: at this point the file is safely stored
   * and registered, so a failing archive step must not turn the transfer into
   * a failure — but it has to be visible.
   */
  private async applySourceSuccessAction(
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    file: SourceFile
  ): Promise<string | undefined> {
    if (job.sourceSuccessAction === 'KEEP') {
      return undefined;
    }

    try {
      if (job.sourceSuccessAction === 'MOVE') {
        if (!job.sourceArchiveDirectory) {
          throw new Error('Es ist kein Archivverzeichnis eingetragen');
        }
        if (!sourceAdapter.moveFile) {
          throw new Error('Diese Quelle kann keine Dateien verschieben');
        }

        await sourceAdapter.moveFile(file, job.sourceArchiveDirectory);
        return undefined;
      }

      if (!sourceAdapter.deleteFile) {
        throw new Error('Diese Quelle kann keine Dateien löschen');
      }

      await sourceAdapter.deleteFile(file);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `source ${job.sourceSuccessAction.toLowerCase()} failed: ${message}`;
    }
  }

  private async resolveDestinationPath(
    job: TransferJob,
    filename: string,
    context: RunContext
  ): Promise<{ path: string; skip: boolean }> {
    /**
     * Claims a name for this run. Check and claim must not be separated by an
     * await, otherwise two concurrent files both see the name as free and pick
     * it. Returns false when someone else already holds it.
     */
    const claim = (candidate: string): boolean => {
      if (context.claimedDestinations.has(candidate)) {
        return false;
      }

      context.claimedDestinations.add(candidate);
      return true;
    };

    const target = context.destination.resolve(job.destinationDirectory, filename);
    const claimedTarget = claim(target);

    if (claimedTarget && !(await context.destination.exists(target))) {
      return { path: target, skip: false };
    }

    if (job.conflictStrategy === 'SKIP') {
      return { path: target, skip: true };
    }

    if (job.conflictStrategy === 'OVERWRITE') {
      return { path: target, skip: false };
    }

    // The extension always comes from the incoming file, never from what was
    // configured: it is the one part of the name that says what is inside.
    const extension = path.extname(filename);

    // NEW_NAME: the name the operator chose. RENAME: the file keeps its own
    // name and carries the time of this run behind it — all files of one run
    // share one stamp, so what arrived together sorts together, and the name
    // says when it came rather than how often it came before.
    //
    // A NEW_NAME job without a name is refused at save time. Should an older
    // record still be one, the stamp keeps the file: a name nobody chose is
    // better than a file that stays behind.
    const chosen = job.conflictStrategy === 'NEW_NAME' ? job.conflictFilename?.trim() : undefined;
    const stem =
      chosen && chosen.length > 0
        ? chosen
        : `${path.basename(filename, extension)}_${timestampSuffix(context.startedAt, job.timestampNotation)}`;

    const renamed = context.destination.resolve(job.destinationDirectory, `${stem}${extension}`);

    if (claim(renamed) && !(await context.destination.exists(renamed))) {
      return { path: renamed, skip: false };
    }

    // A chosen name is one name for every file that ever meets a conflict, and
    // two files of the same name in one run share the stamp. Both end up here,
    // and a transfer must not fail over a name, so a counter settles the tie.
    for (let counter = 1; counter <= 999; counter += 1) {
      const candidate = context.destination.resolve(
        job.destinationDirectory,
        `${stem}_${String(counter).padStart(3, '0')}${extension}`
      );

      if (claim(candidate) && !(await context.destination.exists(candidate))) {
        return { path: candidate, skip: false };
      }
    }

    throw new Error(`Für ${filename} war im Zielverzeichnis kein freier Name zu finden`);
  }

  private async ensureDestinationDirectory(
    job: TransferJob,
    runId: string,
    destination: DestinationAdapter
  ): Promise<void> {
    await destination.prepareDirectory(job.destinationDirectory, job.createDestinationDirectory);
  }

  /**
   * Der eine Fall, in dem „nichts gefunden" wahrscheinlich ein Versehen ist.
   *
   * Es lagen Dateien im Verzeichnis, und keine passte, während das Muster
   * keinen Stern trägt. Bis vor kurzem galt ein Muster ohne Stern als
   * Namensanfang; seitdem meint es den vollen Namen. Ein Workflow, der von
   * früher stammt, verstummt dadurch — und zwar geräuschlos, denn ein Lauf
   * ohne passende Datei ist kein Fehler und sieht aus wie ein ruhiger Tag.
   *
   * Deshalb steht hier eine Warnung mit dem Satz, der sie behebt. Sie kostet
   * nichts, wenn alles stimmt: Wer nichts findet, weil nichts da ist, sieht
   * sie nie.
   */
  private warnAboutStarlessPattern(runId: string, job: TransferJob, discovered: number): void {
    const pattern = job.filenamePrefix?.trim() ?? '';

    if (discovered === 0 || pattern === '' || pattern.includes('*')) {
      return;
    }

    this.event(
      'RUN_PATTERN_HINT',
      runId,
      job,
      undefined,
      `${discovered} Dateien lagen bereit, keine passte auf „${pattern}“. Ein Muster ohne Stern meint den ` +
        `vollständigen Dateinamen. Ist der Anfang gemeint, gehört ein Stern dahinter: „${pattern}*“.`,
      { pattern, discovered }
    );
  }

  /**
   * Das Ziel dieses Laufs. Ohne eigene Angabe ist es das Dateisystem — so
   * verhielt sich jeder Workflow bisher, und ein gespeicherter Workflow ohne
   * Zielangabe muss weiterlaufen wie zuvor.
   */
  private async destinationFor(job: TransferJob): Promise<DestinationAdapter> {
    return this.destinationProvider
      ? this.destinationProvider.forJob(job)
      : new LocalDestinationAdapter(this.stagingService);
  }

  private criteriaFor(job: TransferJob) {
    return {
      filenamePrefix: job.filenamePrefix,
      allowedExtensions: job.allowedExtensions,
      caseSensitivePrefix: job.caseSensitivePrefix,
      includeSubdirectories: job.includeSubdirectories,
      minimumFileAgeSeconds: job.minimumFileAgeSeconds,
      requireStableFile: job.stabilityCheck.enabled,
      ignoredTemporaryExtensions: job.ignoredTemporaryExtensions,
    };
  }

  /**
   * One place sets what every event carries, so nothing has to be remembered at
   * the twenty places that emit one.
   */
  private event(
    name: TransferEventName,
    runId: string,
    job: TransferJob,
    filename: string | undefined,
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.emit({ name, runId, jobId: job.id, filename, message, details, jobLevel: job.logLevel ?? DEFAULT_JOB_LOG_LEVEL });
  }

  /**
   * Opens a file the source delivered encrypted — in staging, which the run
   * deletes when it ends. The destination never sees the opened file unless the
   * job says so; if the job encrypts for its destination, the next step locks it
   * again with a different key.
   *
   * Three ways this refuses rather than guesses:
   *
   * - without the module, because opening files is what the module is;
   * - without a key, because a job that declares an encrypted source and names
   *   no key is misconfigured, not permissive;
   * - on a file without an envelope, unless the job explicitly accepts
   *   plaintext. A file that was supposed to be encrypted and is not is a fault
   *   at the source, and passing it on silently would hide it.
   */
  private async openIncomingFile(
    file: SourceFile,
    job: TransferJob,
    stagedPath: string,
    currentFilename: string
  ): Promise<{ path: string; filename: string; sha256: string; decrypted: boolean }> {
    if (!this.features.isEnabled('ENCRYPTION')) {
      throw new FeatureNotLicensedError('ENCRYPTION', `Opening "${file.name}" from an encrypted source`);
    }

    const recognised = (await this.encryptionProvider.isEncrypted?.(stagedPath)) ?? false;

    if (!recognised) {
      if (job.sourceEncryption?.acceptPlaintext !== true) {
        throw new Error(
          `„${file.name}“ trägt keine Verschlüsselung, obwohl diese Quelle als verschlüsselt eingerichtet ist. ` +
            'Die Datei wird abgelehnt statt weitergereicht: Eine Datei, die verschlüsselt sein sollte und es nicht ' +
            'ist, ist ein Fehler an der Quelle. Wenn die Quelle absichtlich beides liefert, im Workflow ' +
            '„Unverschlüsselte Dateien annehmen“ einschalten.'
        );
      }

      // Explicitly allowed: it stays as it is, with the checksum it already has.
      const asIs = await this.integrityService.verifyFile(stagedPath, {});
      if (!asIs.ok || !asIs.sha256) {
        throw new Error(asIs.message);
      }

      return { path: stagedPath, filename: currentFilename, sha256: asIs.sha256, decrypted: false };
    }

    const key = await this.encryptionKeyProvider.getKey(job.sourceEncryption?.keyCredentialId);
    const openedPath = `${stagedPath}.opened`;
    const opened = await this.encryptionProvider.decrypt(stagedPath, openedPath, key);

    if (!opened.ok) {
      // A wrong key and a manipulated file look the same from here, and both
      // mean the same for this run: this file cannot be taken over.
      throw new Error(`„${file.name}“ konnte nicht geöffnet werden: ${opened.message}`);
    }

    await fs.rm(stagedPath, { force: true });

    // The checksum has to describe the content, not the envelope: two runs
    // encrypt the same file to different bytes, and duplicate detection
    // compares content across runs.
    const verification = await this.integrityService.verifyFile(openedPath, {});
    if (!verification.ok || !verification.sha256) {
      throw new Error(verification.message);
    }

    return {
      path: openedPath,
      // The name loses the extension that marked the envelope, if it had one.
      filename: currentFilename.toLowerCase().endsWith('.enc')
        ? currentFilename.slice(0, -'.enc'.length)
        : currentFilename,
      sha256: verification.sha256,
      decrypted: true,
    };
  }

  private finish(
    runId: string,
    job: TransferJob,
    forcedStatus: TransferRunStatus | undefined,
    filesFound: number,
    filesSelected: number,
    outcomes: FileOutcome[],
    overrideMessage?: string
  ): TransferRunResult {
    const filesSucceeded = outcomes.filter((outcome) => outcome.status === FileTransferStatus.SUCCESS).length;
    const filesFailed = outcomes.filter((outcome) => outcome.status === FileTransferStatus.FAILED).length;
    const filesSkipped = outcomes.length - filesSucceeded - filesFailed;

    let status = forcedStatus;
    if (!status) {
      if (filesFailed > 0) {
        status = filesSucceeded > 0 ? TransferRunStatus.COMPLETED_WITH_ERRORS : TransferRunStatus.FAILED;
      } else {
        status = TransferRunStatus.SUCCESS;
      }
    }

    const message =
      overrideMessage ??
      `${filesSucceeded} übernommen, ${filesSkipped} übersprungen, ${filesFailed} fehlgeschlagen ` +
        `von ${filesSelected} ausgewählten Dateien`;

    this.event('TRANSFER_RUN_COMPLETED', runId, job, undefined, message, { status });

    return {
      runId,
      jobId: job.id,
      status,
      filesFound,
      filesSelected,
      filesSucceeded,
      filesSkipped,
      filesFailed,
      outcomes,
      message,
    };
  }
}
