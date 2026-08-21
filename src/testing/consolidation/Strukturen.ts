import { DEFAULT_REGION, type Region } from '../../domain/tenants/Region.js';
import type { Encoding } from '../../infrastructure/formats/Csv.js';
import type { Feld } from '../../infrastructure/formats/FixedWidth.js';

/**
 * Der Fallkatalog für feste Feldbreiten, JSON und XML.
 *
 * Getrennt von `Faelle.ts`, weil die Fragen andere sind. Bei CSV geht es darum,
 * was UniCom **erkennen** muss — Trennzeichen, Kopfzeile, Zeichensatz. Hier
 * steht die Struktur meist fest, und es geht darum, was beim Flachlegen
 * **erhalten** bleibt: Attribute, Verschachtelung, Typen, Nullen vor einer
 * Kundennummer.
 *
 * `loesbar: false` heißt auch hier: An dieser Stelle *muss* UniCom nachfragen
 * oder ausdrücklich melden, statt sich für eine Lesart zu entscheiden.
 */
export type Format = 'FIXED' | 'JSON' | 'XML';

export interface Strukturfall {
  /** Dateiname ohne Endung. */
  name: string;
  format: Format;
  zweck: string;
  loesbar: boolean;
  region: Region;
  encoding: Encoding;
  inhalt: string;
  /** Nur bei festen Feldbreiten: die Beschreibung, ohne die nichts geht. */
  felder?: readonly Feld[];
  erwartet: {
    fields?: string[];
    zeilen?: number;
    /** Die erste Datenzeile, Feld für Feld. */
    ersteZeile?: string[];
    /** Ein Textstück, das in den Meldungen vorkommen muss. */
    meldung?: string;
    /** Der Leser muss die Datei abweisen, und die Meldung muss das enthalten. */
    abgewiesen?: string;
  };
}

const KUNDEN_FELDER: readonly Feld[] = [
  { name: 'Kundennummer', start: 1, laenge: 5, ausrichtung: 'RECHTS', fuellzeichen: '0' },
  { name: 'Nachname', start: 6, laenge: 20 },
  { name: 'Vorname', start: 26, laenge: 15 },
  { name: 'Geburtsdatum', start: 41, laenge: 10 },
];

function fest(nummer: string, nachname: string, vorname: string, datum: string): string {
  return nummer.padStart(5, '0') + nachname.padEnd(20) + vorname.padEnd(15) + datum.padEnd(10);
}

export const STRUKTURFAELLE: readonly Strukturfall[] = [
  {
    name: 'fixed-kunden-de',
    format: 'FIXED',
    zweck: 'Das Beispiel aus SPEC-03 §6.2: Position und Länge, rechtsbündige Nummer mit führenden Nullen',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    felder: KUNDEN_FELDER,
    inhalt: [
      fest('4711', 'Mustermann', 'Anna', '01.03.1980'),
      fest('4712', 'Berger', 'Bernd', '15.11.1975'),
      fest('99', 'Öztürk', 'Yusuf', '30.06.1992'),
    ].join('\r\n'),
    erwartet: {
      fields: ['Kundennummer', 'Nachname', 'Vorname', 'Geburtsdatum'],
      zeilen: 3,
      ersteZeile: ['4711', 'Mustermann', 'Anna', '01.03.1980'],
    },
  },
  {
    name: 'fixed-abgeschnitten',
    format: 'FIXED',
    zweck: 'Zeilen ohne abschließende Leerzeichen — häufig, harmlos, und trotzdem zu melden',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    felder: KUNDEN_FELDER,
    inhalt: ['00042Kurz', fest('4712', 'Berger', 'Bernd', '15.11.1975')].join('\n'),
    erwartet: {
      zeilen: 2,
      ersteZeile: ['42', 'Kurz', '', ''],
      meldung: 'kürzer als die beschriebenen',
    },
  },
  {
    name: 'fixed-umlaute-verschieben',
    format: 'FIXED',
    zweck: 'Umlaute in UTF-8: Byte- und Zeichenposition laufen auseinander. Hier muss UniCom warnen',
    loesbar: false,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    felder: KUNDEN_FELDER,
    inhalt: fest('4711', 'Müller-Lüdenscheidt', 'Jürgen', '01.03.1980'),
    erwartet: { meldung: 'mehr als ein Byte' },
  },
  {
    name: 'json-bestellungen',
    format: 'JSON',
    zweck: 'Verschachtelte Objekte und Listen; die Typen kommen aus der Datei und werden nicht geraten',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: JSON.stringify(
      {
        erzeugt: '2026-08-19',
        bestellungen: [
          {
            nr: 1001,
            kunde: { id: 4711, name: 'Mustermann', adresse: { ort: 'Köln', plz: '50667' } },
            positionen: [{ artikel: 'Schraube M8', menge: 500 }],
            bezahlt: true,
          },
          {
            nr: 1002,
            kunde: { id: 4712, name: 'Berger', adresse: { ort: 'Bonn', plz: '53111' } },
            positionen: [{ artikel: 'Mutter M8', menge: 500 }],
            bezahlt: false,
          },
        ],
      },
      null,
      2
    ),
    erwartet: {
      fields: [
        'nr',
        'kunde.id',
        'kunde.name',
        'kunde.adresse.ort',
        'kunde.adresse.plz',
        'positionen[0].artikel',
        'positionen[0].menge',
        'bezahlt',
      ],
      zeilen: 2,
      meldung: 'stehen unter „bestellungen"',
    },
  },
  {
    name: 'json-zwei-listen',
    format: 'JSON',
    zweck: 'Zwei gleich lange Listen: Kunden oder Lieferanten? Diese Wahl darf UniCom nicht allein treffen',
    loesbar: false,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: JSON.stringify({
      kunden: [{ nr: 1 }, { nr: 2 }],
      lieferanten: [{ nr: 8 }, { nr: 9 }],
    }),
    erwartet: { meldung: 'Mehrere Listen sind gleich lang' },
  },
  {
    name: 'json-luecken',
    format: 'JSON',
    zweck: 'Datensätze mit unterschiedlichen Feldern — die Feldliste ist die Vereinigung, nicht der erste Satz',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: JSON.stringify([{ nr: 1, ort: 'Köln' }, { nr: 2, ort: 'Bonn', hinweis: 'Neukunde' }]),
    erwartet: { fields: ['nr', 'ort', 'hinweis'], zeilen: 2, meldung: 'nicht alle 3 Felder' },
  },
  {
    name: 'xml-bestellungen',
    format: 'XML',
    zweck: 'Attribute als eigene Felder (SPEC-03 §8), verschachtelte Elemente flachgelegt',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<bestellungen>',
      '  <bestellung nr="1001">',
      '    <kunde id="4711">Mustermann</kunde>',
      '    <adresse><ort>Köln</ort><plz>50667</plz></adresse>',
      '    <betrag>1.234,50</betrag>',
      '  </bestellung>',
      '  <bestellung nr="1002">',
      '    <kunde id="4712">Berger</kunde>',
      '    <adresse><ort>Bonn</ort><plz>53111</plz></adresse>',
      '    <betrag>89,00</betrag>',
      '  </bestellung>',
      '</bestellungen>',
    ].join('\n'),
    erwartet: {
      fields: ['@nr', 'kunde.@id', 'kunde', 'adresse.ort', 'adresse.plz', 'betrag'],
      zeilen: 2,
      ersteZeile: ['1001', '4711', 'Mustermann', 'Köln', '50667', '1.234,50'],
    },
  },
  {
    name: 'xml-namensraeume',
    format: 'XML',
    zweck: 'Zwei Namensräume mit gleichem Elementnamen — sie zusammenzuwerfen wäre Datenverlust',
    loesbar: false,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<liste xmlns:k="urn:kunde" xmlns:l="urn:lieferant">',
      '  <zeile><k:name>Mustermann</k:name><l:name>Schrauben AG</l:name></zeile>',
      '  <zeile><k:name>Berger</k:name><l:name>Muttern GmbH</l:name></zeile>',
      '</liste>',
    ].join('\n'),
    erwartet: { fields: ['k:name', 'l:name'], zeilen: 2, meldung: 'Namensraumpräfixe' },
  },
  {
    name: 'xml-entitaeten',
    format: 'XML',
    zweck: 'XXE: Eine Datei mit eigenen Entitäten. Sie darf nicht gelesen werden, auch nicht teilweise',
    loesbar: false,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: [
      '<?xml version="1.0"?>',
      '<!DOCTYPE liste [',
      '  <!ENTITY geheim SYSTEM "file:///etc/passwd">',
      ']>',
      '<liste><zeile>&geheim;</zeile></liste>',
    ].join('\n'),
    erwartet: { abgewiesen: 'deklariert eigene Entitäten' },
  },
  {
    name: 'xml-ein-datensatz',
    format: 'XML',
    zweck: 'Eine Datei mit genau einer Bestellung — ein gewöhnlicher Fall und kein Fehler',
    loesbar: true,
    region: DEFAULT_REGION,
    encoding: 'utf-8',
    inhalt: '<?xml version="1.0" encoding="UTF-8"?>\n<bestellung nr="1"><ort>Köln</ort></bestellung>',
    erwartet: { fields: ['@nr', 'ort'], zeilen: 1, meldung: 'ein einzelner Datensatz' },
  },
];

/** Die Endung, unter der ein Fall auf der Platte landet. */
export const ENDUNG: Record<Format, string> = { FIXED: 'txt', JSON: 'json', XML: 'xml' };

/** Was in diesem Katalog noch fehlt — offen ausgewiesen statt verschwiegen. */
export const STRUKTUREN_OFFEN: readonly string[] = [
  'Feste Feldbreiten mit Feldern, die lückenlos aneinanderstoßen — der Vorschlag findet sie nicht',
  'JSON mit einem Schema zur Prüfung (SPEC-03 §7, „optional")',
  'XML mit XSD-Prüfung (SPEC-03 §8, „optional")',
  'Schreiben mit festen Feldbreiten — gelesen wird es, geschrieben noch nicht',
];
