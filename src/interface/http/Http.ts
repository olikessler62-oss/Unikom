import type { IncomingMessage } from 'node:http';

import type { AuthenticatedSession } from '../../application/users/SessionService.js';
import type { Permission } from '../../domain/users/User.js';

/** Beyond this a request body is refused unread (spec section 96 in spirit). */
export const MAX_BODY_BYTES = 1_000_000;

export interface SetCookie {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  httpOnly?: boolean;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  cookies?: SetCookie[];
}

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Present for everything but the login route. */
  session?: AuthenticatedSession;
  request: IncomingMessage;
}

export type Handler = (context: RequestContext) => Promise<ApiResponse> | ApiResponse;

/**
 * What a route demands. `PUBLIC` is only the login. `SESSION` means logged in
 * but no particular right — that is the password change, which has to work for
 * somebody who was handed a password and may do nothing else yet.
 */
export type RouteAuthorization = 'PUBLIC' | 'SESSION' | Permission;

export interface Route {
  method: string;
  pattern: string;
  authorization: RouteAuthorization;
  handle: Handler;
}

/** An error a caller caused, with a message meant for them to read. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function ok(body?: unknown): ApiResponse {
  return { status: body === undefined ? 204 : 200, body };
}

export function created(body: unknown): ApiResponse {
  return { status: 201, body };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');

    if (separator > 0) {
      cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return cookies;
}

/**
 * `Secure` is set only for HTTPS. Setting it unconditionally would make the
 * cookie silently disappear on a plain-HTTP installation, and a login that
 * appears to work but never stays logged in is worse than an honest warning at
 * startup.
 */
export function serializeCookie(cookie: SetCookie, secure: boolean): string {
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`, 'Path=/', 'SameSite=Strict'];

  if (cookie.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  if (secure) {
    parts.push('Secure');
  }

  if (cookie.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${cookie.maxAgeSeconds}`);
  }

  return parts.join('; ');
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > MAX_BODY_BYTES) {
      throw new ApiError(413, 'The request body is too large');
    }

    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'The request body is not valid JSON');
  }
}

/** Matches `/api/jobs/:id` against a concrete path, yielding the parameters. */
export function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const expected = pattern.split('/');
  const actual = path.split('/');

  if (expected.length !== actual.length) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];

    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(actual[index]);
      continue;
    }

    if (segment !== actual[index]) {
      return undefined;
    }
  }

  return params;
}

export function requireObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, `${what} has to be sent as a JSON object`);
  }

  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(400, `"${field}" is missing`);
  }

  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
