import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

import type { EncryptionKeyProvider } from '../../../domain/encryption/EncryptionKeyProvider.js';
import type { Feature } from '../../../domain/licensing/Feature.js';
import {
  advanceContext,
  type FileProcessingContext,
} from '../../../domain/processing/FileProcessingContext.js';
import type { ProcessingStage } from '../../../domain/processing/ProcessingStage.js';
import type { TransferJobRepository } from '../../../domain/transfer/TransferJobRepository.js';
import {
  Aes256GcmEncryptionProvider,
  type EncryptionProvider,
} from '../../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { assertSafeFilename, resolveWithin } from '../../../infrastructure/filesystem/SafePath.js';
import { workingDirectoryFor } from './StageWorkspace.js';

/**
 * Makes an encrypted file readable for the stages that follow.
 *
 * The plaintext is written into the run's staging area and nowhere else. The
 * encrypted file in the destination directory stays exactly as step 1 left it,
 * and staging is removed when the run ends — so what a customer bought with the
 * encryption module, namely that no plaintext lies at rest, still holds while
 * step 2 is working on the content.
 *
 * Register this before the stages that need to read the file.
 */
export class DecryptForProcessingStage implements ProcessingStage {
  readonly name = 'decrypt-for-processing';
  readonly requiredFeature: Feature = 'ENCRYPTION';

  constructor(
    private readonly jobRepository: TransferJobRepository,
    private readonly encryptionKeyProvider: EncryptionKeyProvider,
    private readonly encryptionProvider: EncryptionProvider = new Aes256GcmEncryptionProvider()
  ) {}

  async process(context: FileProcessingContext): Promise<FileProcessingContext> {
    if (!context.encrypted) {
      return context;
    }

    const key = await this.encryptionKeyProvider.getKey(await this.keyCredentialIdFor(context));

    // Dropping the `.enc` gives back the name the file had at the source, which
    // is the name a later export should work with.
    const plainFilename = context.currentFilename.endsWith('.enc')
      ? context.currentFilename.slice(0, -'.enc'.length)
      : context.currentFilename;
    assertSafeFilename(plainFilename);

    const workspace = await workingDirectoryFor(context);
    const plaintextPath = resolveWithin(workspace, plainFilename);

    await this.encryptionProvider.decrypt(context.currentFilePath, plaintextPath, key);

    await this.assertContentIsWhatStepOneTookOver(context, plaintextPath);

    return advanceContext(context, {
      currentFilePath: plaintextPath,
      currentFilename: plainFilename,
      fileSize: (await fs.stat(plaintextPath)).size,
      // The content did not change, only how it is stored - so sha256 stays.
      encrypted: false,
    });
  }

  private async keyCredentialIdFor(context: FileProcessingContext): Promise<string | undefined> {
    const job = await this.jobRepository.getById(context.jobId);

    if (!job) {
      throw new Error(`Job ${context.jobId} no longer exists, so its encryption key cannot be resolved`);
    }

    return job.encryptionConfig.keyCredentialId;
  }

  /**
   * Step 1 recorded the checksum of the content before encrypting it, so the
   * round trip can be checked end to end for free. GCM already detects a
   * manipulated file, but this also catches the case where the stored checksum
   * and the stored file drifted apart — which is what every later stage relies
   * on not having happened.
   */
  private async assertContentIsWhatStepOneTookOver(
    context: FileProcessingContext,
    plaintextPath: string
  ): Promise<void> {
    if (context.sha256 === undefined) {
      return;
    }

    const actual = await sha256Of(plaintextPath);
    if (actual === context.sha256) {
      return;
    }

    await fs.rm(plaintextPath, { force: true });
    throw new Error(
      `The decrypted content of "${context.originalFilename}" does not match the checksum recorded ` +
        `when it was taken over (expected ${context.sha256}, got ${actual})`
    );
  }
}

async function sha256Of(target: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(target)) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}
