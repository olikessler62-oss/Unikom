import type { Cell } from '../../domain/consolidation/Cell.js';
import { decode, detectEncoding, type Encoding } from './Csv.js';
import type { Gelesen } from './Bestand.js';
import { alsElementname, istElementname, zerlegePfad } from './Pfade.js';

/**
 * XML lesen (SPEC-03, Abschnitt 8).
 *
 * Ein eigener Leser und keine fremde Bibliothek — aus demselben Grund wie beim
 * ZIP und beim XLSX: Unikom läuft im Haus des Kunden, und was dort mitläuft,
 * verantwortet der Hersteller. Ein XML-Parser aus dem Netz bringt seine
 * Abhängigkeiten und seine Lücken mit; dieser hier kann genau das, was die Spec
 * verlangt, und **nichts darüber hinaus**.
 *
 * ## Sicherheit ist hier keine Einstellung, sondern eine Auslassung
 *
 * XXE — das Einschleusen fremder Inhalte über Entitäten — ist die bekannteste
 * Lücke beim XML-Lesen. Übliche Parser können externe Entitäten auflösen und
 * müssen davon abgehalten werden; wer die Einstellung vergisst, liest dem
 * Angreifer die Passwortdatei vor.
 *
 * Dieser Leser **kennt** keine Entitätsdeklarationen. Eine Datei, die welche
 * mitbringt, wird abgewiesen und nicht etwa stillschweigend ohne sie gelesen —
 * das Ergebnis wäre sonst ein anderes als das, was dort steht. Damit ist
 * zugleich die Milliarden-Lacher-Falle zu, denn auch die braucht Deklarationen.
 */
export interface XmlElement {
  /** Der Name, wie er in der Datei steht — mit Präfix, wenn eines da ist. */
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  /** Der zusammengesetzte Text dieses Elements, ohne den seiner Kinder. */
  text: string;
}

const ZEICHEN: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/**
 * Löst die fünf Zeichenverweise auf, die XML selbst mitbringt, dazu die
 * numerischen. Alles andere ist ein Verweis auf eine Entität, die es hier nicht
 * gibt — und wird als Fehler gemeldet, statt als Text durchzurutschen.
 */
function aufloesen(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (ganzes, verweis: string) => {
    if (verweis.startsWith('#x') || verweis.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(verweis.slice(2), 16));
    }

    if (verweis.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(verweis.slice(1), 10));
    }

    const bekannt = ZEICHEN[verweis];

    if (bekannt === undefined) {
      throw new Error(
        `Die Datei verweist auf die Entität „${ganzes}", die dieser Leser nicht kennt. ` +
          'Eigene Entitäten werden bewusst nicht unterstützt - über sie wird fremder Inhalt eingeschleust'
      );
    }

    return bekannt;
  });
}

class Leser {
  private stelle = 0;

  constructor(private readonly text: string) {}

  parse(): XmlElement {
    this.prolog();

    const wurzel = this.element();

    this.raum();

    return wurzel;
  }

  /** Deklaration, Kommentare, Verarbeitungsanweisungen und die Dokumenttypangabe. */
  private prolog(): void {
    for (;;) {
      this.raum();

      if (this.folgt('<?')) {
        this.bisNach('?>');
        continue;
      }

      if (this.folgt('<!--')) {
        this.bisNach('-->');
        continue;
      }

      if (this.folgt('<!DOCTYPE')) {
        this.doctype();
        continue;
      }

      return;
    }
  }

  /**
   * Die Dokumenttypangabe wird übersprungen — aber erst, nachdem geprüft ist,
   * dass sie keine Entität deklariert.
   */
  private doctype(): void {
    const ende = this.text.indexOf('>', this.stelle);
    const klammer = this.text.indexOf('[', this.stelle);
    const schluss =
      klammer >= 0 && klammer < ende ? this.text.indexOf('>', this.text.indexOf(']', klammer)) : ende;

    if (schluss < 0) {
      throw new Error('Die Dokumenttypangabe ist nicht abgeschlossen');
    }

    const inhalt = this.text.slice(this.stelle, schluss);

    if (/<!ENTITY/i.test(inhalt)) {
      throw new Error(
        'Diese Datei deklariert eigene Entitäten. Unikom liest solche Dateien nicht: ' +
          'Über Entitäten wird fremder Inhalt eingeschleust (XXE), und ohne sie zu lesen ergäbe ' +
          'einen anderen Inhalt als den, der dort steht'
      );
    }

    this.stelle = schluss + 1;
  }

  private element(): XmlElement {
    if (!this.folgt('<')) {
      throw new Error(`An Position ${this.stelle} wird ein Element erwartet`);
    }

    this.stelle += 1;

    const name = this.name();
    const attrs = new Map<string, string>();

    for (;;) {
      this.raum();

      if (this.text.startsWith('/>', this.stelle)) {
        this.stelle += 2;
        return { name, attrs, children: [], text: '' };
      }

      if (this.text.startsWith('>', this.stelle)) {
        this.stelle += 1;
        break;
      }

      const attribut = this.name();

      this.raum();

      if (!this.text.startsWith('=', this.stelle)) {
        throw new Error(`Dem Attribut „${attribut}" in „${name}" fehlt der Wert`);
      }

      this.stelle += 1;
      this.raum();
      attrs.set(attribut, this.attributwert());
    }

    return this.inhalt(name, attrs);
  }

  private inhalt(name: string, attrs: Map<string, string>): XmlElement {
    const children: XmlElement[] = [];
    let text = '';

    for (;;) {
      if (this.stelle >= this.text.length) {
        throw new Error(`Das Element „${name}" wird nicht geschlossen`);
      }

      if (this.folgt('<![CDATA[')) {
        const ende = this.text.indexOf(']]>', this.stelle);

        if (ende < 0) {
          throw new Error(`Ein CDATA-Abschnitt in „${name}" wird nicht geschlossen`);
        }

        // Kein Auflösen: In CDATA steht alles wörtlich, das ist sein Zweck.
        text += this.text.slice(this.stelle + 9, ende);
        this.stelle = ende + 3;
        continue;
      }

      if (this.folgt('<!--')) {
        this.bisNach('-->');
        continue;
      }

      if (this.folgt('<?')) {
        this.bisNach('?>');
        continue;
      }

      if (this.folgt('</')) {
        this.stelle += 2;

        const geschlossen = this.name();

        this.raum();

        if (geschlossen !== name) {
          throw new Error(`„${name}" wird mit „${geschlossen}" geschlossen`);
        }

        if (!this.text.startsWith('>', this.stelle)) {
          throw new Error(`Dem Schlusszeichen von „${name}" fehlt das >`);
        }

        this.stelle += 1;
        return { name, attrs, children, text: text.trim() };
      }

      if (this.folgt('<')) {
        children.push(this.element());
        continue;
      }

      const naechstes = this.text.indexOf('<', this.stelle);
      const stueck = naechstes < 0 ? this.text.slice(this.stelle) : this.text.slice(this.stelle, naechstes);

      text += aufloesen(stueck);
      this.stelle = naechstes < 0 ? this.text.length : naechstes;
    }
  }

  private attributwert(): string {
    const anfuehrung = this.text[this.stelle];

    if (anfuehrung !== '"' && anfuehrung !== "'") {
      throw new Error(`Ein Attributwert an Position ${this.stelle} steht nicht in Anführungszeichen`);
    }

    const ende = this.text.indexOf(anfuehrung, this.stelle + 1);

    if (ende < 0) {
      throw new Error('Ein Attributwert wird nicht geschlossen');
    }

    const wert = this.text.slice(this.stelle + 1, ende);

    this.stelle = ende + 1;
    return aufloesen(wert);
  }

  private name(): string {
    const anfang = this.stelle;

    while (this.stelle < this.text.length && /[^\s/>=]/.test(this.text[this.stelle])) {
      this.stelle += 1;
    }

    if (this.stelle === anfang) {
      throw new Error(`An Position ${anfang} wird ein Name erwartet`);
    }

    return this.text.slice(anfang, this.stelle);
  }

  private raum(): void {
    while (this.stelle < this.text.length && /\s/.test(this.text[this.stelle])) {
      this.stelle += 1;
    }
  }

  private folgt(zeichen: string): boolean {
    return this.text.startsWith(zeichen, this.stelle);
  }

  private bisNach(zeichen: string): void {
    const ende = this.text.indexOf(zeichen, this.stelle);

    if (ende < 0) {
      throw new Error(`„${zeichen}" fehlt`);
    }

    this.stelle = ende + zeichen.length;
  }
}

export function parseXml(text: string): XmlElement {
  return new Leser(text).parse();
}

/** Die Kodierung aus der XML-Deklaration, falls sie eine nennt. */
export function encodingAusDeklaration(bytes: Uint8Array): Encoding | undefined {
  const kopf = new TextDecoder('latin1').decode(bytes.slice(0, 200));
  const gefunden = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(kopf);

  if (!gefunden) {
    return undefined;
  }

  const genannt = gefunden[1].toLowerCase();

  if (genannt === 'utf-8' || genannt === 'utf8') {
    return 'utf-8';
  }

  return genannt === 'windows-1252' || genannt === 'cp1252' || genannt === 'iso-8859-1' ? 'windows-1252' : undefined;
}

export type Praefixe = 'BEHALTEN' | 'ENTFERNEN';

export interface XmlOptions {
  encoding?: Encoding;
  /** Der Name des Elements, das einen Datensatz trägt. Ohne Angabe wird er gesucht. */
  datensatz?: string;
  /**
   * Ob Namensraumpräfixe in den Feldnamen stehen bleiben.
   *
   * Behalten ist die Voreinstellung: Zwei Namensräume dürfen dasselbe Element
   * enthalten, und `kunde:Name` und `lieferant:Name` sind dann zwei Felder.
   * Sie stillschweigend zu einem zu machen wäre ein Datenverlust.
   */
  praefixe?: Praefixe;
}

interface Kandidat {
  name: string;
  elemente: XmlElement[];
}

/**
 * Sucht das Element, das einen Datensatz trägt.
 *
 * Gesucht wird die größte Gruppe gleichnamiger Geschwister: In
 * `<orders><order/><order/></orders>` ist das `order`. Gibt es keine
 * Wiederholung, ist die Wurzel selbst der eine Datensatz — eine Datei mit genau
 * einer Bestellung ist ein gewöhnlicher Fall.
 */
function findeDatensaetze(wurzel: XmlElement): Kandidat | undefined {
  const kandidaten: Kandidat[] = [];

  const suche = (element: XmlElement): void => {
    const gruppen = new Map<string, XmlElement[]>();

    for (const kind of element.children) {
      const gruppe = gruppen.get(kind.name) ?? [];

      gruppe.push(kind);
      gruppen.set(kind.name, gruppe);
    }

    for (const [name, elemente] of gruppen) {
      if (elemente.length >= 2) {
        kandidaten.push({ name, elemente });
      }
    }

    for (const kind of element.children) {
      suche(kind);
    }
  };

  suche(wurzel);

  return [...kandidaten].sort((links, rechts) => rechts.elemente.length - links.elemente.length)[0];
}

function ohnePraefix(name: string): string {
  const doppelpunkt = name.indexOf(':');

  return doppelpunkt < 0 ? name : name.slice(doppelpunkt + 1);
}

/**
 * Legt ein Element flach.
 *
 * Attribute bekommen ein `@` (`Kunde.@id`, SPEC-03 §8), Kinder einen Punkt,
 * wiederholte Kinder einen Index. Der Weg zurück bleibt damit lesbar — das ist
 * der Sinn, denn aus einer flachen Struktur soll wieder eine verschachtelte
 * werden können.
 */
function flach(element: XmlElement, pfad: string, ziel: Map<string, Cell>, praefixe: Praefixe): void {
  for (const [name, wert] of element.attrs) {
    const feld = praefixe === 'ENTFERNEN' ? ohnePraefix(name) : name;

    ziel.set(pfad === '' ? `@${feld}` : `${pfad}.@${feld}`, { text: wert, declared: wert === '' ? 'EMPTY' : 'STRING' });
  }

  if (element.children.length === 0) {
    // Ein Blatt trägt seinen Text. Ohne Pfad wäre das die Wurzel selbst — dann
    // steht der Text unter ihrem Namen und nicht unter einem leeren Feld.
    const feld = pfad === '' ? (praefixe === 'ENTFERNEN' ? ohnePraefix(element.name) : element.name) : pfad;

    ziel.set(feld, { text: element.text, declared: element.text === '' ? 'EMPTY' : 'STRING' });
    return;
  }

  const zaehler = new Map<string, number>();

  for (const kind of element.children) {
    const gleiche = element.children.filter((geschwister) => geschwister.name === kind.name).length;
    const name = praefixe === 'ENTFERNEN' ? ohnePraefix(kind.name) : kind.name;
    const nummer = zaehler.get(kind.name) ?? 0;

    zaehler.set(kind.name, nummer + 1);

    const teil = gleiche > 1 ? `${name}[${nummer}]` : name;

    flach(kind, pfad === '' ? teil : `${pfad}.${teil}`, ziel, praefixe);
  }

  /*
   * Text neben Kindern — „gemischter Inhalt". Er kommt in Datendateien selten
   * vor, und wenn, dann meint ihn jemand. Er bekommt ein eigenes Feld, statt
   * fortgeworfen zu werden.
   */
  if (element.text !== '') {
    ziel.set(pfad === '' ? '#text' : `${pfad}.#text`, { text: element.text, declared: 'STRING' });
  }
}

export function readXml(bytes: Uint8Array, options: XmlOptions = {}): Gelesen {
  const encoding = options.encoding ?? encodingAusDeklaration(bytes) ?? detectEncoding(bytes);
  const wurzel = parseXml(decode(bytes, encoding));
  const praefixe = options.praefixe ?? 'BEHALTEN';
  const notes: string[] = [];

  const gefunden = options.datensatz
    ? { name: options.datensatz, elemente: alleMit(wurzel, options.datensatz) }
    : findeDatensaetze(wurzel);

  if (options.datensatz && gefunden!.elemente.length === 0) {
    throw new Error(`Ein Element „${options.datensatz}" kommt in dieser Datei nicht vor`);
  }

  const datensaetze = gefunden ? gefunden.elemente : [wurzel];

  notes.push(
    gefunden
      ? `Als Datensatz gelesen: „${gefunden.name}" (${datensaetze.length} Stück)`
      : 'Die Datei enthält kein wiederholtes Element; sie wird als ein einzelner Datensatz gelesen'
  );

  if (praefixe === 'BEHALTEN' && datensaetze.some((element) => hatPraefix(element))) {
    notes.push('Die Feldnamen tragen ihre Namensraumpräfixe. Sollen sie entfallen, gehört das ins Profil');
  }

  const zeilen = datensaetze.map((element) => {
    const felder = new Map<string, Cell>();

    flach(element, '', felder, praefixe);
    return felder;
  });

  const fields: string[] = [];

  for (const zeile of zeilen) {
    for (const name of zeile.keys()) {
      if (!fields.includes(name)) {
        fields.push(name);
      }
    }
  }

  const unvollstaendig = zeilen.filter((zeile) => zeile.size !== fields.length).length;

  if (unvollstaendig > 0) {
    notes.push(
      `${unvollstaendig} von ${zeilen.length} Datensätzen haben nicht alle ${fields.length} Felder; ` +
        'fehlende gelten als leer'
    );
  }

  return {
    fields,
    rows: zeilen.map((zeile) => fields.map((name) => zeile.get(name) ?? { text: '', declared: 'EMPTY' })),
    feststellungen: { kodierung: encoding, kopfzeile: false, spalten: fields.length },
    ragged: zeilen
      .map((zeile, index) => (zeile.size === fields.length ? 0 : index + 1))
      .filter((nummer) => nummer > 0),
    notes,
  };
}

function alleMit(element: XmlElement, name: string): XmlElement[] {
  const gefunden = element.name === name ? [element] : [];

  for (const kind of element.children) {
    gefunden.push(...alleMit(kind, name));
  }

  return gefunden;
}

function hatPraefix(element: XmlElement): boolean {
  return (
    element.name.includes(':') ||
    [...element.attrs.keys()].some((name) => name.includes(':')) ||
    element.children.some(hatPraefix)
  );
}

/* ---------- Der Weg zurück ---------- */

export interface XmlSchreibOptions {
  /** Das umschließende Element. Voreingestellt „daten". */
  wurzel?: string;
  /** Das Element je Datensatz. Voreingestellt „zeile". */
  datensatz?: string;
  /**
   * Wohin ein Feld gehört, wenn es nicht dorthin soll, wo sein Name es
   * hinstellt: `{ Ort: 'adresse.ort', Nr: '@nr' }`.
   *
   * Damit wird aus einer flachen Tabelle eine **definierte** XML-Struktur
   * (SPEC-03, Abschnitt 8). Ohne Angabe gilt der Feldname selbst als Pfad —
   * dann ist das Schreiben die genaue Umkehrung des Lesens.
   */
  zuordnung?: Record<string, string>;
  /** Eingerückt, wie man es einem Menschen gibt. Voreingestellt: ja. */
  eingerueckt?: boolean;
}

interface Knoten {
  name: string;
  attrs: Map<string, string>;
  kinder: Knoten[];
  text?: string;
  /** Nur zum Sortieren gleichnamiger Geschwister aus `pos[0]`, `pos[1]`. */
  stelle?: number;
}

/**
 * Was in XML nicht roh stehen darf.
 *
 * Fünf Zeichen, und alle fünf kommen in echten Daten vor: `Meier & Söhne`,
 * `a < b`, ein Anführungszeichen in einem Firmennamen. Wer sie durchlässt,
 * schreibt eine Datei, die kein Parser wieder aufmacht — und der Empfänger
 * merkt es, nicht der Absender.
 */
function schuetze(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function kindMit(eltern: Knoten, name: string, stelle: number | undefined): Knoten {
  const gefunden = eltern.kinder.find((kind) => kind.name === name && kind.stelle === stelle);

  if (gefunden) {
    return gefunden;
  }

  const neu: Knoten = { name, attrs: new Map(), kinder: [], stelle };

  eltern.kinder.push(neu);
  return neu;
}

/**
 * Hängt einen Wert an seinen Platz im Baum.
 *
 * Ein Pfad, der auf ein Attribut endet, wird ein Attribut; alles andere wird
 * ein Element mit Text. Ein Name, der als Element nicht taugt, wird umbenannt
 * — und das steht danach in den Meldungen, statt still zu geschehen.
 */
function haenge(
  wurzel: Knoten,
  pfad: string,
  wert: string,
  leer: boolean,
  notes: Set<string>
): void {
  const glieder = zerlegePfad(pfad);
  let stand = wurzel;

  for (let stelle = 0; stelle < glieder.length; stelle += 1) {
    const glied = glieder[stelle];
    const letztes = stelle === glieder.length - 1;

    if (glied.art === 'ATTRIBUT') {
      if (!letztes) {
        notes.add(`„${pfad}": Ein Attribut kann keine Kinder haben; alles dahinter wurde übergangen`);
        return;
      }

      // Ein leeres Attribut wird nicht geschrieben. `nr=""` behauptet eine
      // Angabe, die es nicht gibt; ein fehlendes Attribut sagt dasselbe wie
      // ein fehlendes Element.
      if (!leer) {
        stand.attrs.set(benannt(glied.name, notes), wert);
      }

      return;
    }

    const name = benannt(glied.name, notes);

    stand = kindMit(stand, name, glied.art === 'STELLE' ? glied.index : undefined);

    if (letztes) {
      stand.text = leer ? '' : wert;
      return;
    }
  }
}

function benannt(name: string, notes: Set<string>): string {
  if (istElementname(name)) {
    return name;
  }

  const ersatz = alsElementname(name);

  notes.add(`„${name}" taugt nicht als XML-Name und wurde zu „${ersatz}"`);
  return ersatz;
}

function schreibe(knoten: Knoten, tiefe: number, eingerueckt: boolean): string[] {
  const einzug = eingerueckt ? '  '.repeat(tiefe) : '';
  const attribute = [...knoten.attrs]
    .map(([name, wert]) => ` ${name}="${schuetze(wert)}"`)
    .join('');

  if (knoten.kinder.length === 0) {
    // Leere Elemente stehen selbstschließend da: `<b/>` und nicht `<b></b>`.
    // Beides heißt dasselbe, und das kürzere liest sich als das, was es ist.
    return knoten.text === undefined || knoten.text === ''
      ? [`${einzug}<${knoten.name}${attribute}/>`]
      : [`${einzug}<${knoten.name}${attribute}>${schuetze(knoten.text)}</${knoten.name}>`];
  }

  return [
    `${einzug}<${knoten.name}${attribute}>`,
    ...knoten.kinder.flatMap((kind) => schreibe(kind, tiefe + 1, eingerueckt)),
    `${einzug}</${knoten.name}>`,
  ];
}

export function writeXml(gelesen: Gelesen, options: XmlSchreibOptions = {}): { text: string; notes: string[] } {
  const notes = new Set<string>();
  const wurzelname = benannt(options.wurzel ?? 'daten', notes);
  const satzname = benannt(options.datensatz ?? 'zeile', notes);
  const wurzel: Knoten = { name: wurzelname, attrs: new Map(), kinder: [] };

  for (const zeile of gelesen.rows) {
    const satz: Knoten = { name: satzname, attrs: new Map(), kinder: [] };

    gelesen.fields.forEach((feld, index) => {
      const zelle = zeile[index];

      if (zelle !== undefined) {
        haenge(satz, options.zuordnung?.[feld] ?? feld, zelle.text, zelle.declared === 'EMPTY', notes);
      }
    });

    wurzel.kinder.push(satz);
  }

  const eingerueckt = options.eingerueckt !== false;
  const zeilen = ['<?xml version="1.0" encoding="UTF-8"?>', ...schreibe(wurzel, 0, eingerueckt)];

  return { text: zeilen.join(eingerueckt ? '\n' : ''), notes: [...notes] };
}
