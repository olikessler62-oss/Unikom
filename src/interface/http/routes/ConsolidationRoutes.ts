import type {
  Konsolidierungsauftrag,
  Mehrfachtrefferregel,
  OhneHauptsatz,
} from '../../../application/consolidation/ConsolidationService.js';
import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { Aehnlichkeitsregeln } from '../../../domain/consolidation/Aehnlichkeit.js';
import type { Dublettenauswahl, Dublettenregel, Dublettenverbleib } from '../../../domain/consolidation/Dubletten.js';
import type { Ergaenzungsregel } from '../../../domain/consolidation/Ergaenzung.js';
import {
  einstellungenDesMandanten,
  regionAus,
  wirksameEinstellungen,
} from '../../../domain/consolidation/Einstellungen.js';
import type { Entscheidungsregeln } from '../../../domain/consolidation/Prioritaet.js';
import type { Betriebsart, Konsolidierungsart, Quelle } from '../../../domain/consolidation/Quellen.js';
import type { RecognitionOptions } from '../../../domain/consolidation/Recognition.js';
import type { OhneTreffer, Referenzbestand, Referenzregel } from '../../../domain/consolidation/Referenz.js';
import type { Schluessel, Vergleich } from '../../../domain/consolidation/Schluessel.js';
import { VorschauFehler } from '../../../application/workflow/Umformungsvorschau.js';
import type { Umformungsplan } from '../../../domain/transfer/Konsolidierungsschritt.js';
import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import { readCsv } from '../../../infrastructure/formats/Csv.js';
import { ApiError, ok, requireObject, requireString, type Route } from '../Http.js';

/**
 * Der Prüflauf über mehrere Quellen (SPEC-06, Abschnitt 11).
 *
 * Es gibt nur diesen einen Weg hinein, und er verändert nichts. Die Vorschau
 * ist deshalb keine zweite, vereinfachte Rechnung neben der echten — sie **ist**
 * die Rechnung. Eine Vorschau, die anders rechnet als der Lauf, führt genau die
 * Entscheidungen herbei, die sie verhindern soll.
 *
 * Eine Quelle kommt entweder fertig zerlegt (`fields` und `rows`) oder als
 * Text, den der Server liest. Der Browser zerlegt keine CSV: Trennzeichen,
 * Kodierung und Kopfzeile zu erkennen ist Arbeit, die es im Haus schon gibt und
 * die zweimal geschrieben zweimal anders ausgeht.
 */
const BETRIEBSARTEN: readonly Betriebsart[] = ['ANREICHERN', 'SAMMELN'];
const ARTEN: readonly Konsolidierungsart[] = ['APPEND', 'MERGE'];
const AUSWAHLEN: readonly Dublettenauswahl[] = [
  'ERSTER',
  'LETZTER',
  'PRIORITAET',
  'ZUSAMMENFUEHREN',
  'ALLE_BEHALTEN',
  'ENTSCHEIDEN',
];
const VERBLEIBE: readonly Dublettenverbleib[] = ['MITGEBEN', 'SEPARAT', 'VERWERFEN'];
const OHNE_HAUPTSATZ: readonly OhneHauptsatz[] = ['KONFLIKT', 'UEBERNEHMEN', 'UEBERSPRINGEN'];
const OHNE_TREFFER: readonly OhneTreffer[] = ['WARNUNG', 'KONFLIKT', 'IGNORIEREN'];

export function consolidationRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'POST',
      pattern: '/api/consolidation/preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Der Prüflauf');
        const tenantId = requireString(eingabe, 'tenantId');
        const mandant = await application.tenantService.getById(tenantId);

        if (!mandant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        /*
         * Die Schwelle und die Zahlenlesart kommen aus der Hierarchie und nicht
         * aus der Anfrage. Wer die Mindestkonfidenz mitschicken dürfte, könnte
         * sich eine automatische Entscheidung bestellen, die im Lauf danach ein
         * Konflikt ist.
         */
        const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);
        const quellen = quellenAus(eingabe.sources, {
          region: regionAus(wirksam),
          threshold: wirksam.mindestKonfidenz,
          nullValues: wirksam.nullWerte,
        });

        const auftrag: Konsolidierungsauftrag = {
          quellen,
          betriebsart: auswahl(eingabe.mode, BETRIEBSARTEN, 'mode') ?? 'SAMMELN',
          art: auswahl(eingabe.type, ARTEN, 'type') ?? 'APPEND',
          fuehrend: text(eingabe.leading),
          schluessel: schluesselAus(eingabe.key),
          zielfelder: liste(eingabe.targetFields),
          entscheidung: { ...entscheidungAus(eingabe.priority), mindestKonfidenz: wirksam.mindestKonfidenz },
          dubletten: dublettenAus(eingabe.duplicates),
          mehrfachtreffer: mehrfachtrefferAus(eingabe.multipleMatches),
          ohneHauptsatz: auswahl(eingabe.withoutLeading, OHNE_HAUPTSATZ, 'withoutLeading'),
          referenzen: referenzenAus(eingabe.references),
          ergaenzung: ergaenzungAus(eingabe.fill),
          aehnlichkeit: aehnlichkeitAus(eingabe.similarity),
        };

        /*
         * Eine fehlende Hauptdatei ist hier ausdrücklich **kein** 400. Sie ist
         * eine fachliche Lücke, und der Dienst meldet sie als Konflikt mit
         * Ursache und nächsten Schritten. Ein technischer Fehlercode an dieser
         * Stelle ersetzte eine erklärte Meldung durch eine, die niemandem sagt,
         * was zu tun ist.
         */
        return ok(application.consolidationService.konsolidiere(auftrag));
      },
    },
    {
      /** Was die eingestellten Umformungen mit einer echten Datei tun (SPEC-09 §11). */
      method: 'POST',
      pattern: '/api/consolidation/transform-preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Die Vorschau');
        const stelle = await vorschaustelle(application, eingabe);

        return vorschau(() =>
          application.umformungsvorschau.zeige({
            ...stelle,
            zeilen: typeof eingabe.rows === 'number' ? eingabe.rows : undefined,
            umformung: eingabe.umformung as Umformungsplan | undefined,
          })
        );
      },
    },
    {
      /**
       * Welchem internen Feld eine Spalte entspricht (SPEC-09 §11).
       *
       * Die andere Frage an dieselbe Datei: Die Umformungsvorschau zeigt, was
       * mit den **Werten** geschieht — diese hier, ob „Kd-Nr.", „KdNr" und
       * „Kundennummer" dasselbe meinen. Beide Antworten braucht, wer einen
       * Workflow einrichtet, und beide an derselben Stelle.
       */
      method: 'POST',
      pattern: '/api/consolidation/mapping-preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Die Vorschau');
        const stelle = await vorschaustelle(application, eingabe);

        return vorschau(() =>
          application.zuordnungsvorschau.zeige({
            ...stelle,
            tenantId: requireString(eingabe, 'tenantId'),
            profilId: text(eingabe.profileId),
          })
        );
      },
    },
  ];
}

/**
 * Mandant, Verzeichnis und Einstellungen einer Vorschau — für beide dieselben.
 *
 * **Dieselbe Grenze wie überall:** Ein Mandant sieht nicht in den Ordner eines
 * anderen. Eine Vorschau wäre der bequemste Weg dorthin — sie liest schließlich
 * nur. Zwei Routen mit zwei Abschriften dieser Prüfung wären zwei Gelegenheiten,
 * sie an einer Stelle zu vergessen.
 *
 * **Der Server liest die Datei, nicht der Browser.** Sie liegt in dem
 * Verzeichnis, das der Workflow benutzt — auf dem Rechner, auf dem Unikom läuft.
 * Eine hochgeladene Kopie hätte mit der nächtlich verarbeiteten nur den Namen
 * gemein.
 */
async function vorschaustelle(
  application: UnikomApplication,
  eingabe: Record<string, unknown>
): Promise<{
  verzeichnis: string;
  datei?: string;
  region: RecognitionOptions['region'];
  threshold?: number;
  nullValues?: readonly string[];
  eingelesen: string;
}> {
  const tenantId = requireString(eingabe, 'tenantId');
  const mandant = await application.tenantService.getById(tenantId);

  if (!mandant) {
    throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
  }

  const verzeichnis = requireString(eingabe, 'directory');

  try {
    assertWithinTenant(mandant, verzeichnis, 'Dieses Verzeichnis');
  } catch (fehler) {
    throw new ApiError(403, fehler instanceof Error ? fehler.message : String(fehler));
  }

  const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);

  return {
    verzeichnis,
    datei: text(eingabe.file),
    region: regionAus(wirksam),
    threshold: wirksam.mindestKonfidenz,
    nullValues: wirksam.nullWerte,
    eingelesen: new Date().toISOString(),
  };
}

/**
 * 404 und nicht 500: Ein leeres Verzeichnis ist keine Störung, sondern eine
 * Auskunft — und der Satz dazu nennt die Formate, die Unikom lesen kann.
 */
async function vorschau<T>(hole: () => Promise<T>) {
  try {
    return ok(await hole());
  } catch (fehler) {
    if (fehler instanceof VorschauFehler) {
      throw new ApiError(404, fehler.message);
    }

    throw fehler;
  }
}

function text(wert: unknown): string | undefined {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : undefined;
}

function liste(wert: unknown): string[] | undefined {
  return Array.isArray(wert) ? wert.map(String) : undefined;
}

function auswahl<T extends string>(wert: unknown, erlaubt: readonly T[], feld: string): T | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (!(erlaubt as readonly unknown[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}" ist kein Wert für „${feld}". Erwartet wird einer von: ${erlaubt.join(', ')}`);
  }

  return wert as T;
}

function vergleichAus(wert: unknown): Vergleich | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Der Vergleich') as Record<string, unknown>;

  return {
    grossKleinEgal: eintrag.ignoreCase === undefined ? undefined : eintrag.ignoreCase === true,
    leerzeichenEgal: eintrag.ignoreSpaces === undefined ? undefined : eintrag.ignoreSpaces === true,
    umlauteEgal: eintrag.foldUmlauts === undefined ? undefined : eintrag.foldUmlauts === true,
    satzzeichenEgal: eintrag.ignorePunctuation === undefined ? undefined : eintrag.ignorePunctuation === true,
  };
}

/**
 * Eine Quelle — fertig zerlegt oder als Text.
 *
 * Der Text wird mit demselben Leser gelesen wie eine Datei vom FTP, samt
 * Erkennung von Trennzeichen und Kopfzeile. Die Region entscheidet dabei mit,
 * und sie kommt vom Mandanten.
 */
function quellenAus(wert: unknown, erkennung: RecognitionOptions): Quelle[] {
  if (!Array.isArray(wert) || wert.length === 0) {
    throw new ApiError(400, 'Ohne Quellen gibt es nichts zu konsolidieren');
  }

  return wert.map((angabe, stelle) => {
    const eintrag = requireObject(angabe, `Die ${stelle + 1}. Quelle`) as Record<string, unknown>;
    const id = typeof eintrag.id === 'string' && eintrag.id.trim() !== '' ? eintrag.id : `quelle${stelle + 1}`;
    const name = typeof eintrag.name === 'string' && eintrag.name.trim() !== '' ? eintrag.name : id;
    const stand = eintrag.state ? (requireObject(eintrag.state, 'Der Datenstand') as Record<string, unknown>) : undefined;

    const gemeinsam = {
      id,
      name,
      blatt: text(eintrag.sheet),
      stand: stand
        ? { erstellt: text(stand.created), geaendert: text(stand.modified), eingelesen: text(stand.read) }
        : undefined,
    };

    if (typeof eintrag.text === 'string') {
      const tabelle = readCsv(Buffer.from(eintrag.text, 'utf-8'), {
        ...erkennung,
        delimiter: text(eintrag.delimiter),
      });

      return { ...gemeinsam, felder: tabelle.fields, zeilen: tabelle.rows };
    }

    const felder = liste(eintrag.fields);

    if (!felder || felder.length === 0) {
      throw new ApiError(400, `Die Quelle „${name}" hat weder Text noch Feldnamen`);
    }

    if (!Array.isArray(eintrag.rows)) {
      throw new ApiError(400, `Die Quelle „${name}" hat keine Zeilen`);
    }

    return {
      ...gemeinsam,
      felder,
      zeilen: (eintrag.rows as unknown[]).map((zeile) => (Array.isArray(zeile) ? zeile.map(String) : [])),
    };
  });
}

function schluesselAus(wert: unknown): Schluessel | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Der Schlüssel') as Record<string, unknown>;
  const felder = liste(eintrag.fields);

  if (!felder || felder.length === 0) {
    return undefined;
  }

  const jeQuelle: Record<string, string[]> = {};

  for (const [quelle, angabe] of Object.entries((eintrag.perSource ?? {}) as Record<string, unknown>)) {
    const eigene = liste(angabe);

    if (eigene) {
      jeQuelle[quelle] = eigene;
    }
  }

  return { felder, jeQuelle, vergleich: vergleichAus(eintrag.compare) };
}

function entscheidungAus(wert: unknown): Entscheidungsregeln {
  if (wert === undefined || wert === null) {
    return {};
  }

  const eintrag = requireObject(wert, 'Die Entscheidungsregeln') as Record<string, unknown>;
  const jeFeld: Record<string, string[]> = {};

  for (const [feld, angabe] of Object.entries((eintrag.byField ?? {}) as Record<string, unknown>)) {
    const reihenfolge = liste(angabe);

    if (reihenfolge) {
      jeFeld[feld] = reihenfolge;
    }
  }

  const benutzer: Record<string, { quelle: string; grund?: string }> = {};

  for (const [feld, angabe] of Object.entries((eintrag.byUser ?? {}) as Record<string, unknown>)) {
    const regel = requireObject(angabe, `Die Benutzerregel für „${feld}"`) as Record<string, unknown>;
    const quelle = text(regel.source);

    if (quelle) {
      benutzer[feld] = { quelle, grund: text(regel.reason) };
    }
  }

  return {
    quellen: liste(eintrag.sources),
    jeFeld,
    benutzer,
    aktualitaet: eintrag.recency === true,
    vergleich: vergleichAus(eintrag.compare),
  };
}

function dublettenAus(wert: unknown): Dublettenregel | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Dublettenregel') as Record<string, unknown>;
  const auswahlwert = auswahl(eintrag.choose, AUSWAHLEN, 'duplicates.choose');

  if (!auswahlwert) {
    return undefined;
  }

  return { auswahl: auswahlwert, verbleib: auswahl(eintrag.remainder, VERBLEIBE, 'duplicates.remainder') };
}

function mehrfachtrefferAus(wert: unknown): Mehrfachtrefferregel | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Mehrfachtrefferregel') as Record<string, unknown>;
  const regel = auswahl(eintrag.rule, ['KONFLIKT', 'ALLE', 'FELD'] as const, 'multipleMatches.rule');

  if (regel === 'FELD') {
    const feld = text(eintrag.field);

    if (!feld) {
      throw new ApiError(400, 'Soll ein Feld unter mehreren Treffern entscheiden, muss es benannt sein');
    }

    return { regel: 'FELD', feld, nimm: auswahl(eintrag.take, ['GROESSTER', 'KLEINSTER'] as const, 'multipleMatches.take') ?? 'GROESSTER' };
  }

  return regel ? { regel } : undefined;
}

function referenzenAus(wert: unknown): { bestand: Referenzbestand; regel: Referenzregel }[] | undefined {
  if (!Array.isArray(wert) || wert.length === 0) {
    return undefined;
  }

  return wert.map((angabe, stelle) => {
    const eintrag = requireObject(angabe, `Die ${stelle + 1}. Referenz`) as Record<string, unknown>;
    const bestand = requireObject(eintrag.source, 'Der Referenzbestand') as Record<string, unknown>;
    const regel = requireObject(eintrag.rule, 'Die Referenzregel') as Record<string, unknown>;
    const felder = liste(bestand.fields);
    const schluesselfelder = liste(regel.fields);

    if (!felder || felder.length === 0) {
      throw new ApiError(400, 'Ein Referenzbestand ohne Feldnamen lässt sich nicht befragen');
    }

    if (!schluesselfelder || schluesselfelder.length === 0) {
      throw new ApiError(400, 'Ohne Schlüsselfelder gibt es nichts nachzuschlagen');
    }

    const uebernehmen = Array.isArray(regel.take)
      ? (regel.take as unknown[]).map((paar) => {
          const zuordnung = requireObject(paar, 'Die Übernahme') as Record<string, unknown>;

          return { feld: String(zuordnung.field ?? ''), aus: String(zuordnung.from ?? '') };
        })
      : undefined;

    return {
      bestand: {
        id: String(bestand.id ?? `referenz${stelle + 1}`),
        name: String(bestand.name ?? `Referenz ${stelle + 1}`),
        version: text(bestand.version),
        felder,
        zeilen: Array.isArray(bestand.rows)
          ? (bestand.rows as unknown[]).map((zeile) => (Array.isArray(zeile) ? zeile.map(String) : []))
          : [],
      },
      regel: {
        felder: schluesselfelder,
        referenzfelder: liste(regel.referenceFields),
        vergleich: vergleichAus(regel.compare),
        uebernehmen,
        ohneTreffer: auswahl(regel.onMiss, OHNE_TREFFER, 'references.rule.onMiss'),
        aehnlich:
          regel.fuzzy === true
            ? true
            : typeof regel.fuzzy === 'object' && regel.fuzzy !== null
              ? { schwelle: schwelleAus((regel.fuzzy as Record<string, unknown>).threshold, 'references.rule.fuzzy.threshold') }
              : undefined,
      },
    };
  });
}

function ergaenzungAus(wert: unknown): Ergaenzungsregel | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Ergänzungsregel') as Record<string, unknown>;
  const vergleichbarAn = liste(eintrag.comparableBy);
  const felder = liste(eintrag.fields);

  if (!vergleichbarAn || vergleichbarAn.length === 0 || !felder || felder.length === 0) {
    throw new ApiError(
      400,
      'Zum Ergänzen gehört beides: woran sich „vergleichbar" bemisst und welche Felder ergänzt werden dürfen'
    );
  }

  return {
    vergleichbarAn,
    felder,
    mindestens: typeof eintrag.atLeast === 'number' ? eintrag.atLeast : undefined,
    vergleich: vergleichAus(eintrag.compare),
  };
}

/**
 * Die Schwelle, ab der zwei Werte als ähnlich gelten.
 *
 * Anders als die Konfidenzschwelle darf sie aus der Anfrage kommen: Sie
 * entscheidet nicht, ob etwas automatisch geschieht, sondern nur, wie viele
 * Fragen gestellt werden. Wer sie zu tief setzt, bekommt einen Berg Prüffälle —
 * das ist lästig und nicht gefährlich.
 */
function schwelleAus(wert: unknown, feld: string): number | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (typeof wert !== 'number' || !Number.isFinite(wert) || wert <= 0 || wert > 1) {
    throw new ApiError(400, `„${String(wert)}" ist keine Schwelle für „${feld}". Erwartet wird eine Zahl über 0 und höchstens 1`);
  }

  return wert;
}

function aehnlichkeitAus(wert: unknown): Aehnlichkeitsregeln | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Ähnlichkeitssuche') as Record<string, unknown>;
  const felder = liste(eintrag.fields);

  if (!felder || felder.length === 0) {
    throw new ApiError(400, 'Ohne Felder gibt es nichts, woran sich Ähnlichkeit messen ließe');
  }

  return {
    felder,
    schwelle: schwelleAus(eintrag.threshold, 'similarity.threshold'),
    vergleich: vergleichAus(eintrag.compare),
    hoechstens: typeof eintrag.atMost === 'number' ? eintrag.atMost : undefined,
  };
}
