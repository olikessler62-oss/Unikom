import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { csrfTokenFor, SESSION_IDLE_HOURS } from '../../../application/users/SessionService.js';
import { permissionsOf, toSummary } from '../../../domain/users/User.js';
import {
  ApiError,
  ok,
  requireObject,
  requireString,
  type Route,
} from '../Http.js';

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
          body: {
            user: toSummary(result.user),
            permissions: result.user.mustChangePassword ? [] : permissionsOf(result.user.role),
            mustChangePassword: result.user.mustChangePassword,
            // The page has to send this back in a header on every change.
            csrfToken: csrfTokenFor(token),
          },
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
      handle: ({ session, request }) => {
        const user = session!.user;
        const token = sessionTokenOf(request.headers.cookie);

        return ok({
          user: toSummary(user),
          permissions: user.mustChangePassword ? [] : permissionsOf(user.role),
          mustChangePassword: user.mustChangePassword,
          csrfToken: token ? csrfTokenFor(token) : undefined,
          features: application.features.enabled(),
        });
      },
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

export function sessionTokenOf(cookieHeader: string | undefined): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');

    if (separator > 0 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}
