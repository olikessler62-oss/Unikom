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
import { SqliteProfilRepository } from '../../infrastructure/persistence/sqlite/SqliteProfilRepository.js';
import { SqliteSnapshotRepository } from '../../infrastructure/persistence/sqlite/SqliteSnapshotRepository.js';
import { PrivacyService } from '../privacy/PrivacyService.js';
import { dateiBestand } from '../../infrastructure/privacy/DateiBestand.js';
import {
  angekuendigterBestand,
  laufprotokollBestand,
  uebertrageneDateienBestand,
} from '../../infrastructure/privacy/SqliteBestaende.js';
import type { Bestand } from '../../domain/privacy/DataStore.js';
import { InMemoryProfilRepository } from '../../infrastructure/persistence/InMemoryProfilRepository.js';
import { InMemorySnapshotRepository } from '../../infrastructure/persistence/InMemorySnapshotRepository.js';
import type { ProfilRepository } from '../../domain/consolidation/Profil.js';
import type { SchnappschussRepository } from '../../domain/consolidation/Snapshot.js';
import { BackgroundService } from '../background/BackgroundService.js';
import { ConflictService } from '../conflicts/ConflictService.js';
import { ResultService } from '../result/ResultService.js';
import { ConsolidationService } from '../consolidation/ConsolidationService.js';
import { ProfileService } from '../consolidation/ProfileService.js';
import { MappingService } from '../mapping/MappingService.js';
import { QualityService } from '../quality/QualityService.js';
import type { Benachrichtigungsbestand } from '../../domain/background/Benachrichtigung.js';
import type { Herzschlagbestand } from '../../domain/background/Heartbeat.js';
import type { Konfliktbestand } from '../../domain/conflicts/Konfliktbestand.js';
import type { Ergebnisbestand } from '../../domain/result/Ergebnisstand.js';
import type { MappingRepository } from '../../domain/mapping/Regelbestand.js';
import { SqliteConflictRepository } from '../../infrastructure/persistence/sqlite/SqliteConflictRepository.js';
import { SqliteResultRepository } from '../../infrastructure/persistence/sqlite/SqliteResultRepository.js';
import {
  SqliteHeartbeatRepository,
  SqliteNotificationRepository,
} from '../../infrastructure/persistence/sqlite/SqliteBackgroundRepository.js';
import { SqliteMappingRepository } from '../../infrastructure/persistence/sqlite/SqliteMappingRepository.js';
import { InMemoryConflictRepository } from '../../infrastructure/persistence/InMemoryConflictRepository.js';
import { InMemoryResultRepository } from '../../infrastructure/persistence/InMemoryResultRepository.js';
import {
  InMemoryHeartbeatRepository,
  InMemoryNotificationRepository,
} from '../../infrastructure/persistence/InMemoryBackgroundRepository.js';
import { InMemoryMappingRepository } from '../../infrastructure/persistence/InMemoryMappingRepository.js';
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
import { NodeDateiablage } from '../../infrastructure/filesystem/NodeDateiablage.js';
import { Umformungsvorschaudienst } from '../workflow/Umformungsvorschau.js';
import { Zuordnungsvorschaudienst } from '../workflow/Zuordnungsvorschau.js';
import { Ausleitungsdienst } from '../conflicts/Ausleitungsdienst.js';
import { Referenzquellendienst } from '../consolidation/Referenzquellendienst.js';
import type { Referenzquellenbestand } from '../../domain/consolidation/Referenzquelle.js';
import { InMemoryReferenzquellenRepository } from '../../infrastructure/persistence/InMemoryReferenzquellenRepository.js';
import { SqliteReferenzquellenRepository } from '../../infrastructure/persistence/sqlite/SqliteReferenzquellenRepository.js';
import type { Ausleitungsbestand } from '../../domain/conflicts/Ausleitung.js';
import { InMemoryAusleitungsRepository } from '../../infrastructure/persistence/InMemoryAusleitungsRepository.js';
import { SqliteAusleitungsRepository } from '../../infrastructure/persistence/sqlite/SqliteAusleitungsRepository.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { InMemoryZwischenstandRepository } from '../../infrastructure/persistence/InMemoryZwischenstandRepository.js';
import { SqliteZwischenstandRepository } from '../../infrastructure/persistence/sqlite/SqliteZwischenstandRepository.js';
import { BlockweiseKonsolidierung } from '../consolidation/BlockweiseKonsolidierung.js';
import type { Zwischenstandbestand } from '../../domain/consolidation/Zwischenstand.js';
import type { Konsolidierungsbericht } from '../consolidation/ConsolidationService.js';
import { SmtpPostbote } from '../../infrastructure/mail/SmtpPostbote.js';
import { meldeeinstellungenAus, ZugangsAnmeldebuch } from '../background/Postfach.js';
import { ShareAccessProvider } from '../transfer/ShareAccessProvider.js';
import {
  ShareConnectionService,
  type ShareConnections,
} from '../../infrastructure/filesystem/ShareConnectionService.js';
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
  profilRepository: ProfilRepository;
  snapshots: SchnappschussRepository;
  profileService: ProfileService;
  mappingRepository: MappingRepository;
  mappingService: MappingService;
  qualityService: QualityService;
  consolidationService: ConsolidationService;
  conflictRepository: Konfliktbestand;
  conflictService: ConflictService;
  /** Schreibt Konflikt- und Konfliktzieldateien und raeumt sie nach Frist fort (SPEC-07 §5). */
  ausleitungsdienst: Ausleitungsdienst;
  /** Verwaltet die Referenzquellen und liest sie zum Lauf (SPEC-04 §6, §8). */
  referenzquellen: Referenzquellendienst;
  resultRepository: Ergebnisbestand;
  resultService: ResultService;
  /** Herzschlag, abgebrochene Läufe und Benachrichtigungen (Etappe 8). */
  backgroundService: BackgroundService;
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
  /** Zeigt, was die eingestellten Umformungen mit einer echten Datei tun (SPEC-09 §11). */
  umformungsvorschau: Umformungsvorschaudienst;
  /** Zeigt, welchem internen Feld eine Spalte entspricht (SPEC-09 §11). */
  zuordnungsvorschau: Zuordnungsvorschaudienst;
  /**
   * Verbindet Windows-Freigaben mit ihrem hinterlegten Zugang.
   *
   * Nicht nur für den Lauf: Auch Verbindungsprobe, Verzeichnisbrowser und
   * Zielprüfung gehen hier durch. Sie sollen sehen, was der Lauf sieht — sonst
   * urteilt der Editor über das Konto, unter dem Unikom gerade läuft, und
   * nicht über den Zugang, der nachts benutzt wird.
   */
  shares: ShareConnections;
  shareAccess: ShareAccessProvider;
  logger: Logger;
  /** Auskunft und Löschauftrag über alle Bestände (FR_009). */
  privacyService: PrivacyService;
  runtime: JobRuntimeService;
  /** Releases the storage handle; a no-op for the in-memory variant. */
  close(): void;
}

export interface ApplicationOptions {
  /**
   * Wie viele Datensätze eine Konsolidierung höchstens umfasst.
   *
   * Fehlt sie, gilt `HOECHSTMENGE`. Sie beschreibt den Rechner und nicht den
   * Kunden — zwei Mandanten auf derselben Maschine teilen sich denselben
   * Arbeitsspeicher.
   */
  hoechstmenge?: number;
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
  /**
   * Die Bestände für Auskunft und Löschauftrag (FR_009).
   *
   * Nur für die flüchtige Bauart: Die echten hängen an der Datenbank und werden
   * dort verdrahtet. Ohne diesen Weg ließe sich das Verhalten der Schnittstelle
   * nicht prüfen — eine Installation ohne Bestände beauskunftet nichts.
   */
  bestaende?: Bestand[];
}

interface Wiring {
  jobRepository: TransferJobRepository;
  runRepository: TransferRunRepository;
  transferFileRepository: TransferFileRepository;
  credentialRepository: CredentialRepository;
  logStore: Logger & TransferLogRepository;
  userRepository: UserRepository;
  profilRepository: ProfilRepository;
  snapshots: SchnappschussRepository;
  mappingRepository: MappingRepository;
  conflictRepository: Konfliktbestand;
  resultRepository: Ergebnisbestand;
  heartbeatRepository: Herzschlagbestand;
  notificationRepository: Benachrichtigungsbestand;
  /** Die Zwischenstände der blockweisen Konsolidierung (SPEC-06, Abschnitt 15). */
  blockRepository: Zwischenstandbestand<Konsolidierungsbericht>;
  sessionRepository: SessionRepository;
  tenantRepository: TenantRepository;
  installationStateRepository: InstallationStateRepository;
  /** Die Ausleitungen des Konfliktbestands (SPEC-07, Dateimodell). */
  ausleitungsbestand: Ausleitungsbestand;
  /** Die verwalteten Referenzquellen (SPEC-04, Abschnitt 8). */
  referenzquellenbestand: Referenzquellenbestand;
  /** Die Bestände für Auskunft und Löschauftrag (FR_009); leer in der flüchtigen Bauart. */
  bestaende?: Bestand[];
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
  const retentionService = new RetentionService(
    wiring.jobRepository,
    wiring.logStore,
    wiring.transferFileRepository,
    options.logRetentionDays
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

  /*
   * Die Dienste der Etappen 5 bis 8 stehen hier oben und nicht erst im
   * Rueckgabewert: Der Lauf braucht sie. Ein Workflow mit eingeschaltetem
   * Konsolidierungsschritt lief bis hierher still ohne ihn — die Kette war
   * gebaut, aber nirgends angeschlossen.
   */
  const consolidationService = new ConsolidationService();
  /*
   * Die blockweise Verarbeitung legt sich um den Dienst und ersetzt ihn nicht:
   * Bei einem Block läuft genau der Weg von vorher. Ein zweiter Weg durch
   * dieselbe Rechnung wäre die Stelle, an der die beiden eines Tages
   * verschiedene Ergebnisse liefern.
   */
  const blockweise = new BlockweiseKonsolidierung(consolidationService, wiring.blockRepository, logger);
  const conflictService = new ConflictService(wiring.conflictRepository, logger);
  const resultService = new ResultService(wiring.resultRepository, logger);
  const backgroundService = new BackgroundService(
    wiring.heartbeatRepository,
    wiring.notificationRepository,
    wiring.runRepository,
    logger,
    undefined,
    {
      postbote: new SmtpPostbote(new ZugangsAnmeldebuch(credentialService)),
      einstellungen: meldeeinstellungenAus(wiring.tenantRepository),
    }
  );

  const mappingService = new MappingService(wiring.mappingRepository, logger);

  /*
   * Eine Ablage für beide Vorschauen.
   *
   * Sie sehen dieselben Verzeichnisse und müssen dieselbe Datei wählen — zwei
   * Ablagen wären zwei Gelegenheiten, das auseinanderlaufen zu lassen.
   */
  const ablage = new NodeDateiablage();

  const referenzquellen = new Referenzquellendienst(wiring.referenzquellenbestand, ablage, logger);

  const ausleitungsdienst = new Ausleitungsdienst(
    wiring.conflictRepository,
    wiring.ausleitungsbestand,
    ablage,
    logger,
    {
      /*
       * Ein Lauf ist durch, wenn er nicht mehr laeuft und nicht misslungen
       * ist. Alles andere behaelt seine Unterlagen: Wer einen misslungenen
       * Lauf untersucht, braucht genau die Dateien, die eine Frist sonst
       * fortraeumte (SPEC-07, Abschnitt 5).
       */
      abgeschlossen: async (laufId) => {
        const lauf = await wiring.runRepository.getById(laufId);

        return (
          lauf?.status === TransferRunStatus.SUCCESS || lauf?.status === TransferRunStatus.SUCCESS_NO_FILES
        );
      },
    },
    {
      /*
       * Die Frist je Mandant (SPEC-07 §5). Was je Kunde verschieden sein kann,
       * gehört nicht an die Installation.
       */
      tage: async (tenantId) => (await wiring.tenantRepository.getById(tenantId))?.ausleitungenTage,
    }
  );

  return {
    jobRepository: wiring.jobRepository,
    profilRepository: wiring.profilRepository,
    snapshots: wiring.snapshots,
    profileService: new ProfileService(wiring.profilRepository, wiring.snapshots, wiring.tenantRepository, logger),
    mappingRepository: wiring.mappingRepository,
    mappingService,
    qualityService: new QualityService(),
    consolidationService,
    conflictRepository: wiring.conflictRepository,
    conflictService,
    ausleitungsdienst,
    referenzquellen,
    resultRepository: wiring.resultRepository,
    resultService,
    backgroundService,
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
    umformungsvorschau: new Umformungsvorschaudienst(ablage),
    zuordnungsvorschau: new Zuordnungsvorschaudienst(ablage, mappingService),
    shares,
    shareAccess,
    logger,
    privacyService: new PrivacyService(wiring.bestaende ?? [], logger),
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
      ausleitungen: ausleitungsdienst,
      runGate: licenceService,
      runControls,
      terminwache: (versaeumt) => backgroundService.meldeAusbleiben(versaeumt).then(() => undefined),
      konsolidierung: {
        consolidation: consolidationService,
        conflicts: conflictService,
        results: resultService,
        tenants: wiring.tenantRepository,
        ablage: new NodeDateiablage(),
        // Damit ein Durchgang, der von einer Windows-Freigabe liest, sie mit
        // dem hinterlegten Zugang verbindet und nicht mit dem Dienstkonto.
        freigaben: shares,
        freigabezugang: shareAccess,
        referenzen: referenzquellen,
        blockweise,
        background: backgroundService,
        logger,
        features,
        hoechstmenge: options.hoechstmenge,
      },
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
  /*
   * Was die Datenbank beim Öffnen an bestehenden Daten umgestellt hat. Das
   * Protokoll steht in eben dieser Datenbank, es gibt also im Augenblick der
   * Umstellung noch keines — die Meldungen warten hier und werden geschrieben,
   * sobald der Protokollierer steht.
   */
  const umstellungen: string[] = [];
  const database = openDatabase(dataDirectory, (message) => umstellungen.push(message));

  const jobRepository = new SqliteTransferJobRepository(database);

  /*
   * Protokoll und Dateiliste kennen den Workflow, nicht den Mandanten. Ohne
   * diese Auflösung könnten sie die Eingrenzung auf einen Mandanten nur
   * vortäuschen — und ein Löschauftrag „nur für Mandant A" nähme die Zeilen
   * aller anderen mit (FR_009, Abschnitt 5).
   */
  const jobsOfTenant = async (tenantId: string): Promise<string[]> =>
    (await jobRepository.list()).filter((job) => job.tenantId === tenantId).map((job) => job.id);

  const application = assemble(
    {
      jobRepository,
      runRepository: new SqliteTransferRunRepository(database),
      transferFileRepository: new SqliteTransferFileRepository(database),
      credentialRepository: new SqliteCredentialRepository(database),
      /*
       * Das Laufprotokoll steht in der Datenbank.
       *
       * Es ist der einzige Zeuge dessen, was ein Lauf getan hat, und gebraucht
       * wird er fast immer später: Was um drei Uhr schiefging, sieht jemand um
       * acht, und dazwischen kann der Rechner neu gestartet haben. Ein
       * Protokoll, das ein Neustart mitnimmt, ist genau dann fort, wenn es
       * gebraucht wird — und ein Kunde, der keinen Zugang zu seinem System
       * gewährt, hat dann nichts, was er schicken könnte.
       *
       * Das kostet Platz: gemessene 1,6 kB je Datei bei ausführlicher
       * Protokollierung. Dagegen steht die Aufbewahrung — voreingestellt
       * neunzig Tage, je Workflow einstellbar (`RetentionConfig.logDays`), und
       * sie räumt hier wirklich etwas fort. Eine Datei wird daneben nicht mehr
       * geschrieben; wer ein Protokoll aus der Hand geben will, speichert es in
       * der Laufansicht.
       */
      logStore: new SqliteTransferLogStore(database),
      userRepository: new SqliteUserRepository(database),
      profilRepository: new SqliteProfilRepository(database),
      snapshots: new SqliteSnapshotRepository(database),
      mappingRepository: new SqliteMappingRepository(database),
      conflictRepository: new SqliteConflictRepository(database),
      ausleitungsbestand: new SqliteAusleitungsRepository(database),
      referenzquellenbestand: new SqliteReferenzquellenRepository(database),
      resultRepository: new SqliteResultRepository(database),
      heartbeatRepository: new SqliteHeartbeatRepository(database),
      notificationRepository: new SqliteNotificationRepository(database),
      blockRepository: new SqliteZwischenstandRepository<Konsolidierungsbericht>(database),
      bestaende: [
        laufprotokollBestand(database, jobsOfTenant),
        uebertrageneDateienBestand(database, jobsOfTenant),
        dateiBestand(new SqliteTenantRepository(database)),
        angekuendigterBestand(
          'konflikte',
          'Konfliktbestand',
          'Feldwerte im Klartext, zur Bearbeitung durch einen Menschen',
          'Diesen Bestand gibt es in dieser Fassung noch nicht; er entsteht mit der Konfliktbearbeitung (SPEC-07)'
        ),
      ],
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

  for (const message of umstellungen) {
    application.logger.log({ timestamp: new Date(), level: 'WARNING', message });
  }

  return application;
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
      profilRepository: new InMemoryProfilRepository(),
      snapshots: new InMemorySnapshotRepository(),
      mappingRepository: new InMemoryMappingRepository(),
      conflictRepository: new InMemoryConflictRepository(),
      ausleitungsbestand: new InMemoryAusleitungsRepository(),
      referenzquellenbestand: new InMemoryReferenzquellenRepository(),
      resultRepository: new InMemoryResultRepository(),
      heartbeatRepository: new InMemoryHeartbeatRepository(),
      notificationRepository: new InMemoryNotificationRepository(),
      blockRepository: new InMemoryZwischenstandRepository<Konsolidierungsbericht>(),
      sessionRepository: new InMemorySessionRepository(),
      tenantRepository: new InMemoryTenantRepository(),
      installationStateRepository: new InMemoryInstallationStateRepository(),
      bestaende: options.bestaende,
      close: () => {},
    },
    options
  );
}
