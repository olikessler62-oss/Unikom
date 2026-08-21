/**
 * Die optionale Prüfung gegen ein JSON Schema (SPEC-03, Abschnitt 7).
 *
 * ```text
 * { "type": "object",
 *   "required": ["kdnr"],
 *   "properties": { "kdnr": { "type": "integer" } } }
 * ```
 *
 * ## Ein Ausschnitt, und er sagt welcher
 *
 * JSON Schema ist groß: `$ref`, `allOf`, `if/then`, `patternProperties`,
 * Rekursion über mehrere Dateien. Das vollständig zu bauen wäre ein eigenes
 * Erzeugnis, und ein halbes, das sich für vollständig ausgibt, ist schlimmer
 * als keines — es sagt „gültig" zu einer Datei, deren Schema es nicht
 * verstanden hat.
 *
 * Deshalb zwei Regeln:
 *
 * 1. Geprüft wird der Ausschnitt, der bei Kunden vorkommt: `type`, `required`,
 *    `properties`, `items`, `enum`, `minimum`/`maximum`, `minLength`/
 *    `maxLength`, `pattern`.
 * 2. **Was nicht verstanden wurde, steht im Ergebnis.** Ein Schlüsselwort, das
 *    diese Prüfung nicht kennt, wird nicht übergangen, sondern gemeldet — wer
 *    `$ref` benutzt, soll erfahren, dass davon nichts geprüft wurde, statt ein
 *    grünes Häkchen zu bekommen.
 *
 * ## Ungültig heißt nicht wertlos
 *
 * Die Prüfung liefert **alle** Verstöße mit ihrem Pfad, nicht den ersten. Wer
 * eine Datei mit dreißig Fehlern bekommt, will sie einmal überarbeiten und
 * nicht dreißigmal hochladen.
 */
export interface Schemaverstoss {
  /** Wo im Dokument, in Punktschreibweise: `kunden[3].kdnr`. */
  pfad: string;
  /** Was verlangt war und was dastand — in einem Satz. */
  hinweis: string;
}

export interface Schemapruefung {
  gueltig: boolean;
  verstoesse: Schemaverstoss[];
  /**
   * Schlüsselwörter, die diese Prüfung nicht kennt, mit ihrem Pfad im Schema.
   *
   * Sie sind der Grund, warum `gueltig: true` nicht „das Schema ist erfüllt"
   * heißt, sondern „was geprüft werden konnte, war in Ordnung".
   */
  ungeprueft: string[];
}

/** Was diese Prüfung versteht. Alles andere wird gemeldet, nicht übergangen. */
const BEKANNT = new Set([
  'type',
  'required',
  'properties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'nullable',
  'title',
  'description',
  '$schema',
  '$id',
  'examples',
  'default',
  'additionalProperties',
]);

type Schema = Record<string, unknown>;

export function pruefeGegenSchema(daten: unknown, schema: unknown): Schemapruefung {
  const verstoesse: Schemaverstoss[] = [];
  const ungeprueft: string[] = [];

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return {
      gueltig: false,
      verstoesse: [{ pfad: '', hinweis: 'Das Schema ist kein JSON-Objekt' }],
      ungeprueft: [],
    };
  }

  pruefe(daten, schema as Schema, '', '', verstoesse, ungeprueft);

  return { gueltig: verstoesse.length === 0, verstoesse, ungeprueft };
}

/**
 * @param pfad        die Stelle in den **Daten** — sie nennt die Zeile, die klemmt
 * @param schemapfad  die Stelle im **Schema** — dort steht `[]` statt `[3]`
 *
 * Zwei Pfade, weil zwei Fragen: Ein Verstoß gehört zu einem Datensatz, ein
 * nicht verstandenes Schlüsselwort zu einer Stelle im Schema. Über hundert
 * Listeneinträge wäre dasselbe `$ref` sonst hundertmal gemeldet.
 */
function pruefe(
  wert: unknown,
  schema: Schema,
  pfad: string,
  schemapfad: string,
  verstoesse: Schemaverstoss[],
  ungeprueft: string[]
): void {
  for (const schluessel of Object.keys(schema)) {
    if (!BEKANNT.has(schluessel)) {
      const stelle = `${schemapfad || '(Wurzel)'} → ${schluessel}`;

      if (!ungeprueft.includes(stelle)) {
        ungeprueft.push(stelle);
      }
    }
  }

  /*
   * `null` zuerst. In JSON Schema ist `null` ein eigener Typ und nicht die
   * Abwesenheit eines Wertes — wer das übergeht, meldet für jedes leere Feld
   * einen Typfehler.
   */
  if (wert === null) {
    if (schema.nullable === true || typKennt(schema.type, 'null')) {
      return;
    }
  }

  if (schema.type !== undefined && !passtZumTyp(wert, schema.type)) {
    verstoesse.push({
      pfad: pfad || '(Wurzel)',
      hinweis: `Erwartet wird ${beschreibe(schema.type)}, vorgefunden wurde ${typVon(wert)}`,
    });

    /* Bei falschem Typ ist alles Weitere Folgefehler und kein eigener Befund. */
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((erlaubt) => gleich(erlaubt, wert))) {
    verstoesse.push({
      pfad: pfad || '(Wurzel)',
      hinweis: `„${String(wert)}" steht nicht in der Liste der erlaubten Werte`,
    });
  }

  if (schema.const !== undefined && !gleich(schema.const, wert)) {
    verstoesse.push({ pfad: pfad || '(Wurzel)', hinweis: `Erwartet wird genau „${String(schema.const)}"` });
  }

  if (typeof wert === 'number') {
    pruefeZahl(wert, schema, pfad, verstoesse);
  }

  if (typeof wert === 'string') {
    pruefeText(wert, schema, pfad, verstoesse);
  }

  if (Array.isArray(wert) && typeof schema.items === 'object' && schema.items !== null) {
    wert.forEach((eintrag, stelle) =>
      pruefe(eintrag, schema.items as Schema, `${pfad}[${stelle}]`, `${schemapfad}[]`, verstoesse, ungeprueft)
    );
  }

  if (istObjekt(wert)) {
    pruefeObjekt(wert, schema, pfad, schemapfad, verstoesse, ungeprueft);
  }
}

function pruefeObjekt(
  wert: Record<string, unknown>,
  schema: Schema,
  pfad: string,
  schemapfad: string,
  verstoesse: Schemaverstoss[],
  ungeprueft: string[]
): void {
  const eigenschaften = istObjekt(schema.properties) ? schema.properties : {};

  if (Array.isArray(schema.required)) {
    for (const pflicht of schema.required) {
      if (typeof pflicht === 'string' && !(pflicht in wert)) {
        verstoesse.push({ pfad: verbinde(pfad, pflicht), hinweis: 'Dieses Feld fehlt und ist Pflicht' });
      }
    }
  }

  for (const [name, teilschema] of Object.entries(eigenschaften)) {
    if (name in wert && istObjekt(teilschema)) {
      pruefe(wert[name], teilschema, verbinde(pfad, name), verbinde(schemapfad, name), verstoesse, ungeprueft);
    }
  }

  /*
   * Zusätzliche Felder sind nur dann ein Verstoß, wenn das Schema es sagt.
   * Voreingestellt erlaubt JSON Schema sie — und eine Prüfung, die strenger
   * ist als das Schema, meldet Fehler, die keine sind.
   */
  if (schema.additionalProperties === false) {
    for (const name of Object.keys(wert)) {
      if (!(name in eigenschaften)) {
        verstoesse.push({
          pfad: verbinde(pfad, name),
          hinweis: 'Dieses Feld ist im Schema nicht vorgesehen',
        });
      }
    }
  }
}

function pruefeZahl(wert: number, schema: Schema, pfad: string, verstoesse: Schemaverstoss[]): void {
  if (typeof schema.minimum === 'number' && wert < schema.minimum) {
    verstoesse.push({ pfad: pfad || '(Wurzel)', hinweis: `${wert} liegt unter dem Kleinstwert ${schema.minimum}` });
  }

  if (typeof schema.maximum === 'number' && wert > schema.maximum) {
    verstoesse.push({ pfad: pfad || '(Wurzel)', hinweis: `${wert} liegt über dem Größtwert ${schema.maximum}` });
  }
}

function pruefeText(wert: string, schema: Schema, pfad: string, verstoesse: Schemaverstoss[]): void {
  if (typeof schema.minLength === 'number' && wert.length < schema.minLength) {
    verstoesse.push({
      pfad: pfad || '(Wurzel)',
      hinweis: `Der Wert ist ${wert.length} Zeichen lang, verlangt sind mindestens ${schema.minLength}`,
    });
  }

  if (typeof schema.maxLength === 'number' && wert.length > schema.maxLength) {
    verstoesse.push({
      pfad: pfad || '(Wurzel)',
      hinweis: `Der Wert ist ${wert.length} Zeichen lang, erlaubt sind höchstens ${schema.maxLength}`,
    });
  }

  if (typeof schema.pattern === 'string') {
    let regel;

    try {
      regel = new RegExp(schema.pattern);
    } catch {
      /*
       * Ein Muster, das sich nicht übersetzen lässt, ist ein Mangel des
       * Schemas und kein Befund über die Daten. Es als Verstoß zu buchen
       * schöbe die Schuld auf die Datei.
       */
      verstoesse.push({
        pfad: pfad || '(Wurzel)',
        hinweis: `Das Schema nennt ein Muster, das sich nicht lesen lässt: ${schema.pattern}`,
      });

      return;
    }

    if (!regel.test(wert)) {
      verstoesse.push({ pfad: pfad || '(Wurzel)', hinweis: `„${wert}" passt nicht zum Muster ${schema.pattern}` });
    }
  }
}

function passtZumTyp(wert: unknown, typ: unknown): boolean {
  if (Array.isArray(typ)) {
    return typ.some((einzeln) => passtZumTyp(wert, einzeln));
  }

  switch (typ) {
    case 'object':
      return istObjekt(wert);
    case 'array':
      return Array.isArray(wert);
    case 'string':
      return typeof wert === 'string';
    case 'number':
      return typeof wert === 'number' && Number.isFinite(wert);
    /* Eine ganze Zahl ist eine Zahl ohne Rest — 5.0 zählt, 5.5 nicht. */
    case 'integer':
      return typeof wert === 'number' && Number.isInteger(wert);
    case 'boolean':
      return typeof wert === 'boolean';
    case 'null':
      return wert === null;
    default:
      /* Einen Typ, den wir nicht kennen, halten wir nicht für verletzt. */
      return true;
  }
}

function typKennt(typ: unknown, gesucht: string): boolean {
  return Array.isArray(typ) ? typ.includes(gesucht) : typ === gesucht;
}

function beschreibe(typ: unknown): string {
  return Array.isArray(typ) ? typ.join(' oder ') : String(typ);
}

function typVon(wert: unknown): string {
  if (wert === null) {
    return 'null';
  }

  if (Array.isArray(wert)) {
    return 'array';
  }

  return typeof wert;
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

function gleich(links: unknown, rechts: unknown): boolean {
  return JSON.stringify(links) === JSON.stringify(rechts);
}

function verbinde(pfad: string, name: string): string {
  return pfad ? `${pfad}.${name}` : name;
}
