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
import { resolveWithin } from '../../infrastructure/filesystem/SafePath.js';
import { FileSelectionService } from './FileSelectionService.js';
import { FileStabilityService } from './FileStabilityService.js';
import { FileIntegrityService } from './FileIntegrityService.js';
import { DuplicateDetectionService } from './DuplicateDetectionService.js';
import { StagingService } from './StagingService.js';
import { noopEventListener, type TransferEventListener, type TransferEventName } from './TransferEvents.js';

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
  }

  async execute(
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    options: TransferExecutionOptions = {}
  ): Promise<TransferRunResult> {
    const runId = options.runId ?? `TR-${randomUUID()}`;
    const now = options.now ?? new Date();

    this.event('TRANSFER_RUN_STARTED', runId, job, undefined, `Transfer run started for job ${job.name}`);

    const connectionTest = await sourceAdapter.testConnection();
    if (!connectionTest.ok) {
      return this.finish(runId, job, TransferRunStatus.FAILED, 0, 0, [], `Connection failed: ${connectionTest.message}`);
    }

    const discovered = (await sourceAdapter.listFiles(job.sourceDirectory, job.includeSubdirectories)).filter(
      (file) => !file.isDirectory
    );

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
    const outcomes: FileOutcome[] = [];

    try {
      for (const file of selected) {
        this.event('FILE_SELECTED', runId, job, file.name, 'File selected for transfer');
        // A single failing file must never stop the remaining ones (section 62).
        outcomes.push(await this.processFile(file, job, sourceAdapter, runId, stagingDirectory));
      }
    } finally {
      await this.stagingService.cleanup(stagingDirectory);
    }

    return this.finish(runId, job, undefined, discovered.length, selected.length, outcomes);
  }

  private async processFile(
    file: SourceFile,
    job: TransferJob,
    sourceAdapter: SourceAdapter,
    runId: string,
    stagingDirectory: string
  ): Promise<FileOutcome> {
    const startedAt = new Date();
    const transferFileId = randomUUID();

    const record = (status: FileTransferStatus, patch: Partial<TransferFile> = {}): TransferFile => ({
      id: transferFileId,
      transferRunId: runId,
      jobId: job.id,
      sourcePath: job.sourceDirectory,
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

      const knownSourceFile = await this.duplicateDetectionService.checkSourceFile(job.id, job.sourceDirectory, file);
      if (knownSourceFile.duplicate) {
        await this.transferFileRepository.save(record(FileTransferStatus.SKIPPED, { resolution: 'DUPLICATE' }));
        return { filename: file.name, status: FileTransferStatus.SKIPPED, message: knownSourceFile.message };
      }

      // Download into staging under a validated name (sections 42 and 96).
      let stagedPath = this.stagingService.stagedPathFor(stagingDirectory, file.name);
      const download = await sourceAdapter.downloadFile(file, stagedPath);
      if (!download.ok) {
        throw new Error(download.message);
      }
      this.event('FILE_DOWNLOADED', runId, job, file.name, 'Download completed');

      const verification = await this.integrityService.verifyFile(stagedPath, { expectedSize: file.size });
      if (!verification.ok || !verification.sha256) {
        throw new Error(verification.message);
      }
      this.event('FILE_VALIDATED', runId, job, file.name, 'Integrity check passed, SHA-256 calculated');

      const knownContent = await this.duplicateDetectionService.checkContent(job.id, verification.sha256);
      if (knownContent.duplicate) {
        // Recording the resolution here is what stops the next run from
        // downloading this file again just to hash it (spec section 39).
        await this.transferFileRepository.save(
          record(FileTransferStatus.SKIPPED, { sha256: verification.sha256, resolution: 'DUPLICATE' })
        );
        return {
          filename: file.name,
          status: FileTransferStatus.SKIPPED,
          sha256: verification.sha256,
          message: knownContent.message,
        };
      }

      // Encryption happens while the file is still in staging, never after it
      // reached the destination (section 45).
      let finalFilename = file.name;
      if (job.encryptionConfig.enabled && job.encryptionConfig.provider === 'AES_256_GCM') {
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

      const destination = await this.resolveDestinationPath(job, finalFilename);
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

      return {
        filename: file.name,
        status: FileTransferStatus.SUCCESS,
        destinationPath: destination.path,
        sha256: verification.sha256,
        message: sourceActionMessage
          ? `STEP_1_COMPLETED (${sourceActionMessage})`
          : 'STEP_1_COMPLETED',
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
    filename: string
  ): Promise<{ path: string; skip: boolean }> {
    const target = resolveWithin(job.destinationDirectory, filename);

    if (!(await this.exists(target))) {
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
      const candidate = `${stem}_${String(counter).padStart(3, '0')}${extension}`;
      const candidatePath = resolveWithin(job.destinationDirectory, candidate);

      if (!(await this.exists(candidatePath))) {
        return { path: candidatePath, skip: false };
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
