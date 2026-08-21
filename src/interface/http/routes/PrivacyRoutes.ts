import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import {
  auskunftsdateiname,
  auskunftsdokument,
  loeschbelegDateiname,
  loeschbelegDokument,
} from '../../../application/privacy/Auskunftsdokument.js';
import { fristenJeMandant } from '../../../application/privacy/Fristen.js';
import { MAX_FUNDE_AUSLEITUNG } from '../../../domain/privacy/DataStore.js';
import { ApiError, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

/**
 * Auskunft, Löschauftrag und die Auskunftsseite (FR_009).
 *
 * Alle drei sind Sache des Administrators: Ein Löschauftrag greift in jeden
 * Bestand der Installation, und die Auskunftsseite beschreibt sie vollständig.
 * Das ist keine Arbeit an Daten, sondern an der Anlage — und dafür steht in
 * Unikom die Stufe Administrator.
 */
export function privacyRoutes(application: UnikomApplication): Route[] {
  /** Der Name eines Mandanten, für Kopf und Dateiname der Ausleitung. */
  const mandantName = async (tenantId?: string): Promise<string | undefined> =>
    tenantId ? (await application.tenantService.list()).find((mandant) => mandant.id === tenantId)?.name : undefined;

  return [
    {
      /* Was gespeichert wird, wo und wie lange — der Bogen für den Datenschutzbeauftragten. */
      method: 'GET',
      pattern: '/api/privacy/report',
      authorization: 'MANAGE_USERS',
      handle: async () => {
        const mandanten = await application.tenantService.list();

        return ok({
          bestaende: application.privacyService.verzeichnis(),
          mandanten: mandanten.map((mandant) => ({
            id: mandant.id,
            name: mandant.name,
            rootDirectory: mandant.rootDirectory,
          })),
          /*
           * Die Fristen stehen sonst verstreut in den Workflows. Hier werden
           * sie gelesen, nicht gepflegt: Was hier steht, ist der tatsächliche
           * Zustand — eine zweite, gepflegte Liste wäre die, die veraltet.
           */
          fristen: await fristenJeMandant(application.tenantRepository, application.jobRepository),
          /*
           * Die Zusagen, die nicht aus einer Einstellung folgen, sondern aus der
           * Bauweise. Sie stehen hier, weil ein Datenschutzbeauftragter genau
           * danach fragt und die Antwort sonst in elf Specs verstreut liegt.
           */
          zusagen: [
            'Unikom sendet von sich aus nichts nach außen: keine Telemetrie, keine Nutzungsstatistik, keine Fehlerberichte, keine Modellanfragen',
            'Eine KI-gestützte Erkennung ist nicht Bestandteil dieser Fassung; es verlassen also auch keine Feldnamen das Haus',
            'Die Datenbank ist nicht verschlüsselt. Zugangsdaten sind es einzeln; für alles Übrige ist das Datenverzeichnis auf einer verschlüsselten Platte zu halten',
            'Unikom greift nicht auf Postfächer zu; Nachrichten werden abgelegt und aus einem Verzeichnis geholt',
            'Der Zugriff auf Konfliktdaten hängt an einem eigenen Recht je Benutzer, nicht an der Berechtigungsstufe',
          ],
        });
      },
    },
    {
      method: 'POST',
      pattern: '/api/privacy/search',
      authorization: 'MANAGE_USERS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'Die Auskunft');

        try {
          return ok(await application.privacyService.search(requireString(input, 'term'), optionalString(input, 'tenantId')));
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      /*
       * Dieselbe Suche als Datei (FR_009, Abschnitt 6).
       *
       * Sie läuft ein zweites Mal und nimmt nicht das Ergebnis vom Bildschirm:
       * Der Bildschirm zeigt bis zu fünfzig Fundstellen je Bestand, die Datei
       * geht an eine betroffene Person und darf nichts weglassen. Aus dem
       * Angezeigten eine Auskunft zu bauen hieße, eine Kürzung auszuliefern,
       * die niemand angeordnet hat.
       */
      method: 'POST',
      pattern: '/api/privacy/export',
      authorization: 'MANAGE_USERS',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'Die Ausleitung');
        const tenantId = optionalString(input, 'tenantId');

        try {
          const begriff = requireString(input, 'term');
          const auskunft = await application.privacyService.search(begriff, tenantId, MAX_FUNDE_AUSLEITUNG);
          const erstellt = new Date();

          return ok({
            filename: auskunftsdateiname(auskunft.begriff, erstellt),
            text: auskunftsdokument(auskunft, {
              erstellt,
              mandant: await mandantName(tenantId),
              veranlasser: session?.user.username,
            }),
          });
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      method: 'POST',
      pattern: '/api/privacy/erase',
      authorization: 'MANAGE_USERS',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'Der Löschauftrag');

        /*
         * Ohne ausdrückliche Bestätigung geschieht nichts.
         *
         * FR_009, Abschnitt 5: erst anzeigen, dann bestätigen, dann entfernen.
         * Ein Löschauftrag, der schon beim ersten Aufruf ausführt, ist nicht
         * umkehrbar und trifft im Zweifel den Falschen.
         */
        if (input.confirmed !== true) {
          throw new ApiError(
            400,
            'Ein Löschauftrag wird erst ausgeführt, wenn bestätigt wurde, was die Suche gezeigt hat'
          );
        }

        const tenantId = optionalString(input, 'tenantId');

        try {
          const bericht = await application.privacyService.erase(
            requireString(input, 'term'),
            tenantId,
            session ? { id: session.user.id, name: session.user.username } : undefined
          );

          /*
           * Der Beleg entsteht hier und nicht auf Abruf: Eine zweite Suche
           * fände nichts mehr, und ein Beleg, der „nichts gefunden" sagt,
           * belegt gar nichts.
           */
          return ok({
            ...bericht,
            beleg: {
              filename: loeschbelegDateiname(bericht.begriff, bericht.zeitpunkt),
              text: loeschbelegDokument(bericht, { mandant: await mandantName(tenantId) }),
            },
          });
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ];
}
