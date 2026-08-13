import type { DatabaseSync } from 'node:sqlite';

import type { Tenant, TenantRepository } from '../../../domain/tenants/Tenant.js';
import { nullable } from './SqliteDatabase.js';

interface TenantRow {
  id: string;
  name: string;
  description: string | null;
  root_directory: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, name, description, root_directory, enabled, created_at, updated_at';

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rootDirectory: row.root_directory ?? undefined,
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteTenantRepository implements TenantRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<Tenant[]> {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM tenants ORDER BY name_lower ASC`)
      .all() as unknown as TenantRow[];

    return rows.map(toTenant);
  }

  async getById(id: string): Promise<Tenant | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM tenants WHERE id = ?`).get(id) as unknown as
      | TenantRow
      | undefined;

    return row ? toTenant(row) : undefined;
  }

  async findByName(name: string): Promise<Tenant | undefined> {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM tenants WHERE name_lower = ?`)
      .get(name.trim().toLowerCase()) as unknown as TenantRow | undefined;

    return row ? toTenant(row) : undefined;
  }

  async save(tenant: Tenant): Promise<Tenant> {
    this.database
      .prepare(
        `INSERT INTO tenants (id, name, name_lower, description, root_directory, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name           = excluded.name,
           name_lower     = excluded.name_lower,
           description    = excluded.description,
           root_directory = excluded.root_directory,
           enabled        = excluded.enabled,
           updated_at     = excluded.updated_at`
      )
      .run(
        tenant.id,
        tenant.name,
        tenant.name.trim().toLowerCase(),
        nullable(tenant.description),
        nullable(tenant.rootDirectory),
        tenant.enabled ? 1 : 0,
        tenant.createdAt.toISOString(),
        tenant.updatedAt.toISOString()
      );

    return tenant;
  }

  async delete(id: string): Promise<void> {
    this.database.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  }

  async count(): Promise<number> {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM tenants').get() as unknown as {
      total: number;
    };

    return Number(row.total);
  }
}
