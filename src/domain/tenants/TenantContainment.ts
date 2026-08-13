import path from 'node:path';

import type { Tenant } from './Tenant.js';

export class TenantBoundaryError extends Error {
  constructor(
    readonly tenantName: string,
    message: string
  ) {
    super(message);
    this.name = 'TenantBoundaryError';
  }
}

/**
 * Checks that a directory really lies below the tenant's root.
 *
 * Deliberately a comparison of resolved paths and not a string prefix: with a
 * prefix, `D:/Data/KundeAB` would count as being inside `D:/Data/KundeA`, and
 * two clients whose names begin alike would share a boundary that is not one.
 */
export function assertWithinTenant(tenant: Tenant, directory: string, what: string): void {
  if (!tenant.rootDirectory) {
    return;
  }

  const root = path.resolve(tenant.rootDirectory);
  const target = path.resolve(directory);
  const relative = path.relative(root, target);

  // An empty relative path means the root itself, which is allowed: a client
  // may write straight into their own folder.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TenantBoundaryError(
      tenant.name,
      `${what} lies outside the directory of "${tenant.name}" (${root}). ` +
        'Files of one client must not be able to land in another client\'s folder.'
    );
  }
}

/**
 * Whether two tenants' roots would overlap. Nesting one client's directory
 * inside another's would make the boundary meaningless in one direction.
 */
export function rootsOverlap(first: string, second: string): boolean {
  const left = path.resolve(first);
  const right = path.resolve(second);
  const forward = path.relative(left, right);
  const backward = path.relative(right, left);

  const contains = (relative: string): boolean =>
    relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));

  return contains(forward) || contains(backward);
}
