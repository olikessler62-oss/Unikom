import fs from 'node:fs/promises';
import path from 'node:path';
import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import { ConsoleLogger } from './infrastructure/logging/ConsoleLogger.js';
import type { LogLevel } from './domain/logging/LogEntry.js';
import { DEFAULT_TENANT_ID } from './domain/tenants/Tenant.js';
import type { TransferJob } from './domain/transfer/TransferJob.js';

const DATA_DIRECTORY = path.resolve('application-data');
const SOURCE_DIRECTORY = path.resolve('demo', 'source');
const DESTINATION_DIRECTORY = path.resolve('demo', 'incoming');

/** `UNIKOM_LOG_LEVEL=DEBUG npm run dev` shows why each file was rejected. */
const LOG_LEVEL = (process.env.UNIKOM_LOG_LEVEL as LogLevel | undefined) ?? 'INFO';

const DEMO_FILES: Record<string, string> = {
  'ORDER_001.csv': 'customer;amount\nA;42\n',
  'ORDER_002.csv': 'customer;amount\nB;17\n',
  // Neither of these may be picked up: wrong prefix, and an unfinished upload.
  'INVOICE_001.csv': 'ignored\n',
  'ORDER_003.csv.part': 'still uploading\n',
};

function demoJob(): TransferJob {
  return {
    id: 'job-demo-001',
    tenantId: DEFAULT_TENANT_ID,
    name: 'Kunde A - Bestellungen',
    description: 'Beispiel-Job gemäß Spec Abschnitt 3',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: SOURCE_DIRECTORY },
    sourceDirectory: SOURCE_DIRECTORY,
    filenamePrefix: 'ORDER_*',
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.part', '.tmp', '.temp'],
    minimumFileAgeSeconds: 0,
    stabilityCheck: {
      enabled: true,
      intervalSeconds: 0,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },
    destinationDirectory: DESTINATION_DIRECTORY,
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',
    executionMode: 'MANUAL_AND_AUTOMATIC',
    schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Only creates what is missing. Rewriting the files on every start would change
 * their modification time, which makes them look like new files to the identity
 * check — the content hash would still catch them, but only after a download.
 */
async function seedSourceDirectory(): Promise<void> {
  await fs.mkdir(SOURCE_DIRECTORY, { recursive: true });

  for (const [name, content] of Object.entries(DEMO_FILES)) {
    const target = path.join(SOURCE_DIRECTORY, name);
    const alreadyThere = await fs.access(target).then(() => true, () => false);

    if (!alreadyThere) {
      await fs.writeFile(target, content);
    }
  }
}

function formatDuration(milliseconds: number | undefined): string {
  return milliseconds === undefined ? '-' : `${(milliseconds / 1000).toFixed(1)}s`;
}

async function bootstrap(): Promise<void> {
  await seedSourceDirectory();

  const application = createPersistentApplication(DATA_DIRECTORY, {
    logLevel: LOG_LEVEL,
    logger: new ConsoleLogger(),
  });

  await application.tenantService.ensureDefaultTenant();

  const existing = await application.jobRepository.getById('job-demo-001');
  if (!existing) {
    await application.jobRepository.save(demoJob());
  }

  console.log(`Unikom - Quelle: ${SOURCE_DIRECTORY}`);
  console.log(`Unikom - Ziel:   ${DESTINATION_DIRECTORY}`);
  console.log(`Unikom - Log-Level: ${LOG_LEVEL} (mit UNIKOM_LOG_LEVEL=DEBUG mehr Details)\n`);

  await application.runtime.bootstrap.reconstructSchedules(new Date());
  await application.runtime.orchestrator.runJobNow('job-demo-001');

  const statistics = await application.historyService.statistics();
  const history = await application.historyService.listRuns('job-demo-001', 5);

  console.log('\n── Historie ──────────────────────────────────────────────');
  for (const run of history) {
    console.log(
      `${run.startedAt.toISOString().slice(0, 19).replace('T', ' ')}  ` +
        `${run.status.padEnd(22)}  Dauer ${formatDuration(run.durationMs).padStart(6)}  ` +
        `gefunden ${run.filesFound}  übernommen ${run.filesSucceeded}  übersprungen ${run.filesSkipped}  ` +
        `fehlgeschlagen ${run.filesFailed}`
    );
  }

  console.log('\n── Dashboard ─────────────────────────────────────────────');
  console.log(`Aktive Jobs:                ${statistics.activeJobs}`);
  console.log(`Heute ausgeführte Läufe:    ${statistics.runsToday}`);
  console.log(`Heute übernommene Dateien:  ${statistics.filesTransferredToday}`);
  console.log(`Fehlgeschlagene Dateien:    ${statistics.filesFailedToday}`);

  for (const next of statistics.nextExecutions) {
    console.log(`Nächste Ausführung:         ${next.jobName} um ${next.nextExecutionAt.toISOString()}`);
  }

  application.close();
}

void bootstrap().catch((error: unknown) => {
  console.error('Unikom bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
