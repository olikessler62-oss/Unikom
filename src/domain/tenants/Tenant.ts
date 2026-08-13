/**
 * A client of the operator — "Mandant" in the interface.
 *
 * This is not the SaaS kind of tenant. Unikom runs on the operator's own
 * machine and serves exactly one company. That company, however, may be a
 * service provider who collects, processes and delivers data for several of
 * their own clients, and those must not get mixed up.
 *
 * A company with a single source server simply has one tenant and never has to
 * think about it.
 */
export interface Tenant {
  id: string;
  /** Shown everywhere; has to be unique so two clients cannot be confused. */
  name: string;
  description?: string;
  /**
   * Everything this tenant's jobs write stays below this directory, and that is
   * checked rather than trusted. Without it a typo in a destination path drops
   * one client's files into another client's folder, and nobody notices.
   *
   * Optional: an installation with a single client gains nothing from it. As
   * soon as it is set, it is enforced.
   */
  rootDirectory?: string;
  /** A disabled tenant keeps its history; its jobs no longer run. */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantRepository {
  list(): Promise<Tenant[]>;
  getById(id: string): Promise<Tenant | undefined>;
  findByName(name: string): Promise<Tenant | undefined>;
  save(tenant: Tenant): Promise<Tenant>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

/** Identifier of the tenant an installation starts with. */
export const DEFAULT_TENANT_ID = 'default';
export const DEFAULT_TENANT_NAME = 'Standard';
