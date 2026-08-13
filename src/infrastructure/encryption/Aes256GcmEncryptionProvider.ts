import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export interface EncryptionResult {
  ok: boolean;
  encryptedPath?: string;
  message: string;
}

export interface EncryptionProvider {
  encrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult>;
  decrypt?(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult>;
}

export class Aes256GcmEncryptionProvider implements EncryptionProvider {
  async encrypt(inputPath: string, outputPath: string, key: string): Promise<EncryptionResult> {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const plaintext = await fs.readFile(inputPath);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = Buffer.concat([
      Buffer.from('AES-256-GCM:'),
      iv,
      tag,
      encrypted,
    ]);

    await fs.writeFile(outputPath, payload);

    return {
      ok: true,
      encryptedPath: outputPath,
      message: 'AES-256-GCM encryption completed',
    };
  }
}
