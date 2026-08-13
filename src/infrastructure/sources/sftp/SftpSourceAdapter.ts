import crypto from 'node:crypto';
import path from 'node:path';
import Client from 'ssh2-sftp-client';
import type {
  ConnectionTestResult,
  DownloadResult,
  SourceAdapter,
  SourceCredentials,
} from '../../../domain/source/SourceAdapter.js';
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

  constructor(
    private readonly config: SourceConfig,
    private readonly credentials: SourceCredentials = {}
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const files = await this.listFiles(this.config.directory, false);

      return {
        ok: true,
        message: `Connected to ${this.config.host}:${this.config.port ?? 22}, source directory reachable`,
        filesFound: files.filter((file) => !file.isDirectory).length,
      };
    } catch (error) {
      // Never echo credentials; the library only reports the failure kind anyway.
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listFiles(directory: string, recursive: boolean): Promise<SourceFile[]> {
    const client = await this.connect();
    return this.listInto(client, directory, recursive);
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    const client = await this.connect();
    await client.fastGet(sourceFile.fullPath, targetPath);

    return { ok: true, message: `Downloaded ${sourceFile.name} over SFTP`, localPath: targetPath };
  }

  async moveFile(sourceFile: SourceFile, targetDirectory: string): Promise<void> {
    const client = await this.connect();

    if (!(await client.exists(targetDirectory))) {
      await client.mkdir(targetDirectory, true);
    }

    await client.rename(sourceFile.fullPath, path.posix.join(targetDirectory, sourceFile.name));
  }

  async deleteFile(sourceFile: SourceFile): Promise<void> {
    const client = await this.connect();
    await client.delete(sourceFile.fullPath);
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
      throw new Error('The SFTP source has no host configured');
    }

    const client = new Client();
    this.hostKeyProblem = undefined;

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
        throw new Error(this.hostKeyProblem);
      }

      throw error;
    }

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

    if (this.config.hostKeyFingerprint) {
      const expected = normaliseFingerprint(this.config.hostKeyFingerprint);
      const matches =
        expected.length === actual.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

      if (!matches) {
        this.hostKeyProblem =
          `The SSH host key of ${this.config.host} does not match the configured fingerprint. ` +
          `Expected ${expected}, server presented ${actual}. The connection was refused.`;
      }

      return matches;
    }

    if (this.config.allowUnknownHostKey === true) {
      return true;
    }

    this.hostKeyProblem =
      `No SSH host key fingerprint is configured for ${this.config.host}. ` +
      `The server presented ${actual}. Store this value in hostKeyFingerprint after verifying it, ` +
      'or set allowUnknownHostKey to accept any key deliberately.';

    return false;
  }

  private async listInto(client: Client, directory: string, recursive: boolean): Promise<SourceFile[]> {
    const entries = await client.list(directory);
    const files: SourceFile[] = [];

    for (const entry of entries) {
      const fullPath = path.posix.join(directory, entry.name);

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
