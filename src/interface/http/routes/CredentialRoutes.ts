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
    throw new ApiError(400, `„${value}“ ist kein Zugangstyp. Erwartet wird einer von: ${TYPES.join(', ')}`);
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

        /*
         * An SSH key takes a different road than a password: the uploaded file
         * is parsed, and a passphrase may be needed to open it. Without any
         * material, a pair is generated — the case where the customer has no
         * key yet and the public half still has to be handed over.
         */
        if (type === 'SSH_PRIVATE_KEY') {
          return created(
            await application.credentialService.createSshKey({
              name: requireString(input, 'name'),
              username: optionalString(input, 'username'),
              tenantId,
              material: optionalString(input, 'secret'),
              passphrase: optionalString(input, 'passphrase'),
            })
          );
        }

        return created(
          await application.credentialService.create({
            name: requireString(input, 'name'),
            type,
            username: optionalString(input, 'username'),
            // Nur bei Benutzer/Kennwort sinnvoll; ein Schluessel meldet sich an
            // keiner Freigabe an. Mitgeschrieben wird trotzdem, was ankommt —
            // die Oberflaeche bietet das Feld nur dort an.
            freigabe: optionalString(input, 'freigabe'),
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
          throw new ApiError(404, `Den Zugang ${params.id} gibt es nicht`);
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
          throw new ApiError(404, `Den Zugang ${params.id} gibt es nicht`);
        }

        return ok(replaced);
      },
    },
    {
      /*
       * The line to put into the source server's authorized_keys.
       *
       * A GET and not part of the summary: it is only interesting while
       * somebody is setting the connection up, and deriving it means decrypting
       * the private key — work that should happen when it is asked for, not on
       * every listing of every credential.
       */
      method: 'GET',
      pattern: '/api/credentials/:id/public-key',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params }) => {
        try {
          return ok(await application.credentialService.publicKeyOf(params.id));
        } catch (failure) {
          throw new ApiError(404, failure instanceof Error ? failure.message : String(failure));
        }
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
