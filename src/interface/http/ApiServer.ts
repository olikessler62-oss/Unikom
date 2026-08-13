import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import type { UnikomApplication } from '../../application/runtime/UnikomApplication.js';
import { csrfTokenFor, type AuthenticatedSession } from '../../application/users/SessionService.js';
import { FeatureNotLicensedError } from '../../domain/licensing/Feature.js';
import {
  ApiError,
  matchPath,
  parseCookies,
  readJsonBody,
  serializeCookie,
  type ApiResponse,
  type RequestContext,
  type Route,
} from './Http.js';
import { authRoutes, SESSION_COOKIE } from './routes/AuthRoutes.js';
import { credentialRoutes } from './routes/CredentialRoutes.js';
import { historyRoutes } from './routes/HistoryRoutes.js';
import { jobRoutes } from './routes/JobRoutes.js';
import { userRoutes } from './routes/UserRoutes.js';

export const CSRF_HEADER = 'x-unikom-csrf';

/** Methods that change something and therefore need the companion token. */
const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiServerOptions {
  /**
   * Defaults to 127.0.0.1. Anything else exposes the interface to the network,
   * where a plain-HTTP login would carry the password across it in the clear —
   * `listen` therefore refuses that unless `behindTls` says something else
   * terminates TLS in front of it.
   */
  host?: string;
  port?: number;
  /** A reverse proxy terminates TLS; cookies are then marked Secure. */
  behindTls?: boolean;
  /** Serves the built interface; without it only the API answers. */
  staticHandler?: (request: IncomingMessage, response: ServerResponse) => boolean;
}

export class ApiServer {
  private readonly routes: Route[];
  private server?: Server;

  constructor(
    private readonly application: UnikomApplication,
    private readonly options: ApiServerOptions = {}
  ) {
    this.routes = [
      ...authRoutes(application),
      ...jobRoutes(application),
      ...historyRoutes(application),
      ...credentialRoutes(application),
      ...userRoutes(application),
    ];
  }

  /** Exposed for tests, which drive requests without opening a port. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const result = await this.route(request);
      this.send(response, result);
    } catch (error) {
      this.send(response, this.toResponse(error));
    }
  }

  async listen(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 8383;

    if (host !== '127.0.0.1' && host !== 'localhost' && !this.options.behindTls) {
      throw new Error(
        `Refusing to listen on ${host} without TLS: the login password would cross the network in the clear. ` +
          'Put a reverse proxy with a certificate in front and set behindTls, or stay on 127.0.0.1.'
      );
    }

    this.server = createServer((request, response) => {
      if (this.options.staticHandler?.(request, response)) {
        return;
      }

      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, resolve);
    });

    const address = this.server.address();

    // Port 0 asks the system for a free one, so the configured value is not
    // necessarily the one it ended up on.
    return { host, port: typeof address === 'object' && address ? address.port : port };
  }

  async close(): Promise<void> {
    const server = this.server;

    if (!server) {
      return;
    }

    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async route(request: IncomingMessage): Promise<ApiResponse> {
    const url = new URL(request.url ?? '/', 'http://unikom.local');
    const method = request.method ?? 'GET';

    let pathExists = false;

    for (const route of this.routes) {
      const params = matchPath(route.pattern, url.pathname);

      if (!params) {
        continue;
      }

      pathExists = true;

      if (route.method !== method) {
        continue;
      }

      return this.dispatch(route, request, url, params);
    }

    // Separating the two is worth it: a wrong method is a mistake in our own
    // interface, a wrong path is a mistake in the request.
    throw new ApiError(pathExists ? 405 : 404, `${method} ${url.pathname} does not exist`);
  }

  private async dispatch(
    route: Route,
    request: IncomingMessage,
    url: URL,
    params: Record<string, string>
  ): Promise<ApiResponse> {
    // Everything is checked before the body is read: an unauthenticated
    // caller should not get us to do work, and a request that will be refused
    // anyway does not need to be understood first.
    let session: AuthenticatedSession | undefined;

    if (route.authorization !== 'PUBLIC') {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      session = await this.application.sessionService.resolve(token);

      if (!session) {
        throw new ApiError(401, 'Not logged in');
      }

      if (CHANGING_METHODS.has(route.method)) {
        assertCsrfToken(request, token!);
      }

      if (
        route.authorization !== 'SESSION' &&
        !this.application.sessionService.authorize(session, route.authorization)
      ) {
        throw new ApiError(
          403,
          session.user.mustChangePassword
            ? 'The password has to be changed before anything else can be done'
            : `Your role ${session.user.role} may not do this`
        );
      }
    }

    const context: RequestContext = {
      method: route.method,
      path: url.pathname,
      params,
      query: url.searchParams,
      body: CHANGING_METHODS.has(route.method) ? await readJsonBody(request) : undefined,
      request,
      session,
    };

    return route.handle(context);
  }

  private toResponse(error: unknown): ApiResponse {
    if (error instanceof ApiError) {
      return { status: error.status, body: { error: error.message } };
    }

    if (error instanceof FeatureNotLicensedError) {
      return { status: 402, body: { error: error.message, feature: error.feature } };
    }

    if (error instanceof Error) {
      // Everything the services reject is a caller mistake with a message
      // written for them; unexpected failures are logged, not sent.
      this.application.logger.log({
        timestamp: new Date(),
        level: 'ERROR',
        message: `API request failed: ${error.message}`,
      });

      return { status: 400, body: { error: error.message } };
    }

    return { status: 500, body: { error: 'Unexpected error' } };
  }

  private send(response: ServerResponse, result: ApiResponse): void {
    const secure = this.options.behindTls === true;

    if (result.cookies?.length) {
      response.setHeader(
        'Set-Cookie',
        result.cookies.map((cookie) => serializeCookie(cookie, secure))
      );
    }

    // The interface is served from the same origin and needs no remote
    // resources, so the policy can be this narrow.
    response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');

    if (result.body === undefined) {
      response.writeHead(result.status);
      response.end();
      return;
    }

    const payload = JSON.stringify(result.body);
    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    response.end(payload);
  }
}

/**
 * The session cookie alone does not prove the request was intended: a browser
 * sends it along with a request another site triggered. The companion token has
 * to arrive in a header, which only our own page can set — and computing it
 * needs the session token from an httpOnly cookie no foreign script can read.
 */
function assertCsrfToken(request: IncomingMessage, sessionToken: string): void {
  const supplied = request.headers[CSRF_HEADER];
  const expected = csrfTokenFor(sessionToken);

  if (typeof supplied !== 'string' || supplied.length !== expected.length) {
    throw new ApiError(403, 'The request is missing its CSRF token');
  }

  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new ApiError(403, 'The CSRF token does not match this session');
  }
}
