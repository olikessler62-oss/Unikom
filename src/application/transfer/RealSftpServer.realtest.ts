import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Client from 'ssh2-sftp-client';

import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { loadTestServerConfig } from '../../testing/TestServerConfig.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { DEFAULT_TENANT_ID } from '../../domain/tenants/Tenant.js';
import type { SourceConfig } from '../../domain/transfer/TransferJob.js';

/**
 * Gegen einen echten Hoster, nicht gegen den eigenen Testserver.
 *
 * Der eigene Server ist von uns geschrieben und stimmt deshalb unseren
 * Annahmen zu. Ein Hoster tut das nicht: Er setzt das Konto in ein chroot, er
 * meldet eigene Fehlercodes, er hat Rechte und Wartezeiten. Vor allem entsteht
 * dort die Lage, gegen die der RemotePathResolver gebaut ist — ein Anwender
 * gibt einen Pfad ein, und derselbe Text bezeichnet zwei Verzeichnisse, die
 * es beide gibt.
 *
 * Ohne `testserver.local.json` überspringen sich diese Tests. Ein Bauplatz
 * ohne Netz muss grün bleiben, und ein fehlender Zugang ist kein Mangel am
 * Erzeugnis.
 *
 * Die Endung `.realtest.ts` hält sie aus `npm test` heraus, und das mit Grund:
 * Gemessen hat ein Test, der allein 528 ms braucht, neben diesen hier seine
 * Zeitgrenze von 30 s gerissen — sie halten das Netz besetzt und verdrängen,
 * was daneben läuft. Eine Standardprüfung muss ohne Netz auskommen, schnell
 * sein und immer dasselbe sagen. Diese hier laufen mit `npm run test:real`.
 *
 * Absichtlich falsche Anmeldedaten werden hier nie geschickt: Gegen einen
 * echten Server ist das der schnellste Weg, die eigene Adresse zu sperren.
 * Diese Prüfung bleibt beim eigenen Testserver.
 */

const configured = loadTestServerConfig().sftp;
const skip = !configured
  ? 'kein echter SFTP-Prüfserver eingerichtet - siehe testserver.local.example.json'
  : !configured.password && !configured.privateKeyFile
    ? 'der Prüfserver hat weder Kennwort noch Schlüsseldatei hinterlegt'
    : false;

/** Nur aufgerufen, wenn `skip` falsch ist; erspart jedem Test ein `!`. */
function server() {
  return configured!;
}

const INHALT = Buffer.from('kunde;betrag\nA;42\n', 'utf8');

/**
 * Die Verbindung zum Aufbauen und Aufräumen — bewusst neben dem Adapter, der
 * hier geprüft wird. Ein Test, der seine Bühne mit demselben Werkzeug stellt,
 * das er prüft, bemerkt dessen Fehler nicht.
 */
async function client(): Promise<Client> {
  const sftp = new Client();
  await sftp.connect({
    host: server().host,
    port: server().port ?? 22,
    username: server().username,
    ...(server().password
      ? { password: server().password }
      : {
          privateKey: await fs.readFile(server().privateKeyFile!, 'utf8'),
          passphrase: server().passphrase,
        }),
    readyTimeout: 20_000,
  });
  return sftp;
}

/**
 * Ein eigener Ordner je Test, unterhalb des vereinbarten Testverzeichnisses.
 * Läufe dürfen sich nicht begegnen, und was liegen bleibt, muss zuzuordnen
 * sein.
 */
async function remoteWorkspace(sftp: Client): Promise<string> {
  const directory = `${server().directory}/lauf-${crypto.randomBytes(4).toString('hex')}`;
  await sftp.mkdir(directory, true);
  return directory;
}

function sourceConfig(directory: string, remoteWorkingDirectory?: string): SourceConfig {
  return {
    type: 'SFTP',
    directory,
    host: server().host,
    port: server().port ?? 22,
    hostKeyFingerprint: server().hostKeyFingerprint,
    allowUnknownHostKey: server().allowUnknownHostKey,
    timeoutSeconds: 30,
    remoteWorkingDirectory,
  };
}

interface Bühne {
  application: ReturnType<typeof createPersistentApplication>;
  credentialId: string;
  destinationDirectory: string;
  abbauen: () => Promise<void>;
}

async function bühne(): Promise<Bühne> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-echt-'));
  const application = createPersistentApplication(path.join(workspace, 'application-data'), {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
  });

  // Kennwort oder Schlüssel — die Konfiguration lässt beides zu, und ein
  // Hoster, der nur Schlüssel annimmt, ist keine Ausnahme.
  const credential = server().password
    ? await application.credentialService.create({
        name: 'Echter Prüfserver',
        type: 'USERNAME_PASSWORD',
        username: server().username,
        secret: server().password!,
      })
    : await application.credentialService.createSshKey({
        name: 'Echter Prüfserver',
        username: server().username,
        material: await fs.readFile(server().privateKeyFile!, 'utf8'),
        passphrase: server().passphrase,
      });

  return {
    application,
    credentialId: credential.id,
    destinationDirectory: path.join(workspace, 'ziel'),
    abbauen: async () => {
      application.close();
      await fs.rm(workspace, { recursive: true, force: true });
    },
  };
}

test('eine Datei wird vom echten Server übernommen', { skip, timeout: 90_000 }, async () => {
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();

  try {
    await sftp.put(INHALT, `${remote}/ORDER_001.csv`);

    await szene.application.jobRepository.save(
      createTransferJob({
        id: 'echt',
        sourceType: 'SFTP',
        sourceConfig: sourceConfig(remote),
        sourceDirectory: remote,
        credentialId: szene.credentialId,
        destinationDirectory: szene.destinationDirectory,
        minimumFileAgeSeconds: 0,
      })
    );

    const run = await szene.application.runtime.orchestrator.runJobNow('echt', new Date());

    assert.equal(run?.status, TransferRunStatus.SUCCESS);
    assert.equal(run?.filesSucceeded, 1);

    const angekommen = await fs.readFile(path.join(szene.destinationDirectory, 'ORDER_001.csv'));
    assert.equal(angekommen.equals(INHALT), true);
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});

test('die Quelldatei wird auf dem Server archiviert, nicht kopiert', { skip, timeout: 90_000 }, async () => {
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();
  const archiv = `${remote}/archiv`;

  try {
    await sftp.mkdir(archiv, true);
    await sftp.put(INHALT, `${remote}/ORDER_001.csv`);

    await szene.application.jobRepository.save(
      createTransferJob({
        id: 'echt',
        sourceType: 'SFTP',
        sourceConfig: sourceConfig(remote),
        sourceDirectory: remote,
        credentialId: szene.credentialId,
        destinationDirectory: szene.destinationDirectory,
        minimumFileAgeSeconds: 0,
        sourceSuccessAction: 'MOVE',
        sourceArchiveDirectory: archiv,
      })
    );

    const run = await szene.application.runtime.orchestrator.runJobNow('echt', new Date());
    assert.equal(run?.filesSucceeded, 1);

    // Verschoben heißt: dort ja, hier nicht mehr. Eine Kopie ließe den
    // nächsten Lauf dieselbe Datei erneut holen.
    assert.equal(await sftp.exists(`${archiv}/ORDER_001.csv`), '-');
    assert.equal(await sftp.exists(`${remote}/ORDER_001.csv`), false);
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});

test('die Quelldatei wird auf dem Server gelöscht, wenn das eingestellt ist', { skip, timeout: 90_000 }, async () => {
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();

  try {
    await sftp.put(INHALT, `${remote}/ORDER_001.csv`);

    await szene.application.jobRepository.save(
      createTransferJob({
        id: 'echt',
        sourceType: 'SFTP',
        sourceConfig: sourceConfig(remote),
        sourceDirectory: remote,
        credentialId: szene.credentialId,
        destinationDirectory: szene.destinationDirectory,
        minimumFileAgeSeconds: 0,
        sourceSuccessAction: 'DELETE',
      })
    );

    const run = await szene.application.runtime.orchestrator.runJobNow('echt', new Date());

    assert.equal(run?.filesSucceeded, 1);
    assert.equal(await sftp.exists(`${remote}/ORDER_001.csv`), false);
    // Erst das Ziel, dann die Quelle: Gelöscht wird nur, was angekommen ist.
    assert.equal((await fs.readFile(path.join(szene.destinationDirectory, 'ORDER_001.csv'))).equals(INHALT), true);
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});

test('jede Schreibweise desselben Verzeichnisses führt an denselben Ort', { skip, timeout: 180_000 }, async () => {
  // Aus 600 Kundeninstallationen: Eingegeben wird alles. Mit führendem
  // Schrägstrich und ohne, mit Rückstrichen weil Windows, mit Schrägstrich am
  // Ende weil ein Verzeichnis so aussieht, doppelt weil zwei Pfade
  // zusammengefügt wurden.
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();
  const relativ = remote.replace(/^\//, '');

  try {
    await sftp.put(INHALT, `${remote}/ORDER_001.csv`);

    const schreibweisen = [
      remote,
      relativ,
      `${remote}/`,
      remote.replace(/\//g, '\\'),
      remote.replace(/\//g, '//'),
      `./${relativ}`,
    ];

    for (const eingabe of schreibweisen) {
      const antwort = await szene.application.remoteDirectories.browse({
        name: 'Prüfung',
        tenantId: DEFAULT_TENANT_ID,
        sourceType: 'SFTP',
        sourceConfig: sourceConfig(eingabe),
        credentialId: szene.credentialId,
        directory: eingabe,
      });

      assert.equal(antwort.ok, true, `„${eingabe}" wurde abgelehnt: ${antwort.message}`);
      assert.equal(antwort.path, remote, `„${eingabe}" führte woanders hin`);
      assert.equal(antwort.filesFound, 1, `„${eingabe}" fand nicht die eine Datei`);
    }
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});

test('ein doppeltes Verzeichnis wird gemeldet, nicht geraten', { skip, timeout: 120_000 }, async () => {
  // Der Fall, der die Pfadauflösung überhaupt nötig macht: Das Konto startet
  // in /…/lauf-x, und darin liegt noch einmal ein Baum gleichen Namens. Wer
  // jetzt den vollen Pfad einträgt, meint eines von zwei Verzeichnissen, und
  // beide gibt es. Geraten wird hier nicht.
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();

  // Der Name des Arbeitsverzeichnisses, ein zweites Mal darin.
  const segmente = remote.split('/').filter(Boolean);
  const doppelt = `${remote}/${segmente.join('/')}/bestellungen`;
  const echt = `${remote}/bestellungen`;

  try {
    await sftp.mkdir(echt, true);
    await sftp.mkdir(doppelt, true);
    await sftp.put(INHALT, `${echt}/ORDER_001.csv`);

    const anfrage = {
      name: 'Prüfung',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'SFTP' as const,
      sourceConfig: sourceConfig(echt, remote),
      credentialId: szene.credentialId,
      directory: echt,
    };

    const mehrdeutig = await szene.application.remoteDirectories.browse(anfrage);

    assert.equal(mehrdeutig.ok, false, 'beide Lesarten gibt es - das darf nicht durchgehen');
    assert.equal(mehrdeutig.ambiguous?.length, 2, JSON.stringify(mehrdeutig));
    assert.match(mehrdeutig.message, /passt auf 2 Verzeichnisse/);

    // Und die Gegenprobe: Ohne den doppelten Baum ist dieselbe Eingabe
    // eindeutig. Die Ablehnung kommt von der Lage, nicht von der Schreibweise.
    await sftp.rmdir(`${remote}/${segmente[0]}`, true);

    const eindeutig = await szene.application.remoteDirectories.browse(anfrage);

    assert.equal(eindeutig.ok, true, eindeutig.message);
    assert.equal(eindeutig.path, echt);
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});

test('ein Pfad aus dem Arbeitsverzeichnis heraus wird abgelehnt', { skip, timeout: 90_000 }, async () => {
  const sftp = await client();
  const remote = await remoteWorkspace(sftp);
  const szene = await bühne();

  try {
    const antwort = await szene.application.remoteDirectories.browse({
      name: 'Prüfung',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'SFTP',
      sourceConfig: sourceConfig('../../etc', remote),
      credentialId: szene.credentialId,
      directory: '../../etc',
    });

    assert.equal(antwort.ok, false);
    assert.match(antwort.message, /führt aus .* heraus/);
    // Ohne Verbindung abgelehnt: Der Server wird gar nicht erst gefragt.
    assert.equal(antwort.entries.length, 0);
  } finally {
    await sftp.rmdir(remote, true).catch(() => {});
    await sftp.end();
    await szene.abbauen();
  }
});
