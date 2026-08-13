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
    return { ok: false, exists: false, writable: false, message: 'No directory is configured' };
  }

  const stats = await fs.stat(target).catch((error: NodeJS.ErrnoException) => error);

  if (stats instanceof Error) {
    return missingDirectory(target, stats, options.createIfMissing === true);
  }

  if (!stats.isDirectory()) {
    return { ok: false, exists: true, writable: false, message: `${target} is a file, not a directory` };
  }

  const writable = await isWritable(target);

  return writable
    ? { ok: true, exists: true, writable: true, message: `${target} exists and can be written to` }
    : {
        ok: false,
        exists: true,
        writable: false,
        message:
          `${target} exists but cannot be written to. On a share, the account Unikom runs under ` +
          'needs write permission — not the person who is logged in here.',
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
          ? `No permission to reach ${target}`
          : `${target} cannot be reached: ${error.message}`,
    };
  }

  if (!createIfMissing) {
    return {
      ok: false,
      exists: false,
      writable: false,
      message: `${target} does not exist. Switch on "create if missing" or correct the path.`,
    };
  }

  // It may be created, so the question moves up: can we write into the parent?
  const parent = path.dirname(path.resolve(target));

  if (parent === path.resolve(target)) {
    return { ok: false, exists: false, writable: false, message: `${target} cannot be created` };
  }

  const parentStats = await fs.stat(parent).catch(() => undefined);

  if (!parentStats?.isDirectory()) {
    return {
      ok: false,
      exists: false,
      writable: false,
      message: `${target} does not exist, and neither does ${parent} — so it cannot be created either.`,
    };
  }

  return (await isWritable(parent))
    ? {
        ok: true,
        exists: false,
        writable: true,
        wouldBeCreated: true,
        message: `${target} does not exist yet and will be created on the first run.`,
      }
    : {
        ok: false,
        exists: false,
        writable: false,
        message: `${target} does not exist and cannot be created: ${parent} cannot be written to.`,
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
