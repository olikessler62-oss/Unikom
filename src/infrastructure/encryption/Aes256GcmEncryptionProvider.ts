import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface EncryptionResult {
  ok: boolean;
  outputPath?: string;
  message: string;
}

export interface EncryptionProvider {
  encrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult>;
  decrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult>;
}

const MAGIC = Buffer.from('UNIKOM', 'ascii');
const FORMAT_VERSION = 1;

/** How the key material was obtained; stored so decryption never has to guess. */
const KDF_RAW_KEY = 0;
const KDF_SCRYPT = 1;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = MAGIC.length + 1 + 1 + SALT_BYTES + IV_BYTES; // 36

/**
 * File encryption according to spec sections 45-47.
 *
 * AES-256-GCM is used rather than CBC because it also detects manipulation.
 * Data is streamed, so a multi-gigabyte transfer does not have to fit in
 * memory, and the header records the key derivation so a file stays readable
 * even if the credential format changes later.
 *
 * Layout: MAGIC | version | kdf | salt | iv | ciphertext | tag
 */
export class Aes256GcmEncryptionProvider implements EncryptionProvider {
  async encrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const { keyMaterial, kdf } = deriveKey(key, salt);

    const header = Buffer.concat([
      MAGIC,
      Buffer.from([FORMAT_VERSION, kdf]),
      salt,
      iv,
    ]);

    const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, iv);

    try {
      await pipeline(
        createReadStream(inputPath),
        cipher,
        async function* (encrypted) {
          yield header;
          for await (const chunk of encrypted) {
            yield chunk as Buffer;
          }
          // Only valid once the cipher has flushed everything.
          yield cipher.getAuthTag();
        },
        createWriteStream(outputPath)
      );
    } catch (error) {
      await fs.rm(outputPath, { force: true });
      throw error;
    }

    return { ok: true, outputPath, message: 'AES-256-GCM encryption completed' };
  }

  async decrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult> {
    const { salt, iv, kdf, size } = await readHeader(inputPath);
    const { keyMaterial } = deriveKey(key, salt, kdf);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial, iv);
    decipher.setAuthTag(await readAuthTag(inputPath, size));

    const ciphertextBytes = size - HEADER_BYTES - TAG_BYTES;
    const ciphertext =
      ciphertextBytes > 0
        ? createReadStream(inputPath, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 })
        : Readable.from([]);

    try {
      await pipeline(ciphertext, decipher, createWriteStream(outputPath));
    } catch (error) {
      // A wrong key and a manipulated file are indistinguishable here, and both
      // must leave no half-written plaintext behind.
      await fs.rm(outputPath, { force: true });
      throw new Error(
        'Decryption failed: the file was modified or the wrong encryption key was used. ' +
          `(${error instanceof Error ? error.message : String(error)})`
      );
    }

    return { ok: true, outputPath, message: 'AES-256-GCM decryption completed' };
  }
}

function deriveKey(key: string, salt: Buffer, expectedKdf?: number): { keyMaterial: Buffer; kdf: number } {
  const decoded = Buffer.from(key, 'base64');
  const isRawKey = decoded.length === KEY_BYTES && decoded.toString('base64') === key;
  const kdf = expectedKdf ?? (isRawKey ? KDF_RAW_KEY : KDF_SCRYPT);

  if (kdf === KDF_RAW_KEY) {
    if (!isRawKey) {
      throw new Error('The file was encrypted with a raw key, but the supplied credential is not one');
    }

    return { keyMaterial: decoded, kdf };
  }

  if (kdf !== KDF_SCRYPT) {
    throw new Error(`Unsupported key derivation id ${kdf}`);
  }

  // A typed passphrase needs stretching; a plain hash would not slow an
  // attacker down enough.
  return { keyMaterial: crypto.scryptSync(key, salt, KEY_BYTES), kdf };
}

async function readHeader(inputPath: string): Promise<{ salt: Buffer; iv: Buffer; kdf: number; size: number }> {
  const handle = await fs.open(inputPath, 'r');

  try {
    const { size } = await handle.stat();
    if (size < HEADER_BYTES + TAG_BYTES) {
      throw new Error(`${inputPath} is too short to be an AES-256-GCM file written by Unikom`);
    }

    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);

    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(`${inputPath} was not encrypted by Unikom`);
    }

    const version = header[MAGIC.length];
    if (version !== FORMAT_VERSION) {
      throw new Error(`${inputPath} uses encryption format version ${version}, which this build cannot read`);
    }

    return {
      kdf: header[MAGIC.length + 1],
      salt: header.subarray(MAGIC.length + 2, MAGIC.length + 2 + SALT_BYTES),
      iv: header.subarray(MAGIC.length + 2 + SALT_BYTES, HEADER_BYTES),
      size,
    };
  } finally {
    await handle.close();
  }
}

async function readAuthTag(inputPath: string, size: number): Promise<Buffer> {
  const handle = await fs.open(inputPath, 'r');

  try {
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    return tag;
  } finally {
    await handle.close();
  }
}
