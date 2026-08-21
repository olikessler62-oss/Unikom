import type { DatabaseSync } from 'node:sqlite';

import type {
  Benachrichtigung,
  Benachrichtigungsbestand,
  Meldeanlass,
  Meldestufe,
} from '../../../domain/background/Benachrichtigung.js';
import type { Herzschlag, Herzschlagbestand } from '../../../domain/background/Heartbeat.js';
import { nullable } from './SqliteDatabase.js';

/**
 * Herzschlag und Benachrichtigungen in SQLite.
 *
 * Beide gehoeren zusammen in eine Datei, weil sie dasselbe Problem loesen: Was
 * ein Prozess erlebt, muss ein anderer erfahren koennen — auch wenn der erste
 * nicht mehr da ist. Ohne einen Bestand dazwischen waere der Hintergrundbetrieb
 * eine Blackbox mit einem Fenster, das man geoeffnet haben muss.
 */
interface HerzschlagRow {
  process: string;
  last_seen: string;
  run_id: string | null;
  host: string | null;
  pid: number | null;
  started_at: string;
}

interface MeldungRow {
  id: string;
  tenant_id: string;
  reason: string;
  level: string;
  title: string;
  body: string;
  target_kind: string | null;
  target_id: string | null;
  created_at: string;
  seen_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export class SqliteHeartbeatRepository implements Herzschlagbestand {
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Ein Lebenszeichen — angelegt oder aufgefrischt.
   *
   * Ein einziger kurzer Zug: Der Worker schreibt es alle paar Sekunden, und
   * eine Transaktion, die dabei laenger offen stuende, sperrte die Oberflaeche
   * regelmaessig aus.
   */
  async melden(schlag: Herzschlag): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO worker_heartbeats (process, last_seen, run_id, host, pid, started_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(process) DO UPDATE SET
           last_seen = excluded.last_seen,
           run_id = excluded.run_id`
      )
      .run(
        schlag.prozess,
        schlag.zuletzt,
        nullable(schlag.laufId),
        nullable(schlag.host),
        schlag.pid ?? null,
        schlag.gestartet
      );
  }

  async alle(): Promise<Herzschlag[]> {
    const rows = this.database
      .prepare('SELECT * FROM worker_heartbeats ORDER BY started_at')
      .all() as unknown as HerzschlagRow[];

    return rows.map((row) => ({
      prozess: row.process,
      zuletzt: row.last_seen,
      laufId: row.run_id ?? undefined,
      host: row.host ?? undefined,
      pid: row.pid ?? undefined,
      gestartet: row.started_at,
    }));
  }

  async abmelden(prozess: string): Promise<void> {
    this.database.prepare('DELETE FROM worker_heartbeats WHERE process = ?').run(prozess);
  }
}

export class SqliteNotificationRepository implements Benachrichtigungsbestand {
  constructor(private readonly database: DatabaseSync) {}

  async anlegen(meldung: Benachrichtigung): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO notifications
           (id, tenant_id, reason, level, title, body, target_kind, target_id, created_at,
            seen_at, acknowledged_at, acknowledged_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meldung.id,
        meldung.tenantId,
        meldung.anlass,
        meldung.stufe,
        meldung.titel,
        meldung.text,
        nullable(meldung.ziel?.art),
        nullable(meldung.ziel?.id),
        meldung.entstanden,
        nullable(meldung.gesehen),
        nullable(meldung.bestaetigt),
        nullable(meldung.bestaetigtVon)
      );
  }

  async list(tenantId: string, nurOffene = false): Promise<Benachrichtigung[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM notifications
         WHERE tenant_id = ?${nurOffene ? ' AND acknowledged_at IS NULL' : ''}
         ORDER BY created_at DESC`
      )
      .all(tenantId) as unknown as MeldungRow[];

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      anlass: row.reason as Meldeanlass,
      stufe: row.level as Meldestufe,
      titel: row.title,
      text: row.body,
      ziel: row.target_kind
        ? { art: row.target_kind as NonNullable<Benachrichtigung['ziel']>['art'], id: row.target_id ?? '' }
        : undefined,
      entstanden: row.created_at,
      gesehen: row.seen_at ?? undefined,
      bestaetigt: row.acknowledged_at ?? undefined,
      bestaetigtVon: row.acknowledged_by ?? undefined,
    }));
  }

  /** Gesehen wird nur einmal vermerkt — der erste Blick ist der, auf den es ankommt. */
  async gesehen(id: string, zeitpunkt: string): Promise<void> {
    this.database.prepare('UPDATE notifications SET seen_at = ? WHERE id = ? AND seen_at IS NULL').run(zeitpunkt, id);
  }

  /**
   * Bestaetigen ist etwas anderes als sehen.
   *
   * `WHERE acknowledged_at IS NULL` sorgt dafuer, dass der erste Bestaetiger
   * derjenige bleibt, der im Bestand steht: Wer eine Stunde spaeter dasselbe
   * noch einmal wegklickt, ueberschreibt nicht, wer es wirklich erledigt hat.
   */
  async bestaetigen(id: string, benutzer: string, zeitpunkt: string): Promise<void> {
    this.database
      .prepare(
        `UPDATE notifications SET acknowledged_at = ?, acknowledged_by = ?, seen_at = COALESCE(seen_at, ?)
         WHERE id = ? AND acknowledged_at IS NULL`
      )
      .run(zeitpunkt, benutzer, zeitpunkt, id);
  }
}
