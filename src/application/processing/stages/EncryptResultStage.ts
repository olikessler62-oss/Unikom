import fs from 'node:fs/promises';
import path from 'node:path';

import type { EncryptionKeyProvider } from '../../../domain/encryption/EncryptionKeyProvider.js';
import type { Feature } from '../../../domain/licensing/Feature.js';
import {
  advanceContext,
  type FileProcessingContext,
} from '../../../domain/processing/FileProcessingContext.js';
import type { ProcessingStage } from '../../../domain/processing/ProcessingStage.js';
import {
  Aes256GcmEncryptionProvider,
  type EncryptionProvider,
} from '../../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { resolveWithin } from '../../../infrastructure/filesystem/SafePath.js';
import { workingDirectoryFor } from './StageWorkspace.js';

/**
 * Encrypts the result of the chain before it is delivered.
 *
 * The key is its own, configured per destination rather than taken from the
 * job's step 1 credential. A file that goes to a recipient has to be readable
 * by that recipient, and with our own key it would not be — so the key belongs
 * to the destination, not to the source.
 *
 * Register this as the last stage before delivery. Like every stage it writes
 * into the run's staging area, which is removed when the run ends.
 */
export class EncryptResultStage implements ProcessingStage {
  readonly name = 'encrypt-result';
  readonly requiredFeature: Feature = 'ENCRYPTION';

  constructor(
    /** Credential of the destination this file is encrypted for. */
    private readonly keyCredentialId: string,
    private readonly encryptionKeyProvider: EncryptionKeyProvider,
    private readonly encryptionProvider: EncryptionProvider = new Aes256GcmEncryptionProvider()
  ) {}

  async process(context: FileProcessingContext): Promise<FileProcessingContext> {
    if (context.encrypted) {
      // Already encrypted, for instance because nothing decrypted it in
      // between. Encrypting a second time would only make it unreadable for
      // the recipient holding the destination key.
      return context;
    }

    const key = await this.encryptionKeyProvider.getKey(this.keyCredentialId);

    const encryptedFilename = `${context.currentFilename}.enc`;
    const workspace = await workingDirectoryFor(context);
    const encryptedPath = resolveWithin(workspace, encryptedFilename);

    await this.encryptionProvider.encrypt(context.currentFilePath, encryptedPath, key);

    // The plaintext this stage was handed has served its purpose. Removing it
    // keeps the window in which it exists as short as the chain allows, even
    // though staging is wiped at the end of the run anyway.
    if (path.resolve(context.currentFilePath) !== path.resolve(context.finalDestinationPath ?? '')) {
      await fs.rm(context.currentFilePath, { force: true });
    }

    return advanceContext(context, {
      currentFilePath: encryptedPath,
      currentFilename: encryptedFilename,
      fileSize: (await fs.stat(encryptedPath)).size,
      // The content did not change, only how it is stored - so sha256 stays.
      encrypted: true,
    });
  }
}
