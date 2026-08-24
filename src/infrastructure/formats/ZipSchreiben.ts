import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Schreibt ein ZIP-Archiv — mehrere Dateien in einem Behälter.
 *
 * ## Warum überhaupt gepackt wird
 *
 * Ein Stapel gehört zusammen. Drei Dateien einzeln ins Archiv zu legen hieße,
 * beim Nachsehen aus Zeitstempeln zu erraten, welche zu welchem Durchgang
 * gehörten — und bei zwei Läufen derselben Nacht rät man falsch. Ein Behälter je
 * Durchgang beantwortet die Frage, ohne dass jemand sie stellen muss.
 *
 * ## Ohne Passwort — die Verschlüsselung liegt außen
 *
 * Hier stand einmal WinZip-AES mit einem Passwort. Es ist fort, und zwar aus
 * zwei Gründen: ZIP legt nicht fest, in welchen Bytes ein Passwort verarbeitet
 * wird — ein Umlaut darin ergibt beim einen Werkzeug einen anderen Schlüssel
 * als beim anderen —, und ein passwortgeschütztes ZIP verrät seine Dateinamen,
 * weil das zentrale Verzeichnis nie mitverschlüsselt wird.
 *
 * Das Archiv wird deshalb **als Ganzes** mit AES-256-GCM eingeschlagen, mit
 * einem Schlüssel aus der Schlüsselverwaltung. Damit liegen auch die Namen
 * innen, und es gilt dasselbe Verfahren wie überall sonst im Haus.
 *
 * Was hier bleibt, ist der Behälter: gepackt mit Deflate, lesbar von
 * `Zip.readZip`, sobald der Umschlag ab ist.
 */
export interface Archiveintrag {
  /** Der Name im Archiv, ohne Verzeichnisteil. */
  name: string;
  inhalt: Uint8Array;
}

/** Kennungen, an denen ein ZIP seine Teile erkennt. */
const LOKAL = 0x04034b50;
const ZENTRAL = 0x02014b50;
const ABSCHLUSS = 0x06054b50;

/** Was ein Leser können muss: 2.0 — Deflate, mehr braucht dieser Behälter nicht. */
const MINDESTFASSUNG = 20;

/** Namen in UTF-8 (Bit 11) — sonst nichts. */
const FLAGGEN = 0x0800;

const VERFAHREN_DEFLATE = 8;

/**
 * Packt mehrere Dateien in ein Archiv.
 *
 * `jetzt` kommt von außen und nicht aus der Uhr: Ein Archiv, das sich nur mit
 * der Uhr des Servers erklären lässt, ist nicht prüfbar — und ein Lauf, der um
 * Mitternacht beginnt, soll für alle seine Dateien denselben Zeitpunkt tragen.
 */
export function packe(eintraege: readonly Archiveintrag[], jetzt: Date): Buffer {
  const { zeit, datum } = dosZeit(jetzt);
  const stuecke: Buffer[] = [];
  const koepfe: Buffer[] = [];
  let versatz = 0;

  for (const eintrag of eintraege) {
    const name = Buffer.from(eintrag.name, 'utf-8');
    const gepackt = deflateRawSync(eintrag.inhalt);
    const pruefsumme = crc32(eintrag.inhalt);

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(LOKAL, 0);
    kopf.writeUInt16LE(MINDESTFASSUNG, 4);
    kopf.writeUInt16LE(FLAGGEN, 6);
    kopf.writeUInt16LE(VERFAHREN_DEFLATE, 8);
    kopf.writeUInt16LE(zeit, 10);
    kopf.writeUInt16LE(datum, 12);
    kopf.writeUInt32LE(pruefsumme, 14);
    kopf.writeUInt32LE(gepackt.length, 18);
    kopf.writeUInt32LE(eintrag.inhalt.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);

    stuecke.push(kopf, name, gepackt);

    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(ZENTRAL, 0);
    // Erstellt von: dieselbe Fassung, Wirtssystem 0 (FAT) — das Übliche.
    zentral.writeUInt16LE(MINDESTFASSUNG, 4);
    zentral.writeUInt16LE(MINDESTFASSUNG, 6);
    zentral.writeUInt16LE(FLAGGEN, 8);
    zentral.writeUInt16LE(VERFAHREN_DEFLATE, 10);
    zentral.writeUInt16LE(zeit, 12);
    zentral.writeUInt16LE(datum, 14);
    zentral.writeUInt32LE(pruefsumme, 16);
    zentral.writeUInt32LE(gepackt.length, 20);
    zentral.writeUInt32LE(eintrag.inhalt.length, 24);
    zentral.writeUInt16LE(name.length, 28);
    zentral.writeUInt16LE(0, 30);
    zentral.writeUInt32LE(versatz, 42);

    koepfe.push(zentral, name);
    versatz += kopf.length + name.length + gepackt.length;
  }

  const verzeichnis = Buffer.concat(koepfe);
  const abschluss = Buffer.alloc(22);
  abschluss.writeUInt32LE(ABSCHLUSS, 0);
  abschluss.writeUInt16LE(eintraege.length, 8);
  abschluss.writeUInt16LE(eintraege.length, 10);
  abschluss.writeUInt32LE(verzeichnis.length, 12);
  abschluss.writeUInt32LE(versatz, 16);

  return Buffer.concat([...stuecke, verzeichnis, abschluss]);
}

/**
 * Zeit und Datum, wie MS-DOS sie zählte — und wie ZIP sie bis heute trägt.
 *
 * Sekunden in Zweierschritten, Jahre ab 1980. Vor 1980 gibt es in diesem Format
 * nichts; ein solcher Zeitpunkt käme aus einer kaputten Uhr und wird auf den
 * ersten Tag gesetzt, statt eine negative Jahreszahl in den Kopf zu schreiben.
 */
function dosZeit(zeitpunkt: Date): { zeit: number; datum: number } {
  const jahr = Math.max(1980, zeitpunkt.getFullYear());

  return {
    zeit:
      (zeitpunkt.getHours() << 11) | (zeitpunkt.getMinutes() << 5) | (zeitpunkt.getSeconds() >> 1),
    datum: ((jahr - 1980) << 9) | ((zeitpunkt.getMonth() + 1) << 5) | zeitpunkt.getDate(),
  };
}
