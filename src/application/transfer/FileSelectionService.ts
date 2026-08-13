import type { SourceFile, FileSelectionCriteria } from '../../domain/files/SourceFile.js';

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

    const normalizedAllowed = allowedExtensions.map((ext) => this.normalizeExtension(ext));
    const extension = this.getExtension(filename);
    return normalizedAllowed.includes(extension);
  }

  isOldEnough(fileAgeSeconds: number, minimumFileAgeSeconds: number): boolean {
    return fileAgeSeconds >= minimumFileAgeSeconds;
  }

  isStable(file: SourceFile, previousSize?: number, previousModified?: Date): boolean {
    if (typeof file.size !== 'number') {
      return true;
    }

    const sameSize = previousSize === undefined || file.size === previousSize;
    const sameModified = !file.lastModified || !previousModified || file.lastModified.getTime() === previousModified.getTime();
    return sameSize && sameModified;
  }

  matches(file: SourceFile, criteria: FileSelectionCriteria): boolean {
    const nameMatches = this.matchesFilename(file.name, criteria.filenamePrefix, criteria.caseSensitivePrefix);
    const extensionMatches = this.matchesExtension(file.name, criteria.allowedExtensions);
    const ageOk = true;
    const stableOk = !criteria.requireStableFile || this.isStable(file);

    return !file.isDirectory && nameMatches && extensionMatches && ageOk && stableOk;
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
