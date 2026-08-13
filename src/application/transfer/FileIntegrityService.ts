import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export interface FileIntegrityValidationOptions {
  expectedSize?: number;
  expectedSha256?: string;
}

export interface FileIntegrityValidationResult {
  ok: boolean;
  sha256?: string;
  size?: number;
  message: string;
}

export class FileIntegrityService {
  /**
   * Streamed on purpose: a transferred file can be far larger than the memory
   * available to the process.
   */
  async calculateSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }

  async verifyFile(filePath: string, options: FileIntegrityValidationOptions = {}): Promise<FileIntegrityValidationResult> {
    const stats = await fs.stat(filePath);
    const size = stats.size;
    const sha256 = await this.calculateSha256(filePath);

    if (options.expectedSize !== undefined && size !== options.expectedSize) {
      return {
        ok: false,
        sha256,
        size,
        message: `File size mismatch: expected ${options.expectedSize}, got ${size}`,
      };
    }

    if (options.expectedSha256 !== undefined && sha256 !== options.expectedSha256) {
      return {
        ok: false,
        sha256,
        size,
        message: `SHA-256 mismatch: expected ${options.expectedSha256}, got ${sha256}`,
      };
    }

    return {
      ok: true,
      sha256,
      size,
      message: 'File integrity validation succeeded',
    };
  }
}
