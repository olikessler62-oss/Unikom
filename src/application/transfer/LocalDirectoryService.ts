import fs from 'node:fs/promises';
import path from 'node:path';

import { assertWithinTenant, TenantBoundaryError } from '../../domain/tenants/TenantContainment.js';
import type { Tenant, TenantRepository } from '../../domain/tenants/Tenant.js';
import { checkDirectory, type DirectoryCheckResult } from '../../infrastructure/filesystem/DirectoryCheck.js';
import {
  PROBE_BYTES,
  istText,
  probeAus,
  signaturVon,
  warumKeinText,
} from '../../infrastructure/formats/Dateiprobe.js';
import type { RemoteDirectoryResult } from './RemoteDirectoryService.js';

/**
 * Ein Verzeichnis auf dem Rechner aussuchen, auf dem Unikom läuft.
 *
 * **Warum das der Server beantwortet und nicht der Browser.** Ein Dateidialog
 * im Browser nennt den Pfad des Rechners, an dem jemand sitzt. Das ist bei
 * einer Weboberfläche nicht derselbe wie der, auf dem geschrieben wird — wer
 * Unikom vom Arbeitsplatz aus einrichtet, wählte sonst `D:\Eingang` seines
 * eigenen Rechners aus, und der Lauf legte die Dateien auf dem Server an eine
 * Stelle, die dort etwas ganz anderes ist oder gar nicht existiert. Ein
 * serverseitiger Browser ist deshalb kein Notbehelf, sondern die richtige
 * Antwort auf die Frage.
 *
 * Die Antwort hat dieselbe Form wie die des entfernten Browsers. Nicht aus
 * Sparsamkeit: Es ist dieselbe Frage — „was liegt hier, und wohin führt es
 * weiter" —, und dasselbe Fenster in der Oberfläche zeigt sie. Zwei Formen
 * hießen zwei Fenster, die sich mit der Zeit auseinanderentwickeln.
 *
 * Die Grenze des Mandanten gilt auch beim Blättern. Wer sie beim Speichern
 * nicht überschreiten darf, soll dahinter auch nicht erst stöbern.
 */

export interface LocalDirectoryRequest {
  tenantId?: string;
  /** Was im Feld steht. Leer heißt: zeig, was es überhaupt gibt. */
  directory: string;
  /**
   * Orte, die dieser Mandant schon benutzt — sie stehen im Fenster obenan.
   *
   * Sie kommen aus den vorhandenen Workflows und nicht aus einer eigenen
   * Merkliste. Das ist kein Sparen an der falschen Stelle: Eine Merkliste
   * müsste gepflegt, aufgeräumt und mitgesichert werden, sie veraltete
   * unbemerkt, und sie hinge am Browser oder am Benutzerkonto. Die Verzeichnisse
   * der Workflows sind dagegen immer aktuell, gelten für jeden, der die
   * Oberfläche öffnet, und sind genau die Orte, an denen dieser Kunde arbeitet.
   */
  known?: string[];
}

/**
 * Was beim Ansehen einer Beispieldatei herauskommt.
 *
 * Dieselbe Form wie die Antwort des Verzeichnisbrowsers: `ok` und `message`
 * zuerst, alles Weitere freiwillig. Ein Misserfolg ist hier ein gewöhnlicher
 * Ausgang und kein Ausnahmefall — die Datei ist ein PDF, sie steht beim
 * falschen Mandanten, sie ist fort. Jeder dieser Fälle hat einen Satz, und der
 * gehört in die Antwort und nicht in einen Fehler.
 */
export interface Dateiprobenergebnis {
  ok: boolean;
  message: string;
  /** Der bloße Name, ohne Pfad — er steht in der Auskunft über der Textfläche. */
  name?: string;
  pfad?: string;
  text?: string;
  kodierung?: string;
  /** Wie groß die Datei ist. */
  groesse?: number;
  /** Wie viel davon angesehen wurde. */
  gelesen?: number;
  /** Ob die Datei größer ist als das, was hereinkam. */
  gekuerzt?: boolean;
}

export class LocalDirectoryService {
  constructor(private readonly tenants?: TenantRepository) {}

  async browse(request: LocalDirectoryRequest): Promise<RemoteDirectoryResult> {
    const tenant = request.tenantId ? await this.tenants?.getById(request.tenantId) : undefined;
    const entered = request.directory.trim();

    /*
     * Ohne Eingabe: beim Mandanten sein Verzeichnis, sonst das Verzeichnis, in
     * dem Unikom läuft.
     *
     * Hier stand einmal die Auswahl der Laufwerke, mit der Begründung, von
     * irgendwo anzufangen wäre geraten. Das stimmt für einen fremden Ort — nicht
     * für den eigenen: Wer ein Verzeichnis sucht, sucht es fast immer in der
     * Nähe der Anwendung, und von `C:\` aus sind das jedes Mal fünf Klicks.
     *
     * Der Mandant behält den Vorrang. Sein Verzeichnis ist zugleich seine
     * Grenze — außerhalb davon anzufangen hieße, mit einer Fehlermeldung zu
     * beginnen.
     */
    const answer =
      entered === ''
        ? await this.list(tenant?.rootDirectory ?? process.cwd(), tenant)
        : await this.list(entered, tenant);

    return { ...answer, known: await this.knownDirectories(request.known ?? [], tenant) };
  }

  /**
   * Ob in dieses Verzeichnis geschrieben werden kann.
   *
   * ## Warum geschrieben und nicht gefragt
   *
   * Ein Rechteflag beantwortet die Frage nicht: Auf einer Freigabe entscheidet
   * der Server, unter Windows entscheiden Vererbung und Verweigerungen, und
   * beides steht in keinem Bit, das sich hier ablesen ließe. `checkDirectory`
   * legt deshalb eine winzige Datei an und nimmt sie sofort wieder fort — das
   * ist dieselbe Handlung, die der Lauf später ausführt, und nur sie
   * antwortet richtig.
   *
   * ## Warum jetzt und nicht um drei Uhr nachts
   *
   * Das Erledigt-Verzeichnis wird beim ersten gelungenen Durchgang gebraucht,
   * das Gescheitert-Verzeichnis beim ersten misslungenen — beides Zeitpunkte,
   * an denen niemand zusieht. Ein fehlendes Schreibrecht fiele dort als
   * Warnung im Protokoll an, und die Dateien blieben liegen.
   *
   * ## Ohne Anlegen
   *
   * Ein fehlendes Verzeichnis ist hier ein Mangel und keine Kleinigkeit: Der
   * Lauf legt diese drei **nicht** an, er verschiebt nur. Angelegt wird im
   * Auswahlfenster, mit einem Knopf, den man drückt.
   */
  async pruefeSchreibzugriff(request: { tenantId?: string; directory: string }): Promise<DirectoryCheckResult> {
    const ziel = request.directory.trim();

    if (ziel === '') {
      return { ok: false, exists: false, writable: false, message: 'Es ist kein Verzeichnis eingetragen' };
    }

    const tenant = request.tenantId ? await this.tenants?.getById(request.tenantId) : undefined;
    const resolved = path.resolve(ziel);

    if (tenant) {
      try {
        assertWithinTenant(tenant, resolved, 'Dieses Verzeichnis');
      } catch (error) {
        return {
          ok: false,
          exists: false,
          writable: false,
          message: error instanceof TenantBoundaryError ? error.message : String(error),
        };
      }
    }

    return checkDirectory(resolved);
  }

  /**
   * Den Anfang einer Datei ansehen — für die Erkennung einer Beispieldatei.
   *
   * ## Warum hier und nicht in der Erkennung
   *
   * Weil hier die Grenze des Mandanten steht. Ein Pfad, der aus dem Browser
   * kommt, ist eine Behauptung: Er kann auf `C:\Windows\win.ini` zeigen oder auf
   * das Verzeichnis des nächsten Kunden. Dieselbe Prüfung, die beim Blättern
   * gilt, muss beim Lesen gelten — und sie steht in dieser Klasse, damit es sie
   * nur einmal gibt. Eine zweite Fassung an anderer Stelle wäre die, die beim
   * nächsten Eingriff vergessen wird.
   *
   * ## Warum nur der Anfang
   *
   * Eine Lieferung hat zweihundert Megabyte, und die Frage ist nach hundert
   * Zeilen beantwortet. Gelesen wird deshalb mit `read` an Position 0 und nicht
   * mit `readFile`: Der Unterschied ist, ob der Server 64 Kilobyte oder die
   * ganze Datei in den Speicher nimmt — bei einem Nachtlauf daneben ist das
   * kein Feinschliff.
   */
  async leseProbe(request: { tenantId?: string; datei: string }): Promise<Dateiprobenergebnis> {
    const angabe = request.datei.trim();

    if (angabe === '') {
      return { ok: false, message: 'Es ist keine Datei ausgewählt' };
    }

    const tenant = request.tenantId ? await this.tenants?.getById(request.tenantId) : undefined;
    const resolved = path.resolve(angabe);

    if (tenant) {
      try {
        assertWithinTenant(tenant, resolved, 'Diese Datei');
      } catch (error) {
        return { ok: false, message: error instanceof TenantBoundaryError ? error.message : String(error) };
      }
    }

    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      return {
        ok: false,
        message:
          code === 'ENOENT'
            ? `${resolved} gibt es nicht.`
            : code === 'EACCES' || code === 'EPERM'
              ? `Keine Berechtigung für ${resolved}. Das Konto, unter dem Unikom läuft, darf dort nicht lesen.`
              : `${resolved} lässt sich nicht lesen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!stats.isFile()) {
      return {
        ok: false,
        message: stats.isDirectory()
          ? `${resolved} ist ein Verzeichnis und keine Datei.`
          : `${resolved} ist keine gewöhnliche Datei.`,
      };
    }

    if (stats.size === 0) {
      return { ok: false, message: `„${path.basename(resolved)}" ist leer - darin ist nichts zu erkennen.` };
    }

    const gekuerzt = stats.size > PROBE_BYTES;
    const puffer = new Uint8Array(Math.min(stats.size, PROBE_BYTES));
    const griff = await fs.open(resolved, 'r');
    let gelesen = 0;

    try {
      gelesen = (await griff.read(puffer, 0, puffer.length, 0)).bytesRead;
    } finally {
      await griff.close();
    }

    const angesehen = puffer.subarray(0, gelesen);

    if (!istText(angesehen)) {
      return { ok: false, message: warumKeinText(signaturVon(angesehen), path.basename(resolved)) };
    }

    const probe = probeAus(angesehen, gekuerzt);

    return {
      ok: true,
      message: `„${path.basename(resolved)}" gelesen`,
      name: path.basename(resolved),
      pfad: resolved,
      text: probe.text,
      kodierung: probe.kodierung,
      groesse: stats.size,
      gelesen: probe.bytes,
      gekuerzt,
    };
  }

  /**
   * Die schon benutzten Orte, geprüft und in Ordnung gebracht.
   *
   * Geprüft, weil ein Ort aus einem alten Workflow längst verschwunden sein
   * kann — ihn zur Auswahl anzubieten und dann an einer Fehlermeldung enden zu
   * lassen wäre schlechter als ihn wegzulassen. Und in Ordnung gebracht, weil
   * derselbe Ort in zwei Workflows unterschiedlich geschrieben stehen kann.
   */
  private async knownDirectories(candidates: string[], tenant?: Tenant): Promise<RemoteDirectoryResult['known']> {
    const seen = new Map<string, string>();

    for (const candidate of candidates) {
      const trimmed = candidate.trim();

      if (trimmed === '') {
        continue;
      }

      const resolved = path.resolve(trimmed);

      if (seen.has(resolved.toLowerCase())) {
        continue;
      }

      if (tenant?.rootDirectory) {
        try {
          assertWithinTenant(tenant, resolved, 'Dieses Verzeichnis');
        } catch {
          // Gehört einem anderen Mandanten; hier hat es nichts zu suchen.
          continue;
        }
      }

      seen.set(resolved.toLowerCase(), resolved);
    }

    const reachable = await Promise.all(
      [...seen.values()].map(async (directory) =>
        (await fs.stat(directory).then(
          (stats) => stats.isDirectory(),
          () => false
        ))
          ? directory
          : undefined
      )
    );

    return reachable
      .filter((directory): directory is string => Boolean(directory))
      .sort((left, right) => left.localeCompare(right))
      .map((directory) => ({ name: directory, path: directory, relativePath: directory }));
  }

  private async list(directory: string, tenant?: Tenant): Promise<RemoteDirectoryResult> {
    const resolved = path.resolve(directory);

    if (tenant) {
      try {
        assertWithinTenant(tenant, resolved, 'Dieses Verzeichnis');
      } catch (error) {
        return {
          ok: false,
          message: error instanceof TenantBoundaryError ? error.message : String(error),
          entries: [],
        };
      }
    }

    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      return {
        ok: false,
        message:
          code === 'ENOENT'
            ? `${resolved} gibt es nicht.`
            : code === 'EACCES' || code === 'EPERM'
              ? `Keine Berechtigung für ${resolved}. Das Konto, unter dem Unikom läuft, darf dort nicht lesen.`
              : `${resolved} lässt sich nicht lesen: ${error instanceof Error ? error.message : String(error)}`,
        path: resolved,
        entries: [],
      };
    }

    const directories = entries.filter((entry) => entry.isDirectory());

    return {
      ok: true,
      message: `Verzeichnis gefunden: ${resolved}`,
      path: resolved,
      // Lokal ist der Pfad selbst das, was ins Feld gehört — es gibt kein
      // Arbeitsverzeichnis, vor dem etwas abzuschneiden wäre.
      relativePath: resolved,
      parentPath: this.parentOf(resolved, tenant),
      filesFound: entries.length - directories.length,
      files: entries
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolved, entry.name),
          relativePath: path.join(resolved, entry.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      entries: directories
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolved, entry.name),
          relativePath: path.join(resolved, entry.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  /**
   * Eine Ebene höher — aber nie über die Grenze des Mandanten und nie über die
   * Wurzel hinaus. Oberhalb eines Laufwerks steht die Auswahl der Laufwerke.
   */
  private parentOf(resolved: string, tenant?: Tenant): string {
    if (tenant?.rootDirectory && path.resolve(tenant.rootDirectory) === resolved) {
      return resolved;
    }

    const parent = path.dirname(resolved);

    return parent === resolved ? '' : parent;
  }
}
