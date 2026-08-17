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
import { openSftpConnection } from './SftpConnection.js';

export { fingerprintOf } from './SftpConnection.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

/** Remote timestamps arrive as seconds on some servers and milliseconds on others. */
function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return new Date(value < 1e12 ? value * 1000 : value);
}

export class SftpSourceAdapter implements SourceAdapter {
  private client?: Client;
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

    this.client = await openSftpConnection(this.config, this.credentials, this.trace, 'Quelle');
    return this.client;
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
