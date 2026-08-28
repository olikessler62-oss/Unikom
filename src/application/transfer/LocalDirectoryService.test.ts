import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LocalDirectoryService } from './LocalDirectoryService.js';
import { InMemoryTenantRepository } from '../../infrastructure/persistence/InMemoryTenantRepository.js';
import type { Tenant } from '../../domain/tenants/Tenant.js';

/** Ein Mandant mit eigenem Verzeichnis; die Zeitstempel spielen hier keine Rolle. */
function mandant(rootDirectory: string): Tenant {
  return {
    id: 'kunde-a',
    name: 'Kunde A',
    rootDirectory,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/**
 * Ein Verzeichnis auf dem Rechner aussuchen, auf dem Unikom läuft.
 *
 * Der Browser ist serverseitig, und das ist keine Notlösung: Ein Dateidialog
 * im Browser nennt den Pfad des Rechners, an dem jemand sitzt — bei einer
 * Weboberfläche nicht derselbe wie der, auf dem geschrieben wird.
 */

async function bühne(): Promise<{ wurzel: string; kunde: string; dienst: LocalDirectoryService }> {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-blaettern-'));
  const kunde = path.join(wurzel, 'kunde-a');

  await fs.mkdir(path.join(kunde, 'eingang'), { recursive: true });
  await fs.mkdir(path.join(kunde, 'archiv'), { recursive: true });
  await fs.writeFile(path.join(kunde, 'liste.csv'), 'a;b\n');
  await fs.mkdir(path.join(wurzel, 'kunde-b'), { recursive: true });

  return { wurzel, kunde, dienst: new LocalDirectoryService(new InMemoryTenantRepository()) };
}

test('ein Verzeichnis nennt seine Unterverzeichnisse und zählt die Dateien', async () => {
  const b = await bühne();

  const antwort = await b.dienst.browse({ directory: b.kunde });

  assert.equal(antwort.ok, true, antwort.message);
  assert.deepEqual(
    antwort.entries.map((eintrag) => eintrag.name),
    ['archiv', 'eingang']
  );
  // Die Dateien sind kein Ziel der Auswahl, aber ihre Zahl sagt, ob man
  // richtig ist: Ein Eingangsverzeichnis ohne eine einzige Datei ist ein
  // Hinweis, kein Beweis — aber ein hilfreicher.
  assert.equal(antwort.filesFound, 1);
});

test('der Pfad steht so darin, wie er ins Feld gehört', async () => {
  // Anders als beim entfernten Browser gibt es hier kein Arbeitsverzeichnis,
  // vor dem etwas abzuschneiden wäre — der Pfad ist der Pfad.
  const b = await bühne();

  const antwort = await b.dienst.browse({ directory: b.kunde });

  assert.equal(antwort.relativePath, path.resolve(b.kunde));
  assert.equal(antwort.entries[0].relativePath, path.join(path.resolve(b.kunde), 'archiv'));
});

test('ein Verzeichnis, das es nicht gibt, wird gemeldet statt geworfen', async () => {
  // Jemand tippt, und die Oberfläche muss antworten können — ein Absturz wäre
  // hier eine Fehlermeldung ohne Text.
  const b = await bühne();

  const antwort = await b.dienst.browse({ directory: path.join(b.wurzel, 'gibt-es-nicht') });

  assert.equal(antwort.ok, false);
  assert.match(antwort.message, /gibt es nicht/);
  assert.deepEqual(antwort.entries, []);
});

test('die Grenze des Mandanten gilt auch beim Blättern', async () => {
  /*
   * Wer sie beim Speichern nicht überschreiten darf, soll dahinter auch nicht
   * erst stöbern. Sonst zeigte das Fenster die Verzeichnisse fremder Kunden,
   * und die Ablehnung käme erst beim Speichern — nachdem man gesehen hat, was
   * man nicht sehen sollte.
   */
  const b = await bühne();
  const mandanten = new InMemoryTenantRepository();
  await mandanten.save(mandant(b.kunde));
  const dienst = new LocalDirectoryService(mandanten);

  const draußen = await dienst.browse({ tenantId: 'kunde-a', directory: path.join(b.wurzel, 'kunde-b') });
  assert.equal(draußen.ok, false);
  assert.match(draußen.message, /außerhalb des Verzeichnisses/);

  const drinnen = await dienst.browse({ tenantId: 'kunde-a', directory: path.join(b.kunde, 'eingang') });
  assert.equal(drinnen.ok, true, drinnen.message);
});

test('ohne Eingabe beginnt der Mandant in seinem eigenen Verzeichnis', async () => {
  const b = await bühne();
  const mandanten = new InMemoryTenantRepository();
  await mandanten.save(mandant(b.kunde));

  const antwort = await new LocalDirectoryService(mandanten).browse({ tenantId: 'kunde-a', directory: '' });

  assert.equal(antwort.path, path.resolve(b.kunde));
  // Und eine Ebene höher führt nicht hinaus: Dort steht die eigene Wurzel.
  assert.equal(antwort.parentPath, path.resolve(b.kunde));
});

test('schon benutzte Orte werden angeboten, verschwundene nicht', async () => {
  // Ein Ort aus einem alten Workflow kann längst weg sein. Ihn anzubieten und
  // dann an einer Fehlermeldung enden zu lassen wäre schlechter, als ihn
  // wegzulassen.
  const b = await bühne();

  const antwort = await b.dienst.browse({
    directory: b.kunde,
    known: [
      path.join(b.kunde, 'eingang'),
      path.join(b.wurzel, 'gibt-es-nicht'),
      // Zweimal derselbe Ort, verschieden geschrieben — er gehört einmal hin.
      path.join(b.kunde, 'eingang') + path.sep,
      '   ',
    ],
  });

  assert.deepEqual(
    antwort.known?.map((eintrag) => eintrag.path),
    [path.join(path.resolve(b.kunde), 'eingang')]
  );
});

test('schon benutzte Orte eines anderen Mandanten werden nicht angeboten', async () => {
  const b = await bühne();
  const mandanten = new InMemoryTenantRepository();
  await mandanten.save(mandant(b.kunde));

  const antwort = await new LocalDirectoryService(mandanten).browse({
    tenantId: 'kunde-a',
    directory: b.kunde,
    known: [path.join(b.kunde, 'archiv'), path.join(b.wurzel, 'kunde-b')],
  });

  assert.deepEqual(
    antwort.known?.map((eintrag) => eintrag.path),
    [path.join(path.resolve(b.kunde), 'archiv')]
  );
});

/* ---------- Die Schreibprobe ---------- */

test('ein beschreibbares Verzeichnis wird als beschreibbar gemeldet', async () => {
  /*
   * Geprüft wird durch Schreiben und sofortiges Löschen — ein Rechteflag
   * beantwortet die Frage nicht. Und was geschrieben wurde, muss danach fort
   * sein: Ein Abholverzeichnis, in dem nach jeder Prüfung eine Probe liegt,
   * wäre am Ende voller Dateien, die niemand einordnen kann.
   */
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-probe-'));
  const dienst = new LocalDirectoryService();

  const antwort = await dienst.pruefeSchreibzugriff({ directory: wurzel });

  assert.equal(antwort.ok, true);
  assert.equal(antwort.writable, true);
  assert.deepEqual(await fs.readdir(wurzel), [], 'die Probe ist wieder fort');
});

test('ein Verzeichnis, das es nicht gibt, wird nicht angelegt', async () => {
  /*
   * Der Lauf legt diese drei Verzeichnisse nicht an, er verschiebt nur. Ein
   * fehlendes ist deshalb ein Mangel und keine Kleinigkeit — und die Prüfung
   * ist nicht der Ort, an dem stillschweigend etwas entsteht.
   */
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-probe-'));
  const fehlt = path.join(wurzel, 'gibt-es-nicht');
  const dienst = new LocalDirectoryService();

  const antwort = await dienst.pruefeSchreibzugriff({ directory: fehlt });

  assert.equal(antwort.ok, false);
  assert.equal(antwort.exists, false);
  assert.equal(await fs.readdir(wurzel).then((e) => e.length), 0, 'nichts angelegt');
});

test('ohne Eingabe gibt es nichts zu prüfen', async () => {
  const antwort = await new LocalDirectoryService().pruefeSchreibzugriff({ directory: '   ' });

  assert.equal(antwort.ok, false);
  assert.match(antwort.message, /kein Verzeichnis eingetragen/);
});

test('die Grenze des Mandanten gilt auch für die Schreibprobe', async () => {
  /*
   * Wer dort nicht speichern darf, soll dort auch nicht schreiben — und sei es
   * nur eine Probe von null Bytes. Sonst legte diese Prüfung Dateien in
   * Verzeichnissen an, die dem Mandanten gar nicht gehören.
   */
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-probe-'));
  const meins = path.join(wurzel, 'kunde-a');
  const fremd = path.join(wurzel, 'kunde-b');

  await fs.mkdir(meins, { recursive: true });
  await fs.mkdir(fremd, { recursive: true });

  const tenants = new InMemoryTenantRepository();
  await tenants.save(mandant(meins));

  const dienst = new LocalDirectoryService(tenants);
  const antwort = await dienst.pruefeSchreibzugriff({ tenantId: 'kunde-a', directory: fremd });

  assert.equal(antwort.ok, false);
  assert.deepEqual(await fs.readdir(fremd), [], 'im fremden Verzeichnis wurde nichts angelegt');
});

/* ---------- Den Anfang einer Beispieldatei ansehen ---------- */

const UMBRUCH = String.fromCharCode(10);

/** Ein Mandant mit eigenem Verzeichnis, in dem Dateien liegen dürfen. */
async function probenbühne(): Promise<{ kunde: string; fremd: string; dienst: LocalDirectoryService }> {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-lesen-'));
  const kunde = path.join(wurzel, 'kunde-a');
  const fremd = path.join(wurzel, 'kunde-b');

  await fs.mkdir(kunde, { recursive: true });
  await fs.mkdir(fremd, { recursive: true });

  const mandanten = new InMemoryTenantRepository();
  await mandanten.save(mandant(kunde));

  return { kunde, fremd, dienst: new LocalDirectoryService(mandanten) };
}

test('eine kleine Datei kommt ganz zurück', async () => {
  const b = await probenbühne();
  const datei = path.join(b.kunde, 'bestellungen.csv');
  const inhalt = ['kdnr;name;ort', '4711;Meier;Bonn'].join(UMBRUCH);

  await fs.writeFile(datei, inhalt);

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, true, probe.message);
  assert.equal(probe.text, inhalt);
  assert.equal(probe.name, 'bestellungen.csv');
  assert.equal(probe.gekuerzt, false);
  assert.equal(probe.kodierung, 'utf-8');
});

test('von einer großen Datei kommt nur der Anfang — und zwar bis zu einer ganzen Zeile', async () => {
  const b = await probenbühne();
  const datei = path.join(b.kunde, 'lieferung.csv');
  const zeile = `4711;Meier;Bonn;${'x'.repeat(60)}${UMBRUCH}`;

  await fs.writeFile(datei, zeile.repeat(3000));

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, true, probe.message);
  assert.equal(probe.gekuerzt, true);
  assert.ok((probe.gelesen ?? 0) <= 65536, `${probe.gelesen} Bytes sind mehr als die Probe`);
  assert.ok(probe.text?.endsWith(UMBRUCH), 'die Probe endet mitten in einer Zeile');
});

test('gelesen wird wirklich nur der Anfang und nicht die ganze Datei', async () => {
  /*
   * Der Beweis, nicht die Behauptung: Hinter der Probe steht ein Nullbyte.
   * Wer die Datei ganz einliest, findet es und weist sie als „kein Text" ab.
   * Wer nur den Anfang ansieht, sieht es nie.
   *
   * Damit hängt mehr als eine Meldung: Eine Lieferung von zweihundert Megabyte
   * ginge sonst vollständig in den Speicher des Servers, für eine Frage, die
   * nach hundert Zeilen beantwortet ist.
   */
  const b = await probenbühne();
  const datei = path.join(b.kunde, 'lang.csv');
  const kopf = Buffer.from(`kdnr;name${UMBRUCH}`.repeat(8000));

  await fs.writeFile(datei, Buffer.concat([kopf, Buffer.from([0x00, 0x00])]));

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, true, probe.message);
});

test('die Grenze des Mandanten gilt auch beim Lesen', async () => {
  /*
   * Ein Pfad aus dem Browser ist eine Behauptung. Ohne diese Prüfung wäre das
   * Feld ein Leseknopf für jede Datei, die das Konto erreicht, unter dem Unikom
   * läuft — die Lieferung des nächsten Kunden eingeschlossen.
   */
  const b = await probenbühne();
  const datei = path.join(b.fremd, 'geheim.csv');

  await fs.writeFile(datei, `a;b${UMBRUCH}`);

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /außerhalb des Verzeichnisses/);
  assert.equal(probe.text, undefined, 'trotz Ablehnung kam Inhalt zurück');
});

test('eine Excel-Mappe wird beim Namen genannt', async () => {
  // „Das ist keine Textdatei" ist richtig und hilft niemandem weiter. Wer eine
  // Mappe ausgesucht hat, soll erfahren, was stattdessen geht.
  const b = await probenbühne();
  const datei = path.join(b.kunde, 'umsatz.xlsx');

  await fs.writeFile(datei, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]));

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /Excel/);
  assert.match(probe.message, /CSV/);
});

test('ein Verzeichnis ist keine Beispieldatei', async () => {
  const b = await probenbühne();

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei: b.kunde });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /Verzeichnis und keine Datei/);
});

test('eine leere Datei sagt, dass sie leer ist', async () => {
  // Sonst käme eine gelungene Probe ohne Text zurück, und die Erkennung sagte
  // danach „kein Datenblock gefunden" — richtig, aber am falschen Ende.
  const b = await probenbühne();
  const datei = path.join(b.kunde, 'nichts.csv');

  await fs.writeFile(datei, '');

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /leer/);
});

test('eine Datei, die es nicht gibt, sagt genau das', async () => {
  const b = await probenbühne();

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei: path.join(b.kunde, 'fort.csv') });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /gibt es nicht/);
});

test('ohne Angabe wird nichts gelesen', async () => {
  const b = await probenbühne();

  const probe = await b.dienst.leseProbe({ tenantId: 'kunde-a', datei: '   ' });

  assert.equal(probe.ok, false);
  assert.match(probe.message, /keine Datei ausgewählt/);
});
