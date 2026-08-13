import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { FileTransferFileRepository } from '../../infrastructure/persistence/FileTransferFileRepository.js';
import { FileTransferJobRepository } from '../../infrastructure/persistence/FileTransferJobRepository.js';
import { FileTransferRunRepository } from '../../infrastructure/persistence/FileTransferRunRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import { JobRuntimeService } from './JobRuntimeService.js';

export interface UnikomApplication {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  runtime: JobRuntimeService;
}

export interface ApplicationOptions {
  encryptionKeyProvider?: EncryptionKeyProvider;
  events?: TransferEventListener;
  stagingRoot?: string;
}

/**
 * Production wiring: jobs, runs and the processed-file registry all live in
 * `dataDirectory`, so schedules and transfer history survive a restart
 * (spec sections 31, 39 and 110). The staging area sits in the same directory
 * as `staging/<run-id>` (section 43).
 */
export function createPersistentApplication(
  dataDirectory: string,
  options: ApplicationOptions = {}
): UnikomApplication {
  const jobRepository = new FileTransferJobRepository(dataDirectory);
  const runRepository = new FileTransferRunRepository(dataDirectory);
  const transferFileRepository = new FileTransferFileRepository(dataDirectory);

  return {
    jobRepository,
    runRepository,
    transferFileRepository,
    runtime: new JobRuntimeService(jobRepository, {
      runRepository,
      transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider,
      events: options.events,
      stagingRoot: options.stagingRoot ?? dataDirectory,
    }),
  };
}

/** Volatile wiring for tests and experiments; nothing survives the process. */
export function createInMemoryApplication(options: ApplicationOptions = {}): UnikomApplication {
  const jobRepository = new InMemoryTransferJobRepository();
  const runRepository = new InMemoryTransferRunRepository();
  const transferFileRepository = new InMemoryTransferFileRepository();

  return {
    jobRepository,
    runRepository,
    transferFileRepository,
    runtime: new JobRuntimeService(jobRepository, {
      runRepository,
      transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider,
      events: options.events,
      stagingRoot: options.stagingRoot,
    }),
  };
}
