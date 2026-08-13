import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWithin } from '../../infrastructure/filesystem/SafePath.js';

/**
 * Internal working directory for a run (spec sections 42-43). Files are only
 * ever downloaded, validated and encrypted here; the destination directory
 * receives a file exclusively as a finished, atomic move.
 */
export class StagingService {
  async prepareStagingDirectory(stagingRoot: string, runId: string): Promise<string> {
    const stagingDirectory = path.join(path.resolve(stagingRoot), 'staging', runId);
    await fs.mkdir(stagingDirectory, { recursive: true });
    return stagingDirectory;
  }

  /**
   * Path a download writes to. The `.part` suffix marks the file as unfinished
   * so a crash cannot leave something that looks complete (spec section 82).
   */
  stagedPathFor(stagingDirectory: string, filename: string): string {
    return `${resolveWithin(stagingDirectory, filename)}.part`;
  }

  /**
   * Moves a finished staged file to its final path. Falls back to copy+delete
   * when staging and destination live on different volumes, which `rename`
   * cannot cross.
   */
  async moveToFinalPath(stagedPath: string, finalPath: string): Promise<string> {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(stagedPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }

      await fs.copyFile(stagedPath, finalPath);
      await fs.rm(stagedPath, { force: true });
    }

    return finalPath;
  }

  async cleanup(stagingDirectory: string): Promise<void> {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
}
