import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { ROLES, type Role } from '../../../domain/users/User.js';
import {
  ApiError,
  created,
  ok,
  optionalString,
  requireObject,
  requireString,
  type Route,
} from '../Http.js';

function requireRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new ApiError(400, `"${value}" is not a role. Expected one of: ${ROLES.join(', ')}`);
  }

  return value as Role;
}

function requireBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];

  if (typeof value !== 'boolean') {
    throw new ApiError(400, `"${field}" has to be true or false`);
  }

  return value;
}

export function userRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/users',
      authorization: 'MANAGE_USERS',
      handle: async () => ok(await application.userService.list()),
    },
    {
      method: 'POST',
      pattern: '/api/users',
      authorization: 'MANAGE_USERS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The user');

        return created(
          await application.userService.create({
            username: requireString(input, 'username'),
            displayName: optionalString(input, 'displayName') ?? requireString(input, 'username'),
            role: requireRole(requireString(input, 'role')),
            password: requireString(input, 'password'),
            // Somebody else chose this password, so it is not theirs yet.
            mustChangePassword: true,
          })
        );
      },
    },
    {
      method: 'PUT',
      pattern: '/api/users/:id/role',
      authorization: 'MANAGE_USERS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The role');
        return ok(await application.userService.setRole(params.id, requireRole(requireString(input, 'role'))));
      },
    },
    {
      method: 'PUT',
      pattern: '/api/users/:id/enabled',
      authorization: 'MANAGE_USERS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The change');
        return ok(await application.userService.setEnabled(params.id, requireBoolean(input, 'enabled')));
      },
    },
    {
      method: 'POST',
      pattern: '/api/users/:id/password',
      authorization: 'MANAGE_USERS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The password');
        await application.userService.resetPassword(params.id, requireString(input, 'password'));

        return { status: 204 };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/users/:id',
      authorization: 'MANAGE_USERS',
      handle: async ({ params, session }) => {
        if (params.id === session!.user.id) {
          throw new ApiError(400, 'You cannot delete your own account while you are using it');
        }

        await application.userService.delete(params.id);
        return { status: 204 };
      },
    },
  ];
}
