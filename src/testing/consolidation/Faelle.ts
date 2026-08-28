import type { FieldType } from '../../domain/consolidation/Recognition.js';
import { DEFAULT_REGION, type Region } from '../../domain/tenants/Region.js';
import type { Encoding } from '../../infrastructure/formats/Csv.js';

/**
 * Der Fallkatalog der Konsolidierung.
 *
 * Echte Kundendateien sind unersetzlich für das, woran niemand gedacht hat.
 * Für alles, woran wir gedacht haben, taugen sie nicht: Eine echte Datei ist
 * der Fall, aber sie sagt nicht, was darin richtig ist. Hier steht die
 * erwartete Antwort neben den Daten — deshalb ist der Katalog zugleich die
 * Beschreibung dessen, was UniCom können muss.
 *
 * `loesbar: true` heißt: Das muss UniCom ohne Rückfrage richtig machen.
 * `loesbar: false` heißt: Hier *muss* es nachfragen. Beides ist gleich wichtig —
 * ein System, das nie nachfragt, ist nicht klüger, sondern nur stiller.
 *
 * Der Katalog wird als Testgrundlage benutzt und lässt sich mit
 * `npm run testdaten` als echte Dateien ausschreiben.
 */
export interface Fall {
  /** Dateiname ohne Endung. */
  name: string;
  zweck: string;
  /** Ob UniCom den Fall allein lösen können muss. */
  loesbar: boolean;
  region: Region;
  /** Wie die Datei geschrieben wird. */
  encoding: Encoding;
  inhalt: string;
  erwartet: {
    encoding?: Encoding;
    delimiter?: string;
    delimiterCertain?: boolean;
    header?: boolean;
    fields?: string[];
    zeilen?: number;
    /** Zeilennummern mit abweichender Spaltenzahl. */
    ragged?: number[];
    /** Feldname → erkannter Typ. */
    typen?: Record<string, FieldType>;
    /** Felder, die als Prüffall an einen Menschen gehen müssen. */
    unsicher?: string[];
    /** Felder, bei denen ein Hinweis erwartet wird. */
    mitHinweis?: string[];
  };
}

const DE = DEFAULT_REGION;
const US: Region = { locale: 'en-US', timeZone: 'America/New_York' };

const TAB = '\t';

export const FAELLE: readonly Fall[] = [
  {
    name: '01-deutsch-standard',
    zweck: 'Der Regelfall: Semikolon, UTF-8, Kopfzeile, deutsche Zahlen und Daten',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Kundennr;Name;Betrag;Datum;Aktiv',
      '1001;Berger GmbH;1.234,56;04.03.2026;Ja',
      '1002;Schmitt KG;89,90;15.01.2026;Ja',
      '1003;Weber AG;12.500,00;28.02.2026;Nein',
      '1004;Klein & Co;7,50;01.12.2025;Ja',
      '1005;Hoffmann;450,00;19.08.2026;Nein',
    ].join('\n'),
    erwartet: {
      encoding: 'utf-8',
      delimiter: ';',
      delimiterCertain: true,
      header: true,
      fields: ['Kundennr', 'Name', 'Betrag', 'Datum', 'Aktiv'],
      zeilen: 5,
      typen: { Kundennr: 'INTEGER', Name: 'STRING', Betrag: 'DECIMAL', Datum: 'DATE', Aktiv: 'BOOLEAN' },
    },
  },
  {
    name: '02-amerikanisch-standard',
    zweck: 'Dieselbe Struktur amerikanisch: Komma trennt, Punkt ist das Dezimalzeichen',
    loesbar: true,
    region: US,
    encoding: 'utf-8',
    inhalt: [
      'CustomerNo,Name,Amount,Date,Active',
      '1001,Berger Inc,1234.56,03/04/2026,Yes',
      '1002,Schmitt LLC,89.90,01/15/2026,Yes',
      '1003,Weber Corp,12500.00,02/28/2026,No',
      '1004,Klein & Co,7.50,12/01/2025,Yes',
      '1005,Hoffmann,450.00,08/19/2026,No',
    ].join('\n'),
    erwartet: {
      delimiter: ',',
      delimiterCertain: true,
      header: true,
      typen: { CustomerNo: 'INTEGER', Amount: 'DECIMAL', Date: 'DATE', Active: 'BOOLEAN' },
    },
  },
  {
    name: '03-ohne-kopfzeile',
    zweck: 'Ohne Kopfzeile: Die Felder heißen nach ihrer Stelle, die Typen stimmen trotzdem',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      '1001;Berger GmbH;1.234,56',
      '1002;Schmitt KG;89,90',
      '1003;Weber AG;12.500,00',
      '1004;Klein & Co;7,50',
    ].join('\n'),
    erwartet: {
      header: false,
      fields: ['Spalte 1', 'Spalte 2', 'Spalte 3'],
      zeilen: 4,
      typen: { 'Spalte 1': 'INTEGER', 'Spalte 2': 'STRING', 'Spalte 3': 'DECIMAL' },
    },
  },
  {
    name: '04-windows-1252',
    zweck: 'Ein Altbestand in Windows-1252 - Umlaute dürfen nicht zu Fragezeichen werden',
    loesbar: true,
    region: DE,
    encoding: 'windows-1252',
    inhalt: [
      'Name;Ort;Betrag',
      'Müller GmbH;Köln;1.234,56',
      'Straßer KG;Würzburg;89,90',
      'Schröder AG;München;450,00',
    ].join('\n'),
    erwartet: {
      encoding: 'windows-1252',
      typen: { Name: 'STRING', Ort: 'STRING', Betrag: 'DECIMAL' },
    },
  },
  {
    name: '05-mit-bom',
    zweck: 'UTF-8 mit Byte Order Mark, wie Excel sie schreibt - das BOM gehört nicht ins erste Feld',
    loesbar: true,
    region: DE,
    encoding: 'utf-8-bom',
    inhalt: ['Kundennr;Name', '1001;Berger GmbH', '1002;Schmitt KG'].join('\n'),
    erwartet: {
      encoding: 'utf-8-bom',
      fields: ['Kundennr', 'Name'],
    },
  },
  {
    name: '06-textqualifizierer',
    zweck: 'Trennzeichen, Zeilenumbruch und Anführungszeichen im Text - alles in Anführungszeichen',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Name;Anschrift;Betrag',
      '"Meier; Sohn";"Hauptstr. 1\n12345 Köln";1.234,56',
      '"Die ""Alte"" Post";Marktplatz 3;89,90',
      'Klein;Bahnhofstr. 7;450,00',
    ].join('\n'),
    erwartet: {
      delimiter: ';',
      zeilen: 3,
      typen: { Name: 'STRING', Betrag: 'DECIMAL' },
    },
  },
  {
    name: '07-tabulator',
    zweck: 'Tabulator als Trennzeichen',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      ['Kundennr', 'Name', 'Betrag'].join(TAB),
      ['1001', 'Berger GmbH', '1.234,56'].join(TAB),
      ['1002', 'Schmitt KG', '89,90'].join(TAB),
      ['1003', 'Weber AG', '450,00'].join(TAB),
    ].join('\n'),
    erwartet: { delimiter: TAB, delimiterCertain: true, typen: { Kundennr: 'INTEGER', Betrag: 'DECIMAL' } },
  },
  {
    name: '08-leerwerte',
    zweck: 'Leere Felder und Platzhalter zählen nicht gegen den Typ (SPEC-02, Abschnitt 14)',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Kundennr;Rabatt;Bemerkung',
      '1001;12;',
      '1002;;N/A',
      '1003;-;',
      '1004;8;NULL',
      '1005;15;',
    ].join('\n'),
    erwartet: { typen: { Kundennr: 'INTEGER', Rabatt: 'INTEGER' } },
  },
  {
    name: '09-ein-ausreisser',
    zweck: 'Ein einzelner abweichender Wert in 40 kippt die Spalte nicht, wird aber gemeldet',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Kundennr;Betrag',
      ...Array.from({ length: 39 }, (_, index) => `${1000 + index};${(index + 1) * 10},50`),
      '1999;auf Anfrage',
    ].join('\n'),
    erwartet: { typen: { Kundennr: 'INTEGER', Betrag: 'DECIMAL' } },
  },
  {
    name: '10-zweistelliges-jahr',
    zweck: 'Zweistellige Jahreszahlen nach der Pivot-Regel (SPEC-02, Abschnitt 7)',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: ['Kundennr;Geburtstag', '1001;18.08.26', '1002;03.11.50', '1003;27.06.99', '1004;01.01.00'].join('\n'),
    erwartet: { typen: { Geburtstag: 'DATE' } },
  },
  {
    name: '11-zwei-zahlenformate',
    zweck: 'Die Hälfte deutsch, die Hälfte amerikanisch geschrieben - das ist keine Spalte, sondern zwei',
    loesbar: false,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Kundennr;Betrag',
      '1001;1.234,56',
      '1002;2.345,67',
      '1003;3.456,78',
      '1004;1,234.56',
      '1005;2,345.67',
      '1006;3,456.78',
    ].join('\n'),
    erwartet: { unsicher: ['Betrag'] },
  },
  {
    name: '12-datum-widerspricht-region',
    zweck: 'Ein Tag über zwölf in einer amerikanisch gelesenen Datei: kein Datum, sondern ein Prüffall',
    loesbar: false,
    region: US,
    encoding: 'utf-8',
    inhalt: [
      'Id,Date',
      '1,01/15/2026',
      '2,02/28/2026',
      '3,03/04/2026',
      '4,13/05/2026',
      '5,04/30/2026',
      '6,25/12/2026',
    ].join('\n'),
    erwartet: { unsicher: ['Date'] },
  },
  {
    name: '13-mehrdeutiges-datum',
    zweck: 'Alle Angaben sind unter beiden Lesarten gültig - lösbar, aber der Mensch muss es wissen',
    loesbar: true,
    region: DE,
    encoding: 'utf-8',
    inhalt: ['Id;Datum', '1;04/03/2026', '2;01/12/2026', '3;07/09/2026', '4;02/11/2026'].join('\n'),
    erwartet: { typen: { Datum: 'DATE' }, mitHinweis: ['Datum'] },
  },
  {
    name: '14-trennzeichen-mehrdeutig',
    zweck: 'Semikolon und Komma trennen beide gleichmäßig - das gehört ins Profil, nicht in eine Vermutung',
    loesbar: false,
    region: DE,
    encoding: 'utf-8',
    inhalt: ['a;b,c', '1;2,3', '4;5,6', '7;8,9'].join('\n'),
    erwartet: { delimiterCertain: false },
  },
  {
    name: '15-uneinheitliche-spalten',
    zweck: 'Eine Zeile hat ein Feld zu viel - ein Strukturfehler, der nicht stillschweigend verschwindet',
    loesbar: false,
    region: DE,
    encoding: 'utf-8',
    inhalt: [
      'Kundennr;Name;Betrag',
      '1001;Berger GmbH;1.234,56',
      '1002;Schmitt; KG;89,90',
      '1003;Weber AG;450,00',
    ].join('\n'),
    erwartet: { ragged: [3] },
  },
  {
    name: '16-nur-text',
    zweck: 'Alle Spalten sind Text - dann ist nicht erkennbar, ob die erste Zeile eine Kopfzeile ist',
    loesbar: false,
    region: DE,
    encoding: 'utf-8',
    inhalt: ['Name;Ort', 'Berger GmbH;Köln', 'Schmitt KG;Würzburg', 'Weber AG;München'].join('\n'),
    erwartet: { header: false },
  },
];

/**
 * Was der Katalog noch nicht abdeckt. Die Liste steht hier und nicht in einem
 * Ticket, weil sie sonst als „getestet" durchgeht.
 */
export const NOCH_OFFEN: readonly string[] = [
  'Excel lesen - die Mappen liegen als Fälle bereit (Mappen.ts), der Leser fehlt',
  'XLS, das alte Binärformat - noch nicht entschieden, siehe Bauplan',
  'Fixed-Width-TXT',
  'JSON und XML',
  'Währungs- und Prozentwerte (SPEC-02, Abschnitt 12 und 13)',
  'Uhrzeit, Datum mit Uhrzeit, Zeitstempel mit Zeitzone',
  'sehr große Dateien (Blockverarbeitung, SPEC-06 Abschnitt 15)',
  'Dubletten, Zusammenführung, Konflikte - ab Etappe 5',
];

/**
 * Schreibt den Inhalt eines Falls so, wie die Datei beim Kunden ankäme.
 *
 * Steht hier und nicht im Test: Sonst müsste das Werkzeug, das die Dateien
 * ausschreibt, aus einer Testdatei importieren — und führte damit bei jedem
 * Aufruf die Tests mit aus.
 */
export function alsBytes(inhalt: string, encoding: Encoding): Buffer {
  if (encoding === 'windows-1252') {
    // Für die Zeichen, um die es hier geht — Umlaute und ß —, liegt
    // Windows-1252 auf denselben Werten wie latin1.
    return Buffer.from(inhalt, 'latin1');
  }

  const nutzdaten = Buffer.from(inhalt, 'utf-8');

  return encoding === 'utf-8-bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), nutzdaten]) : nutzdaten;
}
