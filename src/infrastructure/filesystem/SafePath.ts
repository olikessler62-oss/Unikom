import path from 'node:path';

/**
 * Filename validation for names that originate from a remote source
 * (spec sections 95-96). A remote name must never be able to steer a write
 * outside the staging or destination directory.
 */

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export class UnsafeFilenameError extends Error {
  constructor(filename: string, reason: string) {
    super(`Rejected unsafe filename "${filename}": ${reason}`);
    this.name = 'UnsafeFilenameError';
  }
}

/**
 * Returns the filename unchanged if it is safe to use as a single path
 * segment, otherwise throws.
 */
export function assertSafeFilename(filename: string): string {
  if (filename.length === 0) {
    throw new UnsafeFilenameError(filename, 'the name is empty');
  }

  if (filename.includes('\0')) {
    throw new UnsafeFilenameError(filename, 'the name contains a null byte');
  }

  if (filename === '.' || filename === '..') {
    throw new UnsafeFilenameError(filename, 'the name is a relative directory reference');
  }

  if (filename.includes('/') || filename.includes('\\')) {
    throw new UnsafeFilenameError(filename, 'the name contains a path separator');
  }

  if (path.isAbsolute(filename) || /^[a-zA-Z]:/.test(filename)) {
    throw new UnsafeFilenameError(filename, 'the name is an absolute path');
  }

  const stem = filename.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    throw new UnsafeFilenameError(filename, 'the name is reserved by the operating system');
  }

  return filename;
}

/**
 * Resolves a remote filename inside a base directory and verifies that the
 * result really stays within that directory.
 */
export function resolveWithin(baseDirectory: string, filename: string): string {
  assertSafeFilename(filename);

  const base = path.resolve(baseDirectory);
  const resolved = path.resolve(base, filename);
  const relative = path.relative(base, resolved);

  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UnsafeFilenameError(filename, `the resulting path escapes ${base}`);
  }

  return resolved;
}

export function isSafeFilename(filename: string): boolean {
  try {
    assertSafeFilename(filename);
    return true;
  } catch {
    return false;
  }
}
