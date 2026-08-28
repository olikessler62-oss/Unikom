import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DirectoryCheckResult {
  ok: boolean;
  message: string;
  exists: boolean;
  writable: boolean;
  /** Set when the directory does not exist yet but could be created. */
  wouldBeCreated?: boolean;
}

/**
 * Checks whether a directory can actually be used, by trying rather than
 * asking.
 *
 * Reading permission bits and deciding from them is unreliable — on Windows the
 * effective right comes from ACLs, group membership and the share's own
 * permissions, none of which a stat call reports. Writing a small file and
 * removing it again answers the question that matters: may this process put
 * something here?
 *
 * This works the same for a local path and for a UNC share. What it cannot do
 * is supply credentials: a share is reached with the identity of the process,
 * so the account Unikom runs under has to have access.
 */
export async function checkDirectory(
  directory: string,
  options: { createIfMissing?: boolean } = {}
): Promise<DirectoryCheckResult> {
  const target = directory.trim();

  if (!target) {
    return { ok: false, exists: false, writable: false, message: 'Es ist kein Verzeichnis eingetragen' };
  }

  const stats = await fs.stat(target).catch((error: NodeJS.ErrnoException) => error);

  if (stats instanceof Error) {
    return missingDirectory(target, stats, options.createIfMissing === true);
  }

  if (!stats.isDirectory()) {
    return { ok: false, exists: true, writable: false, message: `${target} ist eine Datei, kein Verzeichnis` };
  }

  const writable = await isWritable(target);

  return writable
    ? { ok: true, exists: true, writable: true, message: `${target} gibt es, und es ist beschreibbar` }
    : {
        ok: false,
        exists: true,
        writable: false,
        message:
          `${target} gibt es, aber es ist nicht beschreibbar. Bei einer Freigabe braucht das Konto, unter dem ` +
          'Unikom läuft, dort Schreibrecht - nicht die Person, die hier angemeldet ist.',
      };
}

async function missingDirectory(
  target: string,
  error: NodeJS.ErrnoException,
  createIfMissing: boolean
): Promise<DirectoryCheckResult> {
  if (error.code !== 'ENOENT') {
    return {
      ok: false,
      exists: false,
      writable: false,
      message:
        error.code === 'EACCES' || error.code === 'EPERM'
          ? `Keine Berechtigung für ${target}`
          : `${target} ist nicht erreichbar: ${error.message}`,
    };
  }

  if (!createIfMissing) {
    return {
      ok: false,
      exists: false,
      writable: false,
      message: `${target} gibt es nicht. Entweder „Zielverzeichnis anlegen, falls es fehlt“ einschalten oder den Pfad berichtigen.`,
    };
  }

  // It may be created, so the question moves up: can we write into the parent?
  const parent = path.dirname(path.resolve(target));

  if (parent === path.resolve(target)) {
    return { ok: false, exists: false, writable: false, message: `${target} lässt sich nicht anlegen` };
  }

  const parentStats = await fs.stat(parent).catch(() => undefined);

  if (!parentStats?.isDirectory()) {
    return {
      ok: false,
      exists: false,
      writable: false,
      message: `${target} gibt es nicht, und ${parent} auch nicht - es lässt sich also auch nicht anlegen.`,
    };
  }

  return (await isWritable(parent))
    ? {
        ok: true,
        exists: false,
        writable: true,
        wouldBeCreated: true,
        message: `${target} gibt es noch nicht - es wird beim ersten Lauf angelegt.`,
      }
    : {
        ok: false,
        exists: false,
        writable: false,
        message: `${target} gibt es nicht und lässt sich nicht anlegen: ${parent} ist nicht beschreibbar.`,
      };
}

/** Writes a small file and removes it again; nothing else is a real answer. */
async function isWritable(directory: string): Promise<boolean> {
  const probe = path.join(directory, `.unikom-probe-${randomUUID()}`);

  try {
    await fs.writeFile(probe, '');
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {});
  }
}
