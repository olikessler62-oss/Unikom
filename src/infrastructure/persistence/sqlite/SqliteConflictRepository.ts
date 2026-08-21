import type { DatabaseSync } from 'node:sqlite';

import type { Konfliktfilter } from '../../../domain/conflicts/Auswahl.js';
import { filtere } from '../../../domain/conflicts/Auswahl.js';
import type { Bearbeitungsstand } from '../../../domain/conflicts/Fortschritt.js';
import type { Bearbeitungsschritt, Schrittart } from '../../../domain/conflicts/Historie.js';
import type { Konfliktbestand } from '../../../domain/conflicts/Konfliktbestand.js';
import type {
  Konfliktfall,
  Konfliktstatus,
  Kritikalitaet,
  Streitfeld,
} from '../../../domain/conflicts/Konfliktfall.js';
import { nullable } from './SqliteDatabase.js';

/**
 * Der Konfliktbestand in SQLite (SPEC-07, Dateimodell).
 *
 * ## Was hier fehlt, fehlt mit Absicht
 *
 * Es gibt kein `DELETE`. Ein Konfliktfall wird erledigt, nicht gelöscht — und
 * die Historie schon gar nicht. Was fortgeräumt wird, sind die Ausleitungen im
 * Dateisystem; „wird eine Ausleitung nach Ablauf der Aufbewahrungsfrist
 * gelöscht, bleiben Konfliktfall, Entscheidungen und Historie in der Datenbank
 * erhalten".
 *
 * ## Warum Felder und Quellen als JSON in einer Spalte stehen
 *
 * Ein Streitfeld hat mehrere Angebote, jedes Angebot Metadaten. Als eigene
 * Tabellen wären das drei Verknüpfungen für eine Ansicht, die immer den ganzen
 * Fall zeigt und nie ein einzelnes Angebot sucht. Was **gesucht** wird — Status,
 * Kritikalität, Lauf, Datensatz — steht in eigenen Spalten und ist indiziert.
 */
interface KonfliktRow {
  id: string;
  tenant_id: string;
  run_id: string;
  record: string;
  art: string;
  criticality: string;
  status: string;
  cause: string;
  rule: string | null;
  expected: string;
  found: string;
  next_steps: string;
  sources: string;
  fields: string;
  result: string | null;
  created_at: string;
  changed_at: string;
  derived_from: string | null;
  lock_user: string | null;
  lock_user_name: string | null;
  lock_since: string | null;
  version: number;
}

interface SchrittRow {
  conflict_id: string;
  step: number;
  art: string;
  at: string;
  user_id: string;
  user_name: string | null;
  from_status: string | null;
  to_status: string | null;
  before_values: string | null;
  after_values: string | null;
  decision: string | null;
  rule: string | null;
  batch: string | null;
  note: string | null;
}

interface StandRow {
  tenant_id: string;
  user_id: string;
  last_id: string | null;
  position: number | null;
  filter: string | null;
  grouping: string | null;
  sorting: string | null;
  direction: string | null;
  saved_at: string;
}

const SPALTEN =
  'id, tenant_id, run_id, record, art, criticality, status, cause, rule, expected, found, next_steps, ' +
  'sources, fields, result, created_at, changed_at, derived_from, lock_user, lock_user_name, lock_since, version';

/**
 * JSON lesen, ohne den ganzen Bestand zu verlieren.
 *
 * Eine Zeile mit kaputtem JSON — von Hand bearbeitet, halb geschrieben — würde
 * sonst jede Abfrage werfen, die sie mitliest, und damit auch alle gesunden
 * Fälle unerreichbar machen. Der Ersatzwert steht für „hier war etwas, das
 * sich nicht lesen ließ"; der Fall bleibt sichtbar, und man sieht ihm an, dass
 * etwas fehlt.
 */
function lies<T>(text: string | null, ersatz: T): T {
  if (!text) {
    return ersatz;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return ersatz;
  }
}

function toFall(row: KonfliktRow): Konfliktfall {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    laufId: row.run_id,
    datensatz: row.record,
    art: row.art,
    kritikalitaet: row.criticality as Kritikalitaet,
    status: row.status as Konfliktstatus,
    ursache: row.cause,
    regel: row.rule ?? undefined,
    erwartet: row.expected,
    vorgefunden: row.found,
    naechsteSchritte: row.next_steps,
    quellen: lies<string[]>(row.sources, []),
    felder: lies<Streitfeld[]>(row.fields, []),
    ergebnis: row.result ? lies<Record<string, string>>(row.result, {}) : undefined,
    entstanden: row.created_at,
    geaendert: row.changed_at,
    entstandenAus: row.derived_from ?? undefined,
    sperre: row.lock_user
      ? {
          benutzer: row.lock_user,
          benutzerName: row.lock_user_name ?? undefined,
          seit: row.lock_since ?? row.changed_at,
        }
      : undefined,
    fassung: Number(row.version),
  };
}

function toSchritt(row: SchrittRow): Bearbeitungsschritt {
  return {
    nummer: Number(row.step),
    fallId: row.conflict_id,
    art: row.art as Schrittart,
    zeitpunkt: row.at,
    benutzer: row.user_id,
    benutzerName: row.user_name ?? undefined,
    vonStatus: (row.from_status as Konfliktstatus) ?? undefined,
    nachStatus: (row.to_status as Konfliktstatus) ?? undefined,
    vorher: row.before_values ? lies<Record<string, string>>(row.before_values, {}) : undefined,
    nachher: row.after_values ? lies<Record<string, string>>(row.after_values, {}) : undefined,
    entscheidung: row.decision ?? undefined,
    regel: row.rule ?? undefined,
    vorgang: row.batch ?? undefined,
    bemerkung: row.note ?? undefined,
  };
}

export class SqliteConflictRepository implements Konfliktbestand {
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Die Fälle eines Mandanten.
   *
   * Was sich billig in SQL eingrenzen lässt, wird dort eingegrenzt — Status,
   * Kritikalität und Lauf sind indiziert oder wenigstens Spalten. Der Rest,
   * insbesondere die Freitextsuche über Werte, läuft danach über `filtere`:
   * Dieselbe Funktion wie im Arbeitsspeicher, damit beide Umsetzungen bei
   * derselben Anfrage dasselbe antworten.
   */
  async list(tenantId: string, filter: Konfliktfilter = {}): Promise<Konfliktfall[]> {
    const bedingungen = ['tenant_id = ?'];
    const werte: string[] = [tenantId];

    if (filter.status && filter.status.length > 0) {
      bedingungen.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
      werte.push(...filter.status);
    }

    if (filter.kritikalitaet && filter.kritikalitaet.length > 0) {
      bedingungen.push(`criticality IN (${filter.kritikalitaet.map(() => '?').join(', ')})`);
      werte.push(...filter.kritikalitaet);
    }

    if (filter.laufId) {
      bedingungen.push('run_id = ?');
      werte.push(filter.laufId);
    }

    const rows = this.database
      .prepare(`SELECT ${SPALTEN} FROM conflicts WHERE ${bedingungen.join(' AND ')} ORDER BY created_at`)
      .all(...werte) as unknown as KonfliktRow[];

    return filtere(rows.map(toFall), { ...filter, status: undefined, kritikalitaet: undefined, laufId: undefined });
  }

  async byId(id: string): Promise<Konfliktfall | undefined> {
    const row = this.database.prepare(`SELECT ${SPALTEN} FROM conflicts WHERE id = ?`).get(id) as unknown as
      | KonfliktRow
      | undefined;

    return row ? toFall(row) : undefined;
  }

  async save(fall: Konfliktfall): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO conflicts (${SPALTEN})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           criticality = excluded.criticality,
           cause = excluded.cause,
           rule = excluded.rule,
           expected = excluded.expected,
           found = excluded.found,
           next_steps = excluded.next_steps,
           sources = excluded.sources,
           fields = excluded.fields,
           result = excluded.result,
           changed_at = excluded.changed_at,
           lock_user = excluded.lock_user,
           lock_user_name = excluded.lock_user_name,
           lock_since = excluded.lock_since,
           version = excluded.version`
      )
      .run(
        fall.id,
        fall.tenantId,
        fall.laufId,
        fall.datensatz,
        fall.art,
        fall.kritikalitaet,
        fall.status,
        fall.ursache,
        nullable(fall.regel),
        fall.erwartet,
        fall.vorgefunden,
        fall.naechsteSchritte,
        JSON.stringify(fall.quellen),
        JSON.stringify(fall.felder),
        fall.ergebnis ? JSON.stringify(fall.ergebnis) : null,
        fall.entstanden,
        fall.geaendert,
        nullable(fall.entstandenAus),
        nullable(fall.sperre?.benutzer),
        nullable(fall.sperre?.benutzerName),
        nullable(fall.sperre?.seit),
        fall.fassung
      );
  }

  async historie(fallId: string): Promise<Bearbeitungsschritt[]> {
    const rows = this.database
      .prepare('SELECT * FROM conflict_steps WHERE conflict_id = ? ORDER BY step')
      .all(fallId) as unknown as SchrittRow[];

    return rows.map(toSchritt);
  }

  /**
   * Ein Schritt kommt hinzu — mehr kann diese Klasse mit der Historie nicht.
   *
   * Kein `ON CONFLICT DO UPDATE`: Der Primärschlüssel aus Fall und Nummer
   * lässt einen zweiten Schritt mit derselben Nummer nicht zu, und das ist die
   * Absicht. Zwei gleichzeitige Entscheidungen scheitern hier hart, statt sich
   * gegenseitig zu überschreiben.
   */
  async schrittAnfuegen(schritt: Bearbeitungsschritt): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO conflict_steps
           (conflict_id, step, art, at, user_id, user_name, from_status, to_status,
            before_values, after_values, decision, rule, batch, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        schritt.fallId,
        schritt.nummer,
        schritt.art,
        schritt.zeitpunkt,
        schritt.benutzer,
        nullable(schritt.benutzerName),
        nullable(schritt.vonStatus),
        nullable(schritt.nachStatus),
        schritt.vorher ? JSON.stringify(schritt.vorher) : null,
        schritt.nachher ? JSON.stringify(schritt.nachher) : null,
        nullable(schritt.entscheidung),
        nullable(schritt.regel),
        nullable(schritt.vorgang),
        nullable(schritt.bemerkung)
      );
  }

  async standOf(benutzer: string, tenantId: string): Promise<Bearbeitungsstand | undefined> {
    const row = this.database
      .prepare('SELECT * FROM conflict_progress WHERE tenant_id = ? AND user_id = ?')
      .get(tenantId, benutzer) as unknown as StandRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      benutzer: row.user_id,
      tenantId: row.tenant_id,
      zuletzt: row.last_id ?? undefined,
      position: row.position ?? undefined,
      filter: row.filter ? lies<Konfliktfilter>(row.filter, {}) : undefined,
      gruppierung: (row.grouping as Bearbeitungsstand['gruppierung']) ?? undefined,
      sortierung: (row.sorting as Bearbeitungsstand['sortierung']) ?? undefined,
      richtung: (row.direction as Bearbeitungsstand['richtung']) ?? undefined,
      gespeichert: row.saved_at,
    };
  }

  async standSpeichern(stand: Bearbeitungsstand): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO conflict_progress
           (tenant_id, user_id, last_id, position, filter, grouping, sorting, direction, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, user_id) DO UPDATE SET
           last_id = excluded.last_id,
           position = excluded.position,
           filter = excluded.filter,
           grouping = excluded.grouping,
           sorting = excluded.sorting,
           direction = excluded.direction,
           saved_at = excluded.saved_at`
      )
      .run(
        stand.tenantId,
        stand.benutzer,
        nullable(stand.zuletzt),
        stand.position ?? null,
        stand.filter ? JSON.stringify(stand.filter) : null,
        nullable(stand.gruppierung),
        nullable(stand.sortierung),
        nullable(stand.richtung),
        stand.gespeichert
      );
  }
}
