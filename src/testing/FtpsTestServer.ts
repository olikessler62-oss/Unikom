import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ftp-srv is CommonJS and exposes no named ESM exports.
import ftpSrv from 'ftp-srv';

const { FtpSrv } = ftpSrv as unknown as { FtpSrv: new (options: Record<string, unknown>) => FtpSrvInstance };

interface FtpSrvInstance {
  on(event: 'login', handler: LoginHandler): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  listen(): Promise<unknown>;
  close(): Promise<unknown>;
}

type LoginHandler = (
  data: { username: string; password: string },
  resolve: (result: { root: string }) => void,
  reject: (error: Error) => void
) => void;

const certificateDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');

export const TEST_CERTIFICATE_PATH = path.join(certificateDirectory, 'test-cert.pem');
export const TEST_KEY_PATH = path.join(certificateDirectory, 'test-key.pem');

/** The self-signed certificate a client has to trust to reach the test server. */
export async function readTestCertificate(): Promise<string> {
  return fs.readFile(TEST_CERTIFICATE_PATH, 'utf8');
}

/** ftp-srv logs every connection through bunyan; the tests do not need that. */
const silentLogger: Record<string, unknown> = {
  child: () => silentLogger,
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export interface FtpsTestServerOptions {
  root: string;
  username?: string;
  password?: string;
}

/**
 * A real explicit-FTPS server for the tests, with TLS from the checked-in
 * self-signed test certificate. Like the SFTP counterpart it exercises the
 * actual protocol rather than a stand-in.
 */
export class FtpsTestServer {
  private constructor(
    private readonly server: FtpSrvInstance,
    readonly port: number
  ) {}

  static async start(options: FtpsTestServerOptions): Promise<FtpsTestServer> {
    const port = await freePort();
    const [key, cert] = await Promise.all([fs.readFile(TEST_KEY_PATH), fs.readFile(TEST_CERTIFICATE_PATH)]);

    const server = new FtpSrv({
      url: `ftp://127.0.0.1:${port}`,
      pasv_url: '127.0.0.1',
      tls: { key, cert },
      anonymous: false,
      greeting: ['Unikom test server'],
      log: silentLogger,
    });

    server.on('login', ({ username, password }, resolve, reject) => {
      if (username === (options.username ?? 'unikom') && password === (options.password ?? 'secret')) {
        resolve({ root: options.root });
        return;
      }

      reject(new Error('Invalid username or password'));
    });

    // Client disconnects are routine in these tests.
    server.on('client-error', () => {});

    await server.listen();
    return new FtpsTestServer(server, port);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

/** Convenience for tests: a served directory prefilled with files. */
export async function withFtpsRoot(files: Record<string, string>): Promise<string> {
  const os = await import('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ftps-root-'));

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  return root;
}
