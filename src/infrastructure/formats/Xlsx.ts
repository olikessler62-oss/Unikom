import type { Cell, DeclaredType } from '../../domain/consolidation/Cell.js';
import { discoverFields, type DiscoveryOptions, type DiscoveryResult } from '../../domain/discovery/Discovery.js';
import { readZip } from './Zip.js';

/**
 * Liest eine XLSX-Arbeitsmappe.
 *
 * Der entscheidende Unterschied zu CSV: Excel **weiß**, was in einer Zelle
 * steht. Eine Zahl ist eine Zahl, ein Datum ist eine Zahl mit einem
 * Datumsformat, ein Wahrheitswert ist als solcher hinterlegt. Diese Auskunft
 * wird mitgenommen statt weggeworfen — Raten ist nur dort nötig, wo nichts
 * hinterlegt ist (SPEC-03: explizite Definition vor automatischer Erkennung).
 *
 * Deshalb liefert der Leser keine nackten Texte, sondern Zellen mit dem, was
 * die Datei über sie sagt.
 */
export interface XlsxSheet {
  name: string;
  rows: Cell[][];
}

export interface Workbook {
  sheets: XlsxSheet[];
  notes: string[];
}

/** Eingebaute Zahlenformate, die ein Datum oder eine Uhrzeit bedeuten. */
const DATUMSFORMATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export function readXlsx(bytes: Buffer): Workbook {
  const teile = readZip(bytes);
  const notes: string[] = [];

  const workbookXml = text(teile, 'xl/workbook.xml');
  const beziehungen = leseBeziehungen(text(teile, 'xl/_rels/workbook.xml.rels', ''));
  const texte = leseSharedStrings(text(teile, 'xl/sharedStrings.xml', ''));
  const formate = leseStyles(text(teile, 'xl/styles.xml', ''));
  const seit1904 = /date1904="(1|true)"/.test(workbookXml);

  if (seit1904) {
    notes.push('Diese Mappe rechnet Datumsangaben ab 1904; das wird berücksichtigt');
  }

  const sheets: XlsxSheet[] = [];

  for (const eintrag of leseBlattliste(workbookXml)) {
    const ziel = beziehungen.get(eintrag.rid);

    if (!ziel) {
      notes.push(`Für das Blatt „${eintrag.name}" fehlt die Zuordnung zu einer Datei; es wird übergangen`);
      continue;
    }

    const pfad = ziel.startsWith('/') ? ziel.slice(1) : `xl/${ziel}`;
    const blattXml = teile.get(pfad);

    if (!blattXml) {
      notes.push(`Das Blatt „${eintrag.name}" verweist auf „${pfad}", was es im Archiv nicht gibt`);
      continue;
    }

    sheets.push({ name: eintrag.name, rows: leseBlatt(blattXml.toString('utf-8'), texte, formate, seit1904) });
  }

  return { sheets, notes };
}

function text(teile: Map<string, Buffer>, name: string, ersatz?: string): string {
  const inhalt = teile.get(name);

  if (!inhalt) {
    if (ersatz === undefined) {
      throw new Error(`Das ist keine XLSX-Mappe: „${name}" fehlt im Archiv`);
    }

    return ersatz;
  }

  return inhalt.toString('utf-8');
}

// ---------------------------------------------------------------------------
// Die einzelnen Teile
// ---------------------------------------------------------------------------

function leseBlattliste(xml: string): { name: string; rid: string }[] {
  return [...xml.matchAll(/<sheet\b([^>]*)\/?>/g)]
    .map((treffer) => {
      const attribute = leseAttribute(treffer[1]);

      return { name: entziffere(attribute.name ?? ''), rid: attribute['r:id'] ?? attribute.id ?? '' };
    })
    .filter((eintrag) => eintrag.name !== '');
}

function leseBeziehungen(xml: string): Map<string, string> {
  const beziehungen = new Map<string, string>();

  for (const treffer of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attribute = leseAttribute(treffer[1]);

    if (attribute.Id && attribute.Target) {
      beziehungen.set(attribute.Id, entziffere(attribute.Target));
    }
  }

  return beziehungen;
}

function leseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((treffer) =>
    // Ein Eintrag kann in mehrere Abschnitte zerfallen, wenn Teile des Textes
    // anders formatiert sind. Zusammen ergeben sie den Wert der Zelle.
    [...treffer[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((stueck) => entziffere(stueck[1])).join('')
  );
}

/** Je Zellformat: ob es ein Datum bedeutet. */
function leseStyles(xml: string): boolean[] {
  const eigene = new Map<number, string>();

  for (const treffer of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const attribute = leseAttribute(treffer[1]);
    const nummer = Number(attribute.numFmtId);

    if (Number.isFinite(nummer)) {
      eigene.set(nummer, entziffere(attribute.formatCode ?? ''));
    }
  }

  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);

  if (!block) {
    return [];
  }

  return [...block[1].matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((treffer) => {
    const nummer = Number(leseAttribute(treffer[1]).numFmtId ?? '0');

    if (DATUMSFORMATE.has(nummer)) {
      return true;
    }

    const eigenes = eigene.get(nummer);

    return eigenes === undefined ? false : istDatumsformat(eigenes);
  });
}

/**
 * Ob ein eigenes Zahlenformat ein Datum meint. Geprüft wird außerhalb von
 * Anführungszeichen — in `"Monat" 0` steht ein m, das keines ist.
 */
export function istDatumsformat(formatCode: string): boolean {
  let inText = false;

  for (let stelle = 0; stelle < formatCode.length; stelle += 1) {
    const zeichen = formatCode[stelle];

    if (zeichen === '"') {
      inText = !inText;
      continue;
    }

    if (zeichen === '\\') {
      stelle += 1;
      continue;
    }

    if (!inText && 'ymdhs'.includes(zeichen.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function leseBlatt(xml: string, texte: string[], formate: boolean[], seit1904: boolean): Cell[][] {
  const zeilen: Cell[][] = [];

  for (const zeile of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const nummer = Number(leseAttribute(zeile[1]).r ?? zeilen.length + 1);
    const zellen: Cell[] = [];

    for (const zelle of (zeile[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attribute = leseAttribute(zelle[1]);
      const spalte = spaltenIndex(attribute.r ?? '');

      while (zellen.length < spalte) {
        zellen.push({ text: '', declared: 'EMPTY' });
      }

      zellen.push(leseZelle(attribute, zelle[2] ?? '', texte, formate, seit1904));
    }

    // Fehlende Zeilen zwischen zwei gefüllten bleiben leer, statt zu fehlen.
    while (zeilen.length < nummer - 1) {
      zeilen.push([]);
    }

    zeilen.push(zellen);
  }

  return zeilen;
}

function leseZelle(
  attribute: Record<string, string>,
  inhalt: string,
  texte: string[],
  formate: boolean[],
  seit1904: boolean
): Cell {
  const art = attribute.t ?? 'n';
  const wert = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inhalt)?.[1];

  if (art === 'inlineStr') {
    const stuecke = [...inhalt.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((treffer) => entziffere(treffer[1]));

    return zelle(stuecke.join(''), 'STRING');
  }

  if (wert === undefined) {
    return { text: '', declared: 'EMPTY' };
  }

  switch (art) {
    case 's': {
      const index = Number(wert);
      return zelle(texte[index] ?? '', 'STRING');
    }
    case 'str':
      return zelle(entziffere(wert), 'STRING');
    case 'b':
      return zelle(wert === '1' ? 'true' : 'false', 'BOOLEAN');
    case 'e':
      // Ein Fehlerwert in der Zelle (#NV, #DIV/0!) ist kein Text und keine
      // Zahl; er wird als das durchgereicht, was er ist.
      return zelle(entziffere(wert), 'ERROR');
    default: {
      const stil = Number(attribute.s ?? '0');

      if (formate[stil]) {
        const datum = alsDatum(Number(wert), seit1904);

        return datum ? zelle(datum, 'DATE') : zelle(wert, 'NUMBER');
      }

      return zelle(wert, 'NUMBER');
    }
  }
}

function zelle(text: string, declared: DeclaredType): Cell {
  return text.trim() === '' ? { text, declared: 'EMPTY' } : { text, declared };
}

/**
 * Aus der Excel-Tageszahl ein Datum in ISO-Schreibweise.
 *
 * Excel zählt ab dem 1. Januar 1900 und kennt dabei einen 29. Februar 1900,
 * den es nie gab — ein Fehler, der aus Lotus 1-2-3 übernommen wurde und aus
 * Verträglichkeitsgründen geblieben ist. Ab Tageszahl 61 verschiebt er alles
 * um einen Tag; wer ihn nicht berücksichtigt, liest jedes Datum nach dem
 * 28. Februar 1900 um einen Tag falsch.
 *
 * In ISO, weil ein Datum aus einer Tabelle keine Lesart mehr braucht: Die
 * Mehrdeutigkeit von 04/03 gibt es hier gar nicht.
 */
export function alsDatum(tageszahl: number, seit1904 = false): string | undefined {
  if (!Number.isFinite(tageszahl) || tageszahl < 0) {
    return undefined;
  }

  const grundlage = seit1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const versatz = seit1904 ? 0 : tageszahl >= 61 ? -1 : 0;
  const ganze = Math.floor(tageszahl);
  const anteil = tageszahl - ganze;

  const moment = new Date(grundlage + (ganze + versatz - (seit1904 ? 0 : 1) + 1) * 86_400_000);

  if (Number.isNaN(moment.getTime())) {
    return undefined;
  }

  const datum = moment.toISOString().slice(0, 10);

  if (anteil === 0) {
    return datum;
  }

  const sekunden = Math.round(anteil * 86_400);
  const uhrzeit = new Date(sekunden * 1000).toISOString().slice(11, 19);

  return `${datum}T${uhrzeit}`;
}

// ---------------------------------------------------------------------------
// XML von Hand — nur so viel, wie diese Teile brauchen
// ---------------------------------------------------------------------------

function leseAttribute(roh: string): Record<string, string> {
  const attribute: Record<string, string> = {};

  for (const treffer of roh.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attribute[treffer[1]] = treffer[2];
  }

  return attribute;
}

export function entziffere(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (ganz, name: string) => {
    switch (name) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const nummer = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

        return Number.isFinite(nummer) ? String.fromCodePoint(nummer) : ganz;
      }
    }
  });
}

export function spaltenIndex(bezug: string): number {
  const buchstaben = /^([A-Za-z]+)/.exec(bezug)?.[1];

  if (!buchstaben) {
    return 0;
  }

  let index = 0;

  for (const zeichen of buchstaben.toUpperCase()) {
    index = index * 26 + (zeichen.charCodeAt(0) - 64);
  }

  return index - 1;
}

/**
 * Ein Tabellenblatt durch die Data-Discovery-Engine schicken.
 *
 * Damit gilt für Excel dasselbe wie für einen E-Mail-Text: Die Daten müssen
 * nicht in A1 beginnen. Ein Blatt mit zwei Zeilen Überschrift, einer
 * Leerzeile und dann der Tabelle ist der Normalfall in freier Wildbahn und
 * kein Sonderfall.
 *
 * Übergeben wird der angezeigte Text der Zellen. Was die Mappe über die Typen
 * weiß, geht dabei nicht verloren: Ein Datum steht dank des Lesers schon in
 * ISO-Schreibweise da, und die ist eindeutig.
 */
export function discoverSheet(sheet: XlsxSheet, options: DiscoveryOptions): DiscoveryResult {
  return discoverFields(
    sheet.rows.map((zeile) => zeile.map((zelle) => zelle.text)),
    options
  );
}
