import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import type { LogEntry } from '../../domain/logging/LogEntry.js';
import { GESCHWAERZT, MAX_FUNDE_AUSLEITUNG } from '../../domain/privacy/DataStore.js';
import { dateiBestand } from '../../infrastructure/privacy/DateiBestand.js';
import {
  angekuendigterBestand,
  laufprotokollBestand,
  uebertrageneDateienBestand,
} from '../../infrastructure/privacy/SqliteBestaende.js';
import { openDatabase } from '../../infrastructure/persistence/sqlite/SqliteDatabase.js';
import { SqliteTenantRepository } from '../../infrastructure/persistence/sqlite/SqliteTenantRepository.js';
import { PrivacyService } from './PrivacyService.js';

async function aufbau() {
  const verzeichnis = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-privacy-')), 'daten');
  const database = openDatabase(verzeichnis);
  const wurzel = path.join(verzeichnis, 'mandant');

  await fs.mkdir(path.join(wurzel, 'eingang'), { recursive: true });

  const tenants = new SqliteTenantRepository(database);
  const jetzt = new Date('2026-08-19T08:00:00.000Z');

  await tenants.save({
    id: 'default',
    name: 'Standard',
    rootDirectory: wurzel,
    enabled: true,
    createdAt: jetzt,
    updatedAt: jetzt,
  });

  database
    .prepare('INSERT INTO transfer_logs (timestamp, level, job_id, run_id, filename, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(jetzt.toISOString(), 'INFO', 'job-1', 'RUN-1', 'bestellung-mustermann.csv', 'bestellung-mustermann.csv übertragen');
  database
    .prepare('INSERT INTO transfer_logs (timestamp, level, job_id, run_id, filename, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(jetzt.toISOString(), 'INFO', 'job-1', 'RUN-1', 'andere.csv', '3 Dateien geprüft');
  database
    .prepare(
      `INSERT INTO transfer_files (id, transfer_run_id, job_id, source_path, source_filename, status, started_at, document)
       VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, '{}')`
    )
    .run('f1', 'RUN-1', 'job-1', `${wurzel}/eingang/bestellung-mustermann.csv`, 'bestellung-mustermann.csv', jetzt.toISOString());

  await fs.writeFile(
    path.join(wurzel, 'eingang', 'lieferung.csv'),
    ['Nr;Name;Ort', '1;Mustermann;Köln', '2;Berger;Bonn'].join('\n'),
    'utf-8'
  );

  const geschrieben: LogEntry[] = [];
  const dienst = new PrivacyService(
    [
      laufprotokollBestand(database),
      uebertrageneDateienBestand(database),
      dateiBestand(tenants),
      angekuendigterBestand('konflikte', 'Konfliktbestand', 'Feldwerte im Klartext', 'gibt es noch nicht'),
    ],
    { log: (eintrag) => geschrieben.push(eintrag) }
  );

  return { dienst, database, geschrieben, wurzel };
}

test('die Auskunft findet den Menschen in allen Beständen', async () => {
  const { dienst, database } = await aufbau();
  const auskunft = await dienst.search('Mustermann');

  const nach = (key: string) => auskunft.bestaende.find((bestand) => bestand.key === key);

  assert.equal(nach('laufprotokoll')?.treffer, 1, 'eine Protokollzeile');
  assert.equal(nach('dateien')?.treffer, 1, 'eine übertragene Datei');
  assert.equal(nach('dateien-mandant')?.treffer, 1, 'eine Zeile in der Lieferung');
  assert.ok(auskunft.treffer >= 3);

  database.close();
});

test('die Auskunft nennt, wo Unikom nichts anfassen wird', async () => {
  const { dienst, database } = await aufbau();
  const auskunft = await dienst.search('Mustermann');

  assert.deepEqual(auskunft.nurAnzeige, ['Dateien in den Mandantenverzeichnissen']);
  assert.match(
    auskunft.bestaende.find((bestand) => bestand.key === 'dateien-mandant')?.hinweis ?? '',
    /entscheidet der Mandant/
  );

  database.close();
});

test('ein Bestand, den es noch nicht gibt, fehlt nicht, sondern sagt es', async () => {
  // Eine Auskunft, die einen Bestand verschweigt, weil er noch leer ist,
  // gewöhnt den Leser daran, dass die Liste unvollständig sein darf.
  const { dienst, database } = await aufbau();
  const konflikte = (await dienst.search('Mustermann')).bestaende.find((bestand) => bestand.key === 'konflikte');

  assert.ok(konflikte);
  assert.equal(konflikte.treffer, 0);
  assert.match(konflikte.hinweis ?? '', /gibt es noch nicht/);

  database.close();
});

test('ein zu kurzer Begriff wird abgewiesen', async () => {
  const { dienst, database } = await aufbau();

  await assert.rejects(() => dienst.search('Mu'), /zu kurz/);

  database.close();
});

test('der Löschauftrag schwärzt das Protokoll, statt es zu löschen', async () => {
  // Dass ein Lauf stattgefunden hat, ist die Tatsache, die bleiben muss.
  // Der Name in der Zeile ist es nicht.
  const { dienst, database } = await aufbau();

  await dienst.erase('Mustermann', undefined, { id: 'u-1', name: 'anna' });

  const zeilen = database.prepare('SELECT message, filename FROM transfer_logs ORDER BY id').all() as unknown as {
    message: string;
    filename: string | null;
  }[];

  assert.equal(zeilen.length, 2, 'keine Zeile ist verschwunden');
  assert.equal(zeilen[0].message, `bestellung-${GESCHWAERZT}.csv übertragen`);
  assert.equal(zeilen[0].filename, `bestellung-${GESCHWAERZT}.csv`);
  assert.equal(zeilen[1].message, '3 Dateien geprüft', 'unbeteiligte Zeilen bleiben unberührt');

  database.close();
});

test('was Unikom nicht anfassen darf, bleibt und steht im Bericht', async () => {
  const { dienst, database, wurzel } = await aufbau();
  const bericht = await dienst.erase('Mustermann', undefined, { id: 'u-1', name: 'anna' });

  const datei = await fs.readFile(path.join(wurzel, 'eingang', 'lieferung.csv'), 'utf-8');

  assert.match(datei, /Mustermann/, 'die Ergebnisdatei wird nicht umgeschrieben');
  assert.equal(bericht.offen.length, 1);
  assert.equal(bericht.offen[0].key, 'dateien-mandant');

  database.close();
});

test('der Löschauftrag steht im Protokoll — ohne den gelöschten Wert', async () => {
  const { dienst, database, geschrieben } = await aufbau();

  await dienst.erase('Mustermann', undefined, { id: 'u-1', name: 'anna' });

  assert.equal(geschrieben.length, 1);
  assert.equal(geschrieben[0].username, 'anna');
  assert.match(geschrieben[0].message, /Löschauftrag ausgeführt/);
  // Ein Löschprotokoll, das den Wert wiederholt, ist keines.
  assert.doesNotMatch(geschrieben[0].message, /Mustermann/);

  database.close();
});

test('zweimal löschen ändert beim zweiten Mal nichts mehr', async () => {
  const { dienst, database } = await aufbau();

  await dienst.erase('Mustermann', undefined);
  const zweiter = await dienst.erase('Mustermann', undefined);

  assert.equal(
    zweiter.entfernt.reduce((summe, eintrag) => summe + eintrag.stellen, 0),
    0
  );

  database.close();
});

test('Groß- und Kleinschreibung und Umlaute treffen dasselbe', async () => {
  // Der Fehler, den diese Prüfung gefunden hat: Die Suche fand „mustermann",
  // das Schwärzen ließ es stehen — gefunden und trotzdem nicht gelöscht.
  const { dienst, database } = await aufbau();

  const jetzt = new Date('2026-08-19T09:00:00.000Z').toISOString();
  database
    .prepare('INSERT INTO transfer_logs (timestamp, level, message) VALUES (?, ?, ?)')
    .run(jetzt, 'INFO', 'Lieferung von Müller GmbH angekommen');

  const gefunden = await dienst.search('müller');
  assert.equal(gefunden.bestaende.find((bestand) => bestand.key === 'laufprotokoll')?.treffer, 1);

  await dienst.erase('müller', undefined);

  const zeile = database
    .prepare("SELECT message FROM transfer_logs WHERE message LIKE '%GmbH%'")
    .get() as unknown as { message: string };

  assert.equal(zeile.message, `Lieferung von ${GESCHWAERZT} GmbH angekommen`);

  database.close();
});

/**
 * Zwei Mandanten, zwei Workflows, derselbe Name in beiden Protokollen.
 *
 * Das ist der Fall, an dem sich entscheidet, ob die Eingrenzung auf einen
 * Mandanten etwas taugt oder nur so aussieht.
 */
async function zweiMandanten() {
  const verzeichnis = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-privacy-')), 'daten');
  const database = openDatabase(verzeichnis);
  const jetzt = new Date('2026-08-19T08:00:00.000Z').toISOString();

  for (const [job, text] of [
    ['job-a', 'Lieferung Mustermann für Mandant A'],
    ['job-b', 'Lieferung Mustermann für Mandant B'],
  ]) {
    database
      .prepare('INSERT INTO transfer_logs (timestamp, level, job_id, message) VALUES (?, ?, ?, ?)')
      .run(jetzt, 'INFO', job, text);
  }

  const jobsOfTenant = async (tenantId: string) => (tenantId === 'a' ? ['job-a'] : ['job-b']);
  const zeilen = () =>
    (database.prepare('SELECT message FROM transfer_logs ORDER BY id').all() as unknown as { message: string }[]).map(
      (zeile) => zeile.message
    );

  return { database, jobsOfTenant, zeilen };
}

test('ein Löschauftrag für einen Mandanten lässt die Zeilen der anderen stehen', async () => {
  const { database, jobsOfTenant, zeilen } = await zweiMandanten();
  const dienst = new PrivacyService([laufprotokollBestand(database, jobsOfTenant)], { log: () => {} });

  await dienst.erase('Mustermann', 'a');

  assert.deepEqual(zeilen(), [
    `Lieferung ${GESCHWAERZT} für Mandant A`,
    'Lieferung Mustermann für Mandant B',
  ]);

  database.close();
});

test('ein Bestand ohne Mandantenbezug wird bei Eingrenzung vorgelegt statt gelöscht', async () => {
  // Wer „nur Mandant A" aufträgt und dabei die Zeilen von B mitschwärzt, hat
  // mehr getan als beauftragt — und niemand erfährt davon.
  const { database, zeilen } = await zweiMandanten();
  const dienst = new PrivacyService([laufprotokollBestand(database)], { log: () => {} });

  const bericht = await dienst.erase('Mustermann', 'a');

  assert.deepEqual(zeilen(), ['Lieferung Mustermann für Mandant A', 'Lieferung Mustermann für Mandant B']);
  assert.equal(bericht.entfernt.length, 0, 'nichts wurde ausgeführt');
  assert.equal(bericht.offen.length, 1);
  assert.match(bericht.offen[0].hinweis ?? '', /nicht auf einen Mandanten eingrenzen/);

  database.close();
});

test('ohne Eingrenzung greift derselbe Bestand wieder', async () => {
  const { database, zeilen } = await zweiMandanten();
  const dienst = new PrivacyService([laufprotokollBestand(database)], { log: () => {} });

  await dienst.erase('Mustermann', undefined);

  assert.deepEqual(zeilen(), [`Lieferung ${GESCHWAERZT} für Mandant A`, `Lieferung ${GESCHWAERZT} für Mandant B`]);

  database.close();
});

test('die Ausleitung bekommt jede Fundstelle, der Bildschirm die ersten fünfzig', async () => {
  // Eine Auskunft, die stillschweigend bei fünfzig aufhört, hält der Empfänger
  // für vollständig.
  const { dienst, database } = await aufbau();
  const jetzt = new Date('2026-08-19T09:00:00.000Z').toISOString();

  for (let nummer = 0; nummer < 60; nummer += 1) {
    database
      .prepare('INSERT INTO transfer_logs (timestamp, level, message) VALUES (?, ?, ?)')
      .run(jetzt, 'INFO', `Vorgang ${nummer} für Schmitt-Karbowski`);
  }

  const protokoll = (auskunft: Awaited<ReturnType<typeof dienst.search>>) =>
    auskunft.bestaende.find((bestand) => bestand.key === 'laufprotokoll');

  const bildschirm = protokoll(await dienst.search('Schmitt-Karbowski'));
  const ausleitung = protokoll(await dienst.search('Schmitt-Karbowski', undefined, MAX_FUNDE_AUSLEITUNG));

  assert.equal(bildschirm?.treffer, 60, 'gezählt wird alles');
  assert.equal(bildschirm?.funde.length, 50, 'gezeigt werden fünfzig');
  assert.equal(ausleitung?.treffer, 60);
  assert.equal(ausleitung?.funde.length, 60, 'ausgeleitet wird alles');

  database.close();
});

test('eine Datei mit vielen Treffern wird vollständig gezählt', async () => {
  // Vorher wurden fünf Zeilen zurückgegeben und dieselben fünf gezählt: Die
  // Auskunft nannte eine zu niedrige Zahl, ohne es zu sagen.
  const { dienst, wurzel, database } = await aufbau();

  await fs.writeFile(
    path.join(wurzel, 'eingang', 'viele.csv'),
    Array.from({ length: 12 }, (_, nummer) => `${nummer};Kowalczyk;Bonn`).join('\n'),
    'utf-8'
  );

  const gefunden = (await dienst.search('Kowalczyk')).bestaende.find((bestand) => bestand.key === 'dateien-mandant');

  assert.equal(gefunden?.treffer, 12);

  database.close();
});

test('ein Begriff mit Sonderzeichen wird nicht als Muster gelesen', async () => {
  // „a.c" darf nicht „abc" treffen: Wer im Löschauftrag einen Punkt eintippt,
  // meint einen Punkt.
  const { dienst, database } = await aufbau();

  const jetzt = new Date('2026-08-19T09:00:00.000Z').toISOString();
  database.prepare('INSERT INTO transfer_logs (timestamp, level, message) VALUES (?, ?, ?)').run(jetzt, 'INFO', 'abc');
  database
    .prepare('INSERT INTO transfer_logs (timestamp, level, message) VALUES (?, ?, ?)')
    .run(jetzt, 'INFO', 'a.c');

  const gefunden = await dienst.search('a.c');

  assert.equal(gefunden.bestaende.find((bestand) => bestand.key === 'laufprotokoll')?.treffer, 1);

  database.close();
});
