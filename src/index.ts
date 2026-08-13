import fs from 'node:fs/promises';
import path from 'node:path';
import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import type { TransferEvent } from './application/transfer/TransferEvents.js';
import type { TransferJob } from './domain/transfer/TransferJob.js';

const DATA_DIRECTORY = path.resolve('application-data');
const SOURCE_DIRECTORY = path.resolve('demo', 'source');
const DESTINATION_DIRECTORY = path.resolve('demo', 'incoming');

function formatEvent(event: TransferEvent): string {
  const timestamp = new Date().toISOString().slice(11, 19);
  const subject = event.filename ? ` ${event.filename}` : '';
  return `${timestamp}  ${event.name}${subject} — ${event.message}`;
}

function demoJob(): TransferJob {
  return {
    id: 'job-demo-001',
    name: 'Kunde A – Bestellungen',
    description: 'Beispiel-Job gemäß Spec Abschnitt 3',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: SOURCE_DIRECTORY, recursive: false },
    sourceDirectory: SOURCE_DIRECTORY,
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_',
    caseSensitivePrefix: false,
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

const DEMO_FILES: Record<string, string> = {
  'ORDER_001.csv': 'customer;amount\nA;42\n',
  'ORDER_002.csv': 'customer;amount\nB;17\n',
  // Neither of these may be picked up: wrong prefix, and an unfinished upload.
  'INVOICE_001.csv': 'ignored\n',
  'ORDER_003.csv.part': 'still uploading\n',
};

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

async function bootstrap(): Promise<void> {
  await seedSourceDirectory();

  const application = createPersistentApplication(DATA_DIRECTORY, {
    events: (event) => console.log(formatEvent(event)),
  });

  const existing = await application.jobRepository.getById('job-demo-001');
  if (!existing) {
    await application.jobRepository.save(demoJob());
    console.log('Job neu angelegt.\n');
  } else {
    console.log(`Job aus ${DATA_DIRECTORY} geladen — letzter Lauf: ${existing.lastExecutionAt?.toISOString() ?? 'nie'}\n`);
  }

  await application.runtime.bootstrap.reconstructSchedules(new Date());
  const run = await application.runtime.orchestrator.runJobNow('job-demo-001');

  const stored = await application.jobRepository.getById('job-demo-001');
  const transferred = await fs.readdir(DESTINATION_DIRECTORY).catch(() => []);
  const history = await application.runRepository.listByJob('job-demo-001');

  console.log('\nRun:', run?.id);
  console.log('Status:', run?.status);
  console.log('Gefunden:', run?.filesFound, '· Übernommen:', run?.filesSucceeded, '· Übersprungen:', run?.filesSkipped);
  console.log('Im Ziel:', transferred.join(', ') || '(leer)');
  console.log('Läufe insgesamt:', history.length);
  console.log('Nächste Ausführung:', stored?.nextExecutionAt?.toISOString() ?? '(kein Zeitplan)');
  console.log('\nTipp: "npm run dev" erneut ausführen — die Dateien werden dann als Duplikate übersprungen.');
}

void bootstrap().catch((error: unknown) => {
  console.error('Unikom bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
