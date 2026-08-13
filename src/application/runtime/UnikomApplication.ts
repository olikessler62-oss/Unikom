import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import type { LogLevel, Logger, TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { InMemoryCredentialRepository } from '../../infrastructure/persistence/InMemoryCredentialRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferLogStore } from '../../infrastructure/persistence/InMemoryTransferLogStore.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { openDatabase } from '../../infrastructure/persistence/sqlite/SqliteDatabase.js';
import { SqliteCredentialRepository } from '../../infrastructure/persistence/sqlite/SqliteCredentialRepository.js';
import { SqliteTransferFileRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferFileRepository.js';
import { SqliteTransferJobRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferJobRepository.js';
import { SqliteTransferLogStore } from '../../infrastructure/persistence/sqlite/SqliteTransferLogStore.js';
import { SqliteTransferRunRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferRunRepository.js';
import { EnvironmentMasterKeyProvider, type MasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SecretCipher } from '../../infrastructure/security/SecretCipher.js';
import { CredentialEncryptionKeyProvider } from '../credentials/CredentialEncryptionKeyProvider.js';
import { CredentialService } from '../credentials/CredentialService.js';
import { CompositeLogger, DEFAULT_LOG_LEVEL, LevelFilteredLogger } from '../logging/Loggers.js';
import { combineEventListeners, createTransferEventLogger } from '../logging/TransferEventLogger.js';
import { TransferHistoryService } from '../transfer/TransferHistoryService.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import { SourceAdapterProvider } from '../transfer/SourceAdapterProvider.js';
import { JobRuntimeService } from './JobRuntimeService.js';

export interface UnikomApplication {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  logRepository: TransferLogRepository;
  credentialService: CredentialService;
  historyService: TransferHistoryService;
  logger: Logger;
  runtime: JobRuntimeService;
  /** Releases the storage handle; a no-op for the in-memory variant. */
  close(): void;
}

export interface ApplicationOptions {
  /**
   * Protects the stored credentials. Defaults to the UNIKOM_MASTER_KEY
   * environment variable, which is only read when a secret is actually used.
   */
  masterKeyProvider?: MasterKeyProvider;
  /** Overrides how a job's keyCredentialId is turned into a key; for tests. */
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Everything below this level is dropped; defaults to INFO (section 68). */
  logLevel?: LogLevel;
  /** Extra log target next to the database, typically a ConsoleLogger. */
  logger?: Logger;
  events?: TransferEventListener;
  stagingRoot?: string;
}

interface Wiring {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  logStore: Logger & TransferLogRepository;
  close(): void;
}

function assemble(wiring: Wiring, options: ApplicationOptions, defaultStagingRoot?: string): UnikomApplication {
  const credentialService = new CredentialService(
    wiring.credentialRepository,
    new SecretCipher(options.masterKeyProvider ?? new EnvironmentMasterKeyProvider())
  );

  const logger = new LevelFilteredLogger(
    new CompositeLogger(...[wiring.logStore, options.logger].filter((target): target is Logger => Boolean(target))),
    options.logLevel ?? DEFAULT_LOG_LEVEL
  );

  return {
    jobRepository: wiring.jobRepository,
    runRepository: wiring.runRepository,
    transferFileRepository: wiring.transferFileRepository,
    credentialRepository: wiring.credentialRepository,
    logRepository: wiring.logStore,
    credentialService,
    logger,
    historyService: new TransferHistoryService(
      wiring.runRepository,
      wiring.transferFileRepository,
      wiring.logStore,
      wiring.jobRepository
    ),
    runtime: new JobRuntimeService(wiring.jobRepository, {
      runRepository: wiring.runRepository,
      transferFileRepository: wiring.transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider ?? new CredentialEncryptionKeyProvider(credentialService),
      adapterProvider: new SourceAdapterProvider(credentialService),
      // Every pipeline event becomes a log entry; extra listeners still see it.
      events: combineEventListeners(createTransferEventLogger(logger), options.events),
      stagingRoot: options.stagingRoot ?? defaultStagingRoot,
    }),
    close: wiring.close,
  };
}

/**
 * Production wiring. Jobs, runs, credentials, the processed-file registry and
 * the transfer log live in a SQLite database inside `dataDirectory`, so
 * schedules and history survive a restart (spec sections 31, 39 and 110) and
 * duplicate lookups hit an index instead of scanning the whole history
 * (section 101). The staging area sits in the same directory as
 * `staging/<run-id>` (section 43).
 */
export function createPersistentApplication(
  dataDirectory: string,
  options: ApplicationOptions = {}
): UnikomApplication {
  const database = openDatabase(dataDirectory);

  return assemble(
    {
      jobRepository: new SqliteTransferJobRepository(database),
      runRepository: new SqliteTransferRunRepository(database),
      transferFileRepository: new SqliteTransferFileRepository(database),
      credentialRepository: new SqliteCredentialRepository(database),
      logStore: new SqliteTransferLogStore(database),
      close: () => database.close(),
    },
    options,
    dataDirectory
  );
}

/** Volatile wiring for tests and experiments; nothing survives the process. */
export function createInMemoryApplication(options: ApplicationOptions = {}): UnikomApplication {
  return assemble(
    {
      jobRepository: new InMemoryTransferJobRepository(),
      runRepository: new InMemoryTransferRunRepository(),
      transferFileRepository: new InMemoryTransferFileRepository(),
      credentialRepository: new InMemoryCredentialRepository(),
      logStore: new InMemoryTransferLogStore(),
      close: () => {},
    },
    options
  );
}
