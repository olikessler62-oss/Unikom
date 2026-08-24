/**
 * Schreibt zwei Bestellungen als Excel-Dateien aus.
 *
 *   npm run bestellungen
 *   npm run bestellungen -- --ziel D:\Proben
 *
 * ## Wozu
 *
 * Zum Ausprobieren an einem Blatt, das **nicht** wie eine Tabelle gebaut ist.
 * Die Teilnehmerlisten daneben sind der freundliche Fall: Kopfzeile, Daten,
 * fertig. So sieht es in einem Einkauf selten aus.
 *
 * ## Wie so ein Blatt aussieht
 *
 * ```text
 * 1–3    Briefkopf: Haus, Bestellnummer, Datum
 * 4      leer
 * 5–6    zwei Sätze in Spalte A — Lieferbedingungen, Hinweise
 * 7      die Spaltenüberschriften
 * 8–10   drei Bestellzeilen
 * 11     leer
 * 12–16  fünf weitere Bestellzeilen, eine davon um eine Spalte versetzt
 * 17–19  drei Zeilen Fußtext in den ersten drei Spalten
 * ```
 *
 * ## Die versetzte Zeile
 *
 * Sie ist der Kern der Sache. Eine Zeile steht um eine Spalte weiter rechts —
 * jemand hat beim Einfügen eine Zelle verrutschen lassen. Für das Auge ist es
 * eine Bestellzeile wie jede andere; für eine Spaltenzuordnung steht dort die
 * Artikelnummer in der Spalte „Anzahl", und die Anzahl ist Text.
 *
 * Das ist kein Kunstfehler, den wir uns ausgedacht haben, sondern das, was
 * ankommt. Ein Zusammenführen, das sie stillschweigend übernimmt, schreibt
 * eine Bestellung mit einer Position, die niemand bestellt hat.
 *
 * ## Der Fußtext ist kein Datensatz
 *
 * „Zahlungsziel 30 Tage netto" steht in denselben drei Spalten wie eine
 * Bestellzeile. Wer nur zählt, wie viele Zeilen drei gefüllte Zellen haben,
 * bekommt drei Positionen zu viel.
 */
import fs from 'node:fs';
import path from 'node:path';

import { writeXlsx, type Sheet, type Zelle } from '../testing/consolidation/Xlsx.js';

interface Bestellung {
  datei: string;
  blatt: string;
  /** Der Briefkopf — drei Zeilen, jede in Spalte A. */
  kopf: [string, string, string];
  /** Zwei Sätze unter dem Briefkopf, ebenfalls in Spalte A. */
  hinweise: [string, string];
  /** Die Spaltenüberschriften der Positionen. */
  spalten: [string, string, string];
  /** Die drei Positionen des ersten Blocks. */
  erster: Position[];
  /** Die fünf Positionen des zweiten Blocks. */
  zweiter: Position[];
  /** Welche Position des zweiten Blocks verrutscht ist — von 0 an gezählt. */
  versetzt: number;
  /** Drei Zeilen Fußtext, je drei Zellen. */
  fuss: [string, string, string][];
}

interface Position {
  artikel: string;
  anzahl: number;
  beschreibung: string;
}

function pos(artikel: string, anzahl: number, beschreibung: string): Position {
  return { artikel, anzahl, beschreibung };
}

const BESTELLUNGEN: Bestellung[] = [
  {
    datei: 'Bestellung_4711_2026-03-02.xlsx',
    blatt: 'Bestellung',
    kopf: [
      'Muster & Partner GmbH — Zentraler Einkauf',
      'Bestellung Nr. 4711',
      'Bestelldatum: 02.03.2026',
    ],
    hinweise: [
      'Lieferung frei Haus. Anlieferung nur werktags zwischen 07:00 und 15:00 Uhr.',
      'Bitte die Bestellnummer auf Lieferschein und Rechnung angeben.',
    ],
    spalten: ['Artikelnummer', 'Anzahl', 'Item-Beschreibung'],
    erster: [
      pos('A-10023', 12, 'Sechskantschraube M8 x 40, verzinkt'),
      pos('A-10057', 250, 'Unterlegscheibe DIN 125, A8,4'),
      pos('B-20014', 4, 'Kabelbinder 200 mm, schwarz (Beutel à 100 Stück)'),
    ],
    zweiter: [
      pos('B-20031', 30, 'Dichtring 12 x 18 x 2, NBR'),
      pos('C-30002', 6, 'Schmierfett, Kartusche 400 g'),
      pos('C-30119', 2, 'Schutzhandschuhe Gr. 10, Nitril (Karton)'),
      pos('D-40007', 18, 'Sicherungsblech, Edelstahl 1.4301'),
      pos('D-40088', 1, 'Werkzeugkoffer, 24-teilig'),
    ],
    // Die zweite des Blocks — mitten drin, nicht am Rand: Am Rand fiele es auf.
    versetzt: 1,
    fuss: [
      ['Zahlungsziel', '30 Tage netto', '2 % Skonto bei Zahlung binnen 10 Tagen'],
      ['Ansprechpartner', 'Einkauf', 'Durchwahl -412'],
      ['Maschinell erstellt', 'gültig ohne Unterschrift', 'Seite 1 von 1'],
    ],
  },
  {
    datei: 'Bestellung_4712_2026-03-02.xlsx',
    blatt: 'Positionen',
    kopf: [
      'Nordwind Handels KG',
      'Bestellung 4712 / Abruf zum Rahmenvertrag 2026-018',
      'erstellt am 02.03.2026 von Abt. Beschaffung',
    ],
    hinweise: [
      'Teillieferung zulässig. Restmengen bitte innerhalb von 14 Tagen nachliefern.',
      'Abweichende Verpackungseinheiten sind vorab abzustimmen.',
    ],
    // Andere Schreibweise derselben Sache: Ein zweites Haus, ein zweiter Kopf.
    spalten: ['Art.-Nr.', 'Menge', 'Item-Beschreibung'],
    erster: [
      pos('N-5001', 60, 'Rohrschelle 3/4", mit Gummieinlage'),
      pos('N-5044', 8, 'Kugelhahn DN 25, Messing'),
      pos('N-5102', 120, 'Gewindestange M10, 1 m'),
    ],
    zweiter: [
      pos('P-6003', 15, 'Flanschdichtung DN 50, Klingersil'),
      pos('P-6019', 3, 'Manometer 0–16 bar, Anschluss unten'),
      pos('P-6027', 40, 'Reduziernippel 1" auf 3/4", Edelstahl'),
      pos('Q-7010', 5, 'Absperrklappe DN 80, mit Handhebel'),
      pos('Q-7055', 24, 'Schlauchklemme 40–60 mm'),
    ],
    // Hier die vierte — damit die beiden Dateien nicht denselben Fehler an
    // derselben Stelle tragen und jemand ihn nach der Zeilennummer sucht.
    versetzt: 3,
    fuss: [
      ['Lieferanschrift', 'Tor 3, Rampe Ost', 'Anmeldung an der Pforte'],
      ['Rechnungsanschrift', 'siehe Rahmenvertrag', 'Rechnungen bitte als PDF'],
      ['Hinweis', 'Preise gemäß Rahmenvertrag', 'Änderungen vorbehalten'],
    ],
  },
];

/**
 * Die Zeilen eines Blattes.
 *
 * Eine leere Zeile ist ein leeres Feld und keine Zeile mit leeren Zellen: So
 * schreibt Excel sie auch, und der Leser soll an dem geprüft werden, was
 * ankommt, nicht an dem, was bequem wäre.
 */
function zeilen(bestellung: Bestellung): Zelle[][] {
  const leer: Zelle[] = [];

  const positionszeile = (position: Position, verschoben: boolean): Zelle[] =>
    verschoben
      ? ['', position.artikel, position.anzahl, position.beschreibung]
      : [position.artikel, position.anzahl, position.beschreibung];

  return [
    ...bestellung.kopf.map((zeile): Zelle[] => [zeile]),
    leer,
    ...bestellung.hinweise.map((zeile): Zelle[] => [zeile]),
    [...bestellung.spalten],
    ...bestellung.erster.map((position) => positionszeile(position, false)),
    leer,
    ...bestellung.zweiter.map((position, stelle) =>
      positionszeile(position, stelle === bestellung.versetzt)
    ),
    ...bestellung.fuss.map((zeile): Zelle[] => [...zeile]),
  ];
}

function blatt(bestellung: Bestellung): Sheet {
  return { name: bestellung.blatt, rows: zeilen(bestellung) };
}

function beschreibung(): string {
  const zeilen = [
    '# Bestellungen zum Ausprobieren',
    '',
    'Zwei Excel-Blätter, wie sie aus einem Einkauf kommen — **nicht** wie eine',
    'Tabelle gebaut. Alle Häuser, Nummern und Artikel sind erfunden.',
    '',
    'Erzeugt mit `npm run bestellungen`. Geändert wird in',
    '`src/tools/bestellungen.ts`; dieser Ordner ist das Ergebnis.',
    '',
    '## Der Aufbau beider Blätter',
    '',
    '```text',
    'Zeile  1–3    Briefkopf: Haus, Bestellnummer, Datum — je in Spalte A',
    'Zeile  4      leer',
    'Zeile  5–6    zwei Sätze in Spalte A: Lieferbedingungen, Hinweise',
    'Zeile  7      Spaltenüberschriften',
    'Zeile  8–10   drei Bestellzeilen',
    'Zeile 11      leer',
    'Zeile 12–16   fünf Bestellzeilen, eine davon um eine Spalte versetzt',
    'Zeile 17–19   drei Zeilen Fußtext in den ersten drei Spalten',
    '```',
    '',
    '## Was daran schwierig ist',
    '',
    '* **Die versetzte Zeile.** Jemand hat beim Einfügen eine Zelle verrutschen',
    '  lassen. Für das Auge eine Bestellzeile wie jede andere; für eine',
    '  Spaltenzuordnung steht die Artikelnummer in der Spalte „Anzahl", und die',
    '  Anzahl ist Text. In `4711` ist es die zweite Zeile des unteren Blocks, in',
    '  `4712` die vierte — damit niemand den Fehler nach der Zeilennummer sucht.',
    '* **Der Fußtext sieht aus wie ein Datensatz.** „Zahlungsziel · 30 Tage netto ·',
    '  2 % Skonto" steht in denselben drei Spalten wie eine Position. Wer zählt,',
    '  wie viele Zeilen drei gefüllte Zellen haben, bekommt drei Positionen zu',
    '  viel.',
    '* **Zwei leere Zeilen mittendrin.** Ein Block endet nicht dort, wo die Daten',
    '  aufhören.',
    '* **Zwei Häuser, zwei Überschriften.** `Artikelnummer / Anzahl` gegen',
    '  `Art.-Nr. / Menge` — dieselbe Spalte, ein anderes Wort.',
    '',
    '## Die Blätter im Überblick',
    '',
    '| Datei | Blatt | Spaltenüberschriften | versetzte Zeile |',
    '| --- | --- | --- | --- |',
  ];

  for (const bestellung of BESTELLUNGEN) {
    zeilen.push(
      `| \`${bestellung.datei}\` | ${bestellung.blatt} | ${bestellung.spalten.join(', ')} ` +
        `| Zeile ${12 + bestellung.versetzt} |`
    );
  }

  zeilen.push('');

  return zeilen.join('\r\n');
}

function main(argv: string[]): void {
  const stelle = argv.indexOf('--ziel');
  const ziel = path.resolve(stelle >= 0 ? argv[stelle + 1] : 'Testdateien');

  fs.mkdirSync(ziel, { recursive: true });

  for (const bestellung of BESTELLUNGEN) {
    fs.writeFileSync(path.join(ziel, bestellung.datei), writeXlsx([blatt(bestellung)]));
  }

  fs.writeFileSync(path.join(ziel, 'LIESMICH_Bestellungen.md'), beschreibung(), 'utf-8');

  console.log(`${BESTELLUNGEN.length} Bestellungen geschrieben nach ${ziel}`);
  console.log('Je 19 Zeilen, davon 8 Positionen — eine davon um eine Spalte versetzt.');
}

main(process.argv.slice(2));
