import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createTransferEventLogger } from './TransferEventLogger.js';
import { LevelFilteredLogger, RecordingLogger } from './Loggers.js';
import { TransferExecutionService } from '../transfer/TransferExecutionService.js';
import { SftpSourceAdapter } from '../../infrastructure/sources/sftp/SftpSourceAdapter.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { LogEntry, LogLevel } from '../../domain/logging/LogEntry.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * What the protocol has to be able to answer.
 *
 * Not "does it log" — it always did — but whether somebody with a support case
 * open can read what happened without access to the machine: which path was
 * entered and what it was read as, how the login went step by step, what was
 * done to each file before it was done, and what exactly failed.
 */

const CONTENT = 'customer;amount\nA;42\n';
const USERNAME = 'unikom';
const PASSWORD = 'Protokoll-2026';

interface Harness {
  job: TransferJob;
  adapter: SftpSourceAdapter;
  service: TransferExecutionService;
  entries: LogEntry[];
  stop(): Promise<void>;
}

/**
 * Der Detailgrad steht am Workflow, nicht an der Installation.
 *
 * Früher genügte es, die Installation auf DEBUG zu stellen, und ein Workflow
 * ohne eigene Angabe folgte. Diese Erbschaft ist gestrichen — wer alle Schritte
 * sehen will, sagt es dem Workflow. Die Vorgabe hier ist deshalb DEBUG: Die
 * Prüfungen in dieser Datei fragen, ob wirklich jeder Schritt aufgeschrieben
 * wird, und dafür muss der Workflow ihn verlangen.
 */
async function setup(
  jobOverrides: Partial<TransferJob> = {},
  installationLevel: LogLevel = 'DEBUG'
): Promise<Harness> {
  const job: Partial<TransferJob> = { logLevel: 'DEBUG', ...jobOverrides };
  const remoteRoot = await withSftpRoot({ 'customer123/orders/ORDER_001.csv': CONTENT });
  const server = await SftpTestServer.start({ root: remoteRoot, username: USERNAME, password: PASSWORD });
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-protocol-'));

  const recorder = new RecordingLogger();
  const logger = new LevelFilteredLogger(recorder, installationLevel);

  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: path.join(workspace, 'application-data'),
    encryptionKeyProvider: { async getKey() { return 'protocol-test-key'; } },
    events: createTransferEventLogger(logger),
  });

  const adapter = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: 'orders',
      remoteWorkingDirectory: '/customer123',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 10,
    },
    { username: USERNAME, password: PASSWORD }
  );

  return {
    adapter,
    service,
    entries: recorder.entries,
    job: createTransferJob({
      sourceType: 'SFTP',
      sourceDirectory: 'orders',
      destinationDirectory: path.join(workspace, 'incoming'),
      filenamePrefix: 'ORDER_*',
      minimumFileAgeSeconds: 0,
      stabilityCheck: { enabled: false, intervalSeconds: 0, requiredStableChecks: 0, compareSize: false, compareLastModified: false },
      ...job,
    }),
    stop: async () => {
      await adapter.dispose?.();
      await server.stop();
    },
  };
}

/** All messages as one text, which is how somebody reads a protocol. */
function transcript(entries: LogEntry[]): string {
  return entries.map((entry) => `${entry.level} ${entry.message}`).join('\n');
}

test('the protocol shows the login step by step', async () => {
  const harness = await setup();

  try {
    await harness.service.execute(harness.job, harness.adapter);
    const text = transcript(harness.entries);

    for (const step of [
      /Verbindung zu 127\.0\.0\.1:\d+ als „unikom“ über Passwort/,
      /Der Server zeigt den Hostkey SHA256:/,
      /Der Hostkey stimmt mit dem hinterlegten Fingerabdruck überein/,
      /Verbunden und angemeldet über Passwort/,
      /\/customer123\/orders wird gelesen/,
    ]) {
      assert.match(text, step, `missing from the protocol: ${step}`);
    }
  } finally {
    await harness.stop();
  }
});

test('the protocol shows what the entered path was read as', async () => {
  const harness = await setup();

  try {
    await harness.service.execute(harness.job, harness.adapter);

    assert.match(
      transcript(harness.entries),
      /„orders“ wird gelesen als \/customer123\/orders \(Remote-Arbeitsverzeichnis \/customer123\)/,
      'the resolved path is the one thing a wrong directory is diagnosed by'
    );
  } finally {
    await harness.stop();
  }
});

test('every step of a file is announced before it happens and reported after', async () => {
  const harness = await setup({ encryptionConfig: { enabled: true, provider: 'AES_256_GCM' } });

  try {
    await harness.service.execute(harness.job, harness.adapter);
    const text = transcript(harness.entries);

    for (const pair of [
      [/ORDER_001\.csv wird geholt/, /Übertragung abgeschlossen/],
      [/ORDER_001\.csv wird geprüft, Prüfsumme wird berechnet/, /Prüfung bestanden/],
      [/ORDER_001\.csv wird mit AES-256-GCM verschlüsselt/, /Verschlüsselung mit AES-256-GCM abgeschlossen/],
      [/ORDER_001\.csv wird abgelegt als /, /Datei erfolgreich abgelegt/],
    ]) {
      assert.match(text, pair[0], `announcement missing: ${pair[0]}`);
      assert.match(text, pair[1], `completion missing: ${pair[1]}`);
      assert.ok(
        text.indexOf(text.match(pair[0])![0]) < text.indexOf(text.match(pair[1])![0]),
        `the announcement has to come first: ${pair[0]}`
      );
    }
  } finally {
    await harness.stop();
  }
});

test('what happened to the source file is said outright', async () => {
  const harness = await setup({ sourceSuccessAction: 'KEEP' });

  try {
    await harness.service.execute(harness.job, harness.adapter);

    assert.match(transcript(harness.entries), /ORDER_001\.csv bleibt in der Quelle liegen/);
  } finally {
    await harness.stop();
  }
});

test('a failing step names the file, the step and the reason', async () => {
  // The key provider refuses, so the encryption fails where it is used.
  const harness = await setup({
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'gone' },
  });
  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-protocol-fail-')),
    encryptionKeyProvider: {
      async getKey() {
        throw Object.assign(new Error('The key "gone" no longer exists'), { code: 'ENOKEY' });
      },
    },
    events: createTransferEventLogger(new LevelFilteredLogger(new RecordingLogger(), 'DEBUG')),
  });

  try {
    const result = await service.execute(harness.job, harness.adapter);

    assert.equal(result.filesFailed, 1);
    assert.match(result.outcomes[0].message, /no longer exists/);
    assert.match(result.outcomes[0].message, /\[ENOKEY\]/, 'the code ends the search, the sentence alone does not');
  } finally {
    await harness.stop();
  }
});

test('ein Workflow trägt seine Ausführlichkeit selbst, nicht die der Installation', async () => {
  /*
   * Ohne eigene Angabe gilt jeder Schritt — und zwar unabhängig davon, worauf
   * die Installation steht. Die Wahl „wie die Installation" gab es einmal und
   * ist gestrichen: Wer im Störungsfall wissen will, wie laut ein Workflow
   * schreibt, soll es an ihm ablesen können. Eine stillgestellte Installation
   * darf einen Workflow deshalb nicht mit stillstellen — sonst stünde am
   * Morgen nichts da, und niemand hätte das angeordnet.
   */
  const ohneAngabe = await setup({ logLevel: undefined }, 'ERROR');

  try {
    await ohneAngabe.service.execute(ohneAngabe.job, ohneAngabe.adapter);
    assert.match(
      transcript(ohneAngabe.entries),
      /Verbindung zu 127/,
      'ohne eigene Angabe schreibt der Workflow jeden Schritt, auch wenn die Installation nur Fehler will'
    );
  } finally {
    await ohneAngabe.stop();
  }

  const loud = await setup({ logLevel: 'DEBUG' }, 'INFO');

  try {
    await loud.service.execute(loud.job, loud.adapter);
    assert.match(
      transcript(loud.entries),
      /Verbindung zu 127/,
      'the job asked for detail, and the installation setting must not override that'
    );
  } finally {
    await loud.stop();
  }
});

/*
 * „Das Wesentliche" ist gestrichen, und zwar nicht nur aus der Liste.
 *
 * Ein Workflow, der die Angabe noch trägt, weil er vor der Änderung angelegt
 * wurde, schriebe sonst still weiter nach einer Regel, die es in der
 * Oberfläche nicht mehr gibt: Dort stünde „Jeder Schritt", und im Protokoll
 * fehlte genau die Zeile, wegen der man hinsieht.
 */
test('ein Workflow, der noch „Das Wesentliche" trägt, schreibt jeden Schritt', async () => {
  const altlast = await setup({ logLevel: 'INFO' as unknown as TransferJob['logLevel'] }, 'ERROR');

  try {
    await altlast.service.execute(altlast.job, altlast.adapter);
    assert.match(
      transcript(altlast.entries),
      /Verbindung zu 127/,
      'die gestrichene Angabe darf nicht als Schwelle überleben'
    );
  } finally {
    await altlast.stop();
  }
});

test('a job may also be turned down while the installation runs at DEBUG', async () => {
  const harness = await setup({ logLevel: 'WARNING' }, 'DEBUG');

  try {
    await harness.service.execute(harness.job, harness.adapter);

    assert.equal(
      harness.entries.some((entry) => entry.level === 'INFO' || entry.level === 'DEBUG'),
      false,
      'a workflow that runs every minute may ask to stay quiet'
    );
  } finally {
    await harness.stop();
  }
});

test('the connection test hands back the steps it took', async () => {
  const harness = await setup();

  try {
    const result = await harness.adapter.testConnection();

    assert.equal(result.ok, true, result.message);
    assert.ok(result.steps && result.steps.length >= 4, JSON.stringify(result.steps));
    assert.match(result.steps.join('\n'), /Verbindung zu 127/);
    assert.match(result.steps.join('\n'), /Der Hostkey stimmt/);
  } finally {
    await harness.stop();
  }
});

test('a failed connection test says how far it got', async () => {
  const harness = await setup();
  const wrong = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: 'orders',
      host: '127.0.0.1',
      port: 1,
      allowUnknownHostKey: true,
      timeoutSeconds: 2,
    },
    { username: USERNAME, password: 'wrong' }
  );

  try {
    const result = await wrong.testConnection();

    assert.equal(result.ok, false);
    // The last line before the failure is what says where it stopped: at the
    // socket, at the host key, or at the password.
    assert.match(result.steps?.join('\n') ?? '', /Verbindung zu 127\.0\.0\.1:1/);
    assert.match(result.steps?.at(-1) ?? '', /^Fehlgeschlagen: /);
  } finally {
    await wrong.dispose?.();
    await harness.stop();
  }
});

test('no secret ever reaches the protocol', async () => {
  const harness = await setup();

  try {
    await harness.service.execute(harness.job, harness.adapter);
    const text = transcript(harness.entries) + JSON.stringify(harness.entries.map((entry) => entry.context));

    assert.equal(text.includes(PASSWORD), false, 'a password in the log is a password in a support ticket');
    assert.equal(text.includes('protocol-test-key'), false, 'and so is an encryption key');
  } finally {
    await harness.stop();
  }
});
