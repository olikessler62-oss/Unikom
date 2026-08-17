import crypto from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { DownloadResult, SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { EncryptionProvider } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';

export interface EncryptedPickupResult {
  sha256: string;
  /** Bytes of the original file, not of the encrypted result. */
  size: number;
}

/**
 * Counts and hashes everything that flows through, and passes it on untouched.
 *
 * The checksum has to be taken here rather than from the finished file: once
 * the bytes are encrypted, hashing them would describe the container instead of
 * the content, and duplicate detection compares content across runs whose
 * encryption used a fresh salt and IV every time.
 */
class PlaintextDigest extends Transform {
  private readonly hash = crypto.createHash('sha256');
  private bytes = 0;

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    this.hash.update(buffer);
    this.bytes += buffer.length;
    callback(null, buffer);
  }

  result(): EncryptedPickupResult {
    return { sha256: this.hash.digest('hex'), size: this.bytes };
  }
}

/**
 * Fetches a file and encrypts it on the way in, so it is never written to disk
 * in the clear (encryption timing ON_PICKUP).
 *
 * The bytes go straight from the source connection through the checksum and the
 * cipher into the staging file. There is no moment at which a plaintext copy
 * exists on this machine, which is the whole point: every later hop — into the
 * destination, onto a share, into step 2 or step 3 — then carries ciphertext.
 *
 * The one thing this cannot do is encrypt on a foreign SFTP or FTPS server.
 * Our software does not run there, so that first hop is protected by SSH or TLS
 * and by nothing of ours.
 */
export class EncryptedPickupService {
  constructor(private readonly encryptionProvider: EncryptionProvider) {}

  /**
   * Whether this combination can encrypt on pickup at all. Callers check this
   * before starting and refuse the job when it says no — falling back to a
   * plain download would silently deliver what the job promised not to.
   */
  supports(adapter: SourceAdapter): boolean {
    return typeof adapter.downloadTo === 'function' && typeof this.encryptionProvider.encryptStream === 'function';
  }

  async pickup(
    adapter: SourceAdapter,
    sourceFile: SourceFile,
    outputPath: string,
    key: string
  ): Promise<EncryptedPickupResult> {
    if (!adapter.downloadTo || !this.encryptionProvider.encryptStream) {
      throw new Error(
        `„${sourceFile.name}“ soll beim Abholen verschlüsselt werden, aber diese Quelle kann die Datei nicht ` +
          'als Strom liefern. Der Lauf wird abgelehnt, statt die Datei unverschlüsselt zu schreiben.'
      );
    }

    const digest = new PlaintextDigest();
    // Started before the download so the cipher is already consuming what the
    // adapter writes; nothing is buffered up waiting for a reader.
    const encryption = this.encryptionProvider.encryptStream(digest, outputPath, key);
    // The promise must never sit unobserved: if the cipher fails while the
    // download is still running, an unhandled rejection would end the process.
    const encryptionFailure = encryption.then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
    );

    let download: DownloadResult;

    try {
      download = await adapter.downloadTo(sourceFile, digest);
    } catch (error) {
      // Destroying rather than ending: a half-written file must not be sealed
      // as if it were complete. The cipher removes its output as it unwinds.
      digest.destroy(error instanceof Error ? error : new Error(String(error)));
      await encryptionFailure;
      throw error;
    }

    if (!download.ok) {
      digest.destroy(new Error(download.message));
      await encryptionFailure;
      throw new Error(download.message);
    }

    // Some adapters close the stream themselves, others leave it to the caller.
    if (!digest.writableEnded) {
      digest.end();
    }

    const failure = await encryptionFailure;
    if (failure) {
      throw failure;
    }

    return digest.result();
  }
}
