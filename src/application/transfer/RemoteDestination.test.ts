import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { workFilePath } from '../../domain/destination/WorkFile.js';
import { SftpDestinationAdapter } from '../../infrastructure/destinations/sftp/SftpDestinationAdapter.js';

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false
  );
}

/**
 * Was ein entferntes Ziel anders macht als ein Verzeichnis.
 *
 * Die Matrix zeigt, dass eine Datei ankommt. Hier steht das, was erst auffällt,
 * wenn jemand am anderen Ende zusieht: dass unter einem Arbeitsnamen
 * hochgeladen wird, dass nichts davon liegen bleibt, und dass die Einstellungen
 * für einen belegten Namen über das Netz genauso gelten wie auf der Platte.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Ziel-Kennwort-2026';
const INHALT = Buffer.from('kunde;betrag\nA;42\n');

interface Bühne {
  application: ReturnType<typeof createPersistentApplication>;
  quelle: string;
  serverRoot: string;
  eingang: string;
  speichere: (overrides?: Partial<TransferJob>) => Promise<void>;
  abbauen: () => Promise<void>;
}

async function bühne(): Promise<Bühne> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ziel-'));
  const quelle = path.join(workspace, 'quelle');
  await fs.mkdir(quelle, { recursive: true });

  const serverRoot = await withSftpRoot({});
  const server = await SftpTestServer.start({ root: serverRoot, username: USERNAME, password: PASSWORD });

  const application = createPersistentApplication(path.join(workspace, 'application-data'), {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
  });

  const credential = await application.credentialService.create({
    name: 'Zielserver',
    type: 'USERNAME_PASSWORD',
    username: USERNAME,
    secret: PASSWORD,
  });

  return {
    application,
    quelle,
    serverRoot,
    eingang: path.join(serverRoot, 'eingang'),
    speichere: async (overrides = {}) => {
      await application.jobRepository.save(
        createTransferJob({
          id: 'fern',
          sourceDirectory: quelle,
          sourceConfig: { type: 'LOCAL', directory: quelle },
          destinationDirectory: '/eingang',
          destinationType: 'SFTP',
          destinationConfig: {
            type: 'SFTP',
            directory: '/eingang',
            host: '127.0.0.1',
            port: server.port,
            hostKeyFingerprint: server.hostKeyFingerprint,
            timeoutSeconds: 15,
          },
          destinationCredentialId: credential.id,
          createDestinationDirectory: true,
          minimumFileAgeSeconds: 0,
          ...overrides,
        })
      );
    },
    abbauen: async () => {
      application.close();
      await server.stop();
      await fs.rm(workspace, { recursive: true, force: true });
    },
  };
}

test('ein Ziel über SFTP übersteht das Speichern und Wiederlesen', async () => {
  const b = await bühne();

  try {
    await b.speichere();
    const gelesen = await b.application.jobRepository.getById('fern');

    // Ginge eines dieser Felder beim Speichern verloren, liefe der Workflow
    // beim nächsten Start still ins Dateisystem — an einen Ort, den niemand
    // eingestellt hat.
    assert.equal(gelesen?.destinationType, 'SFTP');
    assert.equal(gelesen?.destinationConfig?.host, '127.0.0.1');
    assert.equal(typeof gelesen?.destinationCredentialId, 'string');
  } finally {
    await b.abbauen();
  }
});

test('nach einem gelungenen Lauf bleibt kein Arbeitsname auf dem Server liegen', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere();

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());
    assert.equal(run?.status, TransferRunStatus.SUCCESS);

    const liegend = await fs.readdir(b.eingang);

    // Ein zurückgelassenes .unikom-part sieht für den Empfänger nach einer
    // abgebrochenen Lieferung aus und lässt ihn nachfragen.
    assert.deepEqual(liegend, ['ORDER_001.csv'], `unerwartet im Eingang: ${liegend.join(', ')}`);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
  } finally {
    await b.abbauen();
  }
});

test('eine Datei wird über das Netz übersprungen, wenn dort schon eine liegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'SKIP' });
    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.filesSkipped, 1);
    assert.equal(await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'), 'utf8'), 'die ältere Lieferung');
  } finally {
    await b.abbauen();
  }
});

test('eine Datei wird über das Netz ersetzt, wenn das eingestellt ist', async () => {
  // Der Fall, der bei SFTP wirklich anders ist: Ein Server lehnt das Umbenennen
  // auf einen belegten Namen ab, statt ihn zu ersetzen. Ohne das Aufräumen
  // davor bliebe die alte Datei stehen und der Lauf meldete trotzdem Erfolg.
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await fs.mkdir(b.eingang, { recursive: true });
    await fs.writeFile(path.join(b.eingang, 'ORDER_001.csv'), 'die ältere Lieferung');

    await b.speichere({ conflictStrategy: 'OVERWRITE' });
    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.filesSucceeded, 1);
    assert.equal((await fs.readFile(path.join(b.eingang, 'ORDER_001.csv'))).equals(INHALT), true);
    assert.deepEqual(await fs.readdir(b.eingang), ['ORDER_001.csv']);
  } finally {
    await b.abbauen();
  }
});

test('ein fehlendes Zielverzeichnis wird nicht heimlich angelegt', async () => {
  const b = await bühne();

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere({ createDestinationDirectory: false });

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());

    assert.equal(run?.status, TransferRunStatus.FAILED);
    // Und die Quelle ist unangetastet: Gescheitert heißt, dass nichts geschah.
    assert.deepEqual(await fs.readdir(b.quelle), ['ORDER_001.csv']);
  } finally {
    await b.abbauen();
  }
});

test('der Lauf hinterlässt jeden Schritt der Zielseite im Protokoll', async () => {
  /*
   * Ein Protokoll ist das Werkzeug der Ferndiagnose: Wer ein fremdes System
   * nicht betreten darf, hat nur, was der Lauf aufgeschrieben hat. Deshalb
   * wird jeder Schritt angekündigt und bestätigt — ein Lauf, der hängt, wird
   * an der letzten geschriebenen Zeile erkannt, und eine Zeile „verbinde" vor
   * dem Versuch ist mehr wert als eine Zeile „verbunden" danach.
   */
  const b = await bühne();
  const gesagt: string[] = [];

  try {
    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere({ logLevel: 'DEBUG' });

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());
    const zeilen = await b.application.logRepository.list({ runId: run!.id, limit: 10_000 });
    gesagt.push(...zeilen.map((zeile) => zeile.message));

    const erwartet: [string, RegExp][] = [
      ['Auflösen des Zielpfads', /Zielverzeichnis .* wird gelesen als \/eingang/],
      ['Verbinden zum Zielserver', /Verbindung zu 127\.0\.0\.1/],
      ['Hostkey gezeigt', /zeigt den Hostkey SHA256:/],
      ['Anmeldung gelungen', /Verbunden und angemeldet/],
      ['Beschreibbarkeit belegt', /ist vorhanden und beschreibbar/],
      ['Hochladen angekündigt', /Wird hochgeladen nach .*unikom-part/],
      ['Umbenennen angekündigt', /Wird umbenannt nach \/eingang\/ORDER_001\.csv/],
      ['Vollständigkeit bestätigt', /liegt vollständig/],
    ];

    for (const [was, muster] of erwartet) {
      assert.ok(
        gesagt.some((zeile) => muster.test(zeile)),
        `${was} steht nicht im Protokoll. Geschrieben wurde:\n${gesagt.join('\n')}`
      );
    }

    // Und niemals das Kennwort, egal wie ausführlich.
    assert.equal(
      gesagt.some((zeile) => zeile.includes(PASSWORD)),
      false,
      'das Kennwort steht im Protokoll'
    );
  } finally {
    await b.abbauen();
  }
});

test('zwei Läufe schreiben nie in dieselbe Arbeitsdatei', async () => {
  // Der Arbeitsname hing einmal allein am Zielpfad. Zwei Workflows, die eine
  // gleichnamige Datei in dasselbe Verzeichnis legen, hätten damit gleichzeitig
  // in dieselbe halbe Datei geschrieben — und der erste, der fertig wird,
  // hätte einen Mischmasch aus beiden in den echten Namen umbenannt. Lokal
  // gibt es das nicht, weil dort jeder Lauf seinen eigenen Bereich hat.
  const ziel = '/eingang/ORDER_001.csv';

  assert.notEqual(workFilePath(ziel, 'TR-a'), workFilePath(ziel, 'TR-b'));
  assert.match(workFilePath(ziel, 'TR-a'), /ORDER_001\.csv\.TR-a\.unikom-part$/);
});

test('eine alte Arbeitsdatei wird beim nächsten Lauf weggeräumt, eine frische nicht', async () => {
  const b = await bühne();

  try {
    await fs.mkdir(b.eingang, { recursive: true });

    const alt = path.join(b.eingang, 'ORDER_009.csv.TR-abgebrochen.unikom-part');
    const frisch = path.join(b.eingang, 'ORDER_008.csv.TR-laeuft.unikom-part');
    await fs.writeFile(alt, 'Rest eines abgebrochenen Laufs');
    await fs.writeFile(frisch, 'ein Lauf, der gerade hochlädt');

    // Zwei Tage zurückdatiert — der Kehraus geht nach der Änderungszeit.
    const vorgestern = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(alt, vorgestern, vorgestern);

    await fs.writeFile(path.join(b.quelle, 'ORDER_001.csv'), INHALT);
    await b.speichere();

    const run = await b.application.runtime.orchestrator.runJobNow('fern', new Date());
    assert.equal(run?.filesSucceeded, 1);

    assert.equal(await exists(alt), false, 'die alte Arbeitsdatei liegt noch da');
    // Die frische gehört womöglich einem Lauf, der gerade hochlädt. Sie ihm
    // unter den Händen wegzunehmen wäre schlimmer als der Rückstand.
    assert.equal(await exists(frisch), true, 'die frische Arbeitsdatei wurde weggeräumt');
  } finally {
    await b.abbauen();
  }
});

test('ein mitten im Hochladen abgebrochener Upload lässt keine Arbeitsdatei zurück', async () => {
  // Der Fall, auf den es ankommt: Der Empfänger nimmt die ersten Bytes an und
  // bricht dann ab — ein volles Kontingent sieht genau so aus. Die halb
  // geschriebene Datei liegt dann schon auf dem Server, und sie gehört weg,
  // solange die Verbindung dafür noch steht.
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-abbruch-'));
  const serverRoot = await withSftpRoot({});
  const server = await SftpTestServer.start({
    root: serverRoot,
    username: USERNAME,
    password: PASSWORD,
    failWritesAfterBytes: 4096,
  });

  const gross = path.join(workspace, 'gross.csv');
  await fs.writeFile(gross, Buffer.alloc(64 * 1024, 7));

  const ziel = new SftpDestinationAdapter(
    {
      type: 'SFTP',
      directory: '/eingang',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 15,
    },
    { username: USERNAME, password: PASSWORD }
  );

  try {
    await ziel.prepareDirectory('/eingang', true);
    await assert.rejects(() => ziel.place(gross, '/eingang/ORDER_001.csv', 'TR-x'));

    assert.deepEqual(await fs.readdir(path.join(serverRoot, 'eingang')), []);
  } finally {
    await ziel.dispose?.();
    await server.stop();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('der Verzeichnisbrowser des Ziels sieht auf den Zielserver', async () => {
  // Der Browser bildet die Zielangaben auf eine Quelle ab, weil Blättern Lesen
  // ist. Ginge dabei die Seite verloren, zeigte er den Quellserver — und
  // jemand übernähme einen Pfad, den es am Ziel gar nicht gibt.
  const b = await bühne();

  try {
    await fs.mkdir(path.join(b.serverRoot, 'eingang', 'kunde-a'), { recursive: true });
    await b.speichere();
    const workflow = (await b.application.jobRepository.getById('fern'))!;

    const antwort = await b.application.remoteDirectories.browse({
      name: workflow.name,
      tenantId: workflow.tenantId,
      sourceType: workflow.destinationType!,
      sourceConfig: workflow.destinationConfig!,
      credentialId: workflow.destinationCredentialId,
      directory: '/eingang',
    });

    assert.equal(antwort.ok, true, antwort.message);
    assert.deepEqual(
      antwort.entries.map((entry) => entry.name),
      ['kunde-a']
    );
  } finally {
    await b.abbauen();
  }
});

test('ein Name, der aus dem Zielverzeichnis führte, wird auch über das Netz abgelehnt', async () => {
  const b = await bühne();

  try {
    await b.speichere();
    const ziel = await b.application.destinationProvider.forJob(
      (await b.application.jobRepository.getById('fern'))!
    );

    assert.throws(() => ziel.resolve('/eingang', '../ORDER_001.csv'), /unsafe|Rejected/i);
    await ziel.dispose?.();
  } finally {
    await b.abbauen();
  }
});
