import type { DatabaseSync } from 'node:sqlite';

import { einfrieren, type Profil, type ProfilRepository, type Profilversion } from '../../../domain/consolidation/Profil.js';
import type { Strukturvorgabe } from '../../../domain/discovery/Expectation.js';
import { nullable } from './SqliteDatabase.js';

interface ProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  document: string;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  matches: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, tenant_id, name, description, document, confirmed_by, confirmed_by_name, matches, created_at, updated_at';

/**
 * Die Versionskette steht als ein Dokument in einer Spalte: Sie ist eine
 * Definition und wird als Ganzes gelesen und geschrieben. Was danebensteht —
 * Mandant, Name, Trefferzähler — sind die Angaben, nach denen gesucht und
 * sortiert wird, und die gehören in eigene Spalten.
 *
 * Die Tabelle heißt weiterhin `structure_profiles`. Ein Tabellenname ist
 * hausintern; ihn umzubenennen kostet eine Umstellung an gespeicherten Daten
 * und bringt niemandem etwas.
 */
interface Dokument {
  versionen: readonly Profilversion[];
}

/**
 * Liest ein Dokument, gleich welchen Alters.
 *
 * Vor Etappe 2 stand hier eine nackte `Strukturvorgabe` — ein Profil hatte
 * genau eine Fassung und keine Einstellungen. Ein solches Dokument wird zu
 * Version 1: Das ist genau, was es war, und nichts wird dazuerfunden.
 */
function zuVersionen(row: ProfileRow): Profilversion[] {
  const gelesen = JSON.parse(row.document) as Dokument | Strukturvorgabe;

  if ('versionen' in gelesen && Array.isArray(gelesen.versionen)) {
    return gelesen.versionen.map((version) => ({ ...version, erstellt: new Date(version.erstellt) }));
  }

  return [
    {
      version: 1,
      erstellt: new Date(row.created_at),
      erstelltVon: row.confirmed_by ?? undefined,
      erstelltVonName: row.confirmed_by_name ?? undefined,
      notiz: 'Aus einem bestätigten Datenblock angelegt',
      vorgabe: gelesen as Strukturvorgabe,
      einstellungen: {},
    },
  ];
}

function toProfil(row: ProfileRow): Profil {
  return einfrieren({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    versionen: zuVersionen(row),
    matches: Number(row.matches),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

export class SqliteProfilRepository implements ProfilRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(tenantId: string): Promise<Profil[]> {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM structure_profiles WHERE tenant_id = ? ORDER BY matches DESC, name ASC`)
      .all(tenantId) as unknown as ProfileRow[];

    return rows.map(toProfil);
  }

  async getById(id: string): Promise<Profil | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM structure_profiles WHERE id = ?`).get(id) as unknown as
      | ProfileRow
      | undefined;

    return row ? toProfil(row) : undefined;
  }

  async save(profil: Profil): Promise<Profil> {
    const erste = profil.versionen[0];

    this.database
      .prepare(
        `INSERT INTO structure_profiles
           (id, tenant_id, name, description, document, confirmed_by, confirmed_by_name, matches, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name              = excluded.name,
           description       = excluded.description,
           document          = excluded.document,
           matches           = excluded.matches,
           updated_at        = excluded.updated_at`
      )
      .run(
        profil.id,
        profil.tenantId,
        profil.name,
        nullable(profil.description),
        JSON.stringify({ versionen: profil.versionen } satisfies Dokument),
        /*
         * Wer das Profil angelegt hat, bleibt stehen. Beim Fortschreiben wird
         * es nicht überschrieben — der Urheber jeder einzelnen Version steht
         * ohnehin in der Version selbst, und diese Spalte beantwortet die
         * andere Frage: wer das Profil ins Leben gerufen hat.
         */
        nullable(erste.erstelltVon),
        nullable(erste.erstelltVonName),
        profil.matches,
        profil.createdAt.toISOString(),
        profil.updatedAt.toISOString()
      );

    return profil;
  }

  async delete(id: string): Promise<void> {
    this.database.prepare('DELETE FROM structure_profiles WHERE id = ?').run(id);
  }
}
