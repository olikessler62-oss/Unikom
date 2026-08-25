import type { DatabaseSync } from 'node:sqlite';

import type { Meldeeinstellungen } from '../../../domain/background/Postausgang.js';
import type { Konfliktverhalten } from '../../../domain/conflicts/Konfliktverhalten.js';
import type { Mandanteneinstellungen } from '../../../domain/consolidation/Einstellungen.js';
import type { Region } from '../../../domain/tenants/Region.js';
import type { Tenant, TenantRepository } from '../../../domain/tenants/Tenant.js';
import { nullable } from './SqliteDatabase.js';

interface TenantRow {
  id: string;
  name: string;
  description: string | null;
  root_directory: string | null;
  region: string | null;
  notification: string | null;
  consolidation: string | null;
  exports_days: number | null;
  archive_days: number | null;
  conflicts: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, name, description, root_directory, region, notification, consolidation, exports_days, ' +
  'archive_days, conflicts, enabled, created_at, updated_at';

/**
 * Die Region steht als eine Spalte und nicht als zwei.
 *
 * Sie ist eine Angabe aus zwei Teilen, die nur zusammen etwas bedeuten: Eine
 * halbe Region — Kennung ohne Zeitzone — gibt es nicht, und zwei Spalten
 * könnten genau das enthalten. Unlesbares wird beim Lesen zu „keine Angabe",
 * damit ein beschädigter Eintrag den Mandanten nicht unerreichbar macht.
 */
function toRegion(gespeichert: string | null): Region | undefined {
  if (!gespeichert) {
    return undefined;
  }

  try {
    const gelesen = JSON.parse(gespeichert) as Partial<Region>;

    return typeof gelesen.locale === 'string' && typeof gelesen.timeZone === 'string'
      ? { locale: gelesen.locale, timeZone: gelesen.timeZone }
      : undefined;
  } catch {
    return undefined;
  }
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rootDirectory: row.root_directory ?? undefined,
    region: toRegion(row.region),
    benachrichtigung: ausJson<Meldeeinstellungen>(row.notification),
    consolidation: ausJson<Mandanteneinstellungen>(row.consolidation),
    ausleitungenTage: row.exports_days ?? undefined,
    archivTage: row.archive_days ?? undefined,
    konflikte: ausJson<Konfliktverhalten>(row.conflicts),
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
        `INSERT INTO tenants (id, name, name_lower, description, root_directory, region, notification,
                               consolidation, exports_days, archive_days, conflicts, enabled,
                               created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name           = excluded.name,
           name_lower     = excluded.name_lower,
           description    = excluded.description,
           root_directory = excluded.root_directory,
           region         = excluded.region,
           notification   = excluded.notification,
           consolidation  = excluded.consolidation,
           exports_days   = excluded.exports_days,
           archive_days   = excluded.archive_days,
           conflicts      = excluded.conflicts,
           enabled        = excluded.enabled,
           updated_at     = excluded.updated_at`
      )
      .run(
        tenant.id,
        tenant.name,
        tenant.name.trim().toLowerCase(),
        nullable(tenant.description),
        nullable(tenant.rootDirectory),
        tenant.region ? JSON.stringify(tenant.region) : null,
        tenant.benachrichtigung ? JSON.stringify(tenant.benachrichtigung) : null,
        tenant.consolidation ? JSON.stringify(tenant.consolidation) : null,
        tenant.ausleitungenTage ?? null,
        tenant.archivTage ?? null,
        tenant.konflikte ? JSON.stringify(tenant.konflikte) : null,
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

/**
 * Was als JSON gespeichert wurde — oder nichts.
 *
 * Ein kaputter Eintrag macht den Mandanten nicht unlesbar: Er verliert die
 * Einstellung und behält seinen Namen, sein Verzeichnis und seine Läufe. Ein
 * Wurf an dieser Stelle nähme die ganze Verwaltung mit.
 */
function ausJson<T>(gespeichert: string | null): T | undefined {
  if (!gespeichert) {
    return undefined;
  }

  try {
    return JSON.parse(gespeichert) as T;
  } catch {
    return undefined;
  }
}
