import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { ReferenzquellenFehler } from '../../../application/consolidation/Referenzquellendienst.js';
import {
  einstellungenDesMandanten,
  regionAus,
  wirksameEinstellungen,
} from '../../../domain/consolidation/Einstellungen.js';
import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import { ApiError, created, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

/**
 * Die Verwaltung der Referenzquellen (SPEC-04, Abschnitt 6 und 8).
 *
 * Sie liegt bei `MANAGE_JOBS`: Eine Referenzquelle gehört zur Einrichtung der
 * Verarbeitung und nicht zur Anlage des Mandanten. Wer Workflows baut, richtet
 * auch ein, wogegen sie abgleichen.
 */
export function referenceRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/reference-sources',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => ok(await application.referenzquellen.liste(query.get('tenantId') ?? undefined)),
    },
    {
      method: 'POST',
      pattern: '/api/reference-sources',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const eingabe = requireObject(body, 'Die Referenzquelle');
        const tenantId = requireString(eingabe, 'tenantId');
        const verzeichnis = requireString(eingabe, 'directory');

        await grenze(application, tenantId, verzeichnis);

        try {
          return created(
            await application.referenzquellen.lege(
              {
                id: optionalString(eingabe, 'id'),
                tenantId,
                name: requireString(eingabe, 'name'),
                beschreibung: optionalString(eingabe, 'description'),
                verzeichnis,
                datei: optionalString(eingabe, 'file'),
                version: optionalString(eingabe, 'version'),
              },
              session ? { id: session.user.id, name: session.user.username } : undefined
            )
          );
        } catch (fehler) {
          throw alsApiFehler(fehler, 400);
        }
      },
    },
    {
      /**
       * Nachsehen, was gerade in der Datei steht.
       *
       * Eine eigene Handlung und kein Nebeneffekt des Speicherns: Wer beim
       * Einrichten sehen will, ob die Referenz die Felder hat, über die er
       * nachschlagen will, soll danach fragen können — und nicht erst im
       * Nachtlauf erfahren, dass kein Treffer zustande kommt.
       */
      method: 'POST',
      pattern: '/api/reference-sources/:id/check',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body }) => {
        const eingabe = requireObject(body ?? {}, 'Die Prüfung');
        const tenantId = requireString(eingabe, 'tenantId');
        const mandant = await application.tenantService.getById(tenantId);

        if (!mandant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);

        try {
          return ok(
            await application.referenzquellen.pruefe(params.id, {
              region: regionAus(wirksam),
              threshold: wirksam.mindestKonfidenz,
              nullValues: wirksam.nullWerte,
              eingelesen: new Date().toISOString(),
            })
          );
        } catch (fehler) {
          /*
           * 404 und nicht 500: Eine Datei, die nicht da ist, ist keine Störung,
           * sondern eine Auskunft — und der Satz dazu nennt die Quelle beim
           * Namen.
           */
          throw alsApiFehler(fehler, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/reference-sources/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) => {
        try {
          await application.referenzquellen.entferne(
            params.id,
            session ? { id: session.user.id, name: session.user.username } : undefined
          );
        } catch (fehler) {
          throw alsApiFehler(fehler, 404);
        }

        return ok({ entfernt: params.id });
      },
    },
  ];
}

/**
 * Dieselbe Grenze wie überall: Ein Mandant sieht nicht in den Ordner eines
 * anderen. Eine Referenzquelle liest nur — und wäre damit der bequemste Weg
 * dorthin.
 */
async function grenze(application: UnikomApplication, tenantId: string, verzeichnis: string): Promise<void> {
  const mandant = await application.tenantService.getById(tenantId);

  if (!mandant) {
    throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
  }

  try {
    assertWithinTenant(mandant, verzeichnis, 'Dieses Verzeichnis');
  } catch (fehler) {
    throw new ApiError(403, fehler instanceof Error ? fehler.message : String(fehler));
  }
}

function alsApiFehler(fehler: unknown, status: number): ApiError {
  if (fehler instanceof ReferenzquellenFehler) {
    return new ApiError(status, fehler.message);
  }

  throw fehler;
}
