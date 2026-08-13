import fs from 'node:fs/promises';
import path from 'node:path';

import type { FileProcessingContext } from '../../../domain/processing/FileProcessingContext.js';

/**
 * Where a stage may write intermediate files: a directory of its own inside the
 * run's staging area, one per file.
 *
 * Staging is the only place a stage is allowed to produce anything, and it is
 * removed when the run ends. That is what keeps decrypted content from
 * outliving the run, and it keeps the destination directory holding exactly
 * what step 1 put there.
 *
 * The location is derived from `temporaryPath`: its directory is the run's
 * staging area, and its file name already carries the transfer's own id, which
 * makes it unique even when the same file name occurs in several source
 * subdirectories. Giving each file its own directory means a stage can use the
 * plain, logical file name inside it.
 */
export async function workingDirectoryFor(context: FileProcessingContext): Promise<string> {
  const stagingDirectory = path.dirname(context.temporaryPath);
  const unique = path.basename(context.temporaryPath, '.part');
  const workspace = path.join(stagingDirectory, unique);

  await fs.mkdir(workspace, { recursive: true });

  return workspace;
}
