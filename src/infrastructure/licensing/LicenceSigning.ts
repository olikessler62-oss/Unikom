import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

import type { Licence } from '../../domain/licensing/Licence.js';
import {
  composeLicenceDocument,
  decodeLicencePayload,
  encodeLicencePayload,
  LicenceFormatError,
  splitLicenceDocument,
} from '../../domain/licensing/LicenceDocument.js';

/**
 * Ed25519 signatures over the licence text.
 *
 * Ed25519 rather than RSA because the parts that have to travel are short: a
 * public key of 44 characters fits in a constant in the source, and a signature
 * of 88 fits on one line of an e-mail. Verifying needs no secret at all, which
 * is the whole point — the installation must be able to check a licence without
 * holding anything worth stealing.
 *
 * Keys are handled as base64 of their DER form (SPKI for public, PKCS8 for
 * private), so they survive being pasted into an environment variable.
 */

export interface LicenceKeyPair {
  /** Goes into the vendor's key store, never into a customer installation. */
  privateKey: string;
  /** Goes into `LicencePublicKey.ts` of the distribution build. */
  publicKey: string;
}

export function generateLicenceKeyPair(): LicenceKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/** Issues a licence. Only the vendor can do this; it needs the private key. */
export function signLicence(licence: Licence, privateKeyBase64: string): string {
  const payload = encodeLicencePayload(licence);
  const signature = sign(null, Buffer.from(payload, 'utf8'), toPrivateKey(privateKeyBase64));

  return composeLicenceDocument(payload, signature);
}

/**
 * Checks the signature and returns what the licence says.
 *
 * Order matters: the signature is verified before the content is read, so a
 * malformed payload can never be interpreted by an installation that was handed
 * something other than a real licence.
 */
export function verifyLicenceDocument(text: string, publicKeyBase64: string): Licence {
  const document = splitLicenceDocument(text);
  const valid = verify(
    null,
    Buffer.from(document.payload, 'utf8'),
    toPublicKey(publicKeyBase64),
    document.signature
  );

  if (!valid) {
    throw new LicenceFormatError('Die Signatur der Lizenz stimmt nicht. Sie wurde verändert oder stammt nicht von uns.');
  }

  return decodeLicencePayload(document.payload);
}

function toPrivateKey(base64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
}

function toPublicKey(base64: string): KeyObject {
  try {
    return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new LicenceFormatError('Der hinterlegte Lizenzschlüssel ist unbrauchbar.');
  }
}
