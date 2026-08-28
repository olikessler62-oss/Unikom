import { RemotePathError, RemotePathResolver } from '../../domain/source/RemotePathResolver.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceDescription } from './SourceAdapterProvider.js';

/**
 * Looking at a remote server before a job runs against it.
 *
 * One question, asked twice with different intent: "does this directory exist"
 * — which the editor shows as a tick or a cross — and "what is inside it",
 * which fills the directory browser. Both need a connection, a resolved path
 * and the same failure handling, so they are one call.
 *
 * The point of the browser is that nobody has to know the layout of a server
 * to fetch from it. Which means the answer must be the server's own: what it
 * lists is what gets used, never a path assembled from assumptions about where
 * an account starts.
 */

export interface RemoteDirectoryEntry {
  name: string;
  /** The path the server named, absolute in its own namespace. */
  path: string;
  /** The same path as the operator should type it, without the working directory. */
  relativePath: string;
}

export interface RemoteDirectoryResult {
  ok: boolean;
  message: string;
  /** What the entered path resolved to; absent when it could not be resolved. */
  path?: string;
  relativePath?: string;
  /** Where "one level up" leads, so the browser can walk back. */
  parentPath?: string;
  /** Only directories: files are not what is being chosen here. */
  entries: RemoteDirectoryEntry[];
  /** Files in this directory, as a hint that it is the right one. */
  filesFound?: number;
  /**
   * Die Dateien selbst — für Felder, in denen eine **Datei** gewählt wird.
   *
   * Getrennt von `entries`, nicht daruntergemischt: Wer ein Verzeichnis
   * aussucht, soll nicht durch tausend Dateien scrollen, und wer eine Datei
   * aussucht, soll sie nicht zwischen Ordnern suchen. Die Zahl `filesFound`
   * bleibt daneben stehen — sie gilt auch dann, wenn diese Liste nicht
   * mitgeschickt wurde.
   */
  files?: RemoteDirectoryEntry[];
  /**
   * Orte, an denen dieser Mandant schon arbeitet — im Fenster obenan.
   *
   * Sie stammen aus den vorhandenen Workflows, nicht aus einer eigenen
   * Merkliste: Die wäre zu pflegen, zu sichern und veraltete unbemerkt, und
   * sie hinge am Browser. Die Verzeichnisse der Workflows sind immer aktuell
   * und gelten für jeden, der die Oberfläche öffnet.
   */
  known?: RemoteDirectoryEntry[];
  /**
   * More than one reading of the input exists on this server. Then nothing is
   * chosen: both are named, and the operator says which one they meant.
   */
  ambiguous?: string[];
  /** Every reading that was tried, in order — the record of the decision. */
  tried?: string[];
}

export interface RemoteDirectoryRequest extends SourceDescription {
  /** What the operator typed, or what the browser is currently showing. */
  directory: string;
}

/**
 * The one thing this service needs from the outside — named as a shape rather
 * than as the class that usually provides it, so a test can hand over a single
 * open connection instead of a credential store.
 */
export interface OpensSources {
  forSource(source: SourceDescription): Promise<SourceAdapter>;
}

export class RemoteDirectoryService {
  constructor(private readonly adapterProvider: OpensSources) {}

  async browse(request: RemoteDirectoryRequest): Promise<RemoteDirectoryResult> {
    const resolver = new RemotePathResolver(request.sourceConfig.remoteWorkingDirectory);

    let candidates: string[];
    try {
      candidates = resolver.candidates(request.directory);
    } catch (error) {
      // A path that leads out of the allowed area is a result, not a crash:
      // somebody is typing, and the editor has to be able to say why.
      return {
        ok: false,
        message: error instanceof RemotePathError ? error.message : String(error),
        entries: [],
      };
    }

    const adapter = await this.adapterProvider.forSource(request);

    try {
      // Every reading is put to the server, not just the first. An input that
      // begins with the working directory can mean two directories, and both
      // of them exist on servers that carry the customer number twice. Which
      // one is meant is not ours to guess.
      const found: { path: string; listing: SourceFile[] }[] = [];
      const failures: string[] = [];

      for (const candidate of candidates) {
        try {
          found.push({ path: candidate, listing: await adapter.listFiles(candidate) });
        } catch (error) {
          failures.push(`${candidate} (${error instanceof Error ? error.message : String(error)})`);
        }
      }

      if (found.length === 0) {
        return {
          ok: false,
          // The resolved path travels with the failure: "not found" is only
          // useful next to the path that was actually looked for.
          message: `Verzeichnis nicht gefunden: ${failures.join(' - ')}`,
          path: candidates[0],
          relativePath: resolver.relative(candidates[0]),
          tried: candidates,
          entries: [],
        };
      }

      if (found.length > 1) {
        return {
          ok: false,
          message:
            `Diese Eingabe passt auf ${found.length} Verzeichnisse, die es beide gibt: ` +
            `${found.map((entry) => entry.path).join(' und ')}. ` +
            'Bitte über „Verzeichnis wählen" eines davon übernehmen.',
          ambiguous: found.map((entry) => entry.path),
          tried: candidates,
          entries: [],
        };
      }

      const [{ path: resolved, listing }] = found;
      const directories = listing.filter((entry) => entry.isDirectory);

      return {
        ok: true,
        message: `Verzeichnis gefunden: ${resolved}`,
        path: resolved,
        relativePath: resolver.relative(resolved),
        parentPath: resolver.parentOf(resolved),
        filesFound: listing.length - directories.length,
        tried: candidates,
        entries: directories
          // The server decides what its directories are called; we only sort
          // them, so the same server always reads the same way.
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => ({
            name: entry.name,
            path: entry.fullPath,
            relativePath: resolver.relative(entry.fullPath),
          })),
      };
    } finally {
      await adapter.dispose?.();
    }
  }
}
