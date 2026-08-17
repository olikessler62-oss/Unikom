import path from 'node:path';

import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import type { InstallationStateRepository } from '../../domain/installation/InstallationState.js';
import type { LogLevel, Logger, TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import { allFeatures, type FeatureSet } from '../../domain/licensing/Feature.js';
import { LicenceService, type LicenceServiceOptions } from '../licensing/LicenceService.js';
import { licencePublicKey } from '../../infrastructure/licensing/LicencePublicKey.js';
import { InMemoryCredentialRepository } from '../../infrastructure/persistence/InMemoryCredentialRepository.js';
import { InMemoryInstallationStateRepository } from '../../infrastructure/persistence/InMemoryInstallationStateRepository.js';
import { SqliteInstallationStateRepository } from '../../infrastructure/persistence/sqlite/SqliteInstallationStateRepository.js';
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
import {
  DEFAULT_MASTER_KEY_VARIABLE,
  EnvironmentMasterKeyProvider,
  type MasterKeyProvider,
} from '../../infrastructure/security/MasterKeyProvider.js';
import {
  WindowsProtectedMasterKeyProvider,
  windowsProtectionAvailable,
} from '../../infrastructure/security/WindowsProtectedMasterKeyProvider.js';
import { SecretCipher } from '../../infrastructure/security/SecretCipher.js';
import { CredentialEncryptionKeyProvider } from '../credentials/CredentialEncryptionKeyProvider.js';
import { CredentialService } from '../credentials/CredentialService.js';
import { CompositeLogger, DEFAULT_LOG_LEVEL, LevelFilteredLogger } from '../logging/Loggers.js';
import { ProtocolArchive } from '../logging/ProtocolArchive.js';
import { RunProtocolMemo } from '../logging/RunProtocolMemo.js';
import { RunProtocolWriter } from '../logging/RunProtocolWriter.js';
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
import { RunControlRegistry } from '../transfer/RunControlRegistry.js';
import { RemoteDirectoryService } from '../transfer/RemoteDirectoryService.js';
import { LocalDirectoryService } from '../transfer/LocalDirectoryService.js';
import { DestinationAdapterProvider } from '../transfer/DestinationAdapterProvider.js';
import { ShareAccessProvider } from '../transfer/ShareAccessProvider.js';
import { ShareConnectionService } from '../../infrastructure/filesystem/ShareConnectionService.js';
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
  /** The modules this installation may use; follows the licence once there is one. */
  features: FeatureSet;
  /** The paid period: what it covers, how long it runs, and whether it still does. */
  licenceService: LicenceService;
  /** Which transfers are in flight, and how to hold or stop them. */
  runControls: RunControlRegistry;
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
  /** Builds source adapters including their resolved credentials. */
  adapterProvider: SourceAdapterProvider;
  destinationProvider: DestinationAdapterProvider;
  /** Looks at a remote server while a job is being set up: exists, and what is inside. */
  remoteDirectories: RemoteDirectoryService;
  localDirectories: LocalDirectoryService;
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
  /** Wo der Hauptschlüssel herkam — der Start soll es sagen können. */
  onSecurityNotice?: (message: string) => void;
  /** Overrides how a job's keyCredentialId is turned into a key; for tests. */
  encryptionKeyProvider?: EncryptionKeyProvider;
  /** Everything below this level is dropped; defaults to INFO (section 68). */
  logLevel?: LogLevel;
  /** Extra log target next to the database, typically a ConsoleLogger. */
  logger?: Logger;
  events?: TransferEventListener;
  stagingRoot?: string;
  /**
   * The modules an *unlicensed* installation may use. Defaults to all of them so
   * that development, tests and the demo are not a licensing exercise. Once a
   * licence is in force it decides instead, because that is what was paid for.
   */
  features?: FeatureSet;
  /**
   * Where the paid period comes from. `createPersistentApplication` fills in the
   * built-in key and the licence file next to the database; tests pass their own.
   */
  licence?: LicenceServiceOptions;
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
  installationStateRepository: InstallationStateRepository;
  close(): void;
}

/**
 * Woher der Hauptschlüssel kommt, wenn niemand einen vorgibt.
 *
 * Die Reihenfolge ist eine Rangfolge: Wer die Umgebungsvariable setzt, meint
 * es so — etwa weil derselbe Schlüssel auf zwei Rechnern gelten soll — und darf
 * nicht von einer Bequemlichkeit überstimmt werden. Erst danach kommt der von
 * Windows verwahrte Schlüssel, und der setzt ein Datenverzeichnis voraus: Ohne
 * eines gibt es keinen Ort, an dem er liegen könnte.
 */
function defaultMasterKeyProvider(dataDirectory?: string, trace?: (message: string) => void): MasterKeyProvider {
  if (process.env[DEFAULT_MASTER_KEY_VARIABLE]) {
    trace?.(`Hauptschlüssel aus der Umgebungsvariablen ${DEFAULT_MASTER_KEY_VARIABLE}`);
    return new EnvironmentMasterKeyProvider();
  }

  if (dataDirectory && windowsProtectionAvailable()) {
    return new WindowsProtectedMasterKeyProvider(dataDirectory, trace);
  }

  // Bleibt die Umgebungsvariable — und damit die Meldung, die erklärt, wie man
  // eine bekommt. Sie fällt erst, wenn wirklich ein Geheimnis gebraucht wird.
  return new EnvironmentMasterKeyProvider();
}

function assemble(wiring: Wiring, options: ApplicationOptions, defaultStagingRoot?: string): UnikomApplication {
  const credentialService = new CredentialService(
    wiring.credentialRepository,
    new SecretCipher(
      options.masterKeyProvider ?? defaultMasterKeyProvider(defaultStagingRoot, options.onSecurityNotice)
    )
  );

  const logger = new LevelFilteredLogger(
    new CompositeLogger(...[wiring.logStore, options.logger].filter((target): target is Logger => Boolean(target))),
    options.logLevel ?? DEFAULT_LOG_LEVEL
  );

  // The licence decides the modules; `options.features` is what is left when
  // there is no licence to ask. Services keep being handed one FeatureSet, and
  // it is the licence service's view, so a licence installed at runtime reaches
  // them without anything being rebuilt.
  const licenceService = new LicenceService(wiring.installationStateRepository, {
    ...options.licence,
    unlicensedFeatures: options.licence?.unlicensedFeatures ?? options.features ?? allFeatures(),
  });
  const features = licenceService.features();
  const runControls = new RunControlRegistry();
  const processingStages = new ProcessingStageRegistry(features);
  /*
   * Abgelegt wird nur, wo ein Workflow es verlangt — und nur, wo es ein
   * Datenverzeichnis gibt. Die flüchtige Verdrahtung für Tests hat keines,
   * und ein Protokoll ins Arbeitsverzeichnis zu streuen wäre dort das
   * Gegenteil von hilfreich.
   */
  const protocolArchive = defaultStagingRoot ? new ProtocolArchive(defaultStagingRoot) : undefined;
  const protocolWriter = protocolArchive ? new RunProtocolWriter(wiring.logStore, protocolArchive) : undefined;

  const retentionService = new RetentionService(
    wiring.jobRepository,
    wiring.logStore,
    wiring.transferFileRepository,
    options.logRetentionDays,
    protocolArchive
  );

  const userService = new UserService(wiring.userRepository, wiring.sessionRepository);
  // Hoisted so the job editor can test a connection through the same path a
  // run would take, licence and tenant checks included.
  const adapterProvider = new SourceAdapterProvider(credentialService, features);
  const destinationProvider = new DestinationAdapterProvider(credentialService, features);
  /*
   * Eine Verbindungsverwaltung für die ganze Anwendung, nicht eine je Lauf.
   * Ihre Warteschlange je Server ist der ganze Sinn: Sie kann nur wirken,
   * solange alle Läufe durch dieselbe gehen.
   */
  const shares = new ShareConnectionService();
  const shareAccess = new ShareAccessProvider(credentialService);

  return {
    jobRepository: wiring.jobRepository,
    runRepository: wiring.runRepository,
    transferFileRepository: wiring.transferFileRepository,
    credentialRepository: wiring.credentialRepository,
    logRepository: wiring.logStore,
    credentialService,
    features,
    licenceService,
    runControls,
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
    adapterProvider,
    destinationProvider,
    remoteDirectories: new RemoteDirectoryService(adapterProvider),
    localDirectories: new LocalDirectoryService(wiring.tenantRepository),
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
      adapterProvider,
      destinationProvider,
      shares,
      shareAccess,
      // Every pipeline event becomes a log entry; extra listeners still see it.
      events: combineEventListeners(createTransferEventLogger(logger), options.events),
      stagingRoot: options.stagingRoot ?? defaultStagingRoot,
      features,
      processingStages,
      retentionService,
      runGate: licenceService,
      runControls,
      protocols: protocolWriter,
    }),
    close: wiring.close,
  };
}

/**
 * Where a licence is expected next to the database. Plain text, one line, and
 * signed — see `LicenceDocument`. It may also be installed through the
 * interface, in which case it lives in the database and no file is needed.
 */
export const LICENCE_FILENAME = 'unikom.licence';

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
      /*
       * Das Laufprotokoll steht im Arbeitsspeicher und nicht in der Datenbank.
       *
       * Es ist eine Mitschrift: gebraucht, solange jemand hinsieht, und danach
       * nur, wenn jemand es aufhebt — durch Speichern. Die Datenbank wächst
       * dadurch nicht mehr mit jeder Zeile mit (gemessen: 1,6 kB je Datei bei
       * ausführlicher Protokollierung), und ein Neustart nimmt die Protokolle
       * mit. Beides ist gewollt.
       */
      logStore: new RunProtocolMemo(),
      userRepository: new SqliteUserRepository(database),
      sessionRepository: new SqliteSessionRepository(database),
      tenantRepository: new SqliteTenantRepository(database),
      installationStateRepository: new SqliteInstallationStateRepository(database),
      close: () => database.close(),
    },
    {
      ...options,
      // A real installation checks its paid period; which key it verifies with
      // is decided at build time, and the licence file sits next to the data it
      // licenses. Both can be overridden, which is what the tests do.
      licence: {
        publicKey: licencePublicKey(),
        licenceFile: path.join(dataDirectory, LICENCE_FILENAME),
        ...options.licence,
      },
    },
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
      logStore: new RunProtocolMemo(),
      userRepository: new InMemoryUserRepository(),
      sessionRepository: new InMemorySessionRepository(),
      tenantRepository: new InMemoryTenantRepository(),
      installationStateRepository: new InMemoryInstallationStateRepository(),
      close: () => {},
    },
    options
  );
}
