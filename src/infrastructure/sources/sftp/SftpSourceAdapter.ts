import crypto from 'node:crypto';
import type { Writable } from 'node:stream';
import Client from 'ssh2-sftp-client';
import type {
  ConnectionTestResult,
  DownloadResult,
  SourceAdapter,
  SourceCredentials,
  SourceTrace,
} from '../../../domain/source/SourceAdapter.js';
import { RemotePathResolver } from '../../../domain/source/RemotePathResolver.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

/** Formats a host key the way OpenSSH shows it, so operators can compare it. */
export function fingerprintOf(hostKey: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
}

function normaliseFingerprint(value: string): string {
  const trimmed = value.trim().replace(/=+$/, '');
  return trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${trimmed}`;
}

/** Remote timestamps arrive as seconds on some servers and milliseconds on others. */
function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return new Date(value < 1e12 ? value * 1000 : value);
}

export class SftpSourceAdapter implements SourceAdapter {
  private client?: Client;
  private hostKeyProblem?: string;
  /**
   * Every path this adapter sends to the server comes out of here. The class
   * holds no path arithmetic of its own: what the operator typed is turned
   * into a server path once, at the edge, and everything inside works with
   * paths the server itself named.
   */
  private readonly paths: RemotePathResolver;
  /** Set from outside; every step below reports through it. */
  trace?: SourceTrace;

  constructor(
    private readonly config: SourceConfig,
    private readonly credentials: SourceCredentials = {}
  ) {
    this.paths = new RemotePathResolver(config.remoteWorkingDirectory);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    // The test keeps its own record of the steps and hands it back, so a failed
    // connection can be read as a sequence instead of guessed from one line.
    const steps: string[] = [];
    const outer = this.trace;
    this.trace = (message, details) => {
      steps.push(message);
      outer?.(message, details);
    };

    try {
      const files = await this.listFiles(this.config.directory, false);

      return {
        ok: true,
        message: `Verbunden mit ${this.config.host}:${this.config.port ?? 22}, Quellverzeichnis erreichbar`,
        filesFound: files.filter((file) => !file.isDirectory).length,
        steps,
      };
    } catch (error) {
      // Never echo credentials; the library only reports the failure kind anyway.
      const reason = error instanceof Error ? error.message : String(error);
      steps.push(`Fehlgeschlagen: ${reason}`);

      return { ok: false, message: reason, steps };
    } finally {
      this.trace = outer;
    }
  }

  async listFiles(directory: string, recursive: boolean): Promise<SourceFile[]> {
    const resolved = this.paths.resolve(directory);
    this.trace?.(
      `„${directory}“ wird gelesen als ${resolved} (Remote-Arbeitsverzeichnis ${this.paths.workingDirectory})`,
      { entered: directory, resolved }
    );

    const client = await this.connect();
    this.trace?.(`${resolved} wird gelesen${recursive ? ' samt Unterverzeichnissen' : ''}`);
    const files = await this.listInto(client, resolved, recursive);
    this.trace?.(`${resolved} gelesen: ${files.length} Einträge`);

    return files;
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird über SFTP geholt`);
    await client.fastGet(sourceFile.fullPath, targetPath);
    this.trace?.(`${sourceFile.fullPath} über SFTP geholt`);

    return { ok: true, message: `${sourceFile.name} über SFTP geholt`, localPath: targetPath };
  }

  /**
   * Streams the file instead of writing it to a path, so it can be encrypted
   * on the way in. `fastGet` cannot do this: it opens the target file itself
   * and would put plaintext on the disk before anybody could intervene.
   */
  async downloadTo(sourceFile: SourceFile, destination: Writable): Promise<DownloadResult> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird über SFTP im Strom gelesen`);
    await client.get(sourceFile.fullPath, destination);
    this.trace?.(`${sourceFile.fullPath} über SFTP im Strom gelesen`);

    return { ok: true, message: `${sourceFile.name} über SFTP im Strom gelesen` };
  }

  async moveFile(sourceFile: SourceFile, targetDirectory: string): Promise<void> {
    const client = await this.connect();

    const target = this.paths.resolve(targetDirectory);
    this.trace?.(`Archiv „${targetDirectory}“ wird gelesen als ${target}`, { entered: targetDirectory, resolved: target });

    if (!(await client.exists(target))) {
      this.trace?.(`${target} wird angelegt`);
      await client.mkdir(target, true);
    }

    const destination = this.paths.join(target, sourceFile.name);
    this.trace?.(`${sourceFile.fullPath} wird nach ${destination} verschoben`);
    await client.rename(sourceFile.fullPath, destination);
    this.trace?.(`${sourceFile.fullPath} nach ${destination} verschoben`);
  }

  async deleteFile(sourceFile: SourceFile): Promise<void> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird gelöscht`);
    await client.delete(sourceFile.fullPath);
    this.trace?.(`${sourceFile.fullPath} gelöscht`);
  }

  async dispose(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = undefined;

    try {
      await client.end();
    } catch {
      // A connection that is already gone needs no closing.
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    if (!this.config.host) {
      throw new Error('Für diese SFTP-Quelle ist kein Server eingetragen');
    }

    const client = new Client();
    this.hostKeyProblem = undefined;

    const method = this.credentials.privateKey ? 'Schlüsseldatei' : this.credentials.password ? 'Passwort' : 'ohne Anmeldedaten';
    this.trace?.(
      `Verbindung zu ${this.config.host}:${this.config.port ?? 22} als ` +
        `„${this.credentials.username ?? this.config.username ?? '—'}“ über ${method}`
    );

    try {
      await client.connect({
        host: this.config.host,
        port: this.config.port ?? 22,
        username: this.credentials.username ?? this.config.username,
        password: this.credentials.password,
        privateKey: this.credentials.privateKey,
        passphrase: this.credentials.passphrase,
        readyTimeout: (this.config.timeoutSeconds ?? 30) * 1000,
        hostVerifier: (hostKey: Buffer) => this.verifyHostKey(hostKey),
      });
    } catch (error) {
      // A rejected host key surfaces as a generic handshake failure, which
      // would send the operator hunting in the wrong place.
      if (this.hostKeyProblem) {
        this.trace?.(this.hostKeyProblem);
        throw new Error(this.hostKeyProblem);
      }

      this.trace?.(`Verbindung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    this.trace?.(`Verbunden und angemeldet über ${method}`);
    this.client = client;
    return client;
  }

  /**
   * Host key verification (spec section 6). Without a configured fingerprint
   * the connection is refused; switching the check off requires the explicit
   * `allowUnknownHostKey` flag.
   */
  private verifyHostKey(hostKey: Buffer): boolean {
    const actual = fingerprintOf(hostKey);
    this.trace?.(`Der Server zeigt den Hostkey ${actual}`);

    if (this.config.hostKeyFingerprint) {
      const expected = normaliseFingerprint(this.config.hostKeyFingerprint);
      const matches =
        expected.length === actual.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

      this.trace?.(
        matches ? 'Der Hostkey stimmt mit dem hinterlegten Fingerabdruck überein' : 'Der Hostkey stimmt NICHT überein'
      );

      if (!matches) {
        this.hostKeyProblem =
          `Der SSH-Hostkey von ${this.config.host} stimmt nicht mit dem hinterlegten Fingerabdruck überein. ` +
          `Erwartet ${expected}, der Server zeigt ${actual}. Die Verbindung wurde abgelehnt.`;
      }

      return matches;
    }

    if (this.config.allowUnknownHostKey === true) {
      this.trace?.('Der Hostkey wird ungeprüft angenommen, weil der Workflow einen unbekannten Schlüssel erlaubt');
      return true;
    }

    this.hostKeyProblem =
      `Für ${this.config.host} ist kein SSH-Hostkey-Fingerabdruck hinterlegt. ` +
      `Der Server zeigt ${actual}. Diesen Wert nach einer Prüfung als Fingerabdruck eintragen — ` +
      'oder ausdrücklich erlauben, dass ein unbekannter Hostkey angenommen wird.';

    return false;
  }

  private async listInto(client: Client, directory: string, recursive: boolean): Promise<SourceFile[]> {
    const entries = await client.list(directory);
    const files: SourceFile[] = [];

    for (const entry of entries) {
      const fullPath = this.paths.join(directory, entry.name);

      if (entry.type === 'd') {
        files.push({ name: entry.name, fullPath, isDirectory: true });

        if (recursive) {
          files.push(...(await this.listInto(client, fullPath, true)));
        }
        continue;
      }

      // Symbolic links are skipped: they can point outside the source directory.
      if (entry.type !== '-') {
        continue;
      }

      files.push({
        name: entry.name,
        fullPath,
        size: entry.size,
        lastModified: toDate(entry.modifyTime),
        isDirectory: false,
      });
    }

    return files;
  }
}
