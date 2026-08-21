import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { Feldregeln } from '../../../application/quality/QualityService.js';
import { einstellungenDesMandanten, regionAus, wirksameEinstellungen } from '../../../domain/consolidation/Einstellungen.js';
import type { FieldType } from '../../../domain/consolidation/Recognition.js';
import { AUSGELIEFERTE_REGELN } from '../../../domain/quality/Regeln.js';
import { ApiError, ok, requireObject, requireString, type Route } from '../Http.js';

/**
 * Die Qualitätsprüfung eines Bestands (Etappe 4).
 *
 * Sie läuft auf dem Server, wie jede Verarbeitung — schon deshalb, weil sie die
 * Region des Mandanten braucht: Ob „1,234" tausendzweihundert ist oder eins
 * Komma zwei, entscheidet sie und nicht der Rechner, an dem jemand sitzt.
 */
const TYPEN: readonly FieldType[] = ['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'BINARY'];

export function qualityRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'POST',
      pattern: '/api/quality/check',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'Die Prüfung');
        const tenantId = requireString(input, 'tenantId');
        const mandant = await application.tenantService.getById(tenantId);

        if (!mandant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const felder = input.fields;
        const zeilen = input.rows;

        if (!Array.isArray(felder) || felder.length === 0) {
          throw new ApiError(400, 'Ohne Feldnamen lässt sich nichts prüfen');
        }

        if (!Array.isArray(zeilen)) {
          throw new ApiError(400, 'Ohne Zeilen lässt sich nichts prüfen');
        }

        /*
         * Die geltenden Einstellungen kommen aus der Hierarchie und nicht aus
         * der Anfrage. Wer die Region mitschicken dürfte, könnte eine Prüfung
         * bestehen lassen, die im Lauf danach fehlschlägt — und dann glaubt der
         * Vorschau niemand mehr.
         */
        const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant), undefined);

        return ok(
          application.qualityService.bearbeite({
            felder: felder.map(String),
            zeilen: (zeilen as unknown[][]).map((zeile) => (Array.isArray(zeile) ? zeile.map(String) : [])),
            region: regionAus(wirksam),
            regeln: feldregelnAus(input.rules),
            nullWerte: wirksam.nullWerte,
            jahrhundertGrenze: wirksam.jahrhundertGrenze,
          })
        );
      },
    },
    {
      /* Welche fachlichen Regeln gelten — damit die Oberfläche sie zeigen kann. */
      method: 'GET',
      pattern: '/api/quality/rules',
      authorization: 'MANAGE_JOBS',
      handle: async () =>
        ok(
          AUSGELIEFERTE_REGELN.map((regel) => ({
            id: regel.id,
            name: regel.name,
            feld: regel.feld,
            art: regel.pruefung.art,
            schwere: regel.schwere,
          }))
        ),
    },
  ];
}

function feldregelnAus(wert: unknown): Record<string, Feldregeln> | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (typeof wert !== 'object') {
    throw new ApiError(400, 'Die Feldregeln müssen als Objekt übergeben werden');
  }

  const ergebnis: Record<string, Feldregeln> = {};

  for (const [feld, angabe] of Object.entries(wert as Record<string, unknown>)) {
    const eintrag = (angabe ?? {}) as { target?: unknown; normalise?: unknown; emptyAllowed?: unknown };

    if (eintrag.target !== undefined && !(TYPEN as readonly unknown[]).includes(eintrag.target)) {
      throw new ApiError(
        400,
        `„${String(eintrag.target)}" ist kein Zieltyp für „${feld}". Erwartet wird einer von: ${TYPEN.join(', ')}`
      );
    }

    ergebnis[feld] = {
      ziel: eintrag.target as FieldType | undefined,
      normalisierung: (eintrag.normalise ?? {}) as Feldregeln['normalisierung'],
      leerErlaubt: eintrag.emptyAllowed === undefined ? undefined : eintrag.emptyAllowed === true,
    };
  }

  return ergebnis;
}
