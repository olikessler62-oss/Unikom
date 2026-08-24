import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Aes256GcmEncryptionProvider, encryptBytes } from './Aes256GcmEncryptionProvider.js';

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

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, RAW_KEY), /verändert, oder es wurde der falsche/);
  assert.equal(await exists(decrypted), false);
});

test('the wrong key cannot decrypt the file', async () => {
  const { plain, encrypted, decrypted } = await workspace();
  await provider.encrypt(plain, encrypted, RAW_KEY);

  const otherKey = crypto.randomBytes(32).toString('base64');

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, otherKey), /verändert, oder es wurde der falsche/);
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

  await assert.rejects(() => provider.decrypt(encrypted, decrypted, PASSPHRASE), /ist keiner|verändert, oder es wurde der falsche/);
});

/* ---------- Derselbe Umschlag, aus Bytes ---------- */

test('was byteweise verschluesselt wurde, macht decrypt wieder auf', async () => {
  /*
   * Der eigentliche Vertrag: `encryptBytes` ist kein zweites Format, sondern
   * derselbe Umschlag aus einer anderen Quelle. Liefen die beiden auseinander,
   * läge im Archiv eine Datei, die nur ein Unikom von heute lesen kann.
   */
  const { root } = await workspace();
  const archiv = path.join(root, 'stapel.zip.enc');
  const heraus = path.join(root, 'stapel.zip');
  const inhalt = Buffer.from('PK' + CONTENT, 'utf-8');

  await fs.writeFile(archiv, encryptBytes(inhalt, RAW_KEY));
  const ergebnis = await provider.decrypt(archiv, heraus, RAW_KEY);

  assert.equal(ergebnis.ok, true);
  assert.deepEqual(await fs.readFile(heraus), inhalt);
});

test('auch mit einem getippten Passwort', async () => {
  const { root } = await workspace();
  const archiv = path.join(root, 'stapel.zip.enc');
  const heraus = path.join(root, 'stapel.zip');
  const inhalt = Buffer.from(CONTENT, 'utf-8');

  await fs.writeFile(archiv, encryptBytes(inhalt, PASSPHRASE));

  assert.equal((await provider.decrypt(archiv, heraus, PASSPHRASE)).ok, true);
  assert.deepEqual(await fs.readFile(heraus), inhalt);
});

test('mit dem falschen Schluessel bleibt nichts zurueck', async () => {
  const { root } = await workspace();
  const archiv = path.join(root, 'stapel.zip.enc');
  const heraus = path.join(root, 'stapel.zip');

  await fs.writeFile(archiv, encryptBytes(Buffer.from(CONTENT, 'utf-8'), RAW_KEY));

  await assert.rejects(
    () => provider.decrypt(archiv, heraus, crypto.randomBytes(32).toString('base64')),
    /fehlgeschlagen/
  );
  assert.equal(await exists(heraus), false);
});

test('der Klartext steht nicht im Umschlag', () => {
  const umschlag = encryptBytes(Buffer.from('Kundennummer;Betrag', 'utf-8'), RAW_KEY);

  assert.equal(umschlag.includes(Buffer.from('Kundennummer', 'utf-8')), false);
});

test('zweimal dasselbe ergibt nicht zweimal dieselben Bytes', () => {
  /*
   * Salz und Startwert kommen frisch. Wären zwei Umschläge gleich, ließe sich
   * von außen ablesen, dass zweimal dasselbe geliefert wurde.
   */
  const einmal = encryptBytes(Buffer.from(CONTENT, 'utf-8'), RAW_KEY);
  const nochmal = encryptBytes(Buffer.from(CONTENT, 'utf-8'), RAW_KEY);

  assert.equal(einmal.equals(nochmal), false);
});

test('eine veraenderte Stelle faellt auf', async () => {
  /*
   * Das ist der Grund für GCM statt CBC: Ein Archiv, an dem jemand gedreht hat,
   * darf sich nicht entschlüsseln lassen, als wäre nichts gewesen.
   */
  const { root } = await workspace();
  const archiv = path.join(root, 'stapel.zip.enc');
  const umschlag = encryptBytes(Buffer.from(CONTENT, 'utf-8'), RAW_KEY);

  umschlag[umschlag.length - 20] ^= 0xff;
  await fs.writeFile(archiv, umschlag);

  await assert.rejects(
    () => provider.decrypt(archiv, path.join(root, 'stapel.zip'), RAW_KEY),
    /fehlgeschlagen/
  );
});
