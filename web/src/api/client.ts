/**
 * The only way the interface reaches the server. Everything goes through here,
 * so the CSRF token, the error handling and the session handling exist once
 * instead of in every screen.
 */

const CSRF_HEADER = 'x-unikom-csrf';

/** An answer the server refused to give, with the message it sent along. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Set when a module is missing (402), so the screen can name it. */
    readonly feature?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Held in memory only. Putting it in localStorage would leave it lying around
 * after the session it belongs to has long ended.
 */
let csrfToken: string | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (csrfToken && method !== 'GET') {
    headers[CSRF_HEADER] = csrfToken;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // The session cookie is httpOnly, so it has to travel by itself.
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const detail = payload as { error?: string; feature?: string } | undefined;
    throw new ApiError(response.status, detail?.error ?? `Unerwartete Antwort ${response.status}`, detail?.feature);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
