import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  PROTECTED_KEY_FILENAME,
  ProtectedMasterKeyError,
  WindowsProtectedMasterKeyProvider,
  windowsProtectionAvailable,
} from './WindowsProtectedMasterKeyProvider.js';
import { DEFAULT_MASTER_KEY_VARIABLE, MASTER_KEY_BYTES } from './MasterKeyProvider.js';
import { createPersistentApplication } from '../../application/runtime/UnikomApplication.js';

/**
 * Gegen den echten Datenschutz von Windows, nicht gegen ein Doppel.
 *
 * Ein Doppel würde hier nichts belegen: Die ganze Zusage hängt daran, dass
 * Windows den Block nur auf diesem Rechner wieder herausgibt, und das kann nur
 * Windows selbst beantworten. Anderswo überspringen sich diese Prüfungen.
 */

const skip = windowsProtectionAvailable() ? false : 'Der Datenschutz von Windows steht nur unter Windows offen';

async function verzeichnis(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'unikom-schluessel-'));
}

test('beim ersten Mal wird ein Schlüssel erzeugt und verwahrt', { skip, timeout: 60_000 }, async () => {
const ort = await verzeichnis();
const gesagt: string[] = [];
const provider = new WindowsProtectedMasterKeyProvider(ort, (message) => gesagt.push(message));

const key = provider.getMasterKey();

assert.equal(key.length, MASTER_KEY_BYTES);
assert.equal(fs.existsSync(path.join(ort, PROTECTED_KEY_FILENAME)), true);
assert.ok(gesagt.some((zeile) => /neu erzeugt/.test(zeile)), gesagt.join(' | '));
});

test('der verwahrte Schlüssel steht nicht lesbar in der Datei', { skip, timeout: 60_000 }, async () => {
const ort = await verzeichnis();
const key = new WindowsProtectedMasterKeyProvider(ort).getMasterKey();
const abgelegt = await fsp.readFile(path.join(ort, PROTECTED_KEY_FILENAME), 'utf8');

// Läge er im Klartext da, wäre die ganze Übung Zierde.
assert.equal(abgelegt.includes(key.toString('base64')), false, 'der Schlüssel steht im Klartext in der Datei');
});

test('ein zweiter Start bekommt denselben Schlüssel', { skip, timeout: 60_000 }, async () => {
// Das ist der Punkt, an dem alles hängt: Ein anderer Schlüssel hieße, dass
// jeder gespeicherte Zugang unlesbar wird.
const ort = await verzeichnis();

const erster = new WindowsProtectedMasterKeyProvider(ort).getMasterKey();
const zweiter = new WindowsProtectedMasterKeyProvider(ort).getMasterKey();

assert.equal(erster.equals(zweiter), true, 'zwei Starts, zwei Schlüssel — das wäre Datenverlust');
});

test('eine beschädigte Schlüsseldatei wird gemeldet, nicht überschrieben', { skip, timeout: 60_000 }, async () => {
/*
 * Der gefährliche Ausgang wäre, kommentarlos einen neuen Schlüssel anzulegen:
 * Der Lauf ginge weiter, und jeder gespeicherte Zugang wäre still verloren.
 * Lieber laut scheitern.
 */
const ort = await verzeichnis();
const provider = new WindowsProtectedMasterKeyProvider(ort);
provider.getMasterKey();

const datei = path.join(ort, PROTECTED_KEY_FILENAME);
const heil = await fsp.readFile(datei, 'utf8');
const roh = Buffer.from(heil.trim(), 'base64');
roh[0] ^= 0xff;
await fsp.writeFile(datei, roh.toString('base64'));

assert.throws(() => new WindowsProtectedMasterKeyProvider(ort).getMasterKey(), ProtectedMasterKeyError);

// Und die Datei steht noch da, unverändert — wer sie anderswo gesichert hat,
// kann sie zurückspielen.
assert.equal(fs.existsSync(datei), true);
});

test('der Schlüssel wird einmal geholt und dann behalten', { skip, timeout: 60_000 }, async () => {
// Ohne das liefe für jeden einzelnen Zugang ein PowerShell-Prozess an, und
// der braucht Sekunden. Gemessen statt behauptet: der zweite Aufruf darf
// nicht wieder in dieselbe Größenordnung fallen.
const ort = await verzeichnis();
const provider = new WindowsProtectedMasterKeyProvider(ort);

provider.getMasterKey();
const start = process.hrtime.bigint();
provider.getMasterKey();
const zweiterAufruf = Number(process.hrtime.bigint() - start) / 1_000_000;

assert.ok(zweiterAufruf < 50, `der zweite Aufruf brauchte ${zweiterAufruf.toFixed(1)} ms`);
});

test('ohne gesetzte Umgebungsvariable lässt sich ein Zugang speichern und wieder lesen', { skip, timeout: 90_000 }, async () => {
/*
 * Der Fall, um den es geht: Frische Aufstellung, niemand hat eine
 * Umgebungsvariable gesetzt, jemand trägt Anmeldedaten für einen Server ein.
 * Bis eben endete das in einer Fehlermeldung — auf Englisch, und erst
 * nachdem das Formular ausgefüllt war.
 */
const ort = await verzeichnis();
const vorher = process.env[DEFAULT_MASTER_KEY_VARIABLE];
delete process.env[DEFAULT_MASTER_KEY_VARIABLE];

const application = createPersistentApplication(ort);

try {
  const zugang = await application.credentialService.create({
    name: 'Kunde A SFTP',
    type: 'USERNAME_PASSWORD',
    username: 'unikom',
    secret: 'Kennwort-2026',
  });

  assert.equal(await application.credentialService.resolveSecret(zugang.id), 'Kennwort-2026');
  assert.equal(fs.existsSync(path.join(ort, PROTECTED_KEY_FILENAME)), true);
} finally {
  application.close();
  if (vorher !== undefined) {
    process.env[DEFAULT_MASTER_KEY_VARIABLE] = vorher;
  }
}
});
