import { DEFAULT_REGION, type Region } from '../../domain/tenants/Region.js';
import type { Sheet } from './Xlsx.js';

/**
 * Der Fallkatalog für Excel-Arbeitsmappen.
 *
 * Getrennt von den CSV-Fällen, weil Excel eine Frage mitbringt, die eine
 * einzelne Datei nicht kennt: Ein Blatt kann ein eigener Datenbestand sein,
 * mehrere Blätter können zusammengehören, und welches davon gilt, sieht man
 * ihnen nicht an (SPEC-03, Abschnitt 5).
 *
 * Die Erwartungen stehen schon hier. Geprüft werden sie, sobald der Leser
 * gebaut ist — bis dahin sind es Dateien für die Hand und eine Beschreibung
 * dessen, was der Leser können muss.
 */
export interface Mappe {
  name: string;
  zweck: string;
  loesbar: boolean;
  region: Region;
  sheets: readonly Sheet[];
  erwartet: {
    /** Blattnamen in der Reihenfolge der Mappe. */
    blaetter?: string[];
    /** Blattname → Feldname → erwarteter Typ. */
    typen?: Record<string, Record<string, string>>;
    /** Was ein Mensch entscheiden muss. */
    unsicher?: string[];
  };
}

const DE = DEFAULT_REGION;

export const MAPPEN: readonly Mappe[] = [
  {
    name: '17-mehrere-blaetter',
    zweck: 'Drei zusammengehörige Blätter, über die Kundennummer verbunden',
    loesbar: true,
    region: DE,
    sheets: [
      {
        name: 'Kunden',
        rows: [
          ['Kundennr', 'Name', 'Ort'],
          [1001, 'Berger GmbH', 'Köln'],
          [1002, 'Schmitt KG', 'Würzburg'],
          [1003, 'Weber AG', 'München'],
        ],
      },
      {
        name: 'Adressen',
        rows: [
          ['KundenID', 'Straße', 'PLZ'],
          [1001, 'Hauptstr. 1', '50667'],
          [1002, 'Marktplatz 3', '97070'],
          [1003, 'Bahnhofstr. 7', '80331'],
        ],
      },
      {
        name: 'Umsätze 2026',
        rows: [
          ['KundenID', 'Betrag', 'Datum'],
          [1001, 1234.56, { datum: '2026-03-04' }],
          [1002, 89.9, { datum: '2026-01-15' }],
          [1003, 12500, { datum: '2026-02-28' }],
        ],
      },
    ],
    erwartet: {
      blaetter: ['Kunden', 'Adressen', 'Umsätze 2026'],
      typen: {
        Kunden: { Kundennr: 'INTEGER', Name: 'STRING', Ort: 'STRING' },
        'Umsätze 2026': { KundenID: 'INTEGER', Betrag: 'DECIMAL', Datum: 'DATE' },
      },
    },
  },
  {
    name: '18-blaetter-gleicher-struktur',
    zweck: 'Drei Blätter mit derselben Struktur - Filialen, die gesammelt werden sollen',
    loesbar: true,
    region: DE,
    sheets: [
      {
        name: 'Nord',
        rows: [
          ['Kundennr', 'Name', 'Umsatz'],
          [1001, 'Berger GmbH', 1234.56],
          [1002, 'Schmitt KG', 89.9],
        ],
      },
      {
        name: 'Süd',
        rows: [
          ['Kundennr', 'Name', 'Umsatz'],
          [2001, 'Weber AG', 12500],
          [2002, 'Klein & Co', 7.5],
        ],
      },
      {
        name: 'West',
        rows: [
          ['Kundennr', 'Name', 'Umsatz'],
          [3001, 'Hoffmann', 450],
        ],
      },
    ],
    erwartet: { blaetter: ['Nord', 'Süd', 'West'] },
  },
  {
    name: '19-blatt-mit-vorspann',
    zweck: 'Ein Blatt beginnt nicht in A1, sondern nach zwei Zeilen Überschrift',
    loesbar: false,
    region: DE,
    sheets: [
      {
        name: 'Auswertung',
        rows: [
          ['Auswertung Vertrieb'],
          ['Stand: 19.08.2026'],
          [],
          ['Kundennr', 'Name', 'Umsatz'],
          [1001, 'Berger GmbH', 1234.56],
          [1002, 'Schmitt KG', 89.9],
        ],
      },
    ],
    erwartet: {
      unsicher: ['Wo die Daten beginnen - die ersten Zeilen sind keine Kopfzeile'],
    },
  },
  {
    name: '20-leeres-blatt-dazwischen',
    zweck: 'Ein leeres Blatt zwischen zwei gefüllten darf die Zuordnung nicht verschieben',
    loesbar: true,
    region: DE,
    sheets: [
      {
        name: 'Kunden',
        rows: [
          ['Kundennr', 'Name'],
          [1001, 'Berger GmbH'],
        ],
      },
      { name: 'Tabelle2', rows: [] },
      {
        name: 'Umsätze',
        rows: [
          ['Kundennr', 'Betrag'],
          [1001, 1234.56],
        ],
      },
    ],
    erwartet: { blaetter: ['Kunden', 'Tabelle2', 'Umsätze'] },
  },
  {
    name: '21-datum-als-text',
    zweck: 'Datumsangaben, die als Text in der Mappe stehen - der Rückweg aus einem Fremdsystem',
    loesbar: true,
    region: DE,
    sheets: [
      {
        name: 'Rechnungen',
        rows: [
          ['Nummer', 'Datum', 'Betrag'],
          [4711, '04.03.2026', 1234.56],
          [4712, '15.01.2026', 89.9],
          [4713, '28.02.2026', 12500],
        ],
      },
    ],
    erwartet: {
      blaetter: ['Rechnungen'],
      typen: { Rechnungen: { Nummer: 'INTEGER', Datum: 'DATE', Betrag: 'DECIMAL' } },
    },
  },
];
