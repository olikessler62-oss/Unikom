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
  /**
   * Whether this file is one of ours, decided by the envelope it carries — not
   * by how random its bytes look. Compressed data is statistically as random as
   * encrypted data, so a guess would eventually pass a ZIP archive off as
   * ciphertext and hand the plaintext on unprotected.
   */
  isEncrypted?(inputPath: string): Promise<boolean>;
  /**
   * Encrypts what arrives in a stream. Used when the file is encrypted while it
   * is being fetched, where there is no input file to point at yet.
   */
  encryptStream?(input: Readable, outputPath: string, key: string): Promise<EncryptionResult>;
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
    return this.encryptStream(createReadStream(inputPath), outputPath, key);
  }

  /**
   * The same format written from a stream, so a file can be encrypted while it
   * is still arriving. Everything about the result is identical to `encrypt` —
   * only the origin of the bytes differs.
   */
  async encryptStream(input: Readable, outputPath: string, key: string): Promise<EncryptionResult> {
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
        input,
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

  /**
   * Reads the first bytes and compares them with the magic word. That is all
   * the certainty there is to be had about a file: our own envelope is
   * recognised without doubt, a foreign ciphertext without envelope is not
   * recognisable at all, and nothing in between is worth pretending.
   */
  async isEncrypted(inputPath: string): Promise<boolean> {
    let handle: fs.FileHandle | undefined;

    try {
      handle = await fs.open(inputPath, 'r');
      const start = Buffer.alloc(MAGIC.length);
      const { bytesRead } = await handle.read(start, 0, MAGIC.length, 0);

      return bytesRead === MAGIC.length && start.equals(MAGIC);
    } catch {
      // Unreadable is not the same as unencrypted, but the caller finds out
      // about it at the next step anyway — and finds out with a better message.
      return false;
    } finally {
      await handle?.close();
    }
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
        'Die Entschlüsselung ist fehlgeschlagen: Die Datei wurde verändert, oder es wurde der falsche ' +
          `Schlüssel verwendet. (${error instanceof Error ? error.message : String(error)})`
      );
    }

    return { ok: true, outputPath, message: 'AES-256-GCM decryption completed' };
  }
}

/**
 * Dasselbe Format, nur aus Bytes und nach Bytes.
 *
 * Gebraucht vom Archiv des Konsolidierens: Dort entsteht ein ZIP im Speicher
 * und geht über die `Dateiablage` fort — es gibt keinen Pfad, auf den sich
 * `encrypt` richten könnte, und einen anzulegen hieße, den Klartext erst auf
 * die Platte zu schreiben, um ihn danach zu verschlüsseln.
 *
 * **Derselbe Umschlag**, Byte für Byte: `MAGIC | version | kdf | salt | iv |
 * ciphertext | tag`. Ein zweites Format wäre ein zweites Format — was hiermit
 * geschrieben wird, macht `decrypt` wieder auf, und dafür steht ein Test.
 *
 * Der ganze Inhalt liegt dabei im Speicher. Für ein Archiv aus ein paar
 * Eingangsdateien ist das richtig; der Lauf liest dieselben Dateien ohnehin
 * ganz ein. Für Gigabytes ist es das nicht — dafür gibt es `encryptStream`.
 */
export function encryptBytes(plaintext: Uint8Array, key: string): Buffer {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const { keyMaterial, kdf } = deriveKey(key, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, kdf]),
    salt,
    iv,
    ciphertext,
    cipher.getAuthTag(),
  ]);
}

/**
 * Der Weg zurück aus `encryptBytes`.
 *
 * Ohne ihn wäre das Archiv eine Einbahnstraße: verschlüsselt abgelegt und nie
 * wieder zu öffnen. Genau daran hängt aber die Zusage, die das Zerlegen einer
 * Lieferung überhaupt erlaubt — „das Original liegt im Archiv" gilt nur,
 * solange jemand es auch herausholen kann.
 *
 * Ein zu kurzer Umschlag wird abgewiesen, statt an einem Zufallswert
 * weiterzurechnen: Was keine dreiundfünfzig Bytes hat, kann keiner unserer sein
 * und ergibt beim Zerlegen Zahlen aus dem Nichts.
 *
 * Falscher Schlüssel und veränderte Datei sind hier nicht zu unterscheiden —
 * beides bricht an derselben Prüfsumme, und die Meldung sagt beides.
 */
export function decryptBytes(umschlag: Uint8Array, key: string): Buffer {
  const bytes = Buffer.from(umschlag.buffer, umschlag.byteOffset, umschlag.byteLength);

  if (bytes.length < HEADER_BYTES + TAG_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Das ist kein Unikom-Umschlag: Die Kennung am Anfang fehlt oder die Datei ist zu kurz');
  }

  const kdf = bytes[MAGIC.length + 1];
  const salt = bytes.subarray(MAGIC.length + 2, MAGIC.length + 2 + SALT_BYTES);
  const iv = bytes.subarray(MAGIC.length + 2 + SALT_BYTES, HEADER_BYTES);
  const { keyMaterial } = deriveKey(key, salt, kdf);

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial, iv);

  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));

  try {
    return Buffer.concat([
      decipher.update(bytes.subarray(HEADER_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch (fehler) {
    throw new Error(
      'Die Entschlüsselung ist fehlgeschlagen: Die Datei wurde verändert, oder es wurde der falsche ' +
        `Schlüssel verwendet. (${fehler instanceof Error ? fehler.message : String(fehler)})`
    );
  }
}

function deriveKey(key: string, salt: Buffer, expectedKdf?: number): { keyMaterial: Buffer; kdf: number } {
  const decoded = Buffer.from(key, 'base64');
  const isRawKey = decoded.length === KEY_BYTES && decoded.toString('base64') === key;
  const kdf = expectedKdf ?? (isRawKey ? KDF_RAW_KEY : KDF_SCRYPT);

  if (kdf === KDF_RAW_KEY) {
    if (!isRawKey) {
      throw new Error('Die Datei wurde mit einem Rohschlüssel verschlüsselt, der übergebene Zugang ist keiner');
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
