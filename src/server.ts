import path from 'node:path';

import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import {
  ensureInitialAdministrator,
  initialAdministratorNotice,
} from './application/users/InitialAdministrator.js';
import { ApiServer } from './interface/http/ApiServer.js';
import { ConsoleLogger } from './infrastructure/logging/ConsoleLogger.js';
import type { LogLevel } from './domain/logging/LogEntry.js';

const DATA_DIRECTORY = path.resolve(process.env.UNIKOM_DATA_DIRECTORY ?? 'application-data');
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

async function main(): Promise<void> {
  const application = createPersistentApplication(DATA_DIRECTORY, {
    logLevel: LOG_LEVEL,
    logger: new ConsoleLogger(),
  });

  const administrator = await ensureInitialAdministrator(application.userService);
  if (administrator) {
    console.log(initialAdministratorNotice(administrator));
  }

  // Sessions outlive a restart, so expired ones have to be swept up at some
  // point; once at startup plus the daily retention run is enough.
  await application.sessionService.pruneExpired();

  await application.runtime.bootstrap.reconstructSchedules(new Date());
  application.runtime.startPolling(POLL_INTERVAL_MS);

  const server = new ApiServer(application, { host: HOST, port: PORT, behindTls: BEHIND_TLS });
  const { host, port } = await server.listen();

  console.log(`Unikom — Oberfläche auf http://${host}:${port}`);
  console.log(`Unikom — Daten in ${DATA_DIRECTORY}`);
  console.log(`Unikom — Module: ${application.features.enabled().join(', ') || 'nur Grundprodukt'}\n`);

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

void main().catch((error: unknown) => {
  console.error('Unikom konnte nicht starten:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
