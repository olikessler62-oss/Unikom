import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import type { LogLevel, Logger, TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { allFeatures, type FeatureSet } from '../../domain/licensing/Feature.js';
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
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { SessionRepository } from '../../domain/users/Session.js';
import type { UserRepository } from '../../domain/users/User.js';
import { InMemorySessionRepository } from '../../infrastructure/persistence/InMemorySessionRepository.js';
import { InMemoryTenantRepository } from '../../infrastructure/persistence/InMemoryTenantRepository.js';
import { InMemoryUserRepository } from '../../infrastructure/persistence/InMemoryUserRepository.js';
import { SqliteSessionRepository } from '../../infrastructure/persistence/sqlite/SqliteSessionRepository.js';
import { SqliteTenantRepository } from '../../infrastructure/persistence/sqlite/SqliteTenantRepository.js';
import { SqliteUserRepository } from '../../infrastructure/persistence/sqlite/SqliteUserRepository.js';
import { ProcessingStageRegistry } from '../processing/ProcessingStageRegistry.js';
import { RetentionService } from '../retention/RetentionService.js';
import { TenantService } from '../tenants/TenantService.js';
import { SessionService } from '../users/SessionService.js';
import { UserService } from '../users/UserService.js';
import { TransferHistoryService } from '../transfer/TransferHistoryService.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import { SourceAdapterProvider } from '../transfer/SourceAdapterProvider.js';
import { TransferJobService } from '../transfer/TransferJobService.js';
import { JobRuntimeService } from './JobRuntimeService.js';

export interface UnikomApplication {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  logRepository: TransferLogRepository;
  credentialService: CredentialService;
  historyService: TransferHistoryService;
  /** Creates and changes jobs, and refuses those the licence does not cover. */
  jobService: TransferJobService;
  /** The modules this installation may use. */
  features: FeatureSet;
  /** Stages behind STEP_1_COMPLETED; empty until step 2 or 3 register. */
  processingStages: ProcessingStageRegistry;
  /** Deletes expired log and history entries; runs once a day via the scheduler. */
  retentionService: RetentionService;
  /** Accounts and roles for the interface; entirely local (no cloud login). */
  userService: UserService;
  sessionService: SessionService;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  /** The operator's own clients ("Mandant"); always at least the standard one. */
  tenantService: TenantService;
  tenantRepository: TenantRepository;
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
  /**
   * The modules this installation may use. Defaults to all of them so that
   * development, tests and the demo are not a licensing exercise — a
   * distribution build has to pass the customer's actual set here.
   */
  features?: FeatureSet;
  /** Log retention for jobs that do not set one; defaults to 90 days. */
  logRetentionDays?: number;
}

interface Wiring {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  logStore: Logger & TransferLogRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  tenantRepository: TenantRepository;
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

  const features = options.features ?? allFeatures();
  const processingStages = new ProcessingStageRegistry(features);
  const retentionService = new RetentionService(
    wiring.jobRepository,
    wiring.logStore,
    wiring.transferFileRepository,
    options.logRetentionDays
  );

  const userService = new UserService(wiring.userRepository, wiring.sessionRepository);

  return {
    jobRepository: wiring.jobRepository,
    runRepository: wiring.runRepository,
    transferFileRepository: wiring.transferFileRepository,
    credentialRepository: wiring.credentialRepository,
    logRepository: wiring.logStore,
    credentialService,
    features,
    processingStages,
    retentionService,
    userService,
    sessionService: new SessionService(wiring.sessionRepository, wiring.userRepository),
    userRepository: wiring.userRepository,
    sessionRepository: wiring.sessionRepository,
    jobService: new TransferJobService(
      wiring.jobRepository,
      features,
      wiring.tenantRepository,
      wiring.credentialRepository
    ),
    tenantService: new TenantService(wiring.tenantRepository, wiring.jobRepository),
    tenantRepository: wiring.tenantRepository,
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
      adapterProvider: new SourceAdapterProvider(credentialService, features),
      // Every pipeline event becomes a log entry; extra listeners still see it.
      events: combineEventListeners(createTransferEventLogger(logger), options.events),
      stagingRoot: options.stagingRoot ?? defaultStagingRoot,
      features,
      processingStages,
      retentionService,
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
      userRepository: new SqliteUserRepository(database),
      sessionRepository: new SqliteSessionRepository(database),
      tenantRepository: new SqliteTenantRepository(database),
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
      userRepository: new InMemoryUserRepository(),
      sessionRepository: new InMemorySessionRepository(),
      tenantRepository: new InMemoryTenantRepository(),
      close: () => {},
    },
    options
  );
}
