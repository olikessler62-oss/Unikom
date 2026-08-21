import type { LogLevel } from '../logging/LogEntry.js';
import type { DeliverConfig, KonsolidierungConfig, TransferStageConfig } from './WorkflowStages.js';

/**
 * Woher gelesen und wohin geschrieben wird.
 *
 * `SHARE` ist von `LOCAL` getrennt, obwohl beide über das Dateisystem laufen
 * und ein UNC-Pfad ein Pfad wie jeder andere ist. Der Unterschied liegt nicht
 * im Zugriff, sondern in der Anmeldung: Eine Freigabe kann eigene Zugangsdaten
 * verlangen, ein Verzeichnis auf der eigenen Platte nie. Beides „lokal" zu
 * nennen hieße, das Feld für den Zugang entweder überall anzubieten, wo es
 * sinnlos ist, oder nirgends, wo es gebraucht wird.
 *
 * Ältere Workflows mit UNC-Pfad bleiben `LOCAL` und laufen unverändert weiter —
 * sie erreichen die Freigabe mit der Identität des Dienstes, so wie bisher.
 */
export type SourceType = 'LOCAL' | 'SHARE' | 'SFTP' | 'FTPS';
export type ExecutionMode = 'MANUAL' | 'AUTOMATIC' | 'MANUAL_AND_AUTOMATIC';
/**
 * What happens when the destination already holds a file of that name.
 *
 * `RENAME` keeps both by appending the time of the run,
 * `ORDER_001_31012026_235959.csv`. `NEW_NAME` keeps both under a name the
 * operator chose; the extension of the incoming file is kept.
 */
export type ConflictStrategy = 'SKIP' | 'OVERWRITE' | 'RENAME' | 'NEW_NAME';

/**
 * The order in which a date is written into a filename.
 *
 * A date of digits alone is ambiguous — `01022026` is the first of February to
 * most of the world and the second of January in the United States — and the
 * only reader who can resolve it is the person the file is for. So the job
 * carries the order of the country it was set up in, rather than the server
 * picking one for everybody.
 */
export type DateNotation = 'DAY_FIRST' | 'MONTH_FIRST';
export type SourceSuccessAction = 'KEEP' | 'MOVE' | 'DELETE';
export type EncryptionProvider = 'NONE' | 'AES_256_GCM';

export interface SourceConfig {
  type: SourceType;
  directory: string;
  /**
   * Where this connection starts on the remote server, if it is not the login
   * directory: `/customer123`. Every path the operator types is read from here,
   * and none may leave it.
   *
   * Absent means `/` — whatever the server maps the account's login directory
   * to. Unikom never assumes that is the machine's root: servers put accounts
   * in chroots and virtual directories, and a path built on that assumption
   * would point somewhere else on every second server.
   */
  remoteWorkingDirectory?: string;
  host?: string;
  port?: number;
  username?: string;
  timeoutSeconds?: number;
  retryAttempts?: number;
  useSshPrivateKey?: boolean;

  /**
   * Expected SSH host key, as OpenSSH prints it: `SHA256:<base64>`.
   * Without it the connection is refused unless `allowUnknownHostKey` is set,
   * because host key verification may not be switched off silently (spec
   * section 6).
   */
  hostKeyFingerprint?: string;
  /** Deliberate, documented opt-out of host key verification. */
  allowUnknownHostKey?: boolean;

  tls?: boolean;
  /** TLS certificates are validated unless this is explicitly set to false. */
  validateCertificates?: boolean;
  /**
   * PEM certificate to trust in addition to the system store. This is how a
   * server with a private or self-signed certificate is accepted without
   * turning verification off altogether.
   */
  trustedCertificate?: string;
  /** Implicit FTPS connects with TLS from the first byte (spec section 7). */
  implicitFtps?: boolean;
}

/** Retry behaviour for temporary faults (spec sections 65-66). */
export interface RetryConfig {
  /** Total attempts including the first one. */
  attempts: number;
  /** Delay before attempt 2, 3, ... in seconds. */
  delaysSeconds: number[];
}

/**
 * How long records about transferred files are kept. Both stores hold file
 * names, and a file name is regularly personal data — "Rechnung_Mueller.pdf"
 * names a person. Keeping them without a stated period is hard to justify
 * (Art. 5(1)(e) GDPR).
 *
 * The two settings are deliberately not one, because deleting them has very
 * different consequences.
 */
export interface RetentionConfig {
  /**
   * Log entries older than this are deleted. This has no effect on transfers;
   * only the trail of what happened gets shorter. Defaults to 90 days.
   */
  logDays?: number;
  /**
   * Records of taken-over files older than this are deleted. **This changes
   * behaviour**: those records are the duplicate registry, so a file that is
   * still lying in the source directory becomes unknown again and is taken over
   * a second time.
   *
   * It only matters for `sourceSuccessAction: 'KEEP'`. A job that moves or
   * deletes its source files has nothing left to pick up twice.
   *
   * Undefined means keep indefinitely — there is no safe default here, so the
   * decision stays with whoever configures the job.
   */
  historyDays?: number;
}

export interface StabilityCheckConfig {
  enabled: boolean;
  intervalSeconds: number;
  requiredStableChecks: number;
  compareSize: boolean;
  compareLastModified: boolean;
}

/**
 * Encryption is two decisions, and they are independent of each other.
 *
 * `onPickup` says how the file travels: encrypted from its first byte, so this
 * machine never writes a readable copy of it. `enabled` says what lies in the
 * destination when the run is done.
 *
 * All four combinations are legitimate, and each answers a real question:
 *
 * | travels | at rest | what it is for |
 * |---|---|---|
 * | readable | readable | the plain transfer |
 * | readable | encrypted | the destination is a share others can read |
 * | encrypted | encrypted | nothing readable exists anywhere but the source |
 * | encrypted | readable | protected on the way, and readable for whoever — or
 * |          |          | whatever step — has to work with it afterwards |
 *
 * The last row is the reason these are two settings and not one. It used to be
 * a single setting with a timing of `ON_PICKUP` or `BEFORE_DESTINATION`, which
 * could say "encrypted the whole way" or "encrypted at the end" but not
 * "encrypted on the way and readable at the end". Stored jobs are translated
 * on read — see `reviveJob`.
 *
 * What `onPickup` cannot do: encrypt on a foreign SFTP or FTPS server. Our
 * software does not run there. That first hop is protected by SSH or TLS
 * instead, and claiming otherwise would be a promise the product cannot keep.
 */
export interface EncryptionConfig {
  /** The destination holds ciphertext. */
  enabled: boolean;
  provider: EncryptionProvider;
  keyCredentialId?: string;
  /**
   * Encrypt the stream while the file is being fetched, so no readable copy is
   * ever written to this machine. Needs a source that can deliver a stream;
   * one that cannot has its run refused rather than fetched in the clear.
   */
  onPickup?: boolean;
}

/**
 * What the *source* delivers — the counterpart of `EncryptionConfig`, which
 * describes what leaves for the destination.
 *
 * Two configurations rather than one, because they need two different keys.
 * Whoever sends data locks it with their key; whoever passes it on has to lock
 * it with the key the recipient can open — the same rule step 3 already follows
 * with a key of its own per destination. One key for both directions would only
 * work as long as sender and recipient are the same party, which is exactly the
 * case this feature exists for.
 *
 * Nothing is guessed here: the job states that its source delivers ciphertext,
 * and the file is then recognised by the envelope it carries. Encrypted data
 * looks like random data, and so does compressed data — a heuristic would sooner
 * or later wave a ZIP archive through as "already encrypted".
 */
export interface SourceEncryptionConfig {
  /** The source delivers encrypted files. */
  enabled: boolean;
  /** The key that opens them. Not the key the destination is locked with. */
  keyCredentialId?: string;
  /**
   * A file without an envelope — plaintext — in a source declared encrypted.
   * Absent means refuse: a file that was meant to be encrypted and is not is a
   * fault worth stopping for, and a source that mixes on purpose can say so.
   */
  acceptPlaintext?: boolean;
}

export interface JobSchedule {
  type: 'INTERVAL' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'CRON';
  intervalMinutes?: number;
  executionTime?: string;
  weekdays?: number[];
  cronExpression?: string;
  timezone: string;
  missedRunPolicy: 'SKIP';
}

/**
 * Die Ausführlichkeit, die ein Workflow für sich verlangen kann.
 *
 * Ohne `INFO`. „Das Wesentliche" stand einmal dafür und ist gestrichen, weil
 * die Angabe nichts aussagt: Was an der Nacht, in der etwas schieflief, das
 * Wesentliche war, entscheidet sich erst hinterher — und dann fehlt genau die
 * Zeile, die niemand für wesentlich gehalten hat. Geblieben sind drei Angaben,
 * die man ohne Rückfrage versteht: jeder Schritt, nur Warnungen und Konflikte,
 * nur Konflikte.
 *
 * `INFO` bleibt als Stufe einer *Zeile* bestehen — die meisten Zeilen tragen
 * sie. Nur als Schwelle eines Workflows gibt es sie nicht mehr.
 */
export type JobLogLevel = Exclude<LogLevel, 'INFO'>;

/**
 * Wie ausführlich ein Workflow mitschreibt, wenn er nichts anderes sagt.
 *
 * Jeder Schritt. Ein Protokoll wird gebraucht, wenn etwas schiefging, und dann
 * ist es zu spät, es lauter zu stellen: Der Lauf von heute Nacht kommt nicht
 * wieder. Was das kostet, steht in `RetentionConfig.logDays` — die Zeilen
 * bleiben nicht ewig liegen.
 *
 * Das Gegenstück in der Oberfläche steht in `web/src/screens/job/emptyJob.ts`.
 */
export const DEFAULT_JOB_LOG_LEVEL: JobLogLevel = 'DEBUG';

/**
 * Die Ausführlichkeit dieses Workflows, wie der Lauf sie anwendet.
 *
 * Alles, was keine der drei Angaben ist, wird zur Voreinstellung: kein
 * Eintrag, und ebenso das gestrichene `INFO` aus einem älteren Datensatz. Ohne
 * diese Umsetzung schriebe ein solcher Workflow still nach einer Regel weiter,
 * die es in der Oberfläche nicht mehr gibt — man läse dort „Jeder Schritt" und
 * bekäme etwas anderes.
 */
export function jobLogLevel(job: Pick<TransferJob, 'logLevel'>): JobLogLevel {
  const chosen = job.logLevel as LogLevel | undefined;

  return chosen === 'DEBUG' || chosen === 'WARNING' || chosen === 'ERROR' ? chosen : DEFAULT_JOB_LOG_LEVEL;
}

export interface TransferJob {
  id: string;
  /**
   * The client this job belongs to. An installation always has at least the
   * standard tenant, so this is never empty — a service provider who collects
   * data for several clients keeps them apart by it, and everything the job
   * writes stays inside that client's directory.
   */
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;
  sourceType: SourceType;
  sourceConfig: SourceConfig;
  credentialId?: string;
  sourceDirectory: string;
  /** Absent means the source delivers plaintext, which is the normal case. */
  sourceEncryption?: SourceEncryptionConfig;
  filenamePrefix?: string;
  allowedExtensions: string[];
  ignoredTemporaryExtensions: string[];
  minimumFileAgeSeconds: number;
  stabilityCheck: StabilityCheckConfig;
  destinationDirectory: string;
  createDestinationDirectory: boolean;
  /**
   * Wohin geschrieben wird. Fehlt es, ist es das Dateisystem — so verhielt sich
   * jeder Workflow, bevor es entfernte Ziele gab, und so muss ein gespeicherter
   * Workflow ohne diese Angabe weiterlaufen.
   *
   * Eine Windows-Freigabe ist hier kein eigener Typ: Ein UNC-Pfad ist ein Pfad
   * im Dateisystem, und ihn zu einer eigenen Art zu erklären hieße, zwei Wege
   * zu pflegen, die dasselbe tun.
   */
  destinationType?: SourceType;
  /**
   * Die Verbindungsangaben des Ziels — dieselbe Form wie bei der Quelle, weil
   * es dieselben Angaben sind: Ein SFTP-Server ist derselbe Server, ob von ihm
   * gelesen oder auf ihn geschrieben wird. Das Verzeichnis darin bleibt leer;
   * es steht in `destinationDirectory`, damit es eine Wahrheit gibt.
   */
  destinationConfig?: SourceConfig;
  /** Der Zugang zum Ziel. Nie derselbe wie der zur Quelle, auch wenn er es sein darf. */
  destinationCredentialId?: string;
  conflictStrategy: ConflictStrategy;
  /**
   * The name a file gets when it meets one of its own in the destination and
   * `conflictStrategy` is `NEW_NAME`. Without an extension: the incoming file
   * brings that with it, and a name that carried its own would decide for
   * every file what only the file itself knows.
   */
  conflictFilename?: string;
  /**
   * How a timestamp is written into a filename; defaults to `DAY_FIRST`.
   *
   * Set when the workflow is created, from the language of whoever created it,
   * and then left alone. It travels with the job and not with the viewer: the
   * name is written by a run at three in the morning, with nobody looking, and
   * the files of one workflow have to be named the same way in January and in
   * June.
   */
  timestampNotation?: DateNotation;
  encryptionConfig: EncryptionConfig;
  sourceSuccessAction: SourceSuccessAction;
  sourceArchiveDirectory?: string;
  /** Files processed at the same time; defaults to 3 (spec section 79). */
  maxConcurrentFiles?: number;
  /** Defaults to three attempts at 0, 5 and 15 seconds (spec section 65). */
  retry?: RetryConfig;
  /** How long log and file history are kept; defaults to 90 days of log. */
  retention?: RetentionConfig;
  /**
   * How much this job writes to the log, where it should differ from the
   * installation's setting.
   *
   * `DEBUG` narrates every step: each path as it was entered and as it was
   * resolved, every step of the login, every file before and after it is
   * fetched, checked, encrypted and stored. That is what a support case needs
   * and what nobody wants from thirty workflows at once — so it belongs to the
   * job, not to the server.
   *
   * Fehlt die Angabe, gilt `DEFAULT_JOB_LOG_LEVEL` — nicht die Einstellung der
   * Installation. Die Wahl „wie die Installation" gab es einmal und ist
   * gestrichen: Wer im Störungsfall wissen will, wie laut ein Workflow
   * schreibt, soll es an ihm ablesen können, statt es aus zwei Stellen
   * zusammenzusetzen. Angewendet wird sie über `jobLogLevel`, das auch ältere
   * Datensätze auf eine der drei Angaben bringt.
   */
  logLevel?: JobLogLevel;
  /**
   * Whether two files with identical content but different names count as
   * duplicates, so that the second one is not stored. **Off by default.**
   *
   * Which files a source system provides is its own decision. Whether the same
   * content arriving twice under two names is a mistake or intended is
   * something we cannot tell from here, and silently withholding a file the
   * customer sent is the riskier of the two assumptions.
   *
   * Worth switching on for one specific pattern: source systems that rewrite
   * their files nightly without changing anything. Same name, new modification
   * time - the repeat protection does not catch that, this does.
   *
   * Independent of this, the same source file is never fetched twice; that is
   * what makes a scheduled run repeatable and is not configurable.
   */
  detectContentDuplicates?: boolean;

  /**
   * Moving files from a source to a destination. Absent means it runs, so every
   * stored job keeps behaving as it did. Switched off, the source and
   * destination fields above describe nothing that happens — the workflow works
   * on files that are already lying somewhere.
   */
  transfer?: TransferStageConfig;
  /** Consolidating, correcting and deduplicating records — mit seinen Regeln. */
  consolidation?: KonsolidierungConfig;
  /**
   * Daten exportieren/importieren — entweder in eine Datenbank oder als Datei,
   * die Datei wahlweise vorher konvertiert.
   */
  delivery?: DeliverConfig;

  executionMode: ExecutionMode;
  schedule?: JobSchedule;
  lastExecutionAt?: Date;
  nextExecutionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
