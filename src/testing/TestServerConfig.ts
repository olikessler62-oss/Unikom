import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zugänge zu echten Servern, gegen die zusätzlich geprüft wird.
 *
 * Der eigene SFTP- und FTPS-Testserver spricht dasselbe Protokoll, aber er ist
 * von uns geschrieben und stimmt deshalb unseren Annahmen zu. Ein echter Hoster
 * tut das nicht: Er setzt einen bei der Anmeldung in ein Verzeichnis, das er
 * intern anders nennt, er meldet eigene Fehlercodes, er kennt Rechte. Genau da
 * entstehen die doppelten Root-Verzeichnisse, gegen die der RemotePathResolver
 * gebaut ist.
 *
 * Die Zugangsdaten stehen in `testserver.local.json` im Projektstamm, die von
 * Git ignoriert wird. Fehlt sie, überspringen die Tests sich — ein fehlender
 * Prüfserver ist kein Fehler im Erzeugnis, und ein Bauplatz ohne Netz muss
 * grün bleiben.
 */

export interface RealSftpServer {
  host: string;
  port?: number;
  username: string;
  password?: string;
  /** Pfad zu einer Schlüsseldatei, falls die Anmeldung über einen Schlüssel läuft. */
  privateKeyFile?: string;
  passphrase?: string;
  /** Verzeichnis, in dem ausschließlich Testdaten liegen dürfen. */
  directory: string;
  hostKeyFingerprint?: string;
  allowUnknownHostKey?: boolean;
}

export interface RealFtpsServer {
  host: string;
  port?: number;
  username: string;
  password: string;
  directory: string;
  implicit?: boolean;
  validateCertificates?: boolean;
}

export interface TestServerConfig {
  sftp?: RealSftpServer;
  ftps?: RealFtpsServer;
  /** UNC-Pfad einer Windows-Freigabe; voreingestellt `\\localhost\UnikomTest`. */
  share?: string;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configFile = path.join(projectRoot, 'testserver.local.json');

export const DEFAULT_TEST_SHARE = '\\\\localhost\\UnikomTest';

let cached: TestServerConfig | undefined;

export function loadTestServerConfig(): TestServerConfig {
  if (cached) {
    return cached;
  }

  if (!fs.existsSync(configFile)) {
    cached = {};
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    // Ein Tippfehler in der Datei darf nicht als „kein Prüfserver vorhanden"
    // durchgehen: Dann liefe die Prüfung still an dem vorbei, wofür sie da ist.
    throw new Error(
      `${configFile} ist kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  cached = (parsed ?? {}) as TestServerConfig;
  return cached;
}

/**
 * Was der Test in seinen Namen schreiben darf. Ohne Benutzernamen, ohne
 * Kennwort — Testnamen landen in Protokollen und Bauberichten.
 */
export function describeServer(server: { host: string; port?: number }): string {
  return `${server.host}:${server.port ?? '(Vorgabe)'}`;
}

/**
 * Die Windows-Freigabe, wenn es sie gibt.
 *
 * Erreichbarkeit wird geschrieben geprüft, nicht gelesen: Eine Freigabe, die
 * sich auflisten aber nicht beschreiben lässt, würde die halbe Matrix erst
 * mitten im Lauf scheitern lassen.
 */
export async function findTestShare(): Promise<string | undefined> {
  const configured = loadTestServerConfig().share ?? DEFAULT_TEST_SHARE;

  if (process.platform !== 'win32') {
    return undefined;
  }

  const probe = path.join(configured, `.unikom-schreibprobe-${process.pid}`);

  try {
    await fsp.writeFile(probe, 'Schreibprobe');
    await fsp.rm(probe, { force: true });
    return configured;
  } catch {
    return undefined;
  }
}
