import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const ALGORITHM = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Stores passwords so that the database cannot give them back.
 *
 * scrypt rather than a plain hash because it is deliberately slow and
 * memory-hungry: someone who obtains the database still has to spend real
 * hardware per guess. Every user gets their own salt, so two people with the
 * same password do not get the same hash, and a precomputed table is useless.
 *
 * Format: `scrypt$<salt-base64>$<hash-base64>`. The algorithm is part of the
 * record so a stored password stays readable if this ever changes.
 */
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await scrypt(password, salt, KEY_BYTES);

    return `${ALGORITHM}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  /**
   * Compares in constant time. A comparison that returns early on the first
   * differing byte lets an attacker read the correct hash out of the response
   * times, one byte at a time.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const [algorithm, saltPart, hashPart] = stored.split('$');

    if (algorithm !== ALGORITHM || !saltPart || !hashPart) {
      return false;
    }

    const expected = Buffer.from(hashPart, 'base64');
    const actual = await scrypt(password, Buffer.from(saltPart, 'base64'), expected.length);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

/**
 * Password for the first administrator, shown once on the console. Grouped in
 * blocks because somebody has to read it off a screen and type it in.
 */
export function generateInitialPassword(): string {
  // No look-alikes: 0/O and 1/l/I cost more in typing errors than they add.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const characters = [...bytes].map((byte) => alphabet[byte % alphabet.length]);

  return [0, 4, 8, 12].map((start) => characters.slice(start, start + 4).join('')).join('-');
}
