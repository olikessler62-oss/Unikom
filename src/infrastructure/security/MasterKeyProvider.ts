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

/**
 * The command that produces a usable key. It appears in the error message
 * because that message is the first thing an operator sees when they try to
 * store a credential on a fresh installation - and a message that names an
 * internal function tells them nothing they can act on.
 */
export const MASTER_KEY_COMMAND =
  `node -e "console.log(require('crypto').randomBytes(${MASTER_KEY_BYTES}).toString('base64'))"`;

export class MissingMasterKeyError extends Error {
  constructor(variableName: string) {
    super(
      `${variableName} is not set, so no credential can be stored. Generate a key with:
  ${MASTER_KEY_COMMAND}
` +
        `Set it as the environment variable ${variableName} and restart Unikom. ` +
        'Keep it safe: without it, stored credentials cannot be read again.'
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
          `Generate a valid key with:
  ${MASTER_KEY_COMMAND}`
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
