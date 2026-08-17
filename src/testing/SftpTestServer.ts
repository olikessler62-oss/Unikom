import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
// ssh2 is CommonJS and exposes no named ESM exports, so it is imported whole.
import ssh2 from 'ssh2';
import type { Connection, SFTPWrapper, Server as SshServer } from 'ssh2';

const { Server, utils } = ssh2;

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const S_IFREG = 0o100000;
const S_IFDIR = 0o40000;

export interface SftpTestServerOptions {
  /** Directory served as the SFTP root. */
  root: string;
  username?: string;
  password?: string;
  /**
   * Key accepted for public key authentication. Any key ssh2 can parse works,
   * including a private key, from which the public part is derived.
   */
  authorizedKey?: string;
  /**
   * Lässt jedes Schreiben ab diesem Versatz scheitern — ein Empfänger, dessen
   * Kontingent mitten in der Übertragung voll ist. Nur so lässt sich prüfen,
   * was mit der halb geschriebenen Datei geschieht.
   */
  failWritesAfterBytes?: number;
}

interface DirectoryHandle {
  kind: 'dir';
  entries: string[];
  position: number;
  path: string;
}

interface FileHandle {
  kind: 'file';
  descriptor: number;
  path: string;
}

/**
 * A real SFTP server for the tests. It speaks the actual protocol through the
 * ssh2 library and serves a directory from disk, so the adapter is exercised
 * end to end instead of against a mock that agrees with our assumptions.
 */
export class SftpTestServer {
  private server?: SshServer;
  private readonly connections = new Set<Connection>();
  private readonly hostKey: string;

  private constructor(
    private readonly options: SftpTestServerOptions,
    hostKey: string
  ) {
    this.hostKey = hostKey;
  }

  port = 0;

  static async start(options: SftpTestServerOptions): Promise<SftpTestServer> {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    const server = new SftpTestServer(options, privateKey);
    await server.listen();
    return server;
  }

  /** The fingerprint a client must pin, in the format OpenSSH prints. */
  get hostKeyFingerprint(): string {
    const parsed = utils.parseKey(this.hostKey);
    if (parsed instanceof Error) {
      throw parsed;
    }

    const publicKey = Array.isArray(parsed) ? parsed[0].getPublicSSH() : parsed.getPublicSSH();
    return `SHA256:${crypto.createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;

    // Closing the listener alone leaves established connections open, which
    // would keep the test process alive long after the assertions are done.
    for (const connection of this.connections) {
      connection.end();
    }
    this.connections.clear();

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async listen(): Promise<void> {
    this.server = new Server({ hostKeys: [this.hostKey] }, (connection) => this.handleConnection(connection));

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }

  private handleConnection(connection: Connection): void {
    this.connections.add(connection);
    connection.on('close', () => this.connections.delete(connection));

    connection.on('authentication', (context) => {
      if (context.method === 'password') {
        const ok =
          context.username === (this.options.username ?? 'unikom') &&
          context.password === (this.options.password ?? 'secret');
        return ok ? context.accept() : context.reject();
      }

      if (context.method === 'publickey' && this.options.authorizedKey) {
        const expected = utils.parseKey(this.options.authorizedKey);
        if (expected instanceof Error) {
          return context.reject();
        }

        const expectedKey = Array.isArray(expected) ? expected[0] : expected;
        return context.key.data.equals(expectedKey.getPublicSSH()) ? context.accept() : context.reject();
      }

      return context.reject(['password', 'publickey']);
    });

    connection.on('ready', () => {
      connection.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => this.handleSftp(acceptSftp()));
      });
    });

    connection.on('error', () => {
      // A client that drops the connection is normal in these tests.
    });
  }

  private handleSftp(sftp: SFTPWrapper): void {
    const handles = new Map<number, DirectoryHandle | FileHandle>();
    let nextHandle = 1;

    const register = (entry: DirectoryHandle | FileHandle): Buffer => {
      const id = nextHandle++;
      handles.set(id, entry);
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(id, 0);
      return buffer;
    };

    const lookup = (handle: Buffer): DirectoryHandle | FileHandle | undefined =>
      handles.get(handle.readUInt32BE(0));

    const resolve = (remotePath: string): string => {
      const relative = remotePath.replace(/^\/+/, '');
      return path.join(this.options.root, relative);
    };

    const attrsOf = (stats: fsSync.Stats) => ({
      mode: (stats.isDirectory() ? S_IFDIR : S_IFREG) | 0o644,
      uid: 0,
      gid: 0,
      size: stats.size,
      atime: Math.floor(stats.atimeMs / 1000),
      mtime: Math.floor(stats.mtimeMs / 1000),
    });

    const emptyAttrs = { mode: S_IFDIR | 0o755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };

    sftp.on('REALPATH', (reqid: number, remotePath: string) => {
      const normalised = remotePath === '.' ? '/' : path.posix.normalize(remotePath);
      sftp.name(reqid, [{ filename: normalised, longname: normalised, attrs: emptyAttrs }]);
    });

    sftp.on('OPENDIR', (reqid: number, remotePath: string) => {
      const target = resolve(remotePath);

      try {
        const entries = fsSync.readdirSync(target);
        sftp.handle(reqid, register({ kind: 'dir', entries, position: 0, path: remotePath }));
      } catch {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('READDIR', (reqid: number, handle: Buffer) => {
      const entry = lookup(handle);
      if (!entry || entry.kind !== 'dir') {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }

      if (entry.position >= entry.entries.length) {
        return sftp.status(reqid, STATUS_CODE.EOF);
      }

      const names = entry.entries.slice(entry.position).map((name) => {
        const stats = fsSync.statSync(path.join(resolve(entry.path), name));
        const attrs = attrsOf(stats);
        const type = stats.isDirectory() ? 'd' : '-';

        return {
          filename: name,
          // ssh2-sftp-client reads the entry type from this first character.
          longname: `${type}rw-r--r--   1 unikom unikom ${String(stats.size).padStart(8)} Jan  1 00:00 ${name}`,
          attrs,
        };
      });

      entry.position = entry.entries.length;
      sftp.name(reqid, names);
    });

    sftp.on('OPEN', (reqid: number, filename: string, flags: number) => {
      const target = resolve(filename);
      const mode = flags & OPEN_MODE.WRITE ? 'w' : 'r';

      try {
        sftp.handle(reqid, register({ kind: 'file', descriptor: fsSync.openSync(target, mode), path: filename }));
      } catch {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('READ', (reqid: number, handle: Buffer, offset: number, length: number) => {
      const entry = lookup(handle);
      if (!entry || entry.kind !== 'file') {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }

      const buffer = Buffer.alloc(length);
      const read = fsSync.readSync(entry.descriptor, buffer, 0, length, offset);

      if (read === 0) {
        return sftp.status(reqid, STATUS_CODE.EOF);
      }

      sftp.data(reqid, buffer.subarray(0, read));
    });

    sftp.on('WRITE', (reqid: number, handle: Buffer, offset: number, data: Buffer) => {
      const entry = lookup(handle);
      if (!entry || entry.kind !== 'file') {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }

      // Absichtlicher Abbruch mitten im Schreiben. Ohne ihn ließe sich das
      // Aufräumen nach einem gescheiterten Upload nicht prüfen: Eine Quelldatei,
      // die es nicht gibt, scheitert schon vor dem ersten Byte, und dann
      // entsteht gar keine Arbeitsdatei, die liegen bleiben könnte. Ein volles
      // Kontingent beim Empfänger sieht dagegen genau so aus.
      if (this.options.failWritesAfterBytes !== undefined && offset >= this.options.failWritesAfterBytes) {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }

      fsSync.writeSync(entry.descriptor, data, 0, data.length, offset);
      sftp.status(reqid, STATUS_CODE.OK);
    });

    sftp.on('CLOSE', (reqid: number, handle: Buffer) => {
      const id = handle.readUInt32BE(0);
      const entry = handles.get(id);

      if (entry?.kind === 'file') {
        fsSync.closeSync(entry.descriptor);
      }

      handles.delete(id);
      sftp.status(reqid, STATUS_CODE.OK);
    });

    const stat = (reqid: number, remotePath: string) => {
      try {
        sftp.attrs(reqid, attrsOf(fsSync.statSync(resolve(remotePath))));
      } catch {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }
    };

    sftp.on('STAT', stat);
    sftp.on('LSTAT', stat);

    sftp.on('FSTAT', (reqid: number, handle: Buffer) => {
      const entry = lookup(handle);
      if (!entry) {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }

      stat(reqid, entry.path);
    });

    sftp.on('RENAME', (reqid: number, oldPath: string, newPath: string) => {
      try {
        const target = resolve(newPath);

        // SSH_FXP_RENAME verlangt, dass das Ziel frei ist, und OpenSSH hält
        // sich daran — gemessen an einem echten Hoster, der mit „Failure"
        // antwortet. Node benennt hingegen stillschweigend über eine
        // vorhandene Datei hinweg. Diese Zeile schließt den Unterschied: Ein
        // Testdoppel, das mehr erlaubt als der Server, den es vertritt, lässt
        // genau die Fehler durch, für die es dasteht.
        if (fsSync.existsSync(target)) {
          sftp.status(reqid, STATUS_CODE.FAILURE);
          return;
        }

        fsSync.renameSync(resolve(oldPath), target);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, STATUS_CODE.FAILURE);
      }
    });

    sftp.on('REMOVE', (reqid: number, remotePath: string) => {
      try {
        fsSync.unlinkSync(resolve(remotePath));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('MKDIR', (reqid: number, remotePath: string) => {
      try {
        fsSync.mkdirSync(resolve(remotePath), { recursive: true });
        sftp.status(reqid, STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, STATUS_CODE.FAILURE);
      }
    });

    sftp.on('RMDIR', (reqid: number, remotePath: string) => {
      try {
        fsSync.rmdirSync(resolve(remotePath));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, STATUS_CODE.FAILURE);
      }
    });
  }
}

/** Convenience for tests: a served directory prefilled with files. */
export async function withSftpRoot(files: Record<string, string>): Promise<string> {
  const os = await import('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-sftp-root-'));

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  return root;
}
