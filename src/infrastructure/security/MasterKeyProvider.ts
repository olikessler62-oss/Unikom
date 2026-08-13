import crypto from 'node:crypto';

export const MASTER_KEY_BYTES = 32;
export const DEFAULT_MASTER_KEY_VARIABLE = 'UNIKOM_MASTER_KEY';

/**
 * Supplies the key that protects every stored credential. It must come from
 * outside the application: a key kept next to the database it protects would
 * offer no protection at all (spec section 51).
 */
export interface MasterKeyProvider {
  getMasterKey(): Buffer;
}

export class MissingMasterKeyError extends Error {
  constructor(variableName: string) {
    super(
      `No master key configured. Set ${variableName} to a base64 encoded ${MASTER_KEY_BYTES} byte key. ` +
        `A new one can be generated with generateMasterKey().`
    );
    this.name = 'MissingMasterKeyError';
  }
}

/** Generates a key suitable for the environment variable. */
export function generateMasterKey(): string {
  return crypto.randomBytes(MASTER_KEY_BYTES).toString('base64');
}

export class EnvironmentMasterKeyProvider implements MasterKeyProvider {
  constructor(
    private readonly variableName: string = DEFAULT_MASTER_KEY_VARIABLE,
    private readonly environment: NodeJS.ProcessEnv = process.env
  ) {}

  getMasterKey(): Buffer {
    const configured = this.environment[this.variableName];
    if (!configured) {
      throw new MissingMasterKeyError(this.variableName);
    }

    let key: Buffer;
    try {
      key = Buffer.from(configured, 'base64');
    } catch {
      throw new MissingMasterKeyError(this.variableName);
    }

    if (key.length !== MASTER_KEY_BYTES) {
      // Never echo the configured value, not even its length in a way that
      // narrows it down beyond what the operator already knows.
      throw new Error(
        `${this.variableName} must decode to exactly ${MASTER_KEY_BYTES} bytes, but it does not. ` +
          'Generate a new key with generateMasterKey().'
      );
    }

    return key;
  }
}

/** Explicit key for tests and for embedding Unikom in another host process. */
export class StaticMasterKeyProvider implements MasterKeyProvider {
  constructor(private readonly key: Buffer) {
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(`A master key must be exactly ${MASTER_KEY_BYTES} bytes`);
    }
  }

  getMasterKey(): Buffer {
    return this.key;
  }
}
