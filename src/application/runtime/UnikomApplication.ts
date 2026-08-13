import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { InMemoryCredentialRepository } from '../../infrastructure/persistence/InMemoryCredentialRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { openDatabase } from '../../infrastructure/persistence/sqlite/SqliteDatabase.js';
import { SqliteCredentialRepository } from '../../infrastructure/persistence/sqlite/SqliteCredentialRepository.js';
import { SqliteTransferFileRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferFileRepository.js';
import { SqliteTransferJobRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferJobRepository.js';
import { SqliteTransferRunRepository } from '../../infrastructure/persistence/sqlite/SqliteTransferRunRepository.js';
import { EnvironmentMasterKeyProvider, type MasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SecretCipher } from '../../infrastructure/security/SecretCipher.js';
import { CredentialEncryptionKeyProvider } from '../credentials/CredentialEncryptionKeyProvider.js';
import { CredentialService } from '../credentials/CredentialService.js';
import type { TransferEventListener } from '../transfer/TransferEvents.js';
import { SourceAdapterProvider } from '../transfer/SourceAdapterProvider.js';
import { JobRuntimeService } from './JobRuntimeService.js';

export interface UnikomApplication {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  credentialService: CredentialService;
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
  events?: TransferEventListener;
  stagingRoot?: string;
}

/**
 * Production wiring. Jobs, runs, credentials and the processed-file registry
 * live in a SQLite database inside `dataDirectory`, so schedules and history
 * survive a restart (spec sections 31, 39 and 110) and duplicate lookups hit an
 * index instead of scanning the whole history (section 101). The staging area
 * sits in the same directory as `staging/<run-id>` (section 43).
 */
export function createPersistentApplication(
  dataDirectory: string,
  options: ApplicationOptions = {}
): UnikomApplication {
  const database = openDatabase(dataDirectory);
  const jobRepository = new SqliteTransferJobRepository(database);
  const runRepository = new SqliteTransferRunRepository(database);
  const transferFileRepository = new SqliteTransferFileRepository(database);
  const credentialRepository = new SqliteCredentialRepository(database);

  const credentialService = new CredentialService(
    credentialRepository,
    new SecretCipher(options.masterKeyProvider ?? new EnvironmentMasterKeyProvider())
  );

  return {
    jobRepository,
    runRepository,
    transferFileRepository,
    credentialRepository,
    credentialService,
    runtime: new JobRuntimeService(jobRepository, {
      runRepository,
      transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider ?? new CredentialEncryptionKeyProvider(credentialService),
      adapterProvider: new SourceAdapterProvider(credentialService),
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
  const credentialRepository = new InMemoryCredentialRepository();

  const credentialService = new CredentialService(
    credentialRepository,
    new SecretCipher(options.masterKeyProvider ?? new EnvironmentMasterKeyProvider())
  );

  return {
    jobRepository,
    runRepository,
    transferFileRepository,
    credentialRepository,
    credentialService,
    runtime: new JobRuntimeService(jobRepository, {
      runRepository,
      transferFileRepository,
      encryptionKeyProvider: options.encryptionKeyProvider ?? new CredentialEncryptionKeyProvider(credentialService),
      adapterProvider: new SourceAdapterProvider(credentialService),
      events: options.events,
      stagingRoot: options.stagingRoot,
    }),
    close: () => {},
  };
}
