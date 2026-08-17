import path from 'node:path';

import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import {
  ensureInitialAdministrator,
  initialAdministratorNotice,
} from './application/users/InitialAdministrator.js';
import {
  DEFAULT_MASTER_KEY_VARIABLE,
  MASTER_KEY_COMMAND,
} from './infrastructure/security/MasterKeyProvider.js';
import { ApiServer } from './interface/http/ApiServer.js';
import { createStaticHandler } from './interface/http/StaticFiles.js';
import { ConsoleLogger } from './infrastructure/logging/ConsoleLogger.js';
import type { LogLevel } from './domain/logging/LogEntry.js';
import type { LicenceStatus } from './domain/licensing/Licence.js';

const DATA_DIRECTORY = path.resolve(process.env.UNIKOM_DATA_DIRECTORY ?? 'application-data');
/** The built interface. `npm run web:build` puts it here. */
const WEB_DIRECTORY = path.resolve(process.env.UNIKOM_WEB_DIRECTORY ?? 'dist/web');
const LOG_LEVEL = (process.env.UNIKOM_LOG_LEVEL as LogLevel | undefined) ?? 'INFO';

/**
 * Local by default. Reaching the interface from the network is a deliberate
 * act, and one that needs TLS in front of it — see ApiServer.listen.
 */
const HOST = process.env.UNIKOM_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.UNIKOM_PORT ?? '8383', 10);
const BEHIND_TLS = process.env.UNIKOM_BEHIND_TLS === 'true';

/** How often the scheduler looks for jobs that have come due. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Der Satz über den Hauptschlüssel.
 *
 * Er wird erst geholt, wenn ein Geheimnis gebraucht wird — beim Start steht
 * deshalb noch nicht immer fest, ob er sich öffnen lässt. Gesagt wird darum,
 * woher er kommen wird, und wo keiner in Sicht ist, wird das deutlich gesagt.
 */
function masterKeyLine(notices: string[]): string {
  if (notices.length > 0) {
    return notices.join(' — ');
  }

  if (process.env[DEFAULT_MASTER_KEY_VARIABLE]) {
    return `Hauptschlüssel aus der Umgebungsvariablen ${DEFAULT_MASTER_KEY_VARIABLE}`;
  }

  if (process.platform === 'win32') {
    return 'Hauptschlüssel wird beim ersten Zugang von Windows verwahrt angelegt';
  }

  return (
    `ACHTUNG: kein Hauptschlüssel. Ohne ${DEFAULT_MASTER_KEY_VARIABLE} lässt sich kein Zugang speichern. ` +
    `Einen erzeugen mit: ${MASTER_KEY_COMMAND}`
  );
}

async function main(): Promise<void> {
  /*
   * Was mit dem Hauptschlüssel geschieht, wird beim Start gesagt und nicht
   * beim ersten Zugang.
   *
   * Vorher fehlte er stillschweigend: Der Server fuhr hoch, alles sah in
   * Ordnung aus, und die Auskunft kam erst, nachdem jemand ein ganzes Formular
   * ausgefüllt hatte. Ein Zustand, der beim Start bekannt ist, gehört beim
   * Start gesagt.
   */
  const securityNotices: string[] = [];
  const application = createPersistentApplication(DATA_DIRECTORY, {
    logLevel: LOG_LEVEL,
    logger: new ConsoleLogger(),
    onSecurityNotice: (message) => securityNotices.push(message),
  });

  // Runs on every start: it creates the standard client on an empty
  // installation and adopts jobs that predate clients, so an upgrade needs no
  // migration step of its own.
  await application.tenantService.ensureDefaultTenant();

  const administrator = await ensureInitialAdministrator(application.userService);
  if (administrator) {
    console.log(initialAdministratorNotice(administrator));
  }

  // Sessions outlive a restart, so expired ones have to be swept up at some
  // point; once at startup plus the daily retention run is enough.
  await application.sessionService.pruneExpired();

  // Vor dem ersten Tick: die Module hängen daran, und ein abgelaufener
  // Zeitraum soll beim Hochfahren auf der Konsole stehen, nicht erst auffallen,
  // wenn nachts nichts übertragen wurde.
  const licence = await application.licenceService.refresh();

  await application.runtime.bootstrap.reconstructSchedules(new Date());
  application.runtime.startPolling(POLL_INTERVAL_MS);

  const server = new ApiServer(application, {
    host: HOST,
    port: PORT,
    behindTls: BEHIND_TLS,
    staticHandler: createStaticHandler(WEB_DIRECTORY),
  });
  const { host, port } = await server.listen();

  console.log(`Unikom — Oberfläche auf http://${host}:${port}`);
  console.log(`Unikom — Daten in ${DATA_DIRECTORY}`);
  console.log(`Unikom — ${masterKeyLine(securityNotices)}`);
  console.log(`Unikom — Module: ${application.features.enabled().join(', ') || 'nur Grundprodukt'}`);
  console.log(`Unikom — ${licenceLine(licence)}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nUnikom — ${signal} empfangen, fahre herunter`);
    application.runtime.stopPolling();
    await server.close();
    application.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Eine Zeile, die im Zweifel jemand aus einem Protokoll vorliest. */
function licenceLine(status: LicenceStatus): string {
  switch (status.state) {
    case 'UNLICENSED':
      return 'Lizenz: wird nicht geprüft (unlizenzierte Installation)';
    case 'ACTIVE':
    case 'EXPIRING':
      return `Lizenz: ${status.licence?.customer ?? 'unbekannt'}, bezahlt bis ${
        status.licence?.validUntil.toISOString().slice(0, 10) ?? '—'
      }${status.state === 'EXPIRING' ? ` (noch ${status.daysRemaining} Tage)` : ''}`;
    default:
      return `Lizenz: KEINE ÜBERTRAGUNGEN — ${status.problem ?? status.state}`;
  }
}

void main().catch((error: unknown) => {
  console.error('Unikom konnte nicht starten:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
