import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SecretCipher } from './SecretCipher.js';
import {
  EnvironmentMasterKeyProvider,
  MissingMasterKeyError,
  StaticMasterKeyProvider,
  generateMasterKey,
} from './MasterKeyProvider.js';

const masterKey = Buffer.from(generateMasterKey(), 'base64');
const cipher = new SecretCipher(new StaticMasterKeyProvider(masterKey));

const PASSWORD = 'sehr-geheimes-passwort-2026';

test('a secret survives an encrypt and decrypt cycle', () => {
  assert.equal(cipher.decrypt(cipher.encrypt(PASSWORD)), PASSWORD);
});

test('the stored value contains no trace of the plaintext', () => {
  const stored = cipher.encrypt(PASSWORD);

  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(Buffer.from(stored, 'base64').toString('utf8').includes(PASSWORD), false);
});

test('encrypting the same secret twice gives different ciphertexts', () => {
  // Otherwise equal passwords would be recognisable across records.
  assert.notEqual(cipher.encrypt(PASSWORD), cipher.encrypt(PASSWORD));
});

test('a manipulated record is detected rather than decrypted', () => {
  const payload = Buffer.from(cipher.encrypt(PASSWORD), 'base64');
  payload[payload.length - 1] ^= 0xff;

  assert.throws(() => cipher.decrypt(payload.toString('base64')), /ließ sich nicht entschlüsseln|unvollständig/);
});

test('a different master key cannot read the secret', () => {
  const stored = cipher.encrypt(PASSWORD);
  const foreign = new SecretCipher(new StaticMasterKeyProvider(crypto.randomBytes(32)));

  assert.throws(() => foreign.decrypt(stored), /ließ sich nicht entschlüsseln|unvollständig/);
});

test('a truncated record is rejected', () => {
  assert.throws(() => cipher.decrypt(Buffer.from('too short').toString('base64')), /unvollständig/);
});

test('a missing master key is reported with guidance', () => {
  const provider = new EnvironmentMasterKeyProvider('UNIKOM_TEST_KEY', {});

  assert.throws(() => provider.getMasterKey(), MissingMasterKeyError);
});

test('a master key of the wrong length is rejected without echoing it', () => {
  const provider = new EnvironmentMasterKeyProvider('UNIKOM_TEST_KEY', {
    UNIKOM_TEST_KEY: Buffer.from('too-short').toString('base64'),
  });

  try {
    provider.getMasterKey();
    assert.fail('a short key must be rejected');
  } catch (error) {
    assert.match((error as Error).message, /genau 32 Byte/);
    assert.equal((error as Error).message.includes('too-short'), false);
  }
});

test('a generated master key is accepted', () => {
  const generated = generateMasterKey();
  const provider = new EnvironmentMasterKeyProvider('UNIKOM_TEST_KEY', { UNIKOM_TEST_KEY: generated });

  assert.equal(provider.getMasterKey().length, 32);
});
