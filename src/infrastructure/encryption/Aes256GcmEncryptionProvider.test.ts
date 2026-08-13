import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Aes256GcmEncryptionProvider } from './Aes256GcmEncryptionProvider.js';

const provider = new Aes256GcmEncryptionProvider();
const RAW_KEY = crypto.randomBytes(32).toString('base64');
const PASSPHRASE = 'ein-vom-benutzer-gewaehltes-passwort';
const CONTENT = 'customer;amount\nA;42\n';

async function workspace(content = CONTENT) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-crypto-'));
  const plain = path.join(root, 'ORDER_001.csv');
  await fs.writeFile(plain, content);

  return {
    root,
    plain,
    encrypted: path.join(root, 'ORDER_001.csv.enc'),
    decrypted: path.join(root, 'ORDER_001.decrypted.csv'),
  };
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

test('the encrypted output differs from the input', async () => {
  const { plain, encrypted } = await workspace();
  await provider.encrypt(plain, encrypted, RAW_KEY);

  const cipherText = await fs.readFile(encrypted);

  assert.notEqual(cipherText.toString('utf8'), CONTENT);
  assert.equal(cipherText.includes(Buffer.from('customer;amount')), false);
  assert.equal(cipherText.subarray(0, 6).toString('ascii'), 'UNIKOM');
});

test('decryption with the correct key restores the file byte for byte', async () => {
  const { plain, encrypted, decrypted } = await workspace();

  await provider.encrypt(plain, encrypted, RAW_KEY);
  await provider.decrypt(encrypted, decrypted, RAW_KEY);

  assert.deepEqual(await fs.readFile(decrypted), await fs.readFile(plain));
});

test('a user supplied passphrase also works', async () => {
  const { plain, encrypted, decrypted } = await workspace();

  await provider.encrypt(plain, encrypted, PASSPHRASE);
  await provider.decrypt(encrypted, decrypted, PASSPHRASE);

  assert.equal(await fs.readFile(decrypted, 'utf8'), CONTENT);
});

test('encrypting twice gives different files despite the same key', async () => {
  const { root, plain } = await workspace();
  const first = path.join(root, 'first.enc');
  const second = path.join(root, 'second.enc');

  await provider.encrypt(plain, first, RAW_KEY);
  await provider.encrypt(plain, second, RAW_KEY);

  assert.notDeepEqual(await fs.readFile(first), await fs.readFile(second));
});

test('a manipulated file is detected and leaves no plaintext behind', async () => {
  const { plain, encrypted, decrypted } = await workspace();
  await provider.encrypt(plain, encrypted, RAW_KEY);

  const tampered = await fs.readFile(encrypted);
  tampered[tampered.length - 20] ^= 0xff;
  await fs.writeFile(encrypted, tampered);

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, RAW_KEY), /modified or the wrong encryption key/);
  assert.equal(await exists(decrypted), false);
});

test('the wrong key cannot decrypt the file', async () => {
  const { plain, encrypted, decrypted } = await workspace();
  await provider.encrypt(plain, encrypted, RAW_KEY);

  const otherKey = crypto.randomBytes(32).toString('base64');

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, otherKey), /modified or the wrong encryption key/);
  assert.equal(await exists(decrypted), false);
});

test('a file that Unikom did not encrypt is rejected clearly', async () => {
  const { root, plain, decrypted } = await workspace();
  const foreign = path.join(root, 'foreign.bin');
  await fs.writeFile(foreign, crypto.randomBytes(200));

  await assert.rejects(() => provider.decrypt(foreign, decrypted, RAW_KEY), /not encrypted by Unikom/);
  await assert.rejects(() => provider.decrypt(plain, decrypted, RAW_KEY), /too short|not encrypted by Unikom/);
});

test('an empty file round trips as well', async () => {
  const { plain, encrypted, decrypted } = await workspace('');

  await provider.encrypt(plain, encrypted, RAW_KEY);
  await provider.decrypt(encrypted, decrypted, RAW_KEY);

  assert.equal((await fs.stat(decrypted)).size, 0);
});

test('a file larger than the stream buffer round trips', async () => {
  // Five megabytes cross many chunk boundaries, which a single-buffer
  // implementation would hide.
  const large = crypto.randomBytes(5 * 1024 * 1024);
  const { plain, encrypted, decrypted } = await workspace();
  await fs.writeFile(plain, large);

  await provider.encrypt(plain, encrypted, RAW_KEY);
  await provider.decrypt(encrypted, decrypted, RAW_KEY);

  assert.deepEqual(await fs.readFile(decrypted), large);
});

test('a raw key file cannot be opened with a passphrase', async () => {
  const { plain, encrypted, decrypted } = await workspace();
  await provider.encrypt(plain, encrypted, RAW_KEY);

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, PASSPHRASE), /not one|modified or the wrong/);
});
