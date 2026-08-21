import type { Writable } from 'node:stream';
import { Client, FileType } from 'basic-ftp';
import type {
  ConnectionTestResult,
  DownloadResult,
  SourceAdapter,
  SourceCredentials,
  SourceTrace,
} from '../../../domain/source/SourceAdapter.js';
import { RemotePathResolver } from '../../../domain/source/RemotePathResolver.js';
import { ftpsPort, openFtpsConnection } from './FtpsConnection.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

export class FtpsSourceAdapter implements SourceAdapter {
  private client?: Client;
  /** As in the SFTP adapter: one place decides what a typed path means. */
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
    // As in the SFTP adapter: the steps are collected and handed back, so a
    // failure can be read as a sequence instead of guessed from one line.
    const steps: string[] = [];
    const outer = this.trace;
    this.trace = (message, details) => {
      steps.push(message);
      outer?.(message, details);
    };

    try {
      const files = await this.listFiles(this.config.directory);

      return {
        ok: true,
        message: `TLS-Verbindung zu ${this.config.host}:${this.port()} steht, Quellverzeichnis erreichbar`,
        filesFound: files.filter((file) => !file.isDirectory).length,
        steps,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      steps.push(`Fehlgeschlagen: ${reason}`);

      return { ok: false, message: reason, steps };
    } finally {
      this.trace = outer;
    }
  }

  async listFiles(directory: string): Promise<SourceFile[]> {
    const resolved = this.paths.resolve(directory);
    this.trace?.(
      `„${directory}“ wird gelesen als ${resolved} (Remote-Arbeitsverzeichnis ${this.paths.workingDirectory})`,
      { entered: directory, resolved }
    );

    const client = await this.connect();
    this.trace?.(`${resolved} wird gelesen`);
    const files = await this.listInto(client, resolved);
    this.trace?.(`${resolved} gelesen: ${files.length} Einträge`);

    return files;
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird über FTPS geholt`);
    await client.downloadTo(targetPath, sourceFile.fullPath);
    this.trace?.(`${sourceFile.fullPath} über FTPS geholt`);

    return { ok: true, message: `${sourceFile.name} über FTPS geholt`, localPath: targetPath };
  }

  /**
   * Streams the file instead of writing it to a path, so it can be encrypted on
   * the way in and never lands on the disk in the clear.
   */
  async downloadTo(sourceFile: SourceFile, destination: Writable): Promise<DownloadResult> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird über FTPS im Strom gelesen`);
    await client.downloadTo(destination, sourceFile.fullPath);
    this.trace?.(`${sourceFile.fullPath} über FTPS im Strom gelesen`);

    return { ok: true, message: `${sourceFile.name} über FTPS im Strom gelesen` };
  }

  async moveFile(sourceFile: SourceFile, targetDirectory: string): Promise<void> {
    const client = await this.connect();

    const target = this.paths.resolve(targetDirectory);
    this.trace?.(`Archiv „${targetDirectory}“ wird gelesen als ${target}`, { entered: targetDirectory, resolved: target });

    const previous = await client.pwd();
    await client.ensureDir(target);
    await client.cd(previous);

    const destination = this.paths.join(target, sourceFile.name);
    this.trace?.(`${sourceFile.fullPath} wird nach ${destination} verschoben`);
    await client.rename(sourceFile.fullPath, destination);
    this.trace?.(`${sourceFile.fullPath} nach ${destination} verschoben`);
  }

  async deleteFile(sourceFile: SourceFile): Promise<void> {
    const client = await this.connect();
    this.trace?.(`${sourceFile.fullPath} wird gelöscht`);
    await client.remove(sourceFile.fullPath);
    this.trace?.(`${sourceFile.fullPath} gelöscht`);
  }

  async dispose(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.client.close();
    this.client = undefined;
  }

  private port(): number {
    return ftpsPort(this.config);
  }

  private async connect(): Promise<Client> {
    if (this.client && !this.client.closed) {
      return this.client;
    }

    this.client = await openFtpsConnection(this.config, this.credentials, this.trace, 'Quelle');
    return this.client;
  }

  private async listInto(client: Client, directory: string): Promise<SourceFile[]> {
    const entries = await client.list(directory);
    const files: SourceFile[] = [];

    for (const entry of entries) {
      const fullPath = this.paths.join(directory, entry.name);

      if (entry.type === FileType.Directory) {
        files.push({ name: entry.name, fullPath, isDirectory: true });
        continue;
      }

      // Symbolic links are skipped: they can point outside the source directory.
      if (entry.type !== FileType.File) {
        continue;
      }

      files.push({
        name: entry.name,
        fullPath,
        size: entry.size,
        lastModified: entry.modifiedAt ?? (await this.modifiedAt(client, fullPath)),
        isDirectory: false,
      });
    }

    return files;
  }

  /**
   * Many servers omit the modification time from a plain LIST. Without it the
   * minimum age rule could never be satisfied, so it is fetched per file via
   * MDTM. Servers that do not support MDTM simply leave the value unknown.
   */
  private async modifiedAt(client: Client, fullPath: string): Promise<Date | undefined> {
    try {
      return await client.lastMod(fullPath);
    } catch {
      return undefined;
    }
  }
}
