import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { CredentialType } from '../../../domain/credentials/Credential.js';
import {
  ApiError,
  created,
  ok,
  optionalString,
  requireObject,
  requireString,
  type Route,
} from '../Http.js';

const TYPES: CredentialType[] = ['USERNAME_PASSWORD', 'SSH_PRIVATE_KEY', 'ENCRYPTION_KEY'];

function requireType(value: string): CredentialType {
  if (!(TYPES as string[]).includes(value)) {
    throw new ApiError(400, `"${value}" is not a credential type. Expected one of: ${TYPES.join(', ')}`);
  }

  return value as CredentialType;
}

/**
 * Everything here goes through CredentialService, which only ever returns
 * summaries. There is no route that hands out a secret, and there must not be
 * one: the only caller allowed to see plaintext is the transfer pipeline
 * (spec section 51).
 */
export function credentialRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/credentials',
      authorization: 'VIEW',
      handle: async () => ok(await application.credentialService.list()),
    },
    {
      method: 'POST',
      pattern: '/api/credentials',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The credential');
        const type = requireType(requireString(input, 'type'));
        // Absent means shared across all tenants, which is a real choice and
        // not a fallback: dropping it silently would hand one client's access
        // data to every other one.
        const tenantId = optionalString(input, 'tenantId');

        // An invented passphrase is rarely as strong as it looks, so a key can
        // be generated instead of typed.
        if (type === 'ENCRYPTION_KEY' && input.secret === undefined) {
          return created(
            await application.credentialService.createEncryptionKey(requireString(input, 'name'), tenantId)
          );
        }

        return created(
          await application.credentialService.create({
            name: requireString(input, 'name'),
            type,
            username: optionalString(input, 'username'),
            tenantId,
            secret: requireString(input, 'secret'),
          })
        );
      },
    },
    {
      method: 'PUT',
      pattern: '/api/credentials/:id/name',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The name');
        const renamed = await application.credentialService.rename(params.id, requireString(input, 'name'));

        if (!renamed) {
          throw new ApiError(404, `There is no credential ${params.id}`);
        }

        return ok(renamed);
      },
    },
    {
      method: 'PUT',
      pattern: '/api/credentials/:id/secret',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The secret');
        const replaced = await application.credentialService.replaceSecret(
          params.id,
          requireString(input, 'secret')
        );

        if (!replaced) {
          throw new ApiError(404, `There is no credential ${params.id}`);
        }

        return ok(replaced);
      },
    },
    {
      method: 'GET',
      pattern: '/api/credentials/:id/check',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params }) =>
        // Says whether the master key can still open it, nothing about content.
        ok({ resolvable: await application.credentialService.canResolve(params.id) }),
    },
    {
      method: 'DELETE',
      pattern: '/api/credentials/:id',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params }) => {
        await application.credentialService.delete(params.id);
        return { status: 204 };
      },
    },
  ];
}
