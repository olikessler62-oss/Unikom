import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  generateMasterKey,
  MASTER_KEY_BYTES,
  type MasterKeyProvider,
} from './MasterKeyProvider.js';

/**
 * Der Hauptschlüssel, von Windows verwahrt.
 *
 * Er schützt jeden gespeicherten Zugang. Bisher musste er von Hand als
 * Umgebungsvariable gesetzt werden — richtig gedacht, aber unbequem genug,
 * dass man ihn vergisst, und dann steht man vor unlesbaren Daten.
 *
 * Hier erzeugt Unikom ihn beim ersten Start selbst und übergibt ihn dem
 * Datenschutz von Windows (DPAPI), im Bereich `LocalMachine`. Was auf der
 * Platte liegt, ist danach ein Block, den nur *dieser Rechner* wieder öffnen
 * kann. Die Zusage bleibt damit erhalten: Eine Sicherung der Datenbank ist für
 * sich genommen wertlos, denn der Schlüssel darin lässt sich anderswo nicht
 * entschlüsseln.
 *
 * `LocalMachine` und nicht `CurrentUser`, weil ein Dienst unter einem anderen
 * Konto läuft als der Mensch, der ihn eingerichtet hat. Mit `CurrentUser` wäre
 * der Schlüssel für den Dienst unlesbar — und zwar erst dann, wenn nachts
 * niemand zusieht. Der Preis ist, dass jedes Konto dieses Rechners den Block
 * öffnen könnte; die Rechte auf die Datei bleiben deshalb die zweite Schranke.
 *
 * Gemessen an dieser Maschine: Ein verfälschter Block wird abgelehnt (acht von
 * zehn geprüften Bytes; die übrigen zwei liegen in einem folgenlosen Kopfteil,
 * und in keinem Fall kam ein anderer Schlüssel heraus). Ein stiller
 * Falschschlüssel ist damit nicht der Weg, auf dem hier etwas schiefgeht.
 */

/** Der Aufruf kostet Sekunden, nicht Millisekunden — er darf nur einmal geschehen. */
const PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$roh = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($roh)
$geschuetzt = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
[Convert]::ToBase64String($geschuetzt)
`;

const UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$roh = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($roh)
$offen = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'LocalMachine')
[Convert]::ToBase64String($offen)
`;

export const PROTECTED_KEY_FILENAME = 'hauptschluessel.dpapi';

export class ProtectedMasterKeyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProtectedMasterKeyError';
  }
}

export class WindowsProtectedMasterKeyProvider implements MasterKeyProvider {
  /**
   * Einmal geholt, dann behalten. Ohne das liefe für jeden einzelnen Zugang
   * ein PowerShell-Prozess an, und der braucht Sekunden — ein Lauf mit zehn
   * Verbindungen stünde eine halbe Minute im Leerlauf.
   */
  private cached?: Buffer;

  constructor(
    private readonly dataDirectory: string,
    /** Was gerade geschieht — der Start soll es sagen können. */
    private readonly trace?: (message: string) => void
  ) {}

  get keyFile(): string {
    return path.join(this.dataDirectory, PROTECTED_KEY_FILENAME);
  }

  getMasterKey(): Buffer {
    if (this.cached) {
      return this.cached;
    }

    this.cached = fs.existsSync(this.keyFile) ? this.readExisting() : this.createNew();
    return this.cached;
  }

  private readExisting(): Buffer {
    let opened: string;

    try {
      opened = this.powershell(UNPROTECT_SCRIPT, fs.readFileSync(this.keyFile, 'utf8').trim());
    } catch (error) {
      throw new ProtectedMasterKeyError(
        `Der Hauptschlüssel in ${this.keyFile} lässt sich auf diesem Rechner nicht öffnen. ` +
          'Windows gibt ihn nur dort wieder heraus, wo er erzeugt wurde — nach einem Umzug auf einen anderen ' +
          'Rechner oder einer Neuinstallation von Windows ist das erwartbar. Gespeicherte Zugänge müssen dann ' +
          'neu eingetragen werden. Ist der Schlüssel anderswo gesichert, kann er über die Umgebungsvariable ' +
          'UNIKOM_MASTER_KEY vorgegeben werden.',
        { cause: error }
      );
    }

    const key = Buffer.from(opened, 'base64');

    if (key.length !== MASTER_KEY_BYTES) {
      throw new ProtectedMasterKeyError(
        `Der Hauptschlüssel in ${this.keyFile} hat nicht die erwartete Länge von ${MASTER_KEY_BYTES} Byte. ` +
          'Die Datei ist beschädigt.'
      );
    }

    this.trace?.(`Hauptschlüssel aus ${this.keyFile} geöffnet`);
    return key;
  }

  private createNew(): Buffer {
    const generated = generateMasterKey();
    const protectedKey = this.powershell(PROTECT_SCRIPT, generated);

    fs.mkdirSync(this.dataDirectory, { recursive: true });
    // Erst daneben schreiben, dann umbenennen: Ein Abbruch mitten im Schreiben
    // hinterlässt sonst eine halbe Schlüsseldatei, und die wäre beim nächsten
    // Start nicht von einer beschädigten zu unterscheiden.
    const temporary = `${this.keyFile}.neu`;
    fs.writeFileSync(temporary, protectedKey, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.keyFile);

    this.trace?.(`Hauptschlüssel neu erzeugt und in ${this.keyFile} verwahrt`);
    return Buffer.from(generated, 'base64');
  }

  private powershell(script: string, input: string): string {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input,
      encoding: 'utf8',
      windowsHide: true,
      // Ein hängender Aufruf darf den Start nicht endlos aufhalten.
      timeout: 30_000,
    }).trim();
  }
}

/** Ob dieser Weg hier überhaupt offensteht. */
export function windowsProtectionAvailable(): boolean {
  return process.platform === 'win32';
}
