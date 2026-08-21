import { ErgebnisFehler, type Abschlussauftrag } from '../../../application/result/ResultService.js';
import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { AuthenticatedSession } from '../../../application/users/SessionService.js';
import {
  einstellungenDesMandanten,
  regionAus,
  wirksameEinstellungen,
} from '../../../domain/consolidation/Einstellungen.js';
import type { FieldType } from '../../../domain/consolidation/Recognition.js';
import { AUSGELIEFERTE_REGELN } from '../../../domain/quality/Regeln.js';
import type { Freigabebedingungen } from '../../../domain/result/Freigabe.js';
import type { Zielfeld } from '../../../domain/result/Ergebnispruefung.js';
import { stageFeatures, stageIsActive } from '../../../domain/transfer/WorkflowStages.js';
import { ApiError, ok, requireObject, requireString, type ApiResponse, type Route } from '../Http.js';

/**
 * Validierung und Freigabe über die Schnittstelle (SPEC-08 §10 bis §13).
 *
 * Drei Wege hinein, und der Unterschied ist wichtig:
 *
 * ```text
 * POST …/validate   prüft und legt nichts an     — der Testlauf
 * POST …/complete   prüft, legt an, gibt ggf. frei
 * POST …/:id/release  ein Mensch gibt frei
 * ```
 *
 * Der mittlere ist der einzige, der einen Ergebnisstand erzeugt. Ihn und den
 * ersten in einen Aufruf mit Schalter zu legen, wäre die kürzere Schnittstelle
 * und die, bei der irgendwann versehentlich ein Testlauf im Bestand landet.
 */
export function resultRoutes(application: UnikomApplication): Route[] {
  const auftragAus = async (eingabe: Record<string, unknown>): Promise<Omit<Abschlussauftrag, 'jobId'>> => {
    const tenantId = requireString(eingabe, 'tenantId');
    const mandant = await application.tenantService.getById(tenantId);

    if (!mandant) {
      throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
    }

    const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);
    const bericht = requireObject(eingabe.report, 'Der Konsolidierungsbericht');

    if (!Array.isArray(bericht.zeilen) || !Array.isArray(bericht.felder)) {
      throw new ApiError(400, 'Der Bericht braucht Felder und Zeilen — er kommt aus dem Prüflauf');
    }

    const eingang = requireObject(eingabe.input, 'Der Eingangsbestand');

    return {
      tenantId,
      laufId: text(eingabe.runId) ?? new Date().toISOString(),
      ausLauf: text(eingabe.fromRun),
      bericht: bericht as unknown as Abschlussauftrag['bericht'],
      eingang: {
        felder: Array.isArray(eingang.fields) ? eingang.fields.map(String) : [],
        zeilen: Array.isArray(eingang.rows)
          ? (eingang.rows as unknown[]).map((zeile) => (Array.isArray(zeile) ? zeile.map(String) : []))
          : [],
      },
      zielstruktur: zielstrukturAus(eingabe.target),
      schluessel: schluesselAus(eingabe.key),
      /*
       * Region, Nullwerte und Jahrhundertgrenze kommen aus der Hierarchie des
       * Mandanten, nicht aus der Anfrage — sonst ließe sich eine Prüfung
       * bestehen, die im nächsten Lauf durchfällt.
       */
      region: regionAus(wirksam),
      nullWerte: wirksam.nullWerte,
      jahrhundertGrenze: wirksam.jahrhundertGrenze,
      qualitaet: AUSGELIEFERTE_REGELN,
      massstaebe: massstaebeAus(eingabe.tolerance),
      bedingungen: bedingungenAus(eingabe.conditions),
      konflikte: konflikteAus(eingabe.conflicts),
    };
  };

  return [
    {
      /* Der Testlauf: prüfen, ohne etwas anzulegen (SPEC-08, Abschnitt 11). */
      method: 'POST',
      pattern: '/api/results/validate',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) =>
        ok(application.resultService.pruefe(await auftragAus(requireObject(body, 'Die Prüfung')))),
    },
    {
      method: 'POST',
      pattern: '/api/results/complete',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Der Abschluss');

        /*
         * Pflichtangabe — anders als beim Testlauf. Ein Ergebnisstand, den
         * niemand einem Workflow zuordnen kann, ließe sich später nicht mehr
         * gegen dessen Einstellungen prüfen, und die Übergabe müsste raten, ob
         * Modul 3 eingeschaltet war.
         */
        const jobId = requireString(eingabe, 'jobId');

        return gefangen(async () =>
          application.resultService.schliesseAb({ ...(await auftragAus(eingabe)), jobId })
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/results',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) =>
        ok(
          (await application.resultService.liste(query.get('tenantId') ?? 'default', query.get('runId') ?? undefined)).map(
            /*
             * Ohne die Zeilen. Eine Liste von zwanzig Ergebnisständen mit je
             * zehntausend Datensätzen wäre ein Übertragungsproblem und für die
             * Übersicht nutzlos — die Zeilen holt, wer einen Stand öffnet.
             */
            (stand) => ({ ...stand, zeilen: undefined, datensaetze: stand.zeilen.length })
          )
        ),
    },
    {
      method: 'GET',
      pattern: '/api/results/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params }) => {
        const stand = await application.resultService.stand(params.id);

        if (!stand) {
          throw new ApiError(404, `Den Ergebnisstand „${params.id}“ gibt es nicht`);
        }

        return ok(stand);
      },
    },
    {
      method: 'POST',
      pattern: '/api/results/:id/release',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body, session }) => {
        const eingabe = requireObject(body ?? {}, 'Die Freigabe');

        return gefangen(async () =>
          application.resultService.gibFrei(params.id, benutzer(session), {
            begruendung: text(eingabe.reason),
            bedingungen: bedingungenAus(eingabe.conditions),
            konflikte: konflikteAus(eingabe.conflicts),
          })
        );
      },
    },
    {
      /*
       * Die Übergabe an Modul 3 — die einzige Tür aus der Konsolidierung.
       *
       * Sie liefert einen freigegebenen Stand oder eine Begründung, warum
       * nicht. Einen Weg an der Prüfung vorbei gibt es nicht: Modul 2 schreibt
       * selbst nirgendwohin, und Modul 3 bekommt nichts anderes als das hier.
       */
      method: 'GET',
      pattern: '/api/results/:id/handover',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params }) => {
        /*
         * Gekauft **und** angehakt. Die Lizenz steht an der Installation, das
         * Häkchen am Workflow — und der Workflow steht am Ergebnisstand, nicht
         * in der Anfrage. Als Parameter wäre er das Schlupfloch: Wer ihn
         * wegließe, käme an der zweiten Bedingung vorbei.
         */
        const stand = await application.resultService.stand(params.id);

        if (!stand) {
          throw new ApiError(404, `Den Ergebnisstand „${params.id}“ gibt es nicht`);
        }

        const job = await application.jobService.getById(stand.jobId);

        if (!job) {
          throw new ApiError(
            409,
            `Der Workflow „${stand.jobId}“, aus dem dieser Ergebnisstand stammt, ist nicht mehr vorhanden. ` +
              'Ob Modul 3 darin eingeschaltet war, lässt sich damit nicht mehr feststellen'
          );
        }

        return gefangen(() =>
          application.resultService.uebergabe(params.id, {
            gekauft: (feature) => application.features.isEnabled(feature),
            /*
             * Angehakt heißt: Das Glied „Daten exportieren/importieren" läuft
             * in diesem Workflow **und** sein Zweig verlangt genau dieses
             * Modul. Ein Workflow, der in eine Datenbank importiert, hakt die
             * Konvertierung nicht mit an.
             */
            angehakt: (feature) => stageIsActive(job, 'DELIVER') && stageFeatures('DELIVER', job).includes(feature),
          })
        );
      },
    },
    {
      /* Einen früheren Stand wiederherstellen (SPEC-06, Abschnitt 14). */
      method: 'POST',
      pattern: '/api/results/:id/restore',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body, session }) => {
        const eingabe = requireObject(body ?? {}, 'Die Wiederherstellung');

        return gefangen(async () =>
          application.resultService.stelleWiederHer(params.id, benutzer(session), {
            neuerLaufId: text(eingabe.newRunId) ?? new Date().toISOString(),
          })
        );
      },
    },
  ];
}

function text(wert: unknown): string | undefined {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : undefined;
}

function zahl(wert: unknown): number | undefined {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : undefined;
}

function benutzer(session: AuthenticatedSession | undefined): { id: string; name?: string } {
  if (!session) {
    throw new ApiError(401, 'Für die Freigabe ist eine Anmeldung nötig');
  }

  return { id: session.user.id, name: session.user.username };
}

const TYPEN: readonly FieldType[] = ['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'BINARY'];

function zielstrukturAus(wert: unknown): Zielfeld[] | undefined {
  if (!Array.isArray(wert) || wert.length === 0) {
    return undefined;
  }

  return wert.map((angabe) => {
    const eintrag = requireObject(angabe, 'Das Zielfeld') as Record<string, unknown>;
    const name = text(eintrag.name);

    if (!name) {
      throw new ApiError(400, 'Ein Zielfeld ohne Namen lässt sich nicht prüfen');
    }

    if (eintrag.type !== undefined && !(TYPEN as readonly unknown[]).includes(eintrag.type)) {
      throw new ApiError(400, `„${String(eintrag.type)}" ist kein Zieltyp für „${name}"`);
    }

    return { name, typ: eintrag.type as FieldType | undefined, pflicht: eintrag.required === true };
  });
}

function schluesselAus(wert: unknown): Abschlussauftrag['schluessel'] {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Der Schlüssel') as Record<string, unknown>;
  const felder = Array.isArray(eintrag.fields) ? eintrag.fields.map(String) : [];

  return felder.length > 0 ? { felder } : undefined;
}

function massstaebeAus(wert: unknown): Abschlussauftrag['massstaebe'] {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Maßstäbe') as Record<string, unknown>;

  return {
    anzahlToleranz: zahl(eintrag.count),
    fuellgradToleranz: zahl(eintrag.fill),
    beispiele: zahl(eintrag.examples),
  };
}

/**
 * Die Freigabebedingungen aus der Anfrage.
 *
 * Anders als die Region dürfen sie mitkommen: Sie machen die Freigabe
 * **strenger oder milder**, und beides ist eine Entscheidung des Betreibers,
 * die im Vermerk landet. Was sie nicht können, ist eine Prüfung bestehen zu
 * lassen, die durchgefallen ist — die Befunde entstehen vorher und unabhängig.
 */
function bedingungenAus(wert: unknown): Freigabebedingungen | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Die Freigabebedingungen') as Record<string, unknown>;

  return {
    warnungenBlockieren: eintrag.warningsBlock === true,
    konflikteBlockieren: eintrag.conflictsBlock !== false,
    kritischeErlaubt: zahl(eintrag.criticalAllowed),
    mindestens: zahl(eintrag.minimum),
    immerManuell: eintrag.alwaysManual === true,
  };
}

function konflikteAus(wert: unknown): { offen: number; kritischOffen: number } | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Der Konfliktstand') as Record<string, unknown>;

  return { offen: zahl(eintrag.open) ?? 0, kritischOffen: zahl(eintrag.criticalOpen) ?? 0 };
}

async function gefangen<T>(handlung: () => Promise<T>): Promise<ApiResponse> {
  try {
    return ok(await handlung());
  } catch (fehler) {
    if (fehler instanceof ErgebnisFehler) {
      throw new ApiError(fehler.status, fehler.message);
    }

    throw fehler;
  }
}
