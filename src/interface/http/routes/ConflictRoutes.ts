import { KonfliktFehler, type Benutzerangabe } from '../../../application/conflicts/ConflictService.js';
import { KorrekturFehler } from '../../../application/conflicts/Korrekturdienst.js';
import type { AuthenticatedSession } from '../../../application/users/SessionService.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type {
  Gruppierungsart,
  Konfliktfilter,
  Richtung,
  Sortierart,
} from '../../../domain/conflicts/Auswahl.js';
import type { Entscheidung, Feldentscheidung, Feldwahl } from '../../../domain/conflicts/Entscheidung.js';
import type { Konfliktstatus, Kritikalitaet } from '../../../domain/conflicts/Konfliktfall.js';
import {
  einstellungenDesMandanten,
  regionAus,
  wirksameEinstellungen,
} from '../../../domain/consolidation/Einstellungen.js';
import { verhaltenVon } from '../../../domain/conflicts/Konfliktverhalten.js';
import { AUSGELIEFERTE_REGELN } from '../../../domain/quality/Regeln.js';
import { ApiError, created, ok, requireObject, requireString, type ApiResponse, type Route } from '../Http.js';

/**
 * Die Konfliktbearbeitung über die Schnittstelle (SPEC-07).
 *
 * ## Warum die Vorschau eine eigene Route hat
 *
 * `POST …/preview` rechnet und schreibt nicht, `POST …/decide` rechnet und
 * schreibt. Ein Schalter `dryRun` im selben Aufruf wäre kürzer und der
 * gefährlichere Weg: Ein vergessenes Feld, ein `false` statt `true`, und aus
 * einer Ansicht wird eine Entscheidung. Zwei Adressen können nicht verwechselt
 * werden.
 *
 * ## Wer entscheidet, steht nicht im Rumpf
 *
 * Der Benutzer kommt aus der Sitzung. Wäre er ein Feld in der Anfrage, könnte
 * jeder jede Entscheidung unter fremdem Namen ablegen — und die
 * Nachvollziehbarkeit aus Abschnitt 12 wäre eine Behauptung.
 */
const STATUS: readonly Konfliktstatus[] = [
  'OFFEN',
  'ZURUECKGESTELLT',
  'BEREINIGT',
  'AKZEPTIERT',
  'ERNEUT_VERARBEITET',
  'ERFOLGREICH_VERARBEITET',
];

const KRITIKALITAETEN: readonly Kritikalitaet[] = ['INFORMATION', 'WARNUNG', 'KONFLIKT', 'PRUEFFALL', 'KRITISCH'];
const SORTIERUNGEN: readonly Sortierart[] = ['DRINGLICHKEIT', 'ENTSTEHUNG', 'AENDERUNG', 'ART', 'DATENSATZ'];
const GRUPPIERUNGEN: readonly Gruppierungsart[] = ['KEINE', 'ART', 'STATUS', 'KRITIKALITAET', 'QUELLE', 'FELD', 'LAUF'];
const RICHTUNGEN: readonly Richtung[] = ['AUF', 'AB'];

export function conflictRoutes(application: UnikomApplication): Route[] {
  /**
   * Die Regeln, unter denen entschieden wird.
   *
   * Sie kommen aus der Hierarchie des Mandanten und nicht aus der Anfrage —
   * genauso wie beim Prüflauf. Wer die Region mitschicken dürfte, könnte ein
   * Datum durchbekommen, das der nächste Lauf ablehnt.
   */
  const regelnFuer = async (tenantId: string) => {
    const mandant = await application.tenantService.getById(tenantId);

    if (!mandant) {
      throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
    }

    const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);

    return {
      region: regionAus(wirksam),
      nullWerte: wirksam.nullWerte,
      jahrhundertGrenze: wirksam.jahrhundertGrenze,
      qualitaet: AUSGELIEFERTE_REGELN,
      /*
       * Ob ein Fall hingenommen werden darf. Sie geht denselben Weg wie die
       * Regeln — durch `regelnFuer` und damit durch alle vier Türen:
       * Vorschau, Entscheidung, Massenvorschau, Massenentscheidung. Eine
       * Prüfung, die nur an einer davon hängt, ist an den anderen dreien nicht
       * vorhanden.
       */
      akzeptierenErlaubt: verhaltenVon(mandant.konflikte).akzeptierenErlaubt,
    };
  };

  return [
    {
      method: 'GET',
      pattern: '/api/conflicts',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query, session }) => {
        const tenantId = query.get('tenantId') ?? 'default';

        return ok(
          await application.conflictService.liste(tenantId, benutzer(session).id, {
            filter: filterAus(query),
            sortierung: auswahl(query.get('sort'), SORTIERUNGEN, 'sort'),
            richtung: auswahl(query.get('direction'), RICHTUNGEN, 'direction'),
            gruppierung: auswahl(query.get('group'), GRUPPIERUNGEN, 'group'),
          })
        );
      },
    },
    {
      /** Welche Ausleitungen es gibt — samt denen, deren Datei fortgeräumt ist. */
      method: 'GET',
      pattern: '/api/conflicts/exports',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => ok(await application.ausleitungsdienst.liste(query.get('tenantId') ?? undefined)),
    },
    {
      method: 'GET',
      pattern: '/api/conflicts/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) => {
        const ansicht = await application.conflictService.ansicht(params.id, benutzer(session).id);

        if (!ansicht) {
          throw new ApiError(404, `Den Konfliktfall „${params.id}“ gibt es nicht`);
        }

        return ok(ansicht);
      },
    },
    {
      /* In Bearbeitung nehmen (SPEC-07, Abschnitt 11). */
      method: 'POST',
      pattern: '/api/conflicts/:id/lock',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) =>
        gefangen(() => application.conflictService.sperren(params.id, benutzer(session))),
    },
    {
      method: 'POST',
      pattern: '/api/conflicts/:id/unlock',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) =>
        gefangen(() => application.conflictService.freigeben(params.id, benutzer(session))),
    },
    {
      /* Was die Entscheidung bewirken würde — ohne sie zu treffen. */
      method: 'POST',
      pattern: '/api/conflicts/:id/preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body }) => {
        const eingabe = requireObject(body, 'Die Vorschau');

        return gefangen(async () =>
          application.conflictService.vorschau(
            params.id,
            entscheidungAus(eingabe.decision),
            await regelnFuer(requireString(eingabe, 'tenantId'))
          )
        );
      },
    },
    {
      method: 'POST',
      pattern: '/api/conflicts/:id/decide',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body, session }) => {
        const eingabe = requireObject(body, 'Die Entscheidung');
        const regeln = await regelnFuer(requireString(eingabe, 'tenantId'));

        return gefangen(async () =>
          application.conflictService.entscheide(params.id, entscheidungAus(eingabe.decision), benutzer(session), {
            ...regeln,
            fassung: typeof eingabe.version === 'number' ? eingabe.version : undefined,
          })
        );
      },
    },
    {
      /* Umfang und Auswirkung einer Massenentscheidung (Abschnitt 8). */
      method: 'POST',
      pattern: '/api/conflicts/bulk/preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Die Massenvorschau');

        return gefangen(async () =>
          application.conflictService.massenvorschau(
            kennungen(eingabe.ids),
            entscheidungAus(eingabe.decision),
            await regelnFuer(requireString(eingabe, 'tenantId'))
          )
        );
      },
    },
    {
      method: 'POST',
      pattern: '/api/conflicts/bulk/decide',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const eingabe = requireObject(body, 'Die Massenentscheidung');

        return gefangen(async () =>
          application.conflictService.massenentscheidung(
            kennungen(eingabe.ids),
            entscheidungAus(eingabe.decision),
            benutzer(session),
            await regelnFuer(requireString(eingabe, 'tenantId'))
          )
        );
      },
    },
    {
      /* Der Bearbeitungsstand (Abschnitt 10). */
      method: 'PUT',
      pattern: '/api/conflicts/progress',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const eingabe = requireObject(body, 'Der Bearbeitungsstand');

        await application.conflictService.standSpeichern({
          benutzer: benutzer(session).id,
          tenantId: requireString(eingabe, 'tenantId'),
          zuletzt: typeof eingabe.last === 'string' ? eingabe.last : undefined,
          position: typeof eingabe.position === 'number' ? eingabe.position : undefined,
          filter: eingabe.filter ? (eingabe.filter as Konfliktfilter) : undefined,
          gruppierung: auswahl(eingabe.group, GRUPPIERUNGEN, 'group'),
          sortierung: auswahl(eingabe.sort, SORTIERUNGEN, 'sort'),
          richtung: auswahl(eingabe.direction, RICHTUNGEN, 'direction'),
          gespeichert: new Date().toISOString(),
        });

        return ok({ gespeichert: true });
      },
    },
    {
      /* Der Gesamtstatus vor der Freigabe (Abschnitt 13). */
      method: 'GET',
      pattern: '/api/conflicts/release/state',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) =>
        ok(await application.conflictService.freigabestand(query.get('tenantId') ?? 'default', query.get('runId') ?? undefined)),
    },
    {
      /* Die Konfliktzieldatei: die bereinigten Fälle zur erneuten Verarbeitung. */
      method: 'POST',
      pattern: '/api/conflicts/release',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const eingabe = requireObject(body, 'Die Freigabe');
        const tenantId = requireString(eingabe, 'tenantId');
        const stand = await application.conflictService.freigabestand(tenantId, text(eingabe.runId));

        if (!stand.freigabeMoeglich) {
          throw new ApiError(
            409,
            `Die erneute Verarbeitung ist nicht möglich: ${stand.hindernisse.length} Fall/Fälle warten noch ` +
              `auf eine Entscheidung (${stand.hindernisse
                .slice(0, 3)
                .map((hindernis) => `${hindernis.datensatz}: ${hindernis.ursache}`)
                .join('; ')}${stand.hindernisse.length > 3 ? ' …' : ''})`
          );
        }

        const laufId = text(eingabe.runId);

        if (!laufId) {
          throw new ApiError(
            400,
            'Die Freigabe braucht den Lauf, dessen Fälle entschieden wurden. Der Korrekturlauf rechnet auf ' +
              'dessen Lieferung — und die steht in dessen Archivpaket, nicht im Bestand aller Läufe'
          );
        }

        /*
         * Die Freigabe **ist** der Lauf.
         *
         * Vorher endete sie bei den Daten: Die Fälle standen auf „zur erneuten
         * Verarbeitung gegeben", und niemand verarbeitete sie erneut. Wer
         * zwanzig Fälle entschieden hatte, bekam „stehen bereit" zu lesen und
         * wartete auf etwas, das nicht kam.
         */
        const ergebnis = await application.korrekturdienst
          .fuehreAus({
            tenantId,
            laufId,
            neuerLaufId: text(eingabe.newRunId) ?? `KOR-${randomUUID()}`,
            benutzer: benutzer(session),
          })
          .catch((fehler: unknown) => {
            throw alsApiFehler(fehler);
          });

        /*
         * Die Konfliktzieldatei ist der **Nachweis** und nicht der Weg —
         * gerechnet hat der Lauf oben aus den Entscheidungen im Bestand. Ohne
         * Verzeichnis bleibt es bei den Daten in der Antwort; mit Verzeichnis
         * schreibt der **Server** sie dorthin. Eine im Browser gespeicherte
         * Kopie läge auf einem anderen Rechner als der Dienst.
         */
        const verzeichnis = text(eingabe.directory);

        if (!verzeichnis) {
          return ok(ergebnis);
        }

        const ausleitung = await application.ausleitungsdienst.leiteZielAus(ergebnis.zieldatei, {
          tenantId,
          verzeichnis: await gepruefteAblage(application, tenantId, verzeichnis),
          laufId,
          wer: benutzer(session),
        });

        return ok({ ...ergebnis, ausleitung });
      },
    },
    {
      /**
       * Die Konfliktdatei (SPEC-01, Abschnitt 23).
       *
       * Die Ausleitung des Konfliktbestands zur Ansicht und zur Weitergabe. Sie
       * führt den Bestand nicht — sie ist eine Abschrift, und deshalb darf sie
       * nach Ablauf der Frist fortgeräumt werden, ohne dass etwas verloren geht.
       */
      method: 'POST',
      pattern: '/api/conflicts/export',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const eingabe = requireObject(body, 'Die Ausleitung');
        const tenantId = requireString(eingabe, 'tenantId');

        return created(
          await application.ausleitungsdienst.leiteKonflikteAus({
            tenantId,
            verzeichnis: await gepruefteAblage(application, tenantId, text(eingabe.directory)),
            laufId: text(eingabe.runId),
            wer: benutzer(session),
          })
        );
      },
    },
  ];
}

/** Wo Ausleitungen liegen, wenn niemand etwas anderes sagt. */
export const AUSLEITUNGSORDNER = 'Konfliktausleitungen';

/**
 * Das Verzeichnis, geprüft gegen die Grenze des Mandanten.
 *
 * Eine Ausleitung **schreibt** — sie ist damit ein noch bequemerer Weg in den
 * Ordner eines anderen Mandanten als eine Vorschau, die nur liest.
 *
 * **Ohne Angabe** landet sie in einem festen Unterordner des
 * Mandantenverzeichnisses. Das ist Absicht: Wer eine Konfliktdatei
 * weitergeben will, soll nicht erst einen Pfad ausdenken müssen, und wer sie
 * später sucht, soll wissen, wo sie liegt. Hat der Mandant kein eigenes
 * Verzeichnis, muss eines genannt werden — sonst schriebe Unikom irgendwohin.
 */
async function gepruefteAblage(
  application: UnikomApplication,
  tenantId: string,
  verzeichnis: string | undefined
): Promise<string> {
  const mandant = await application.tenantService.getById(tenantId);

  if (!mandant) {
    throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
  }

  const ziel = verzeichnis ?? (mandant.rootDirectory ? join(mandant.rootDirectory, AUSLEITUNGSORDNER) : undefined);

  if (!ziel) {
    throw new ApiError(
      400,
      `Für den Mandanten „${mandant.name}“ ist kein eigenes Verzeichnis hinterlegt. ` +
        'Geben Sie an, wohin die Ausleitung geschrieben werden soll'
    );
  }

  try {
    assertWithinTenant(mandant, ziel, 'Dieses Verzeichnis');
  } catch (fehler) {
    throw new ApiError(403, fehler instanceof Error ? fehler.message : String(fehler));
  }

  return ziel;
}

function text(wert: unknown): string | undefined {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : undefined;
}

/**
 * Wer gerade handelt — aus der Sitzung und nicht aus dem Rumpf.
 *
 * Eine Historie, in der der Name aus der Anfrage stammt, dokumentiert nichts:
 * Sie hält fest, was jemand behauptet hat, nicht, wer es war.
 */
function benutzer(session: AuthenticatedSession | undefined): Benutzerangabe {
  if (!session) {
    throw new ApiError(401, 'Für die Konfliktbearbeitung ist eine Anmeldung nötig');
  }

  return { id: session.user.id, name: session.user.username };
}

function auswahl<T extends string>(wert: unknown, erlaubt: readonly T[], feld: string): T | undefined {
  if (wert === undefined || wert === null || wert === '') {
    return undefined;
  }

  if (!(erlaubt as readonly unknown[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}" ist kein Wert für „${feld}". Erwartet wird einer von: ${erlaubt.join(', ')}`);
  }

  return wert as T;
}

function mehrfach<T extends string>(wert: string | null, erlaubt: readonly T[], feld: string): T[] | undefined {
  if (!wert) {
    return undefined;
  }

  return wert.split(',').map((eintrag) => {
    const geprueft = auswahl(eintrag.trim(), erlaubt, feld);

    if (!geprueft) {
      throw new ApiError(400, `Leerer Wert in „${feld}"`);
    }

    return geprueft;
  });
}

function filterAus(query: URLSearchParams): Konfliktfilter {
  return {
    id: query.get('id') ?? undefined,
    datensatz: query.get('record') ?? undefined,
    quelle: query.get('source') ?? undefined,
    art: query.get('kind') ?? undefined,
    status: mehrfach(query.get('status'), STATUS, 'status'),
    kritikalitaet: mehrfach(query.get('criticality'), KRITIKALITAETEN, 'criticality'),
    feld: query.get('field') ?? undefined,
    laufId: query.get('runId') ?? undefined,
    seit: query.get('since') ?? undefined,
    bis: query.get('until') ?? undefined,
    bearbeiter: query.get('editor') ?? undefined,
    suche: query.get('q') ?? undefined,
  };
}

function kennungen(wert: unknown): string[] {
  if (!Array.isArray(wert) || wert.length === 0) {
    throw new ApiError(400, 'Ohne Fälle gibt es nichts zu entscheiden');
  }

  return wert.map(String);
}

function wahlAus(wert: unknown, feld: string): Feldwahl {
  const eintrag = requireObject(wert, `Die Wahl für „${feld}"`) as Record<string, unknown>;

  if (eintrag.kind === 'LEER') {
    return { art: 'LEER' };
  }

  if (eintrag.kind === 'EINGABE') {
    return { art: 'EINGABE', wert: String(eintrag.value ?? '') };
  }

  const quelle = text(eintrag.source);

  if (!quelle) {
    throw new ApiError(400, `Für „${feld}" fehlt die Angabe, aus welcher Quelle der Wert kommen soll`);
  }

  return { art: 'QUELLE', quelle };
}

function felderAus(wert: unknown): Feldentscheidung[] {
  if (!Array.isArray(wert)) {
    return [];
  }

  return wert.map((angabe) => {
    const eintrag = requireObject(angabe, 'Die Feldentscheidung') as Record<string, unknown>;
    const feld = text(eintrag.field);

    if (!feld) {
      throw new ApiError(400, 'Eine Feldentscheidung ohne Feldnamen lässt sich nicht zuordnen');
    }

    return { feld, wahl: wahlAus(eintrag.choice, feld) };
  });
}

function entscheidungAus(wert: unknown): Entscheidung {
  const eintrag = requireObject(wert, 'Die Entscheidung') as Record<string, unknown>;
  const art = auswahl(
    eintrag.kind,
    ['BEREINIGEN', 'ZUSAMMENFUEHREN', 'NICHT_ZUSAMMENFUEHREN', 'AKZEPTIEREN', 'ZURUECKSTELLEN', 'WIEDERAUFNEHMEN'] as const,
    'decision.kind'
  );

  if (!art) {
    throw new ApiError(400, 'Ohne Art der Entscheidung geschieht nichts');
  }

  const gemeinsam = { bemerkung: text(eintrag.note), regel: text(eintrag.rule) };

  return art === 'BEREINIGEN' || art === 'ZUSAMMENFUEHREN'
    ? { art, felder: felderAus(eintrag.fields), ...gemeinsam }
    : ({ art, ...gemeinsam } as Entscheidung);
}

/**
 * Ein Fachfehler trägt seinen Statuscode selbst.
 *
 * Ohne diese Umsetzung würde aus einer verlorenen Wettlaufsituation ein 500 —
 * und der Benutzer läse „Interner Fehler", wo „Jemand anderes war schneller"
 * steht. Dasselbe gilt für den Rückweg: „Zu diesem Lauf gibt es kein
 * Archivpaket" ist eine Auskunft und keine Panne.
 */
function alsApiFehler(fehler: unknown): unknown {
  if (fehler instanceof KonfliktFehler || fehler instanceof KorrekturFehler) {
    return new ApiError(fehler.status, fehler.message);
  }

  return fehler;
}

async function gefangen<T>(handlung: () => Promise<T>): Promise<ApiResponse> {
  try {
    return ok(await handlung());
  } catch (fehler) {
    throw alsApiFehler(fehler);
  }
}
