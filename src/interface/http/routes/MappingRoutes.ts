import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { AUSGELIEFERT } from '../../../domain/mapping/Bezeichnungen.js';
import type { Spalte } from '../../../domain/mapping/Feldzuordnung.js';
import type { Ebene } from '../../../domain/consolidation/Einstellungen.js';
import { wirkt, type Mappingart, type Mappingregel } from '../../../domain/mapping/Regelbestand.js';
import { ApiError, created, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

/**
 * Die Mapping-Verwaltung (SPEC-02, Abschnitt 19) und die Vorschau (SPEC-09,
 * Abschnitt 11).
 *
 * Sie liegt bei `MANAGE_JOBS`: Ein Mapping gehört zur Einrichtung eines
 * Workflows und nicht zur Anlage. Wer Workflows baut, baut auch die Zuordnungen
 * darin.
 */
const ARTEN: readonly Mappingart[] = ['WERT', 'FELD'];
const EBENEN: readonly Ebene[] = ['ALLGEMEIN', 'PROFIL', 'MANDANT'];

export function mappingRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/mappings',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => {
        const tenantId = query.get('tenantId') ?? undefined;
        const regeln = await application.mappingService.alle(tenantId);
        const art = query.get('art');
        const suche = (query.get('q') ?? '').toLowerCase();

        const gefiltert = regeln
          .filter((regel) => !art || regel.art === art)
          .filter(
            (regel) =>
              suche === '' ||
              regel.von.toLowerCase().includes(suche) ||
              regel.nach.toLowerCase().includes(suche) ||
              (regel.feld ?? '').toLowerCase().includes(suche)
          );

        return ok({
          regeln: gefiltert.map(toView),
          /*
           * Die ausgelieferte Bezeichnungsliste steht daneben, damit die
           * Oberfläche die internen Felder zur Auswahl anbieten kann — ohne
           * sie müsste jemand `customerId` von Hand tippen und sich vertippen.
           */
          felder: AUSGELIEFERT.map((bezeichnung) => ({
            intern: bezeichnung.intern,
            label: bezeichnung.label,
            typen: bezeichnung.typen ?? [],
          })),
        });
      },
    },
    {
      /* Die Vorschau vor der Anwendung — was übernommen wird, was vorliegt, was offen bleibt. */
      method: 'POST',
      pattern: '/api/mappings/preview',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'Die Vorschau');
        const tenantId = requireString(input, 'tenantId');

        if (!(await application.tenantService.getById(tenantId))) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const spalten = spaltenAus(input.columns);

        return ok(
          await application.mappingService.vorschau(spalten, {
            tenantId,
            profilId: optionalString(input, 'profileId'),
          })
        );
      },
    },
    {
      method: 'POST',
      pattern: '/api/mappings',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'Das Mapping');
        const art = wertAus(input.art, ARTEN, 'Art');
        const ebene = wertAus(input.ebene ?? 'MANDANT', EBENEN, 'Ebene');
        const tenantId = optionalString(input, 'tenantId');

        if (ebene !== 'ALLGEMEIN' && !tenantId) {
          throw new ApiError(400, 'Für ein Mapping auf Mandanten- oder Profilebene fehlt der Mandant');
        }

        const regel = await application.mappingService.bestaetige({
          art,
          ebene,
          tenantId,
          profilId: optionalString(input, 'profileId'),
          feld: optionalString(input, 'feld'),
          von: requireString(input, 'von'),
          nach: requireString(input, 'nach'),
          wer: session ? { id: session.user.id, name: session.user.username } : undefined,
        });

        return created(toView(regel));
      },
    },
    {
      /*
       * Zurücknehmen statt löschen.
       *
       * DELETE wäre die naheliegende Methode und die falsche: Die Regel bleibt
       * stehen. Was hier geschieht, ist eine Änderung ihres Zustands, und die
       * Adresse sagt das auch.
       */
      method: 'POST',
      pattern: '/api/mappings/:id/withdraw',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) => {
        try {
          return ok(
            toView(
              await application.mappingService.nimmZurueck(
                params.id,
                session ? { id: session.user.id, name: session.user.username } : undefined
              )
            )
          );
        } catch (fehler) {
          throw new ApiError(404, fehler instanceof Error ? fehler.message : String(fehler));
        }
      },
    },
    {
      method: 'POST',
      pattern: '/api/mappings/:id/restore',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, session }) => {
        try {
          return ok(
            toView(
              await application.mappingService.gibFrei(
                params.id,
                session ? { id: session.user.id, name: session.user.username } : undefined
              )
            )
          );
        } catch (fehler) {
          throw new ApiError(404, fehler instanceof Error ? fehler.message : String(fehler));
        }
      },
    },
  ];
}

function wertAus<T extends string>(wert: unknown, erlaubt: readonly T[], was: string): T {
  if (typeof wert !== 'string' || !(erlaubt as readonly string[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}" ist keine gültige ${was}. Erwartet wird eine von: ${erlaubt.join(', ')}`);
  }

  return wert as T;
}

function spaltenAus(wert: unknown): Spalte[] {
  if (!Array.isArray(wert) || wert.length === 0) {
    throw new ApiError(400, 'Für eine Vorschau werden die Spalten gebraucht, die zugeordnet werden sollen');
  }

  return wert.map((eintrag, stelle) => {
    const spalte = eintrag as { name?: unknown; type?: unknown; values?: unknown };

    if (typeof spalte.name !== 'string') {
      throw new ApiError(400, `Der Spalte an Stelle ${stelle + 1} fehlt der Name`);
    }

    return {
      name: spalte.name,
      typ: (typeof spalte.type === 'string' ? spalte.type : 'STRING') as Spalte['typ'],
      werte: Array.isArray(spalte.values) ? (spalte.values as string[]).map(String) : undefined,
    };
  });
}

export function toView(regel: Mappingregel): Record<string, unknown> {
  return {
    id: regel.id,
    art: regel.art,
    ebene: regel.ebene,
    tenantId: regel.tenantId,
    profileId: regel.profilId,
    feld: regel.feld,
    von: regel.von,
    nach: regel.nach,
    herkunft: regel.herkunft,
    bestaetigt: regel.bestaetigt,
    bestaetigungen: regel.bestaetigungen,
    anwendungen: regel.anwendungen,
    vorlaeufig: regel.vorlaeufig === true,
    /** Ob sie gerade wirkt — die Frage, die ein Mensch als erste stellt. */
    wirkt: wirkt(regel),
    erstellt: regel.erstellt.toISOString(),
    erstelltVonName: regel.erstelltVonName,
    zurueckgenommen: regel.zurueckgenommen?.toISOString(),
  };
}
