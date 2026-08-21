import path from 'node:path';

import { BackgroundService, dieserProzess } from './application/background/BackgroundService.js';
import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import type { LogLevel } from './domain/logging/LogEntry.js';
import { ConsoleLogger } from './infrastructure/logging/ConsoleLogger.js';

/**
 * Der Background Worker (SPEC-01, Abschnitt 13).
 *
 * Ein **eigenständiger** Node-Prozess. Er hat keine Oberfläche, öffnet keinen
 * Port und wartet auf niemanden: Er sieht in der Datenbank nach, was fällig
 * ist, arbeitet es ab und schreibt das Ergebnis zurück.
 *
 * ```text
 * npm run serve    Oberfläche, HTTP, Einstellungen
 * npm run worker   Läufe, Protokoll, Status, Meldungen
 * ```
 *
 * ## Warum ein eigener Prozess
 *
 * „Die Verarbeitung darf niemals von einem geöffneten Browser abhängig sein"
 * (SPEC-02, Abschnitt 50). Ein Browser ist schnell zu, und ein Server, den
 * jemand für ein Update neu startet, ist es auch. Was nachts um zwei laufen
 * soll, darf an keinem von beiden hängen.
 *
 * Beide Prozesse schreiben in dieselbe SQLite — siehe `Prozessrollen`. SQLite
 * reiht die Schreibvorgänge im WAL-Modus ein; die einzige Regel, die dafür
 * gelten muss, ist: keine Transaktion über eine Wartezeit hinweg.
 *
 * ## Was er beim Start als Erstes tut
 *
 * Nachsehen, ob Läufe auf `RUNNING` stehen, für die sich niemand mehr meldet.
 * Nach einem Stromausfall ist die Herzschlagtabelle leer und der Lauf steht
 * trotzdem als laufend im Bestand — der Prozess, der ihn hätte beenden müssen,
 * ist ja der verschwundene.
 */
const DATA_DIRECTORY = path.resolve(process.env.UNIKOM_DATA_DIRECTORY ?? 'application-data');
const LOG_LEVEL = (process.env.UNIKOM_LOG_LEVEL as LogLevel | undefined) ?? 'INFO';

/** Wie oft nachgesehen wird, ob ein Workflow fällig ist. */
const POLL_INTERVAL_MS = Number.parseInt(process.env.UNIKOM_WORKER_INTERVAL_MS ?? '60000', 10);

/**
 * Wie viele Datensätze eine Konsolidierung höchstens umfasst.
 *
 * Leer heißt: die gemessene Voreinstellung. Sie beschreibt den Rechner —
 * siehe `Menge`.
 */
const HOECHSTMENGE = process.env.UNIKOM_HOECHSTMENGE
  ? Number.parseInt(process.env.UNIKOM_HOECHSTMENGE, 10)
  : undefined;

async function main(): Promise<void> {
  const application = createPersistentApplication(DATA_DIRECTORY, {
    logLevel: LOG_LEVEL,
    logger: new ConsoleLogger(),
    hoechstmenge: HOECHSTMENGE,
  });

  const prozess = dieserProzess();
  const hintergrund = application.backgroundService;

  await application.tenantService.ensureDefaultTenant();

  /*
   * Zuerst aufräumen, dann arbeiten. Ein Lauf, der noch als laufend im Bestand
   * steht, würde sonst neben dem neuen weiterexistieren — und in der Historie
   * stünden zwei, von denen einer nie endet.
   */
  const abgebrochene = await hintergrund.markiereAbgebrochene('default');

  if (abgebrochene.length > 0) {
    console.log(`Unikom Worker — ${abgebrochene.length} unterbrochene(r) Lauf/Läufe erkannt und geschlossen`);
  }

  hintergrund.beginneHerzschlag(prozess);

  await application.licenceService.refresh();
  await application.runtime.bootstrap.reconstructSchedules(new Date());
  application.runtime.startPolling(POLL_INTERVAL_MS);

  console.log(`Unikom Worker — läuft als ${prozess.id} (PID ${prozess.pid})`);
  console.log(`Unikom Worker — Daten in ${DATA_DIRECTORY}`);
  console.log(`Unikom Worker — sieht alle ${Math.round(POLL_INTERVAL_MS / 1000)} Sekunden nach fälligen Workflows`);

  /**
   * Ein ordentliches Ende.
   *
   * Es räumt das Lebenszeichen fort — und genau daran erkennt der andere
   * Prozess später, dass es kein Absturz war. Ohne diesen Abschied sähe jeder
   * geplante Neustart aus wie ein Abbruch, und die erste Meldung nach dem
   * Hochfahren wäre eine falsche.
   */
  const verabschieden = (signal: string): void => {
    console.log(`Unikom Worker — ${signal}, beende mich`);

    void hintergrund
      .beendeHerzschlag(prozess)
      .catch(() => undefined)
      .finally(() => {
        application.runtime.stopPolling();
        process.exit(0);
      });
  };

  process.on('SIGINT', () => verabschieden('SIGINT'));
  process.on('SIGTERM', () => verabschieden('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Unikom Worker konnte nicht starten:', error instanceof Error ? error.message : error);
  process.exit(1);
});
