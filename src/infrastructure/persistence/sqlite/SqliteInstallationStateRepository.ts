import type { DatabaseSync } from 'node:sqlite';

import type { InstallationStateRepository } from '../../../domain/installation/InstallationState.js';

interface StateRow {
  value: string;
}

export class SqliteInstallationStateRepository implements InstallationStateRepository {
  constructor(private readonly database: DatabaseSync) {}

  async get(key: string): Promise<string | undefined> {
    const row = this.database.prepare('SELECT value FROM installation_state WHERE key = ?').get(key) as unknown as
      | StateRow
      | undefined;

    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO installation_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }
}
