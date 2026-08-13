import path from 'node:path';
import { Client, FileType } from 'basic-ftp';
import type {
  ConnectionTestResult,
  DownloadResult,
  SourceAdapter,
  SourceCredentials,
} from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

export class FtpsSourceAdapter implements SourceAdapter {
  private client?: Client;

  constructor(
    private readonly config: SourceConfig,
    private readonly credentials: SourceCredentials = {}
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const files = await this.listFiles(this.config.directory, false);

      return {
        ok: true,
        message: `TLS connection to ${this.config.host}:${this.port()} established, source directory reachable`,
        filesFound: files.filter((file) => !file.isDirectory).length,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listFiles(directory: string, recursive: boolean): Promise<SourceFile[]> {
    const client = await this.connect();
    return this.listInto(client, directory, recursive);
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    const client = await this.connect();
    await client.downloadTo(targetPath, sourceFile.fullPath);

    return { ok: true, message: `Downloaded ${sourceFile.name} over FTPS`, localPath: targetPath };
  }

  async moveFile(sourceFile: SourceFile, targetDirectory: string): Promise<void> {
    const client = await this.connect();

    const previous = await client.pwd();
    await client.ensureDir(targetDirectory);
    await client.cd(previous);

    await client.rename(sourceFile.fullPath, path.posix.join(targetDirectory, sourceFile.name));
  }

  async deleteFile(sourceFile: SourceFile): Promise<void> {
    const client = await this.connect();
    await client.remove(sourceFile.fullPath);
  }

  async dispose(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.client.close();
    this.client = undefined;
  }

  private port(): number {
    return this.config.port ?? (this.config.implicitFtps ? 990 : 21);
  }

  private async connect(): Promise<Client> {
    if (this.client && !this.client.closed) {
      return this.client;
    }

    if (!this.config.host) {
      throw new Error('The FTPS source has no host configured');
    }

    const client = new Client((this.config.timeoutSeconds ?? 30) * 1000);

    await client.access({
      host: this.config.host,
      port: this.port(),
      user: this.credentials.username ?? this.config.username,
      password: this.credentials.password,
      // Explicit FTPS by default, implicit only when the job asks for it.
      secure: this.config.implicitFtps ? 'implicit' : true,
      secureOptions: {
        // Certificates are validated unless the job disables it deliberately
        // (spec section 7).
        rejectUnauthorized: this.config.validateCertificates !== false,
        servername: this.config.host,
        // Lets a private or self-signed server certificate be trusted without
        // giving up verification for every other server.
        ca: this.config.trustedCertificate,
      },
    });

    this.client = client;
    return client;
  }

  private async listInto(client: Client, directory: string, recursive: boolean): Promise<SourceFile[]> {
    const entries = await client.list(directory);
    const files: SourceFile[] = [];

    for (const entry of entries) {
      const fullPath = path.posix.join(directory, entry.name);

      if (entry.type === FileType.Directory) {
        files.push({ name: entry.name, fullPath, isDirectory: true });

        if (recursive) {
          files.push(...(await this.listInto(client, fullPath, true)));
        }
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
