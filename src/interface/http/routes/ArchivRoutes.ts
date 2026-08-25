import path from 'node:path';

import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import { ApiError, ok, requireObject, requireString, type Route } from '../Http.js';

/**
 * Der Blick ins Archiv (FR_006, Runde 10).
 *
 * ## Warum es diese Türen überhaupt gibt
 *
 * Das Archiv hält die Eingangsdateien im Original, verschlüsselt. Daran hängt
 * die Zusage, die das Zerlegen einer Lieferung erlaubt: „das Original liegt im
 * Archiv". Ein Rückweg, den nur der Quelltext kennt, löst diese Zusage nicht
 * ein — um zwei Uhr nachts steht ein Mensch davor und will sehen, was der
 * Lieferant geschickt hat.
 *
 * ## Warum drei Türen und nicht eine
 *
 * ```text
 * packages  welche Pakete liegen da        ohne eines zu öffnen
 * open      was steckt in diesem Paket     Namen und Größen, kein Inhalt
 * file      diese eine Datei, bitte        der Inhalt
 * ```
 *
 * Ein Verzeichnis mit dreihundert Paketen entschlüsselte sonst dreihundert
 * Archive, nur um eine Liste zu zeigen. Und wer wissen will, ob die Lieferung
 * von Dienstag drei Dateien hatte, braucht dafür keine Kundendaten.
 *
 * ## Die Mandantengrenze gilt hier besonders
 *
 * Diese Türen entschlüsseln. Ein Pfad, der aus dem Verzeichnis des Mandanten
 * hinausführt, wäre damit ein Weg an jede Datei auf dieser Maschine, die
 * zufällig unser Umschlag ist. Geprüft wird deshalb **jeder** Pfad, bei jedem
 * Aufruf, und zwar bevor irgendetwas gelesen wird.
 */
export function archivRoutes(application: UnikomApplication): Route[] {
  /** Der geprüfte Pfad — oder eine Absage, die sagt, woran es lag. */
  const gepruefterPfad = async (tenantId: string, pfad: string, was: string): Promise<string> => {
    const mandant = await application.tenantService.getById(tenantId);

    if (!mandant) {
      throw new ApiError(404, `Den Mandanten „${tenantId}" gibt es nicht`);
    }

    try {
      assertWithinTenant(mandant, pfad, was);
    } catch (fehler) {
      throw new ApiError(403, fehler instanceof Error ? fehler.message : String(fehler));
    }

    return pfad;
  };

  const dienst = () => {
    if (!application.archivdienst) {
      throw new ApiError(503, 'Diese Installation kann das Archiv nicht öffnen');
    }

    return application.archivdienst;
  };

  return [
    {
      /* Welche Pakete liegen im Archivverzeichnis — ohne eines zu öffnen. */
      method: 'GET',
      pattern: '/api/archive/packages',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => {
        const verzeichnis = query.get('directory');

        if (!verzeichnis) {
          throw new ApiError(400, 'Ohne Archivverzeichnis gibt es nichts aufzulisten');
        }

        const geprueft = await gepruefterPfad(query.get('tenantId') ?? 'default', verzeichnis, 'Dieses Verzeichnis');

        try {
          return ok(await dienst().liste(geprueft));
        } catch {
          /*
           * Ein Archivverzeichnis, das es noch nicht gibt, ist kein Fehler,
           * sondern der Normalfall vor dem ersten Lauf. Eine leere Liste sagt
           * dasselbe und erschreckt niemanden.
           */
          return ok([]);
        }
      },
    },
    {
      /* Was in einem Paket steckt: Namen und Größen, kein Inhalt. */
      method: 'POST',
      pattern: '/api/archive/open',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Das Archivpaket');
        const pfad = await gepruefterPfad(
          requireString(eingabe, 'tenantId'),
          requireString(eingabe, 'pfad'),
          'Dieses Paket'
        );

        const inhalt = await geoeffnet(dienst(), pfad);

        return ok({
          pfad: inhalt.pfad,
          dateien: inhalt.dateien.map((datei) => ({ name: datei.name, groesse: datei.inhalt.length })),
        });
      },
    },
    {
      /*
       * Eine einzelne Datei, als Base64.
       *
       * Base64 und nicht Text: Im Archiv liegt, was der Lieferant geschickt
       * hat — auch eine Arbeitsmappe. Sie als Text auszugeben hieße, sie
       * unterwegs kaputtzumachen, und zwar unbemerkt. Der Browser baut daraus
       * wieder Bytes; ob er sie anzeigt oder speichert, entscheidet er dort.
       */
      method: 'POST',
      pattern: '/api/archive/file',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const eingabe = requireObject(body, 'Die Archivdatei');
        const pfad = await gepruefterPfad(
          requireString(eingabe, 'tenantId'),
          requireString(eingabe, 'pfad'),
          'Dieses Paket'
        );

        const name = requireString(eingabe, 'name');
        const inhalt = await geoeffnet(dienst(), pfad);
        const datei = inhalt.dateien.find((eintrag) => eintrag.name === name);

        if (!datei) {
          throw new ApiError(404, `„${name}" steckt nicht in „${path.basename(pfad)}"`);
        }

        return ok({
          name: datei.name,
          groesse: datei.inhalt.length,
          inhalt: Buffer.from(datei.inhalt).toString('base64'),
        });
      },
    },
  ];
}

/**
 * Ein Paket aufmachen — und was schiefgeht, in Worte fassen.
 *
 * Ein falscher Schlüssel, eine veränderte Datei und etwas, das gar kein
 * Umschlag ist, kommen hier alle als Absage an. Ohne diese Übersetzung stünde
 * am Bildschirm ein Serverfehler, und der sagt niemandem, dass die Datei
 * angefasst wurde.
 */
async function geoeffnet(
  dienst: NonNullable<UnikomApplication['archivdienst']>,
  pfad: string
): Promise<Awaited<ReturnType<NonNullable<UnikomApplication['archivdienst']>['oeffne']>>> {
  try {
    return await dienst.oeffne(pfad);
  } catch (fehler) {
    throw new ApiError(422, fehler instanceof Error ? fehler.message : String(fehler));
  }
}
