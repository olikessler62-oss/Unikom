import type { Qualitaetsregel, Pruefung, Schwere } from '../../domain/quality/Regeln.js';
import type { Schluessel, Vergleich } from '../../domain/consolidation/Schluessel.js';
import type { FieldType } from '../../domain/consolidation/Recognition.js';
import type {
  Spaltenvorgabe,
  Strukturvorgabe,
  Verbindlichkeit,
} from '../../domain/discovery/Expectation.js';
import { ApiError } from './Http.js';

/**
 * Was von außen an einem Eingangsprofil geändert werden darf — und in welcher Form.
 *
 * ## Warum das ein eigenes Stück ist und nicht in der Route steht
 *
 * Hier steht die Grenze zwischen einer JSON-Nachricht, die jeder schicken kann,
 * und einem Wertgebilde, auf das sich der Lauf verlässt. Eine Grenze, die in
 * einer Route zwischen zwei Antworten steht, wird beim nächsten Feld an einer
 * Stelle vergessen. Hier ist sie prüfbar, ohne dass ein Server läuft.
 *
 * ## Abweisen statt zurechtbiegen
 *
 * Dieselbe Haltung wie bei den Einstellungen: Was nicht verstanden wurde, wird
 * **abgelehnt** und nicht stillschweigend übergangen. Eine unbekannte Prüfart
 * landete sonst im Profil, stünde dort für immer und wirkte nie — eine Regel,
 * die niemand einlöst und die auch niemand mehr findet.
 *
 * Und die Meldung nennt, was erlaubt gewesen wäre. Wer „required" schreibt,
 * soll „PFLICHT" lesen und nicht raten müssen.
 */

const VERBINDLICHKEITEN: readonly Verbindlichkeit[] = ['HINWEIS', 'EINSCHRAENKUNG', 'VORGABE'];

const TYPEN: readonly FieldType[] = [
  'STRING',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'DATE',
  'TIME',
  'DATETIME',
  'BINARY',
  'NULL',
];

const SCHWEREGRADE: readonly Schwere[] = ['INFO', 'WARNUNG', 'KONFLIKT', 'FEHLER'];

const PRUEFARTEN = ['PFLICHT', 'FORMAT', 'BEREICH', 'NICHT_ZUKUNFT', 'AUS_LISTE'] as const;

/** Die vier Faltungen des Vergleichs — mehr gibt es nicht, und weniger auch nicht. */
const FALTUNGEN = ['grossKleinEgal', 'leerzeichenEgal', 'umlauteEgal', 'satzzeichenEgal'] as const;

/**
 * Die Struktur: welche Spalten erwartet werden und wie verbindlich das ist.
 *
 * `verbindlichkeit` ist Pflicht, weil es die Frage beantwortet, was bei einer
 * Abweichung geschieht — und die hat keine sinnvolle Voreinstellung: HINWEIS
 * ließe alles durch, VORGABE hielte alles auf.
 */
export function vorgabeAus(wert: unknown): Strukturvorgabe | undefined {
  const eingang = alsObjekt(wert, 'Die Struktur');

  if (!eingang) {
    return undefined;
  }

  return entstaubt({
    verbindlichkeit: ausListe(eingang.verbindlichkeit, VERBINDLICHKEITEN, 'Die Verbindlichkeit'),
    columns: zahl(eingang.columns, 'Die Spaltenzahl'),
    minColumns: zahl(eingang.minColumns, 'Die Mindestspaltenzahl'),
    spalten: spaltenAus(eingang.spalten),
    beginntNach: text(eingang.beginntNach, 'Der Blockbeginn'),
  }) as Strukturvorgabe;
}

function spaltenAus(wert: unknown): Spaltenvorgabe[] | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (!Array.isArray(wert)) {
    throw new ApiError(400, 'Die Spalten müssen als Liste übergeben werden');
  }

  return wert.map((eine, stelle) => {
    const spalte = alsObjekt(eine, `Die ${stelle + 1}. Spalte`);

    if (!spalte) {
      throw new ApiError(400, `Die ${stelle + 1}. Spalte ist leer`);
    }

    const position = zahl(spalte.position, `Die Stelle der ${stelle + 1}. Spalte`);

    if (position === undefined || position < 1) {
      throw new ApiError(400, `Die ${stelle + 1}. Spalte braucht eine Stelle ab 1`);
    }

    return entstaubt({
      position,
      name: text(spalte.name, `Der Name der ${stelle + 1}. Spalte`),
      type: spalte.type === undefined ? undefined : ausListe(spalte.type, TYPEN, `Der Typ der ${stelle + 1}. Spalte`),
    }) as Spaltenvorgabe;
  });
}

/**
 * Die Regeln, die an den Werten hängen.
 *
 * Sie ersetzen die JSON-Schema-Datei. Was dort `required`, `pattern`, `minimum`
 * und `enum` hieß, heißt hier PFLICHT, FORMAT, BEREICH und AUS_LISTE — und
 * dazu gibt es, was ein JSON Schema nicht kann: einen Schweregrad und eine
 * Bedingung über ein anderes Feld.
 */
export function regelnAus(wert: unknown): Qualitaetsregel[] | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (!Array.isArray(wert)) {
    throw new ApiError(400, 'Die Regeln müssen als Liste übergeben werden');
  }

  const regeln = wert.map((eine, stelle) => regelAus(eine, stelle));
  const doppelt = regeln.map((regel) => regel.id).filter((id, i, alle) => alle.indexOf(id) !== i);

  if (doppelt.length > 0) {
    /*
     * Zwei Regeln mit derselben Kennung sind später nicht mehr auseinander-
     * zuhalten — nicht im Befund, nicht in der Oberfläche, nicht beim Löschen.
     */
    throw new ApiError(400, `Diese Regelkennung kommt mehrfach vor: ${[...new Set(doppelt)].join(', ')}`);
  }

  return regeln;
}

function regelAus(wert: unknown, stelle: number): Qualitaetsregel {
  const regel = alsObjekt(wert, `Die ${stelle + 1}. Regel`);

  if (!regel) {
    throw new ApiError(400, `Die ${stelle + 1}. Regel ist leer`);
  }

  const wo = `der ${stelle + 1}. Regel`;

  return entstaubt({
    id: pflichttext(regel.id, `Die Kennung ${wo}`),
    name: pflichttext(regel.name, `Der Name ${wo}`),
    feld: pflichttext(regel.feld, `Das Feld ${wo}`),
    pruefung: pruefungAus(regel.pruefung, wo),
    schwere: ausListe(regel.schwere, SCHWEREGRADE, `Der Schweregrad ${wo}`),
    wenn: bedingungAus(regel.wenn, wo),
    erklaerung: text(regel.erklaerung, `Die Erklärung ${wo}`),
  }) as Qualitaetsregel;
}

function pruefungAus(wert: unknown, wo: string): Pruefung {
  const pruefung = alsObjekt(wert, `Die Prüfung ${wo}`);

  if (!pruefung) {
    throw new ApiError(400, `Die Prüfung ${wo} fehlt`);
  }

  const art = ausListe(pruefung.art, PRUEFARTEN, `Die Prüfart ${wo}`);

  switch (art) {
    case 'PFLICHT':
    case 'NICHT_ZUKUNFT':
      return { art };

    case 'FORMAT': {
      const muster = pflichttext(pruefung.muster, `Das Muster ${wo}`);

      /*
       * Übersetzt, bevor es gespeichert wird. Ein Muster, das sich erst im
       * Nachtlauf als unlesbar erweist, hält dann eine Verarbeitung auf — und
       * der Fehler steht in einem Protokoll statt in dem Formular, in dem er
       * entstanden ist.
       */
      try {
        new RegExp(muster);
      } catch (fehler) {
        throw new ApiError(
          400,
          `Das Muster ${wo} lässt sich nicht lesen: ${fehler instanceof Error ? fehler.message : String(fehler)}`
        );
      }

      return { art, muster, beschreibung: pflichttext(pruefung.beschreibung, `Die Beschreibung ${wo}`) };
    }

    case 'BEREICH': {
      const min = zahl(pruefung.min, `Der Kleinstwert ${wo}`);
      const max = zahl(pruefung.max, `Der Größtwert ${wo}`);

      if (min === undefined && max === undefined) {
        throw new ApiError(400, `Der Bereich ${wo} braucht einen Kleinst- oder einen Größtwert`);
      }

      if (min !== undefined && max !== undefined && min > max) {
        throw new ApiError(400, `Der Kleinstwert ${wo} liegt über dem Größtwert`);
      }

      return entstaubt({ art, min, max }) as Pruefung;
    }

    case 'AUS_LISTE': {
      const werte = pruefung.werte;

      if (!Array.isArray(werte) || werte.length === 0) {
        throw new ApiError(400, `Die Auswahlliste ${wo} ist leer`);
      }

      return { art, werte: werte.map((eintrag, i) => pflichttext(eintrag, `Der ${i + 1}. Wert ${wo}`)) };
    }
  }
}

function bedingungAus(wert: unknown, wo: string): { feld: string; ist: string } | undefined {
  const bedingung = alsObjekt(wert, `Die Bedingung ${wo}`);

  if (!bedingung) {
    return undefined;
  }

  return {
    feld: pflichttext(bedingung.feld, `Das Bedingungsfeld ${wo}`),
    ist: pflichttext(bedingung.ist, `Der Bedingungswert ${wo}`),
  };
}

/**
 * Woran ein Datensatz zu erkennen ist.
 *
 * Ohne Felder kein Schlüssel: Eine leere Liste sähe aus wie eine Einstellung
 * und wäre keine — sie ordnete jeden Datensatz jedem zu.
 */
export function schluesselAus(wert: unknown): Schluessel | undefined {
  const eingang = alsObjekt(wert, 'Der Schlüssel');

  if (!eingang) {
    return undefined;
  }

  const felder = eingang.felder;

  if (!Array.isArray(felder) || felder.length === 0) {
    throw new ApiError(400, 'Ein Schlüssel braucht mindestens ein Feld');
  }

  return entstaubt({
    felder: felder.map((feld, i) => pflichttext(feld, `Das ${i + 1}. Schlüsselfeld`)),
    jeQuelle: jeQuelleAus(eingang.jeQuelle, felder.length),
    vergleich: vergleichAus(eingang.vergleich),
  }) as Schluessel;
}

function jeQuelleAus(wert: unknown, anzahl: number): Record<string, string[]> | undefined {
  const eingang = alsObjekt(wert, 'Die Feldnamen je Quelle');

  if (!eingang) {
    return undefined;
  }

  const ergebnis: Record<string, string[]> = {};

  for (const [quelle, namen] of Object.entries(eingang)) {
    if (!Array.isArray(namen) || namen.length !== anzahl) {
      /*
       * Gleich viele wie im Schlüssel und in derselben Reihenfolge — sonst
       * stünde nicht fest, welcher Name welchen Teil meint, und ein
       * zusammengesetzter Schlüssel bräche über den Quellen auseinander.
       */
      throw new ApiError(
        400,
        `Die Quelle „${quelle}" muss ${anzahl} Feldname(n) nennen, in derselben Reihenfolge wie der Schlüssel`
      );
    }

    ergebnis[quelle] = namen.map((name, i) => pflichttext(name, `Der ${i + 1}. Feldname der Quelle „${quelle}"`));
  }

  return ergebnis;
}

function vergleichAus(wert: unknown): Vergleich | undefined {
  const eingang = alsObjekt(wert, 'Der Vergleich');

  if (!eingang) {
    return undefined;
  }

  const unbekannt = Object.keys(eingang).filter((name) => !(FALTUNGEN as readonly string[]).includes(name));

  if (unbekannt.length > 0) {
    throw new ApiError(
      400,
      `Unbekannte Vergleichsregel(n): ${unbekannt.join(', ')}. Bekannt sind: ${FALTUNGEN.join(', ')}`
    );
  }

  const ergebnis: Record<string, boolean> = {};

  for (const name of FALTUNGEN) {
    if (typeof eingang[name] === 'boolean') {
      ergebnis[name] = eingang[name] as boolean;
    }
  }

  return ergebnis;
}

/* ---------- Die kleinen Prüfer ---------- */

function alsObjekt(wert: unknown, was: string): Record<string, unknown> | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (typeof wert !== 'object' || Array.isArray(wert)) {
    throw new ApiError(400, `${was} muss als Objekt übergeben werden`);
  }

  return wert as Record<string, unknown>;
}

function ausListe<T extends string>(wert: unknown, erlaubt: readonly T[], was: string): T {
  if (typeof wert !== 'string' || !(erlaubt as readonly string[]).includes(wert)) {
    throw new ApiError(400, `${was} muss einer dieser Werte sein: ${erlaubt.join(', ')}`);
  }

  return wert as T;
}

function text(wert: unknown, was: string): string | undefined {
  if (wert === undefined || wert === null || wert === '') {
    return undefined;
  }

  if (typeof wert !== 'string') {
    throw new ApiError(400, `${was} muss Text sein`);
  }

  return wert;
}

function pflichttext(wert: unknown, was: string): string {
  const vorhanden = text(wert, was);

  if (vorhanden === undefined || vorhanden.trim() === '') {
    throw new ApiError(400, `${was} fehlt`);
  }

  return vorhanden;
}

function zahl(wert: unknown, was: string): number | undefined {
  if (wert === undefined || wert === null || wert === '') {
    return undefined;
  }

  if (typeof wert !== 'number' || !Number.isFinite(wert)) {
    throw new ApiError(400, `${was} muss eine Zahl sein`);
  }

  return wert;
}

/**
 * Wirft die leeren Felder fort.
 *
 * `{ name: undefined }` und `{}` sind für den Vergleich zweier Profilversionen
 * **nicht** dasselbe: `JSON.stringify` lässt undefined zwar fallen, aber die
 * Reihenfolge der übrigen Schlüssel bliebe eine andere. Aus einer Speicherung
 * ohne Änderung würde dann eine neue Version.
 */
function entstaubt<T extends object>(wert: T): T {
  return Object.fromEntries(Object.entries(wert).filter(([, eintrag]) => eintrag !== undefined)) as T;
}
