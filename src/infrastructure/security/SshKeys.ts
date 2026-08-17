import crypto from 'node:crypto';
// ssh2 is CommonJS and exposes no named ESM exports, so it is imported whole.
import ssh2 from 'ssh2';

const { utils } = ssh2;

/**
 * SSH key material for logging in at an SFTP source.
 *
 * Two things happen here, and only here: an uploaded key is turned into one
 * canonical form, and a fresh pair is made when the customer has none.
 *
 * Why not `node:crypto` alone: since OpenSSH 7.8 `ssh-keygen` writes its own
 * container ("BEGIN OPENSSH PRIVATE KEY"), and Node cannot read it. That is the
 * file operators actually have on their disk, so refusing it would mean telling
 * every one of them to convert their key first. `ssh2` parses it, and `ssh2` is
 * what opens the connection later anyway — the same parser decides here and
 * there, so a key that is accepted at setup also works at run time.
 */

/** What the parser tells us that is safe to repeat in a message. */
export interface KeyDescription {
  /** The OpenSSH algorithm name, e.g. `ssh-ed25519`. */
  algorithm: string;
  /** The `authorized_keys` line to put on the source server. */
  publicKey: string;
}

/** A private key, ready to be stored, plus the public half to hand out. */
export interface NormalisedKey extends KeyDescription {
  /**
   * PEM without a passphrase.
   *
   * Deliberately without: the credential store encrypts every secret with the
   * installation's master key, and a passphrase kept next to the key it
   * protects protects nothing. Storing both would look like two locks and be
   * one. The passphrase is used once, here, to open the uploaded file.
   */
  privateKey: string;
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Reads uploaded key material and returns it in one canonical form.
 *
 * The error messages name the next step rather than the internal cause. An
 * operator pasting a key sees "this needs a passphrase", not a parser error.
 */
export function normalisePrivateKey(material: string, passphrase?: string): NormalisedKey {
  const trimmed = material.trim();

  if (trimmed.length === 0) {
    fail('Es wurde kein Schlüsselmaterial übergeben.');
  }

  if (trimmed.includes('PUBLIC KEY') || trimmed.startsWith('ssh-') || trimmed.startsWith('ecdsa-')) {
    fail(
      'Das ist ein öffentlicher Schlüssel. Unikom braucht den privaten — die Datei ohne die Endung .pub. ' +
        'Der öffentliche gehört auf den Quellserver, in dessen authorized_keys.'
    );
  }

  refusePuttyWeCannotRead(trimmed);

  const parsed = utils.parseKey(trimmed, passphrase && passphrase.length > 0 ? passphrase : undefined);

  if (parsed instanceof Error) {
    const reason = parsed.message.toLowerCase();

    if (reason.includes('passphrase') || reason.includes('decrypt') || reason.includes('bad pass')) {
      fail(
        passphrase && passphrase.length > 0
          ? 'Der Schlüssel ließ sich mit dieser Passphrase nicht öffnen.'
          : 'Dieser Schlüssel ist mit einer Passphrase geschützt. Bitte auch diese eingeben.'
      );
    }

    fail(`Das ist kein brauchbarer privater SSH-Schlüssel: ${parsed.message}`);
  }

  const key = Array.isArray(parsed) ? parsed[0] : parsed;

  return {
    privateKey: key.getPrivatePEM(),
    algorithm: key.type,
    publicKey: authorizedKeysLine(key.type, key.getPublicSSH()),
  };
}

/**
 * Derives the `authorized_keys` line from a stored private key.
 *
 * Derived rather than stored: a copy would be a second place that can drift
 * from the first, and there is nothing secret about a public key that would
 * justify keeping one.
 */
export function publicKeyOf(privateKey: string, comment?: string): KeyDescription {
  const parsed = utils.parseKey(privateKey);

  if (parsed instanceof Error) {
    throw new Error(`Der gespeicherte Schlüssel lässt sich nicht lesen: ${parsed.message}`);
  }

  const key = Array.isArray(parsed) ? parsed[0] : parsed;

  return { algorithm: key.type, publicKey: authorizedKeysLine(key.type, key.getPublicSSH(), comment) };
}

/**
 * A fresh pair, for the case where the customer has none yet.
 *
 * RSA and not Ed25519, which would be the nicer key: Ed25519 private keys only
 * exist in OpenSSH's own container, and Node writes PKCS8, which the parser
 * used here — and by the connection later — cannot read. Writing that container
 * by hand to save a few characters per line would be a piece of cryptographic
 * plumbing maintained for cosmetics. RSA at 4096 bits is strong, and every
 * server that speaks SFTP at all accepts it.
 *
 * Asynchronous because generating 4096 bits takes seconds, and the synchronous
 * call would hold up every other request in the meantime.
 */
export async function generateSshKeyPair(comment?: string): Promise<NormalisedKey> {
  const { privateKey } = await new Promise<{ privateKey: string }>((resolve, reject) => {
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 4096,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      },
      (error, _publicKey, privateKey) => (error ? reject(error) : resolve({ privateKey }))
    );
  });

  const described = publicKeyOf(privateKey, comment);
  return { privateKey, ...described };
}

/** The two lines PuTTYgen writes to say what it produced. */
const PUTTY_HEADER = /^PuTTY-User-Key-File-(\d+):\s*(\S+)/;

/**
 * PuTTY keys, and the exact way out when we cannot read one.
 *
 * `.ppk` version 2 with an RSA or DSA key works — that is what the parser
 * understands. Newer PuTTYgen writes version 3 by default and offers key types
 * it did not have before, and neither can be read here: version 3 uses a
 * different key derivation, and adding it would mean carrying a second crypto
 * implementation for one file format.
 *
 * So the message names the clicks instead of the cause. Both ways out are two
 * steps in a program the operator already has open, and both produce a file
 * that works — which is worth more than "unsupported key format".
 */
function refusePuttyWeCannotRead(material: string): void {
  const header = PUTTY_HEADER.exec(material);

  if (!header) {
    return;
  }

  const [, version, algorithm] = header;
  const wayOut =
    'In PuTTYgen den Schlüssel laden und entweder als PPK-Version 2 speichern ' +
    '(Key → Parameters for saving key files → PPK file version → 2) ' +
    'oder mit Conversions → Export OpenSSH key ausgeben.';

  if (version !== '2') {
    fail(`Das ist ein PuTTY-Schlüssel in Version ${version}, den Unikom nicht lesen kann. ${wayOut}`);
  }

  if (algorithm !== 'ssh-rsa' && algorithm !== 'ssh-dss') {
    fail(`Dieser PuTTY-Schlüssel ist vom Typ ${algorithm}, den Unikom nicht lesen kann. ${wayOut}`);
  }
}

function authorizedKeysLine(algorithm: string, publicSsh: Buffer, comment?: string): string {
  const line = `${algorithm} ${publicSsh.toString('base64')}`;
  const trimmed = comment?.trim();

  // A comment with a space in it would look like a fourth field and confuse
  // whoever reads the file later.
  return trimmed ? `${line} ${trimmed.replace(/\s+/g, '-')}` : line;
}
