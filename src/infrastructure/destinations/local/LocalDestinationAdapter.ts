import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import type { DestinationAdapter } from '../../../domain/destination/DestinationAdapter.js';
import type { SourceTrace } from '../../../domain/source/SourceAdapter.js';
import { resolveWithin } from '../../filesystem/SafePath.js';
import { StagingService } from '../../../application/transfer/StagingService.js';

/**
 * Das Ziel im Dateisystem — auch eine Windows-Freigabe, denn ein UNC-Pfad ist
 * ein Pfad wie jeder andere.
 *
 * Diese Klasse enthält nichts Neues. Sie ist wörtlich das, was die Pipeline
 * vorher an fünf Stellen selbst getan hat, nur hinter der Schnittstelle. Das
 * ist beabsichtigt: Solange sich das bisherige Verhalten nicht ändert, kann
 * ein entferntes Ziel danebentreten, ohne dass das bewährte in Bewegung gerät.
 */
export class LocalDestinationAdapter implements DestinationAdapter {
  trace?: SourceTrace;

  constructor(private readonly stagingService: StagingService = new StagingService()) {}

  async prepareDirectory(directory: string, mayCreate: boolean): Promise<void> {
    const resolved = path.resolve(directory);

    if (!(await this.exists(resolved))) {
      if (!mayCreate) {
        throw new Error(`Das Zielverzeichnis ${resolved} fehlt, und es soll nicht automatisch angelegt werden`);
      }

      this.trace?.(`${resolved} wird angelegt`);
      await fs.mkdir(resolved, { recursive: true });
    }

    await fs.access(resolved, fsConstants.W_OK);
    this.trace?.(`${resolved} ist vorhanden und beschreibbar`);
  }

  async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async place(stagedPath: string, targetPath: string): Promise<void> {
    await this.stagingService.moveToFinalPath(stagedPath, targetPath);
  }

  async sizeOf(targetPath: string): Promise<number> {
    return (await fs.stat(targetPath)).size;
  }

  resolve(directory: string, filename: string): string {
    return resolveWithin(directory, filename);
  }

  parentOf(targetPath: string): string {
    return path.dirname(targetPath);
  }

  nameOf(targetPath: string): string {
    return path.basename(targetPath);
  }

  describe(): string {
    return 'lokales Dateisystem';
  }
}
