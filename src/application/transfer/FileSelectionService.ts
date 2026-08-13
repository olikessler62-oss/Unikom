import type { SourceFile, FileSelectionCriteria } from '../../domain/files/SourceFile.js';

export type FileRejectionReason =
  | 'DIRECTORY'
  | 'TEMPORARY_EXTENSION'
  | 'PREFIX_MISMATCH'
  | 'EXTENSION_MISMATCH'
  | 'TOO_YOUNG'
  | 'AGE_UNKNOWN';

export interface FileSelectionResult {
  selected: boolean;
  reason?: FileRejectionReason;
}

/**
 * Central file filter (spec sections 19-20). Every source uses the same rules,
 * so no protocol adapter is allowed to filter on its own.
 *
 * The stability check is deliberately not part of this service: it requires
 * repeated measurements over time and lives in FileStabilityService.
 */
export class FileSelectionService {
  matchesFilename(filename: string, prefix?: string, caseSensitive = false): boolean {
    if (!prefix) {
      return true;
    }

    const actualName = caseSensitive ? filename : filename.toLowerCase();
    const pattern = caseSensitive ? prefix : prefix.toLowerCase();
    return actualName.startsWith(pattern);
  }

  matchesExtension(filename: string, allowedExtensions: string[]): boolean {
    if (allowedExtensions.length === 0) {
      return true;
    }

    const normalizedAllowed = allowedExtensions.map((extension) => this.normalizeExtension(extension));
    return normalizedAllowed.includes(this.getExtension(filename));
  }

  /**
   * A file whose last extension marks an unfinished upload is never picked up,
   * no matter which other filters would match (spec sections 37-38).
   */
  isTemporary(filename: string, ignoredTemporaryExtensions: string[] = []): boolean {
    if (ignoredTemporaryExtensions.length === 0) {
      return false;
    }

    const normalizedIgnored = ignoredTemporaryExtensions.map((extension) => this.normalizeExtension(extension));
    return normalizedIgnored.includes(this.getExtension(filename));
  }

  isOldEnough(fileAgeSeconds: number, minimumFileAgeSeconds: number): boolean {
    return fileAgeSeconds >= minimumFileAgeSeconds;
  }

  ageInSeconds(file: SourceFile, now: Date): number | undefined {
    if (!file.lastModified) {
      return undefined;
    }

    return (now.getTime() - file.lastModified.getTime()) / 1000;
  }

  /**
   * Applies all active filters with AND semantics (spec section 18) and reports
   * why a file was rejected, which feeds both the run statistics and the
   * "show matching files" preview of spec section 53.
   */
  evaluate(file: SourceFile, criteria: FileSelectionCriteria, now: Date = new Date()): FileSelectionResult {
    if (file.isDirectory) {
      return { selected: false, reason: 'DIRECTORY' };
    }

    if (this.isTemporary(file.name, criteria.ignoredTemporaryExtensions)) {
      return { selected: false, reason: 'TEMPORARY_EXTENSION' };
    }

    if (!this.matchesFilename(file.name, criteria.filenamePrefix, criteria.caseSensitivePrefix)) {
      return { selected: false, reason: 'PREFIX_MISMATCH' };
    }

    if (!this.matchesExtension(file.name, criteria.allowedExtensions)) {
      return { selected: false, reason: 'EXTENSION_MISMATCH' };
    }

    if (criteria.minimumFileAgeSeconds > 0) {
      const age = this.ageInSeconds(file, now);
      if (age === undefined) {
        // Without a timestamp the age requirement cannot be proven, and an
        // unproven file must never be treated as ready (spec section 116).
        return { selected: false, reason: 'AGE_UNKNOWN' };
      }

      if (!this.isOldEnough(age, criteria.minimumFileAgeSeconds)) {
        return { selected: false, reason: 'TOO_YOUNG' };
      }
    }

    return { selected: true };
  }

  matches(file: SourceFile, criteria: FileSelectionCriteria, now: Date = new Date()): boolean {
    return this.evaluate(file, criteria, now).selected;
  }

  private normalizeExtension(extension: string): string {
    const cleaned = extension.trim().toLowerCase();
    return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === filename.length - 1) {
      return '';
    }

    return filename.slice(lastDot).toLowerCase();
  }
}
