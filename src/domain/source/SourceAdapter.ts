import type { Writable } from 'node:stream';

import type { SourceFile } from '../files/SourceFile.js';

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Filled by "test connection" in the job editor (spec section 52). */
  filesFound?: number;
  /**
   * What happened on the way, in order: resolve, connect, verify the host key,
   * authenticate, list. A failed connection is otherwise one sentence about a
   * handshake, and the operator has to guess which of five things went wrong.
   */
  steps?: string[];
}

/**
 * Where an adapter narrates what it is doing.
 *
 * Every step, not only the ones that fail: "connecting", then "connected" —
 * because a run that hangs is diagnosed by the last line that was written, and
 * a step that only reports its success leaves nothing behind when it hangs.
 *
 * Never a secret. These lines are persisted, shown in the interface and read
 * by whoever has a support case open (spec section 51).
 */
export type SourceTrace = (message: string, details?: Record<string, unknown>) => void;

export interface DownloadResult {
  ok: boolean;
  message: string;
  localPath?: string;
}

/**
 * Access data for a remote source, resolved from a credential right before the
 * connection is opened. It never enters a transfer job, a log or a repository.
 */
export interface SourceCredentials {
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SourceAdapter {
  /**
   * Set by whoever runs this adapter, before the first call. Assigned rather
   * than passed to the constructor because the adapter is built where the
   * credentials are, and the run that wants the narration only exists later.
   */
  trace?: SourceTrace;
  testConnection(): Promise<ConnectionTestResult>;
  /**
   * Was in diesem Verzeichnis liegt — nur dort, nie darunter.
   *
   * Unterverzeichnisse mitzunehmen gab es einmal und ist gestrichen: Ein
   * Verzeichnis ist die Abmachung mit dem Absender, und was er daneben ablegt,
   * geht diesen Workflow nichts an. Die Unterverzeichnisse stehen weiter in der
   * Liste — der Verzeichnisbrowser blättert damit —, ihr Inhalt aber nicht.
   */
  listFiles(directory: string): Promise<SourceFile[]>;
  downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult>;
  /**
   * Writes the file into a stream instead of onto a path, so the bytes can be
   * hashed and encrypted on their way in and never touch the disk in the clear
   * (encryption timing ON_PICKUP).
   *
   * Optional because an adapter may not be able to stream. Callers must not
   * fall back to `downloadFile` when it is missing: that would quietly turn a
   * job configured to encrypt on pickup into one that writes plaintext, which
   * is the one outcome nobody would notice and everybody would mind.
   */
  downloadTo?(sourceFile: SourceFile, destination: Writable): Promise<DownloadResult>;
  moveFile?(sourceFile: SourceFile, targetDirectory: string): Promise<void>;
  deleteFile?(sourceFile: SourceFile): Promise<void>;
  /** Releases a network connection; local sources do not need it. */
  dispose?(): Promise<void>;
}
