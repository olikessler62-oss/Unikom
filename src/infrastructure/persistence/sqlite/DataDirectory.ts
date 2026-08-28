import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Wo das Datenverzeichnis liegt.
 *
 * SQLite verlässt sich beim gleichzeitigen Zugriff auf Dateisperren. Über SMB
 * und NFS sind die unzuverlässig: Zwei Beteiligte können gleichzeitig glauben,
 * die Sperre zu halten. Das geht lange gut und zerstört die Datenbank dann auf
 * einmal — nicht beim Schreiben, sondern irgendwann beim Lesen, wenn niemand
 * mehr weiß, wann es passiert ist.
 *
 * Deshalb wird der Fall abgewiesen, statt ihn zu überwachen.
 */
export type DirectoryKind = 'LOKAL' | 'UNC' | 'NETZLAUFWERK';

/** \\Server\Freigabe und die POSIX-Schreibweise //Server/Freigabe. */
const FREIGABE = /^(\\\\|\/\/)/;
/** \\?\UNC\Server\Freigabe — dieselbe Freigabe, nur in der langen Form. */
const LANGE_FREIGABE = /^\\\\[?.]\\UNC\\/i;
/** \\?\C:\… ist trotz der zwei Schrägstriche ein lokaler Pfad. */
const LANGES_LAUFWERK = /^\\\\[?.]\\[A-Za-z]:/;

export function kindOfPath(
  directory: string,
  options: { istNetzlaufwerk?: (laufwerk: string) => boolean; platform?: string } = {}
): DirectoryKind {
  const platform = options.platform ?? process.platform;
  const istNetzlaufwerk = options.istNetzlaufwerk ?? isNetworkDrive;
  const pfad = directory.trim();

  if (LANGES_LAUFWERK.test(pfad)) {
    return 'LOKAL';
  }

  if (LANGE_FREIGABE.test(pfad) || (platform === 'win32' && FREIGABE.test(pfad)) || pfad.startsWith('\\\\')) {
    return 'UNC';
  }

  const laufwerk = /^([A-Za-z]):/.exec(path.resolve(pfad));

  if (laufwerk && platform === 'win32') {
    return istNetzlaufwerk(laufwerk[1].toUpperCase()) ? 'NETZLAUFWERK' : 'LOKAL';
  }

  return 'LOKAL';
}

/**
 * Ob auf diesem Laufwerksbuchstaben eine Netzwerkverbindung liegt.
 *
 * `net use X:` endet mit 0, wenn es eine gibt, und sonst mit 2. Ein
 * verbundenes Laufwerk sieht im Pfad aus wie eine lokale Platte, ist aber
 * dieselbe Freigabe mit denselben unzuverlässigen Sperren.
 *
 * Gelingt die Auskunft nicht, gilt das Laufwerk als lokal: Ein Start, der an
 * einer nicht beantwortbaren Frage scheitert, wäre schlimmer als die Lücke.
 */
export function isNetworkDrive(laufwerk: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    execFileSync('net', ['use', `${laufwerk}:`], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function assertDataDirectoryIsLocal(directory: string, kind: DirectoryKind = kindOfPath(directory)): void {
  if (kind === 'LOKAL') {
    return;
  }

  const wo = kind === 'UNC' ? 'auf einer Netzwerkfreigabe' : 'auf einem verbundenen Netzlaufwerk';

  throw new Error(
    `Das Datenverzeichnis „${directory}“ liegt ${wo}. Die Datenbank von Unikom muss auf einer lokalen Platte ` +
      'liegen, weil Dateisperren über das Netz unzuverlässig sind und die Datenbank dabei stillschweigend ' +
      'beschädigt werden kann. Bitte UNIKOM_DATA_DIRECTORY auf ein lokales Verzeichnis setzen. ' +
      'Quellen und Ziele der Übertragung dürfen weiterhin im Netz liegen - nur die Datenbank nicht.'
  );
}
