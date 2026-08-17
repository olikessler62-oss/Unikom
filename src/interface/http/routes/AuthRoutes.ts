import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { csrfTokenFor, SESSION_IDLE_HOURS } from '../../../application/users/SessionService.js';
import { permissionsOf, toSummary, type User } from '../../../domain/users/User.js';
import {
  ApiError,
  ok,
  requireObject,
  requireString,
  type Route,
} from '../Http.js';
import { toLicenceView } from './LicenceRoutes.js';

export const SESSION_COOKIE = 'unikom_session';

export function authRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'POST',
      pattern: '/api/session',
      authorization: 'PUBLIC',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The login');
        const result = await application.userService.authenticate(
          requireString(input, 'username'),
          requireString(input, 'password')
        );

        if (!result.ok) {
          // The reason travels for the disabled and locked cases, which the
          // user can do nothing about without help. A wrong password stays
          // deliberately vague.
          throw new ApiError(401, result.message);
        }

        const token = await application.sessionService.issue(result.user.id);

        return {
          status: 200,
          cookies: [{ name: SESSION_COOKIE, value: token, maxAgeSeconds: SESSION_IDLE_HOURS * 3600 }],
          body: await identityOf(application, result.user, token),
        };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/session',
      authorization: 'SESSION',
      handle: async ({ request }) => {
        const token = sessionTokenOf(request.headers.cookie);

        if (token) {
          await application.sessionService.revoke(token);
        }

        return { status: 204, cookies: [{ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0 }] };
      },
    },
    {
      method: 'GET',
      pattern: '/api/me',
      authorization: 'SESSION',
      handle: async ({ session, request }) =>
        ok(await identityOf(application, session!.user, sessionTokenOf(request.headers.cookie))),
    },
    {
      // Reachable with mustChangePassword set, which is the whole point: it is
      // the one thing such a session is allowed to do.
      method: 'POST',
      pattern: '/api/me/password',
      authorization: 'SESSION',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'The password change');

        await application.userService.changePassword(
          session!.user.id,
          requireString(input, 'currentPassword'),
          requireString(input, 'newPassword')
        );

        // Every session of this user is gone now, including this one, so the
        // cookie has to go with it rather than point at nothing.
        return { status: 204, cookies: [{ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0 }] };
      },
    },
  ];
}

/**
 * Who is signed in, and what this installation may do. Both the login and
 * `/api/me` answer with this, and they have to answer alike: the interface
 * adopts whichever it happens to receive first. When only one of them carried
 * the modules, a fresh login looked like an installation without them, and
 * reloading the page silently repaired it — a fault that hides when watched.
 */
async function identityOf(
  application: UnikomApplication,
  user: User,
  token: string | undefined
): Promise<Record<string, unknown>> {
  return {
    user: toSummary(user),
    permissions: user.mustChangePassword ? [] : permissionsOf(user.role),
    mustChangePassword: user.mustChangePassword,
    // The page has to send this back in a header on every change.
    csrfToken: token ? csrfTokenFor(token) : undefined,
    features: application.features.enabled(),
    // Travels with the identity so the warning about the end of the paid
    // period is on every screen, not only on the one nobody visits.
    licence: toLicenceView(await application.licenceService.refresh()),
  };
}

export function sessionTokenOf(cookieHeader: string | undefined): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');

    if (separator > 0 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}
