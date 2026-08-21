import { deflateRawSync } from 'node:zlib';

/**
 * Schreibt eine XLSX-Datei mit mehreren Tabellenblättern — ohne fremde
 * Bibliothek.
 *
 * Eine XLSX ist ein ZIP-Archiv mit XML darin. Für den Fallkatalog brauchen wir
 * nur die schreibende Richtung, und die ist überschaubar; eine Abhängigkeit,
 * die bei jedem Kunden mit ausgeliefert wird, wäre dafür ein hoher Preis.
 *
 * Bewusst mit deflate statt „gespeichert": Echte Excel-Dateien sind komprimiert,
 * und der Leser, der später entsteht, soll an echten Dateien geprüft werden.
 *
 * Die Zeitstempel im Archiv sind festgesetzt. Damit erzeugt derselbe Katalog
 * bei jedem Lauf dieselben Bytes — sonst sähe jede erzeugte Testdatei nach
 * einer Änderung aus.
 */
/** Ein echtes Datum, wie Excel es speichert: eine Tageszahl mit Datumsformat. */
export interface Datum {
  datum: string;
}

export type Zelle = string | number | Datum;

export interface Sheet {
  name: string;
  /** Zeilen aus Zellen. Zahlen bleiben Zahlen, `{ datum }` wird zur Tageszahl. */
  rows: readonly (readonly Zelle[])[];
}

const DOS_ZEIT = 0; // 00:00:00
const DOS_DATUM = ((2026 - 1980) << 9) | (1 << 5) | 1; // 1. Januar 2026

export interface Optionen {
  /**
   * Text in eine gemeinsame Zeichenkettentabelle legen statt in die Zelle.
   *
   * So schreibt echtes Excel fast immer, und der Leser muss beide Wege können.
   * Voreingestellt ist der einfache Weg, damit die Datei von Hand lesbar bleibt.
   */
  sharedStrings?: boolean;
}

export function writeXlsx(sheets: readonly Sheet[], optionen: Optionen = {}): Buffer {
  if (sheets.length === 0) {
    throw new Error('Eine Arbeitsmappe ohne Tabellenblatt lässt sich nicht schreiben');
  }

  const tabelle = optionen.sharedStrings ? sammleTexte(sheets) : undefined;

  const eintraege: [string, string][] = [
    ['[Content_Types].xml', contentTypes(sheets.length, Boolean(tabelle))],
    ['_rels/.rels', wurzelBeziehungen()],
    ['xl/workbook.xml', workbook(sheets)],
    ['xl/_rels/workbook.xml.rels', workbookBeziehungen(sheets.length, Boolean(tabelle))],
    ['xl/styles.xml', styles()],
    ...(tabelle ? ([['xl/sharedStrings.xml', sharedStrings(tabelle)]] as [string, string][]) : []),
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, blatt(sheet, tabelle)]),
  ];

  return zip(eintraege.map(([name, inhalt]) => ({ name, daten: Buffer.from(inhalt, 'utf-8') })));
}

function sammleTexte(sheets: readonly Sheet[]): Map<string, number> {
  const tabelle = new Map<string, number>();

  for (const sheet of sheets) {
    for (const zeile of sheet.rows) {
      for (const wert of zeile) {
        if (typeof wert === 'string' && wert !== '' && !tabelle.has(wert)) {
          tabelle.set(wert, tabelle.size);
        }
      }
    }
  }

  return tabelle;
}

function sharedStrings(tabelle: Map<string, number>): string {
  const eintraege = [...tabelle.keys()].map((text) => `<si><t xml:space="preserve">${xml(text)}</t></si>`).join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${tabelle.size}" ` +
    `uniqueCount="${tabelle.size}">${eintraege}</sst>`
  );
}

function contentTypes(anzahl: number, mitTabelle: boolean): string {
  const blaetter = Array.from(
    { length: anzahl },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  ).join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    (mitTabelle
      ? '<Override PartName="/xl/sharedStrings.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      : '') +
    blaetter +
    '</Types>'
  );
}

function wurzelBeziehungen(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" ' +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
    'Target="xl/workbook.xml"/>' +
    '</Relationships>'
  );
}

function workbook(sheets: readonly Sheet[]): string {
  const eintraege = sheets
    .map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${eintraege}</sheets>` +
    '</workbook>'
  );
}

function workbookBeziehungen(anzahl: number, mitTabelle: boolean): string {
  const eintraege =
    Array.from(
      { length: anzahl },
      (_, index) =>
        `<Relationship Id="rId${index + 1}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        `Target="worksheets/sheet${index + 1}.xml"/>`
    ).join('') +
    `<Relationship Id="rId${anzahl + 1}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
    'Target="styles.xml"/>' +
    (mitTabelle
      ? `<Relationship Id="rId${anzahl + 2}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" ' +
        'Target="sharedStrings.xml"/>'
      : '');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${eintraege}</Relationships>`
  );
}

/**
 * Zwei Zellformate: das leere und eines mit dem eingebauten Datumsformat 14.
 * Mehr braucht der Katalog nicht — und ein Datum ohne Format wäre in Excel
 * eine fünfstellige Zahl, also genau der Fehler, den der Leser finden soll.
 */
function styles(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font/></fonts>' +
    '<fills count="1"><fill/></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="2"><xf/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>' +
    '</styleSheet>'
  );
}

/**
 * Die Tageszahl, mit der Excel rechnet: Tage seit dem 30. Dezember 1899. Der
 * merkwürdige Bezugstag kommt daher, dass Excel einen 29. Februar 1900 kennt,
 * den es nie gab.
 */
export function alsTageszahl(iso: string): number {
  const [jahr, monat, tag] = iso.split('-').map(Number);
  const tage = (Date.UTC(jahr, monat - 1, tag) - Date.UTC(1899, 11, 30)) / 86_400_000;

  return Math.round(tage);
}

function blatt(sheet: Sheet, tabelle?: Map<string, number>): string {
  const zeilen = sheet.rows
    .map((zellen, zeile) => {
      const inhalt = zellen
        .map((wert, spalte) => zelle(`${spaltenName(spalte)}${zeile + 1}`, wert, tabelle))
        .join('');

      return `<row r="${zeile + 1}">${inhalt}</row>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${zeilen}</sheetData>` +
    '</worksheet>'
  );
}

/**
 * Text steht unmittelbar in der Zelle (`inlineStr`) statt in einer gemeinsamen
 * Zeichenkettentabelle. Beides ist zulässig; so bleibt die Datei ohne
 * zusätzlichen Teil lesbar, auch von Hand.
 */
function zelle(bezug: string, wert: Zelle, tabelle?: Map<string, number>): string {
  if (typeof wert === 'object') {
    return `<c r="${bezug}" s="1"><v>${alsTageszahl(wert.datum)}</v></c>`;
  }

  if (typeof wert === 'number') {
    return `<c r="${bezug}"><v>${wert}</v></c>`;
  }

  if (wert === '') {
    return `<c r="${bezug}"/>`;
  }

  const stelle = tabelle?.get(wert);

  return stelle === undefined
    ? `<c r="${bezug}" t="inlineStr"><is><t xml:space="preserve">${xml(wert)}</t></is></c>`
    : `<c r="${bezug}" t="s"><v>${stelle}</v></c>`;
}

export function spaltenName(index: number): string {
  let name = '';
  let rest = index;

  do {
    name = String.fromCharCode(65 + (rest % 26)) + name;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);

  return name;
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let wert = index;

    for (let schritt = 0; schritt < 8; schritt += 1) {
      wert = wert & 1 ? 0xedb88320 ^ (wert >>> 1) : wert >>> 1;
    }

    tabelle[index] = wert >>> 0;
  }

  return tabelle;
})();

export function crc32(daten: Buffer): number {
  let wert = 0xffffffff;

  for (const byte of daten) {
    wert = CRC_TABELLE[(wert ^ byte) & 0xff] ^ (wert >>> 8);
  }

  return (wert ^ 0xffffffff) >>> 0;
}

interface Eintrag {
  name: string;
  daten: Buffer;
}

function zip(eintraege: readonly Eintrag[]): Buffer {
  const lokal: Buffer[] = [];
  const zentral: Buffer[] = [];
  let versatz = 0;

  for (const eintrag of eintraege) {
    const name = Buffer.from(eintrag.name, 'utf-8');
    const gepackt = deflateRawSync(eintrag.daten);
    const pruefsumme = crc32(eintrag.daten);

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4); // benötigte Version
    kopf.writeUInt16LE(0, 6); // keine Merkmale
    kopf.writeUInt16LE(8, 8); // deflate
    kopf.writeUInt16LE(DOS_ZEIT, 10);
    kopf.writeUInt16LE(DOS_DATUM, 12);
    kopf.writeUInt32LE(pruefsumme, 14);
    kopf.writeUInt32LE(gepackt.length, 18);
    kopf.writeUInt32LE(eintrag.daten.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);

    lokal.push(kopf, name, gepackt);

    const verzeichnis = Buffer.alloc(46);
    verzeichnis.writeUInt32LE(0x02014b50, 0);
    verzeichnis.writeUInt16LE(20, 4); // erzeugende Version
    verzeichnis.writeUInt16LE(20, 6);
    verzeichnis.writeUInt16LE(0, 8);
    verzeichnis.writeUInt16LE(8, 10);
    verzeichnis.writeUInt16LE(DOS_ZEIT, 12);
    verzeichnis.writeUInt16LE(DOS_DATUM, 14);
    verzeichnis.writeUInt32LE(pruefsumme, 16);
    verzeichnis.writeUInt32LE(gepackt.length, 20);
    verzeichnis.writeUInt32LE(eintrag.daten.length, 24);
    verzeichnis.writeUInt16LE(name.length, 28);
    verzeichnis.writeUInt32LE(versatz, 42);

    zentral.push(verzeichnis, name);
    versatz += kopf.length + name.length + gepackt.length;
  }

  const verzeichnisBytes = Buffer.concat(zentral);
  const abschluss = Buffer.alloc(22);

  abschluss.writeUInt32LE(0x06054b50, 0);
  abschluss.writeUInt16LE(eintraege.length, 8);
  abschluss.writeUInt16LE(eintraege.length, 10);
  abschluss.writeUInt32LE(verzeichnisBytes.length, 12);
  abschluss.writeUInt32LE(versatz, 16);

  return Buffer.concat([...lokal, verzeichnisBytes, abschluss]);
}
