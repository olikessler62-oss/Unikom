import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { openDatabase } from '../../infrastructure/persistence/sqlite/SqliteDatabase.js';
import { SqliteTransferFileRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferFileRepository.js';
import { SqliteTransferJobRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferJobRepository.js';
import { SqliteTransferRunRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferRunRepository.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import { JobRuntimeService } from './JobRuntimeService.js';

export interface UnikomApplication {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  runtime: JobRuntimeService;
  /** Releases the storage handle; a no-op for the in-memory variant. */
  close(): void;
}

export interface ApplicationOptions {
  encryptionKeyProvider?: EncryptionKeyProvider;
  events?: TransferEventListener;
  stagingRoot?: string;
}

/**
 * Production wiring. Jobs, runs and the processed-file registry live in a
 * SQLite database inside `dataDirectory`, so schedules and history survive a
 * restart (spec sections 31, 39 and 110) and duplicate lookups hit an index
 * instead of scanning the whole history (section 101). The staging area sits
 * in the same directory as `staging/<run-id>` (section 43).
 */
export function createPersistentApplication(
  dataDirectory: string,
  options: ApplicationOptions = {}
): UnikomApplication {
  const database = openDatabase(dataDirectory);
  const jobRepository = new SqliteTransferJobRepository(database);
  const runRepository = new SqliteTransferRunRepository(database);
  const transferFileRepository = new SqliteTransferFileRepository(database);

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
    close: () => database.close(),
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
    close: () => {},
  };
}
