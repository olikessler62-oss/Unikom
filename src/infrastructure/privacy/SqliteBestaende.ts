import type { DatabaseSync } from 'node:sqlite';

import {
  GESCHWAERZT,
  MAX_FUNDE,
  type Bestand,
  type Bestandsauskunft,
  type Fund,
} from '../../domain/privacy/DataStore.js';

/**
 * Die Bestände, die in der Datenbank liegen.
 *
 * Protokolle werden **geschwärzt**, nicht gelöscht: Dass ein Lauf stattgefunden
 * hat und was er getan hat, ist die Tatsache, die nachvollziehbar bleiben muss
 * (SPEC-05, Abschnitt 13). Der Name in der Zeile ist es nicht.
 *
 * Verglichen wird in TypeScript und nicht in SQL. Der Grund ist ein Fehler, den
 * ein Test gefunden hat: SQLite vergleicht bei `LIKE` ohne Rücksicht auf Groß-
 * und Kleinschreibung, `replace()` aber genau. Die Suche fand damit „mustermann",
 * das Schwärzen ließ es stehen — gefunden und trotzdem nicht gelöscht, ohne
 * eine einzige Meldung. Beides betrifft ohnehin nur ASCII; ein „Müller" hätte
 * ein „müller" nie getroffen.
 *
 * Gelesen wird in Blöcken. Ein Löschauftrag ist eine seltene Handlung eines
 * Administrators; Genauigkeit zählt hier mehr als Geschwindigkeit.
 */
const BLOCK = 1000;

/**
 * Welche Workflows zu einem Mandanten gehören.
 *
 * Protokoll und Dateiliste kennen den Mandanten nicht, sondern den Workflow.
 * Ohne diese Auflösung könnte ein Bestand die Eingrenzung auf einen Mandanten
 * nur vortäuschen — und beim Löschen die Zeilen aller anderen mitnehmen.
 */
export type JobsOfTenant = (tenantId: string) => Promise<string[]>;

function trifft(text: string | null, begriff: string): boolean {
  return text !== null && text.toLocaleLowerCase().includes(begriff.toLocaleLowerCase());
}

function schwaerze(text: string, begriff: string): string {
  const muster = new RegExp(begriff.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

  return text.replace(muster, GESCHWAERZT);
}

function fund(wo: string, auszug: string, wann?: string): Fund {
  return { wo, auszug: auszug.length > 200 ? `${auszug.slice(0, 200)} …` : auszug, wann };
}

/**
 * Die Einschränkung auf einen Mandanten, als SQL-Bedingung.
 *
 * Zeilen ohne Workflow — was die Anwendung selbst protokolliert — bleiben beim
 * Eingrenzen außen vor. Sie gehören zu keinem Mandanten, und ein Löschauftrag
 * für einen bestimmten Mandanten darf sie deshalb nicht anfassen.
 */
async function eingrenzung(
  tenantId: string | undefined,
  jobsOfTenant: JobsOfTenant | undefined
): Promise<{ bedingung: string; parameter: string[] }> {
  if (!tenantId || !jobsOfTenant) {
    return { bedingung: '', parameter: [] };
  }

  const jobs = await jobsOfTenant(tenantId);

  // Ein Mandant ohne Workflows hat in diesen Beständen nichts stehen. `IN ()`
  // ist kein gültiges SQL, deshalb die ausgeschriebene Unmöglichkeit.
  if (jobs.length === 0) {
    return { bedingung: 'WHERE 1 = 0', parameter: [] };
  }

  return { bedingung: `WHERE job_id IN (${jobs.map(() => '?').join(', ')})`, parameter: jobs };
}

/** Läuft eine Tabelle in Blöcken ab, damit ein großes Protokoll nicht auf einmal im Speicher liegt. */
function* bloecke<T>(database: DatabaseSync, sql: string, parameter: string[] = []): Generator<T[]> {
  let versatz = 0;

  for (;;) {
    const zeilen = database
      .prepare(`${sql} LIMIT ? OFFSET ?`)
      .all(...parameter, BLOCK, versatz) as unknown as T[];

    if (zeilen.length === 0) {
      return;
    }

    yield zeilen;
    versatz += zeilen.length;
  }
}

interface Protokollzeile {
  id: number;
  timestamp: string;
  message: string;
  filename: string | null;
}

export function laufprotokollBestand(database: DatabaseSync, jobsOfTenant?: JobsOfTenant): Bestand {
  const lesen = (bedingung: string): string =>
    `SELECT id, timestamp, message, filename FROM transfer_logs ${bedingung} ORDER BY id DESC`;

  return {
    key: 'laufprotokoll',
    name: 'Laufprotokoll',
    inhalt: 'Schritte, Dateinamen, Zählwerte, Fehler',
    ort: 'DATENBANK',
    personenbezug: 'MITTELBAR',
    aufbewahrung: '90 Tage, je Workflow einstellbar',
    behandlung: 'SCHWAERZEN',
    mandantenweise: jobsOfTenant !== undefined,

    async suchen(begriff, tenantId, grenze = MAX_FUNDE): Promise<Bestandsauskunft> {
      const { bedingung, parameter } = await eingrenzung(tenantId, jobsOfTenant);
      const funde: Fund[] = [];
      let treffer = 0;

      for (const zeilen of bloecke<Protokollzeile>(database, lesen(bedingung), parameter)) {
        for (const zeile of zeilen) {
          if (!trifft(zeile.message, begriff) && !trifft(zeile.filename, begriff)) {
            continue;
          }

          treffer += 1;

          if (funde.length < grenze) {
            funde.push(fund('Protokollzeile', zeile.message, zeile.timestamp));
          }
        }
      }

      return {
        key: 'laufprotokoll',
        name: 'Laufprotokoll',
        treffer,
        behandlung: 'SCHWAERZEN',
        funde,
        hinweis:
          'Die Zeilen bleiben erhalten und werden nur an der betroffenen Stelle unkenntlich gemacht — ' +
          'sonst verschwände mit dem Namen auch die Tatsache, dass etwas verarbeitet wurde',
      };
    },

    async ausfuehren(begriff, tenantId): Promise<number> {
      const { bedingung, parameter } = await eingrenzung(tenantId, jobsOfTenant);
      const schreiben = database.prepare('UPDATE transfer_logs SET message = ?, filename = ? WHERE id = ?');
      let stellen = 0;

      for (const zeilen of bloecke<Protokollzeile>(database, lesen(bedingung), parameter)) {
        for (const zeile of zeilen) {
          if (!trifft(zeile.message, begriff) && !trifft(zeile.filename, begriff)) {
            continue;
          }

          schreiben.run(
            schwaerze(zeile.message, begriff),
            zeile.filename === null ? null : schwaerze(zeile.filename, begriff),
            zeile.id
          );
          stellen += 1;
        }
      }

      return stellen;
    },
  };
}

interface Dateizeile {
  id: string;
  source_path: string;
  source_filename: string;
  started_at: string | null;
}

export function uebertrageneDateienBestand(database: DatabaseSync, jobsOfTenant?: JobsOfTenant): Bestand {
  const lesen = (bedingung: string): string =>
    `SELECT id, source_path, source_filename, started_at FROM transfer_files ${bedingung} ORDER BY rowid DESC`;

  return {
    key: 'dateien',
    name: 'Übertragene Dateien',
    inhalt: 'Dateinamen, Pfade, Prüfsummen, Status je Datei',
    ort: 'DATENBANK',
    personenbezug: 'MITTELBAR',
    aufbewahrung: '90 Tage, je Workflow einstellbar',
    behandlung: 'SCHWAERZEN',
    mandantenweise: jobsOfTenant !== undefined,

    async suchen(begriff, tenantId, grenze = MAX_FUNDE): Promise<Bestandsauskunft> {
      const { bedingung, parameter } = await eingrenzung(tenantId, jobsOfTenant);
      const funde: Fund[] = [];
      let treffer = 0;

      for (const zeilen of bloecke<Dateizeile>(database, lesen(bedingung), parameter)) {
        for (const zeile of zeilen) {
          if (!trifft(zeile.source_filename, begriff) && !trifft(zeile.source_path, begriff)) {
            continue;
          }

          treffer += 1;

          if (funde.length < grenze) {
            funde.push(fund(zeile.source_path, zeile.source_filename, zeile.started_at ?? undefined));
          }
        }
      }

      return { key: 'dateien', name: 'Übertragene Dateien', treffer, behandlung: 'SCHWAERZEN', funde };
    },

    async ausfuehren(begriff, tenantId): Promise<number> {
      const { bedingung, parameter } = await eingrenzung(tenantId, jobsOfTenant);
      const schreiben = database.prepare(
        'UPDATE transfer_files SET source_filename = ?, source_path = ? WHERE id = ?'
      );
      let stellen = 0;

      for (const zeilen of bloecke<Dateizeile>(database, lesen(bedingung), parameter)) {
        for (const zeile of zeilen) {
          if (!trifft(zeile.source_filename, begriff) && !trifft(zeile.source_path, begriff)) {
            continue;
          }

          schreiben.run(schwaerze(zeile.source_filename, begriff), schwaerze(zeile.source_path, begriff), zeile.id);
          stellen += 1;
        }
      }

      return stellen;
    },
  };
}

/**
 * Die Bestände, die es in dieser Fassung noch nicht gibt, aber geben wird.
 *
 * Sie stehen hier mit `treffer: 0` und einem Hinweis, statt zu fehlen: Eine
 * Auskunft, die einen Bestand verschweigt, weil er noch leer ist, gewöhnt den
 * Leser daran, dass die Liste unvollständig sein darf.
 */
export function angekuendigterBestand(key: string, name: string, inhalt: string, hinweis: string): Bestand {
  return {
    key,
    name,
    inhalt,
    ort: 'DATENBANK',
    personenbezug: 'JA',
    aufbewahrung: 'noch nicht festgelegt',
    behandlung: 'ANZEIGEN',
    // Ein Bestand ohne Zeilen grenzt sich mühelos ein.
    mandantenweise: true,
    async suchen(): Promise<Bestandsauskunft> {
      return { key, name, treffer: 0, behandlung: 'ANZEIGEN', funde: [], hinweis };
    },
    async ausfuehren(): Promise<number> {
      return 0;
    },
  };
}
