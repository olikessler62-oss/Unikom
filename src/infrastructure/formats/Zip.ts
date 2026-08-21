import { inflateRawSync } from 'node:zlib';

/**
 * Liest ein ZIP-Archiv — so weit, wie eine XLSX es braucht.
 *
 * Gelesen wird über das zentrale Verzeichnis am Ende des Archivs, nicht durch
 * Vorwärtslaufen über die lokalen Köpfe. Der Grund: Bei Dateien, die im Strom
 * geschrieben wurden, stehen die Größen im lokalen Kopf auf Null und erst
 * hinter den Daten in einem Nachsatz. Wer sich auf den lokalen Kopf verlässt,
 * liest solche Archive falsch — und Excel schreibt sie.
 */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD = 0x06054b50;
const ZENTRAL = 0x02014b50;
const LOKAL = 0x04034b50;

export function readZip(bytes: Buffer): Map<string, Buffer> {
  const abschluss = findeAbschluss(bytes);
  const anzahl = bytes.readUInt16LE(abschluss + 10);
  let stelle = bytes.readUInt32LE(abschluss + 16);

  const eintraege = new Map<string, Buffer>();

  for (let nummer = 0; nummer < anzahl; nummer += 1) {
    if (bytes.readUInt32LE(stelle) !== ZENTRAL) {
      throw new Error(`Das Archiv ist beschädigt: Eintrag ${nummer + 1} hat keine gültige Kennung`);
    }

    const verfahren = bytes.readUInt16LE(stelle + 10);
    const gepackt = bytes.readUInt32LE(stelle + 20);
    const entpackt = bytes.readUInt32LE(stelle + 24);
    const namensLaenge = bytes.readUInt16LE(stelle + 28);
    const extraLaenge = bytes.readUInt16LE(stelle + 30);
    const kommentarLaenge = bytes.readUInt16LE(stelle + 32);
    const versatz = bytes.readUInt32LE(stelle + 42);
    const name = bytes.subarray(stelle + 46, stelle + 46 + namensLaenge).toString('utf-8');

    eintraege.set(name, hole(bytes, versatz, verfahren, gepackt, entpackt, name));
    stelle += 46 + namensLaenge + extraLaenge + kommentarLaenge;
  }

  return eintraege;
}

function hole(
  bytes: Buffer,
  versatz: number,
  verfahren: number,
  gepackt: number,
  entpackt: number,
  name: string
): Buffer {
  if (bytes.readUInt32LE(versatz) !== LOKAL) {
    throw new Error(`Das Archiv ist beschädigt: „${name}" liegt nicht dort, wo das Verzeichnis es angibt`);
  }

  // Die Längen im lokalen Kopf können von denen im Verzeichnis abweichen; für
  // den Beginn der Daten zählen die hier.
  const namensLaenge = bytes.readUInt16LE(versatz + 26);
  const extraLaenge = bytes.readUInt16LE(versatz + 28);
  const beginn = versatz + 30 + namensLaenge + extraLaenge;
  const roh = bytes.subarray(beginn, beginn + gepackt);

  if (verfahren === 0) {
    return Buffer.from(roh);
  }

  if (verfahren !== 8) {
    throw new Error(`„${name}" ist mit Verfahren ${verfahren} gepackt; unterstützt werden nur „gespeichert" und deflate`);
  }

  const inhalt = inflateRawSync(roh);

  if (inhalt.length !== entpackt) {
    throw new Error(`„${name}" ist unvollständig: erwartet ${entpackt} Bytes, entpackt ${inhalt.length}`);
  }

  return inhalt;
}

function findeAbschluss(bytes: Buffer): number {
  // Der Abschluss steht am Ende, kann aber einen Kommentar hinter sich haben.
  const frühestens = Math.max(0, bytes.length - 22 - 0xffff);

  for (let stelle = bytes.length - 22; stelle >= frühestens; stelle -= 1) {
    if (bytes.readUInt32LE(stelle) === EOCD) {
      return stelle;
    }
  }

  throw new Error('Das ist kein ZIP-Archiv: der Abschluss des zentralen Verzeichnisses fehlt');
}
