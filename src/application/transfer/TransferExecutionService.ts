import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
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
import { resolveWithin } from '../../infrastructure/filesystem/SafePath.js';
import type { ProcessingStageRegistry } from '../processing/ProcessingStageRegistry.js';
import { FileSelectionService } from './FileSelectionService.js';
import { FileStabilityService } from './FileStabilityService.js';
import { FileIntegrityService } from './FileIntegrityService.js';
import { DuplicateDetectionService } from './DuplicateDetectionService.js';
import { StagingService } from './StagingService.js';
import { DEFAULT_RETRY_CONFIG, RetryPolicy } from './RetryPolicy.js';
import { noopEventListener, type TransferEventListener, type TransferEventName } from './TransferEvents.js';

/** System default from spec section 79; parallelism is never unbounded. */
export const DEFAULT_MAX_CONCURRENT_FILES = 3;

/**
 * Directory a file actually sits in. With `includeSubdirectories` the job's
 * source directory is not specific enough: two files of the same name in two
 * subdirectories would otherwise share one identity and the second would be
 * discarded as a duplicate of the first (spec section 40).
 */
function directoryOf(file: SourceFile, fallback: string): string {
  const separator = Math.max(file.fullPath.lastIndexOf('/'), file.fullPath.lastIndexOf('\\'));

  if (separator < 0) {
    return fallback;
  }

  return file.fullPath.slice(0, separator) || '/';
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
}

export interface TransferExecutionOptions {
  runId?: string;
  now?: Date;
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
  private readonly stagingRoot: string;
  private readonly emit: TransferEventListener;
  private readonly retryWait?: (milliseconds: number) => Promise<void>;
  private readonly features: FeatureSet;
  private readonly processingStages?: ProcessingStageRegistry;

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
    this.stagingRoot = dependencies.stagingRoot ?? path.join(process.cwd(), 'application-data');
    this.emit = dependencies.events ?? noopEventListener;
    this.retryWait = dependencies.retryWait;
    this.features = dependencies.features ?? allFeatures();
    this.processingStages = dependencies.processingStages;
  }

  async execute(
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    options: TransferExecutionOptions = {}
  ): Promise<TransferRunResult> {
    const runId = options.runId ?? `TR-${randomUUID()}`;
    const now = options.now ?? new Date();

    this.event('TRANSFER_RUN_STARTED', runId, job, undefined, `Transfer run started for job ${job.name}`);

    const retry = new RetryPolicy(job.retry ?? DEFAULT_RETRY_CONFIG, this.retryWait);

    const connectionTest = await sourceAdapter.testConnection();
    if (!connectionTest.ok) {
      return this.finish(runId, job, TransferRunStatus.FAILED, 0, 0, [], `Connection failed: ${connectionTest.message}`);
    }

    let discovered: SourceFile[];
    try {
      discovered = await retry.run(
        async () => (await sourceAdapter.listFiles(job.sourceDirectory, job.includeSubdirectories)).filter(
          (file) => !file.isDirectory
        ),
        ({ attempt, delaySeconds }) => {
          void sourceAdapter.dispose?.();
          this.event(
            'FILE_RETRYING',
            runId,
            job,
            undefined,
            `Listing the source failed on attempt ${attempt}, retrying in ${delaySeconds}s`
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
        result.selected ? 'File matches the selection rules' : `File filtered out: ${result.reason}`
      );
      return result.selected;
    });

    if (selected.length === 0) {
      return this.finish(
        runId,
        job,
        TransferRunStatus.SUCCESS_NO_FILES,
        discovered.length,
        0,
        [],
        `${discovered.length} files scanned, 0 matching files found`
      );
    }

    await this.ensureDestinationDirectory(job);
    const stagingDirectory = await this.stagingService.prepareStagingDirectory(this.stagingRoot, runId);

    const context: RunContext = {
      runId,
      stagingDirectory,
      claimedHashes: new Set(),
      claimedDestinations: new Set(),
      retry,
    };

    let outcomes: FileOutcome[];
    try {
      outcomes = await this.processConcurrently(selected, job, sourceAdapter, context);
    } finally {
      await this.stagingService.cleanup(stagingDirectory);
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
    context: RunContext
  ): Promise<FileOutcome[]> {
    const limit = Math.max(1, job.maxConcurrentFiles ?? DEFAULT_MAX_CONCURRENT_FILES);
    const outcomes = new Array<FileOutcome>(files.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      for (let index = next++; index < files.length; index = next++) {
        const file = files[index];
        this.event('FILE_SELECTED', context.runId, job, file.name, 'File selected for transfer');
        // A single failing file must never stop the remaining ones (section 62).
        outcomes[index] = await this.processFile(file, job, sourceAdapter, context);
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
    return outcomes;
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
      if (knownSourceFile.duplicate) {
        await this.transferFileRepository.save(record(FileTransferStatus.SKIPPED, { resolution: 'DUPLICATE' }));
        return { filename: file.name, status: FileTransferStatus.SKIPPED, message: knownSourceFile.message };
      }

      // Download into staging under a validated name (sections 42 and 96).
      let stagedPath = this.stagingService.stagedPathFor(stagingDirectory, file.name, transferFileId);
      await context.retry.run(
        async () => {
          const download = await sourceAdapter.downloadFile(file, stagedPath);
          if (!download.ok) {
            throw new Error(download.message);
          }
        },
        ({ attempt, error, delaySeconds }) => {
          // A dropped connection cannot be reused; the adapter reconnects lazily.
          void sourceAdapter.dispose?.();
          this.event(
            'FILE_RETRYING',
            runId,
            job,
            file.name,
            `Attempt ${attempt} failed with a temporary error, retrying in ${delaySeconds}s: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }
      );
      this.event('FILE_DOWNLOADED', runId, job, file.name, 'Download completed');

      const verification = await this.integrityService.verifyFile(stagedPath, { expectedSize: file.size });
      if (!verification.ok || !verification.sha256) {
        throw new Error(verification.message);
      }
      this.event('FILE_VALIDATED', runId, job, file.name, 'Integrity check passed, SHA-256 calculated');

      const knownContent = await this.duplicateDetectionService.checkContent(job.id, verification.sha256);
      // Claiming the hash right after the repository check closes the window in
      // which two concurrently processed files with identical content would
      // both pass. There is no await between the check and the claim, so this
      // is atomic for the run.
      const contentAlreadyClaimed = context.claimedHashes.has(verification.sha256);
      context.claimedHashes.add(verification.sha256);

      if (knownContent.duplicate || contentAlreadyClaimed) {
        // Recording the resolution here is what stops the next run from
        // downloading this file again just to hash it (spec section 39).
        await this.transferFileRepository.save(
          record(FileTransferStatus.SKIPPED, { sha256: verification.sha256, resolution: 'DUPLICATE' })
        );
        return {
          filename: file.name,
          status: FileTransferStatus.SKIPPED,
          sha256: verification.sha256,
          message: contentAlreadyClaimed
            ? 'Identical content was already taken over earlier in this run'
            : knownContent.message,
        };
      }

      // Encryption happens while the file is still in staging, never after it
      // reached the destination (section 45).
      let finalFilename = file.name;
      const stagedPathBeforeEncryption = stagedPath;
      if (job.encryptionConfig.enabled && job.encryptionConfig.provider === 'AES_256_GCM') {
        if (!this.features.isEnabled('ENCRYPTION')) {
          // Refusing here rather than storing in the clear: the job asked for
          // an encrypted file, and quietly delivering an unencrypted one is
          // the worse of the two outcomes.
          throw new FeatureNotLicensedError('ENCRYPTION', `Storing "${file.name}" encrypted`);
        }

        const key = await this.encryptionKeyProvider.getKey(job.encryptionConfig.keyCredentialId);
        const encryptedPath = `${stagedPath}.enc`;
        const encryption = await this.encryptionProvider.encrypt(stagedPath, encryptedPath, key);
        if (!encryption.ok) {
          throw new Error(encryption.message);
        }

        await fs.rm(stagedPath, { force: true });
        stagedPath = encryptedPath;
        finalFilename = `${file.name}.enc`;
        this.event('FILE_ENCRYPTED', runId, job, file.name, 'AES-256-GCM encryption completed');
      }

      const destination = await this.resolveDestinationPath(job, finalFilename, context);
      if (destination.skip) {
        await this.transferFileRepository.save(record(FileTransferStatus.SKIPPED, { sha256: verification.sha256 }));
        return {
          filename: file.name,
          status: FileTransferStatus.SKIPPED,
          sha256: verification.sha256,
          message: `${finalFilename} already exists in the destination and the conflict strategy is SKIP`,
        };
      }

      await this.stagingService.moveToFinalPath(stagedPath, destination.path);
      const destinationStats = await fs.stat(destination.path);
      this.event('FILE_STORED', runId, job, file.name, 'File stored successfully');

      await this.transferFileRepository.save(
        record(FileTransferStatus.SUCCESS, {
          resolution: 'TRANSFERRED',
          destinationPath: path.dirname(destination.path),
          destinationFilename: path.basename(destination.path),
          destinationSize: destinationStats.size,
          sha256: verification.sha256,
        })
      );

      // Only now, with everything persisted, may the source file be touched.
      const sourceActionMessage = await this.applySourceSuccessAction(job, sourceAdapter, file);

      this.event('FILE_COMPLETED', runId, job, file.name, 'File completed');
      this.event('STEP_1_COMPLETED', runId, job, file.name, 'STEP_1_COMPLETED', {
        destinationFilename: path.basename(destination.path),
        sha256: verification.sha256,
      });

      // Everything from here on happens after Step 1 is finished and can no
      // longer invalidate it; the source file has already been dealt with.
      const stageMessage = await this.runProcessingStages(runId, job, file, {
        runId,
        jobId: job.id,
        sourceFile: file,
        originalFilename: file.name,
        currentFilename: path.basename(destination.path),
        temporaryPath: stagedPathBeforeEncryption,
        currentFilePath: destination.path,
        finalDestinationPath: destination.path,
        fileSize: destinationStats.size,
        sha256: verification.sha256,
        encrypted: finalFilename !== file.name,
        metadata: {},
      });

      return {
        filename: file.name,
        status: FileTransferStatus.SUCCESS,
        destinationPath: destination.path,
        sha256: verification.sha256,
        message: [
          'STEP_1_COMPLETED',
          sourceActionMessage ? `(${sourceActionMessage})` : undefined,
          stageMessage,
        ]
          .filter(Boolean)
          .join(' '),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        this.event('PROCESSING_STAGE_COMPLETED', runId, job, file.name, `Stage "${stage}" completed`);
      });

      return undefined;
    } catch (error) {
      const stage = error instanceof ProcessingStageError ? error.stage : 'unknown';
      const message = error instanceof Error ? error.message : String(error);

      this.event('PROCESSING_STAGE_FAILED', runId, job, file.name, message, { stage });

      return `- further processing failed in stage "${stage}"`;
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
          throw new Error('No archive directory configured');
        }
        if (!sourceAdapter.moveFile) {
          throw new Error('The source adapter cannot move files');
        }

        await sourceAdapter.moveFile(file, job.sourceArchiveDirectory);
        return undefined;
      }

      if (!sourceAdapter.deleteFile) {
        throw new Error('The source adapter cannot delete files');
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

    const target = resolveWithin(job.destinationDirectory, filename);
    const claimedTarget = claim(target);

    if (claimedTarget && !(await this.exists(target))) {
      return { path: target, skip: false };
    }

    if (job.conflictStrategy === 'SKIP') {
      return { path: target, skip: true };
    }

    if (job.conflictStrategy === 'OVERWRITE') {
      return { path: target, skip: false };
    }

    const extension = path.extname(filename);
    const stem = path.basename(filename, extension);

    for (let counter = 1; counter <= 999; counter += 1) {
      const candidate = resolveWithin(
        job.destinationDirectory,
        `${stem}_${String(counter).padStart(3, '0')}${extension}`
      );

      if (claim(candidate) && !(await this.exists(candidate))) {
        return { path: candidate, skip: false };
      }
    }

    throw new Error(`Could not find a free name for ${filename} in the destination directory`);
  }

  private async ensureDestinationDirectory(job: TransferJob): Promise<void> {
    const directory = path.resolve(job.destinationDirectory);

    if (!(await this.exists(directory))) {
      if (!job.createDestinationDirectory) {
        throw new Error(`Destination directory ${directory} does not exist and automatic creation is disabled`);
      }

      await fs.mkdir(directory, { recursive: true });
    }

    await fs.access(directory, fsConstants.W_OK);
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
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

  private event(
    name: TransferEventName,
    runId: string,
    job: TransferJob,
    filename: string | undefined,
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.emit({ name, runId, jobId: job.id, filename, message, details });
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
      `${filesSucceeded} succeeded, ${filesSkipped} skipped, ${filesFailed} failed out of ${filesSelected} selected files`;

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
