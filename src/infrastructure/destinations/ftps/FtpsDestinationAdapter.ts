import type { Client } from 'basic-ftp';

import type { DestinationAdapter } from '../../../domain/destination/DestinationAdapter.js';
import type { SourceCredentials, SourceTrace } from '../../../domain/source/SourceAdapter.js';
import { RemotePathResolver } from '../../../domain/source/RemotePathResolver.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import { assertSafeFilename } from '../../filesystem/SafePath.js';
import { ftpsPort, openFtpsConnection } from '../../sources/ftps/FtpsConnection.js';

/**
 * Ein FTPS-Server als Ziel — dieselbe Bauform wie beim SFTP-Ziel.
 *
 * Auch hier wird unter einem Arbeitsnamen hochgeladen und erst danach
 * umbenannt. Bei FTP ist das sogar noch nötiger als bei SFTP: Ein
 * Abholprogramm auf der Gegenseite sieht eine wachsende Datei und kann ihr
 * nicht ansehen, dass sie noch wächst.
 *
 * Der Unterschied liegt im Fragen: FTP kennt kein „gibt es das". Vorhandensein
 * wird deshalb aus der Auflistung des Verzeichnisses beantwortet, was auch das
 * ist, was ein FTP-Server verlässlich beherrscht.
 */
export class FtpsDestinationAdapter implements DestinationAdapter {
  private client?: Client;
  private readonly paths: RemotePathResolver;
  trace?: SourceTrace;

  constructor(
    private readonly config: SourceConfig,
    private readonly credentials: SourceCredentials = {}
  ) {
    this.paths = new RemotePathResolver(config.remoteWorkingDirectory);
  }

  async prepareDirectory(directory: string, mayCreate: boolean): Promise<void> {
    const resolved = this.paths.resolve(directory);
    this.trace?.(`Zielverzeichnis „${directory}“ wird gelesen als ${resolved}`, { entered: directory, resolved });

    const client = await this.connect();

    if (!(await this.directoryExists(client, resolved))) {
      if (!mayCreate) {
        throw new Error(`Das Zielverzeichnis ${resolved} fehlt, und es soll nicht automatisch angelegt werden`);
      }

      this.trace?.(`${resolved} wird angelegt`);
      await client.ensureDir(resolved);
    }

    // Wie beim SFTP-Ziel: geschrieben geprüft, nicht aus Rechten geraten.
    const probe = this.paths.join(resolved, `.unikom-schreibprobe-${process.pid}`);
    try {
      const { Readable } = await import('node:stream');
      await client.uploadFrom(Readable.from([Buffer.from('Schreibprobe')]), probe);
      await client.remove(probe);
    } catch (error) {
      throw new Error(
        `In das Zielverzeichnis ${resolved} kann nicht geschrieben werden: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.trace?.(`${resolved} ist vorhanden und beschreibbar`);
  }

  async exists(targetPath: string): Promise<boolean> {
    const client = await this.connect();
    const parent = this.paths.parentOf(targetPath);
    const name = this.nameOf(targetPath);

    try {
      const entries = await client.list(parent);
      return entries.some((entry) => entry.name === name);
    } catch {
      // Ein Verzeichnis, das nicht gelesen werden kann, enthält für diese
      // Frage nichts: Der Lauf scheitert dann beim Anlegen, mit besserem Grund.
      return false;
    }
  }

  async place(stagedPath: string, targetPath: string): Promise<void> {
    const client = await this.connect();
    const working = `${targetPath}.unikom-part`;

    this.trace?.(`Wird hochgeladen nach ${working}`);
    await client.uploadFrom(stagedPath, working);

    if (await this.exists(targetPath)) {
      this.trace?.(`${targetPath} wird vor dem Ersetzen entfernt`);
      await client.remove(targetPath);
    }

    this.trace?.(`Wird umbenannt nach ${targetPath}`);
    await client.rename(working, targetPath);
    this.trace?.(`${targetPath} liegt vollständig`);
  }

  async sizeOf(targetPath: string): Promise<number> {
    const client = await this.connect();
    return client.size(targetPath);
  }

  resolve(directory: string, filename: string): string {
    assertSafeFilename(filename);
    return this.paths.join(this.paths.resolve(directory), filename);
  }

  parentOf(targetPath: string): string {
    return this.paths.parentOf(targetPath);
  }

  nameOf(targetPath: string): string {
    const segments = targetPath.split('/');
    return segments[segments.length - 1] ?? targetPath;
  }

  describe(): string {
    return `FTPS ${this.config.host ?? '—'}:${ftpsPort(this.config)}`;
  }

  async dispose(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = undefined;
    client.close();
  }

  private async directoryExists(client: Client, directory: string): Promise<boolean> {
    try {
      await client.list(directory);
      return true;
    } catch {
      return false;
    }
  }

  private async connect(): Promise<Client> {
    if (this.client && !this.client.closed) {
      return this.client;
    }

    this.client = await openFtpsConnection(this.config, this.credentials, this.trace, 'Ziel');
    return this.client;
  }
}
