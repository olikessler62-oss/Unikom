import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CredentialService } from './CredentialService.js';
import { InMemoryCredentialRepository } from '../../infrastructure/persistence/InMemoryCredentialRepository.js';
import { SecretCipher } from '../../infrastructure/security/SecretCipher.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';

const PASSWORD = 'Kunde-A-Produktiv-2026';

function service(): { service: CredentialService; repository: InMemoryCredentialRepository } {
  const repository = new InMemoryCredentialRepository();
  return {
    repository,
    service: new CredentialService(repository, new SecretCipher(new StaticMasterKeyProvider(crypto.randomBytes(32)))),
  };
}

test('a stored credential holds no plaintext secret', async () => {
  const { service: credentials, repository } = service();

  const summary = await credentials.create({
    name: 'Customer A Production SFTP',
    type: 'USERNAME_PASSWORD',
    username: 'orders',
    secret: PASSWORD,
  });

  const stored = await repository.getById(summary.id);

  assert.ok(stored);
  assert.equal(stored?.encryptedSecret.includes(PASSWORD), false);
  assert.equal(JSON.stringify(stored).includes(PASSWORD), false);
});

test('what the service hands out never carries the secret', async () => {
  const { service: credentials } = service();
  const created = await credentials.create({ name: 'Customer B FTPS', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  const listed = await credentials.list();
  const fetched = await credentials.getById(created.id);

  for (const value of [created, fetched, listed]) {
    assert.equal(JSON.stringify(value).includes(PASSWORD), false);
    assert.equal(JSON.stringify(value).includes('encryptedSecret'), false);
  }
});

test('the pipeline can resolve the secret again', async () => {
  const { service: credentials } = service();
  const created = await credentials.create({ name: 'Internal Network', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  assert.equal(await credentials.resolveSecret(created.id), PASSWORD);
});

test('a generated encryption key is usable and unique', async () => {
  const { service: credentials } = service();

  const first = await credentials.createEncryptionKey('Customer A Key');
  const second = await credentials.createEncryptionKey('Customer B Key');

  const firstSecret = await credentials.resolveSecret(first.id);
  const secondSecret = await credentials.resolveSecret(second.id);

  assert.equal(first.type, 'ENCRYPTION_KEY');
  assert.equal(Buffer.from(firstSecret, 'base64').length, 32);
  assert.notEqual(firstSecret, secondSecret);
});

test('credential names stay unique', async () => {
  const { service: credentials } = service();
  await credentials.create({ name: 'Customer A', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  await assert.rejects(
    () => credentials.create({ name: 'Customer A', type: 'SSH_PRIVATE_KEY', secret: 'other' }),
    /gibt es schon/
  );
});

test('an empty secret is refused', async () => {
  const { service: credentials } = service();

  await assert.rejects(() => credentials.create({ name: 'Leer', type: 'ENCRYPTION_KEY', secret: '' }), /braucht ein Geheimnis/);
});

test('a credential can be renamed without touching its secret', async () => {
  const { service: credentials } = service();
  const created = await credentials.create({ name: 'Alt', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  const renamed = await credentials.rename(created.id, 'Neu');

  assert.equal(renamed?.name, 'Neu');
  assert.equal(await credentials.resolveSecret(created.id), PASSWORD);
});

test('replacing the secret invalidates the old one', async () => {
  const { service: credentials } = service();
  const created = await credentials.create({ name: 'Rotation', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  await credentials.replaceSecret(created.id, 'neues-passwort');

  assert.equal(await credentials.resolveSecret(created.id), 'neues-passwort');
});

test('resolving an unknown credential fails without leaking anything', async () => {
  const { service: credentials } = service();

  await assert.rejects(() => credentials.resolveSecret('does-not-exist'), /gibt es nicht/);
  assert.equal(await credentials.canResolve('does-not-exist'), false);
});

test('a deleted credential is gone', async () => {
  const { service: credentials } = service();
  const created = await credentials.create({ name: 'Weg', type: 'USERNAME_PASSWORD', secret: PASSWORD });

  await credentials.delete(created.id);

  assert.equal(await credentials.getById(created.id), undefined);
});
