import type Client from 'ssh2-sftp-client';

import type { DestinationAdapter } from '../../../domain/destination/DestinationAdapter.js';
import type { SourceCredentials, SourceTrace } from '../../../domain/source/SourceAdapter.js';
import { RemotePathResolver } from '../../../domain/source/RemotePathResolver.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import { assertSafeFilename } from '../../filesystem/SafePath.js';
import { openSftpConnection } from '../../sources/sftp/SftpConnection.js';

/**
 * Ein SFTP-Server als Ziel.
 *
 * Der Weg einer Datei ist derselbe wie überall: Sie liegt fertig im
 * Arbeitsbereich, geprüft und gehasht, und wird von dort abgelegt. Nur der
 * letzte Schritt ist ein anderer — statt eines Umbenennens auf der Platte ein
 * Hochladen über das Netz.
 *
 * **Hochgeladen wird unter einem Arbeitsnamen.** Ein Empfänger, der sein
 * Eingangsverzeichnis im Sekundentakt abfragt — und das tun sie —, würde sonst
 * eine Datei zu fassen bekommen, von der erst die Hälfte da ist. Erst wenn
 * alle Bytes liegen, wird umbenannt; das ist innerhalb eines Verzeichnisses
 * bei SFTP atomar. Bricht die Verbindung vorher ab, bleibt ein `.unikom-part`
 * liegen, das niemand für eine Lieferung hält.
 */
export class SftpDestinationAdapter implements DestinationAdapter {
  private client?: Client;
  /** Wie bei der Quelle: Was jemand eingetippt hat, wird einmal am Rand übersetzt. */
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

    if (!(await client.exists(resolved))) {
      if (!mayCreate) {
        throw new Error(`Das Zielverzeichnis ${resolved} fehlt, und es soll nicht automatisch angelegt werden`);
      }

      this.trace?.(`${resolved} wird angelegt`);
      await client.mkdir(resolved, true);
    }

    // Beschreibbarkeit wird geschrieben geprüft, nicht aus Rechten gelesen:
    // Ein SFTP-Server meldet Rechte, an die er sich nicht hält, und ein Kontingent
    // steht in keinem Rechtebit. Ein Lauf, der erst bei der ersten Datei merkt,
    // dass er nicht schreiben darf, hat die Quelle schon angefasst.
    const probe = this.paths.join(resolved, `.unikom-schreibprobe-${process.pid}`);
    try {
      await client.put(Buffer.from('Schreibprobe'), probe);
      await client.delete(probe);
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
    return (await client.exists(targetPath)) !== false;
  }

  async place(stagedPath: string, targetPath: string): Promise<void> {
    const client = await this.connect();
    const working = `${targetPath}.unikom-part`;

    this.trace?.(`Wird hochgeladen nach ${working}`);
    await client.fastPut(stagedPath, working);

    // Überschreiben verlangt, dass der Platz frei ist. SSH_FXP_RENAME setzt ein
    // freies Ziel voraus, und Server halten sich daran: An einem echten Hoster
    // gemessen, der ein Umbenennen auf einen belegten Namen mit „Failure"
    // beantwortet. Ohne diese Zeile bliebe bei „Überschreiben" die alte Datei
    // stehen, während der Lauf Erfolg meldete.
    if ((await client.exists(targetPath)) !== false) {
      this.trace?.(`${targetPath} wird vor dem Ersetzen entfernt`);
      await client.delete(targetPath);
    }

    this.trace?.(`Wird umbenannt nach ${targetPath}`);
    await client.rename(working, targetPath);
    this.trace?.(`${targetPath} liegt vollständig`);
  }

  async sizeOf(targetPath: string): Promise<number> {
    const client = await this.connect();
    return (await client.stat(targetPath)).size;
  }

  resolve(directory: string, filename: string): string {
    // Derselbe Schutz wie lokal: Ein Name aus einer entfernten Quelle darf
    // nicht aus dem Zielverzeichnis herausführen.
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
    return `SFTP ${this.config.host ?? '—'}:${this.config.port ?? 22}`;
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
      // Eine Verbindung, die schon fort ist, braucht kein Schließen.
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    this.client = await openSftpConnection(this.config, this.credentials, this.trace, 'Ziel');
    return this.client;
  }
}
