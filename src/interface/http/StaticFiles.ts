import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serves the built interface from `dist/web`. One process, one port: an
 * installation should be one thing to start and one thing to watch.
 *
 * Returns a handler that reports whether it dealt with the request, so the API
 * keeps everything under /api and this takes the rest.
 */
export function createStaticHandler(
  directory: string
): (request: IncomingMessage, response: ServerResponse) => boolean {
  const root = path.resolve(directory);

  return (request, response) => {
    const url = new URL(request.url ?? '/', 'http://unikom.local');

    if (url.pathname.startsWith('/api/')) {
      return false;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return false;
    }

    const file = resolveFile(root, url.pathname);

    if (!file) {
      return false;
    }

    const isEntryPoint = file.endsWith('index.html');

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The entry point must never be cached, or a new version would keep
      // loading the previous one's scripts. The assets carry a content hash in
      // their name, so they can be cached hard.
      'Cache-Control': isEntryPoint ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });

    if (request.method === 'HEAD') {
      response.end();
      return true;
    }

    fs.createReadStream(file).pipe(response);
    return true;
  };
}

/**
 * Turns a request path into a file below the root, or into the entry point for
 * anything the interface routes itself.
 *
 * The resolved path is compared against the root rather than the raw one being
 * trusted: `/../../etc/passwd` and its encoded variants must not be able to
 * read outside the built interface.
 */
function resolveFile(root: string, pathname: string): string | undefined {
  const entryPoint = path.join(root, 'index.html');
  const decoded = safeDecode(pathname);

  if (decoded === undefined) {
    return undefined;
  }

  const candidate = path.resolve(root, `.${decoded}`);
  const relative = path.relative(root, candidate);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }

  if (isFile(candidate)) {
    return candidate;
  }

  // Anything else belongs to the interface's own navigation, so it gets the
  // entry point and the page decides what to show.
  return isFile(entryPoint) ? entryPoint : undefined;
}

function safeDecode(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
