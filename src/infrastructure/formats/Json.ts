import type { Cell, DeclaredType } from '../../domain/consolidation/Cell.js';
import { decode, detectEncoding, type Encoding } from './Csv.js';
import type { Gelesen } from './Bestand.js';
import { zerlegePfad } from './Pfade.js';

/**
 * JSON lesen (SPEC-03, Abschnitt 7).
 *
 * Zwei Dinge macht JSON anders als CSV, und beide sind ein Gewinn:
 *
 * **Es kennt seine Typen.** `42` ist eine Zahl, `"42"` eine Zeichenkette,
 * `null` ist nichts und `false` ist ein Wahrheitswert. Diese Auskunft wird
 * mitgenommen (`Cell.declared`), statt sie wegzuwerfen und anschließend aus
 * dem Text zu erraten.
 *
 * **Es ist verschachtelt.** Eine Bestellung enthält eine Adresse und eine
 * Liste von Positionen. Für die Konsolidierung muss daraus eine flache Tabelle
 * werden, und der Weg dorthin muss umkehrbar bleiben: Aus `kunde.adresse.ort`
 * und `positionen[0].artikel` lässt sich die Verschachtelung wieder aufbauen,
 * aus `ort` und `artikel` nicht.
 *
 * **Festlegung aus der Spec:** Eine JSON-Datei ist genau ein Datenbestand.
 * Mehrere Dateien werden nicht von selbst zusammengeführt.
 */
export interface JsonOptions {
  encoding?: Encoding;
  /**
   * Wo die Datensätze stehen, als Pfad: `customers`, `data.items`.
   *
   * Ohne Angabe sucht der Leser die Liste selbst — und sagt, wo er sie gefunden
   * hat. Eine Wahl, die er selbst trifft, muss er begründen können.
   */
  pfad?: string;
  /** Wie viele Zeilen einer Liste in Spalten aufgelöst werden. */
  maxListe?: number;
}

/** Mehr als das ergibt Spalten, die niemand mehr liest. */
const MAX_LISTE = 50;

type JsonWert = string | number | boolean | null | JsonWert[] | { [name: string]: JsonWert };

function istObjekt(wert: JsonWert): wert is { [name: string]: JsonWert } {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

/** Der erklärte Typ, wie JSON selbst ihn nennt. */
function typVon(wert: JsonWert): DeclaredType {
  if (wert === null) {
    return 'EMPTY';
  }

  switch (typeof wert) {
    case 'number':
      return Number.isFinite(wert) ? 'NUMBER' : 'ERROR';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return wert === '' ? 'EMPTY' : 'STRING';
  }
}

function alsText(wert: JsonWert): string {
  return wert === null ? '' : typeof wert === 'object' ? JSON.stringify(wert) : String(wert);
}

/**
 * Legt einen Datensatz flach.
 *
 * Listen bekommen einen Index (`positionen[0].artikel`), verschachtelte
 * Objekte einen Punkt. Eine leere Liste wird zu einem leeren Feld und nicht
 * verschwiegen — sonst hätte eine Bestellung ohne Positionen einfach keine
 * Spalte dafür, und der Unterschied zwischen „keine" und „nicht gefragt" wäre
 * fort.
 */
function flach(
  wert: JsonWert,
  pfad: string,
  ziel: Map<string, Cell>,
  maxListe: number,
  notes: Set<string>
): void {
  if (Array.isArray(wert)) {
    if (wert.length === 0) {
      ziel.set(pfad, { text: '', declared: 'EMPTY' });
      return;
    }

    if (wert.length > maxListe) {
      notes.add(`„${pfad}" hat ${wert.length} Einträge; aufgelöst wurden die ersten ${maxListe}`);
    }

    wert.slice(0, maxListe).forEach((eintrag, index) => flach(eintrag, `${pfad}[${index}]`, ziel, maxListe, notes));
    return;
  }

  if (istObjekt(wert)) {
    const namen = Object.keys(wert);

    if (namen.length === 0) {
      ziel.set(pfad, { text: '', declared: 'EMPTY' });
      return;
    }

    for (const name of namen) {
      flach(wert[name], pfad === '' ? name : `${pfad}.${name}`, ziel, maxListe, notes);
    }

    return;
  }

  ziel.set(pfad, { text: alsText(wert), declared: typVon(wert) });
}

/** Folgt einem Pfad wie `data.items` — Punkt für Punkt, ohne Zauberei. */
function amPfad(wurzel: JsonWert, pfad: string): JsonWert | undefined {
  let stand: JsonWert | undefined = wurzel;

  for (const glied of pfad.split('.')) {
    if (stand === undefined || !istObjekt(stand)) {
      return undefined;
    }

    stand = stand[glied];
  }

  return stand;
}

interface Fund {
  liste: JsonWert[];
  pfad: string;
}

/**
 * Sucht die Liste der Datensätze.
 *
 * Genommen wird die **längste Liste von Objekten** — und zwar nur, wenn es
 * genau eine gibt, die am längsten ist. Bei einem Gleichstand entscheidet
 * niemand still: Der Leser nimmt die erste und schreibt in die Notizen, welche
 * andere ebenso in Frage kam. Eine Wahl zwischen „Kunden" und „Lieferanten",
 * die eine Maschine allein trifft, fällt beim Kunden auf und nicht hier.
 */
function findeListe(wurzel: JsonWert, notes: Set<string>): Fund | undefined {
  const kandidaten: Fund[] = [];

  const suche = (wert: JsonWert, pfad: string, tiefe: number): void => {
    if (tiefe > 8) {
      return;
    }

    if (Array.isArray(wert)) {
      if (wert.some(istObjekt)) {
        kandidaten.push({ liste: wert, pfad });
      }

      return;
    }

    if (istObjekt(wert)) {
      for (const name of Object.keys(wert)) {
        suche(wert[name], pfad === '' ? name : `${pfad}.${name}`, tiefe + 1);
      }
    }
  };

  suche(wurzel, '', 0);

  if (kandidaten.length === 0) {
    return undefined;
  }

  const sortiert = [...kandidaten].sort((links, rechts) => rechts.liste.length - links.liste.length);
  const gleichlang = sortiert.filter((eintrag) => eintrag.liste.length === sortiert[0].liste.length);

  if (gleichlang.length > 1) {
    notes.add(
      `Mehrere Listen sind gleich lang (${gleichlang.map((eintrag) => `„${eintrag.pfad || 'Wurzel'}"`).join(', ')}); ` +
        'genommen wurde die erste. Welche gemeint ist, gehört ins Profil'
    );
  }

  return sortiert[0];
}

export function readJson(bytes: Uint8Array, options: JsonOptions = {}): Gelesen {
  const encoding = options.encoding ?? detectEncoding(bytes);
  const text = decode(bytes, encoding);
  const notes = new Set<string>();
  const maxListe = options.maxListe ?? MAX_LISTE;

  let wurzel: JsonWert;

  try {
    wurzel = JSON.parse(text) as JsonWert;
  } catch (fehler) {
    throw new Error(`Die Datei ist kein gültiges JSON: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  }

  const fund = options.pfad
    ? { liste: amPfad(wurzel, options.pfad), pfad: options.pfad }
    : findeListe(wurzel, notes);

  if (options.pfad && !Array.isArray(fund?.liste)) {
    throw new Error(`Unter „${options.pfad}" steht keine Liste von Datensätzen`);
  }

  /*
   * Ein einzelnes Objekt ohne Liste ist ein Datensatz und kein Fehler. Eine
   * Datei mit genau einer Bestellung darin ist ein gewöhnlicher Fall, und ihn
   * abzulehnen wäre Willkür.
   */
  const datensaetze = Array.isArray(fund?.liste) ? fund.liste : istObjekt(wurzel) ? [wurzel] : [];
  const pfad = Array.isArray(fund?.liste) ? fund.pfad : '';

  if (datensaetze.length === 0) {
    notes.add('In dieser Datei steht kein Datensatz, den Unikom lesen könnte');
  }

  if (pfad) {
    notes.add(`Die Datensätze stehen unter „${pfad}"`);
  }

  const zeilen = datensaetze.map((datensatz) => {
    const felder = new Map<string, Cell>();

    flach(datensatz, '', felder, maxListe, notes);
    return felder;
  });

  /*
   * Die Feldliste ist die **Vereinigung** aller Datensätze, in der Reihenfolge
   * ihres ersten Auftretens. Nur den ersten Datensatz zu nehmen wäre kürzer und
   * verlöre jedes Feld, das erst weiter unten vorkommt — und zwar lautlos.
   */
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
    notes.add(
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
    notes: [...notes],
  };
}

/* ---------- Der Weg zurück ---------- */

export interface JsonSchreibOptions {
  /**
   * Der Schlüssel, unter dem die Datensätze stehen sollen.
   *
   * Ohne Angabe entsteht ein nacktes Array `[{…},{…}]`, mit Angabe
   * `{"customers":[{…},{…}]}`. SPEC-03, Abschnitt 7, verlangt ausdrücklich,
   * dass sich beides unterscheiden lässt — für den Empfänger ist es nicht
   * dasselbe.
   */
  wurzel?: string;
  /**
   * Wohin ein Feld gehört, wenn es nicht dorthin soll, wo sein Name es
   * hinstellt: `{ Ort: 'kunde.adresse.ort' }`.
   *
   * Damit wird aus einer flachen CSV eine **definierte** verschachtelte
   * Struktur. Ohne Angabe gilt der Feldname selbst als Pfad — dann ist das
   * Schreiben die genaue Umkehrung des Lesens.
   */
  zuordnung?: Record<string, string>;
  /** Eingerückt, wie man es einem Menschen gibt. Voreingestellt: ja. */
  eingerueckt?: boolean;
}

/**
 * Setzt einen Wert an seinen Platz im Gebilde.
 *
 * Die Zwischenstufen entstehen unterwegs: Ein Glied mit Stelle wird eine Liste,
 * eines ohne ein Objekt. Steht dort schon etwas anderes — weil zwei Felder
 * denselben Pfad verschieden auslegen —, wird das gemeldet und nicht
 * überschrieben. Ein Feld, das ein anderes still verdrängt, ist ein
 * Datenverlust im Schreiben, also an der Stelle, an der niemand mehr hinsieht.
 */
function setze(ziel: Record<string, JsonWert>, pfad: string, wert: JsonWert, notes: Set<string>): void {
  const glieder = zerlegePfad(pfad);
  let stand: Record<string, JsonWert> | JsonWert[] = ziel;

  for (let stelle = 0; stelle < glieder.length; stelle += 1) {
    const glied = glieder[stelle];
    const letztes = stelle === glieder.length - 1;

    /*
     * Ein Attribut kennt JSON nicht. Es wird zu einem gewöhnlichen Feld mit
     * einem @ davor — so bleibt erkennbar, dass es aus einem XML-Attribut
     * stammt, und der Weg nach XML zurück ist offen.
     */
    const name = glied.art === 'ATTRIBUT' ? `@${glied.name}` : glied.name;

    if (glied.art === 'STELLE') {
      const behaelter = stand as Record<string, JsonWert>;
      const liste = Array.isArray(behaelter[name]) ? (behaelter[name] as JsonWert[]) : [];

      if (behaelter[name] !== undefined && !Array.isArray(behaelter[name])) {
        notes.add(`„${pfad}" verlangt an „${name}" eine Liste, dort steht aber schon etwas anderes`);
        return;
      }

      behaelter[name] = liste;

      if (letztes) {
        liste[glied.index] = wert;
        return;
      }

      const eintrag = istObjekt(liste[glied.index]) ? liste[glied.index] : {};

      liste[glied.index] = eintrag;
      stand = eintrag as Record<string, JsonWert>;
      continue;
    }

    const behaelter = stand as Record<string, JsonWert>;

    if (letztes) {
      behaelter[name] = wert;
      return;
    }

    if (behaelter[name] !== undefined && !istObjekt(behaelter[name])) {
      notes.add(`„${pfad}" verlangt unter „${name}" ein Objekt, dort steht aber schon ein Wert`);
      return;
    }

    const unter = istObjekt(behaelter[name]) ? (behaelter[name] as Record<string, JsonWert>) : {};

    behaelter[name] = unter;
    stand = unter;
  }
}

/**
 * Der Wert, wie JSON ihn tragen soll.
 *
 * Genommen wird der **erklärte** Typ der Zelle und sonst nichts. Aus „1.234,50"
 * eine Zahl zu machen, weil es nach einer aussieht, wäre eine Umrechnung — und
 * die hängt an der Region, gehört ins Mapping und nicht in den Schreiber. Was
 * als Text hereinkam, geht als Text hinaus.
 */
function wertVon(zelle: Cell): JsonWert {
  switch (zelle.declared) {
    case 'EMPTY':
      return null;
    case 'NUMBER':
      return Number(zelle.text);
    case 'BOOLEAN':
      return zelle.text.toLowerCase() === 'true';
    default:
      return zelle.text;
  }
}

export interface Geschrieben {
  text: string;
  notes: string[];
}

export function writeJson(gelesen: Gelesen, options: JsonSchreibOptions = {}): Geschrieben {
  const notes = new Set<string>();

  const datensaetze = gelesen.rows.map((zeile) => {
    const satz: Record<string, JsonWert> = {};

    gelesen.fields.forEach((feld, index) => {
      const zelle = zeile[index];

      if (zelle !== undefined) {
        setze(satz, options.zuordnung?.[feld] ?? feld, wertVon(zelle), notes);
      }
    });

    return satz;
  });

  const gebilde = options.wurzel ? { [options.wurzel]: datensaetze } : datensaetze;

  return {
    text: JSON.stringify(gebilde, null, options.eingerueckt === false ? undefined : 2),
    notes: [...notes],
  };
}
