import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { AuthenticatedSession } from '../../../application/users/SessionService.js';
import { KANAELE } from '../../../domain/background/Benachrichtigung.js';
import { handlungsbedarf, zusammen } from '../../../domain/background/Handlungsbedarf.js';
import { verhaltenVon } from '../../../domain/conflicts/Konfliktverhalten.js';
import { ApiError, ok, type Route } from '../Http.js';

/**
 * Hintergrundbetrieb über die Schnittstelle (SPEC-01, Abschnitt 15 und 19 bis 22).
 *
 * Zwei Dinge: **wer läuft** und **was aussteht**. Beides liest der Server aus
 * der Datenbank — geschrieben hat es der Worker, und zwischen den beiden gibt
 * es keinen Meldeweg, der ausfallen koennte.
 */
export function backgroundRoutes(application: UnikomApplication): Route[] {
  return [
    {
      /*
       * Wer gerade arbeitet. Nicht nur eine Anzeige: Steht hier nichts und ein
       * Workflow ist fällig, läuft der Worker nicht — und das ist die
       * häufigste Ursache dafuer, dass „nachts nichts passiert ist".
       */
      method: 'GET',
      pattern: '/api/background/processes',
      authorization: 'VIEW',
      handle: async () => ok(await application.backgroundService.prozesse()),
    },
    {
      /*
       * Was auf einen Menschen wartet — die Zahl neben dem Menüpunkt.
       *
       * ## Über alle Mandanten
       *
       * Das Menü steht über allen Kunden und nicht in einem. Wer acht betreut,
       * will morgens **eine** Zahl sehen; wessen Fall es ist, steht im
       * Bildschirm dahinter.
       *
       * ## Warum eine eigene Route und nicht zweimal die vorhandenen
       *
       * `/api/conflicts` und `/api/results` liefern beide ganze Listen samt
       * Datensätzen — für eine Zahl im Menü, die im Takt weniger Minuten neu
       * geholt wird, ist das die falsche Menge über die Leitung. Und sie kennen
       * je einen Mandanten; die Schleife darüber stünde sonst im Browser, der
       * dafür erst alle Mandanten laden müsste.
       *
       * ## Eine Abfrage je Mandant
       *
       * Die Bestände fragen nach Mandant, nicht über alle. Bei den Zahlen, um
       * die es hier geht — ein Haus mit einer Handvoll Kunden — ist das in
       * Ordnung. Würde daraus einmal ein Dienstleister mit dreihundert, gehört
       * die Zählung in die Datenbank statt in diese Schleife; die Stelle dafür
       * ist dann `Konfliktbestand` und `Ergebnisbestand`, nicht diese Route.
       */
      method: 'GET',
      pattern: '/api/handlungsbedarf',
      authorization: 'VIEW',
      handle: async () => {
        const mandanten = await application.tenantService.list();

        const je = await Promise.all(
          mandanten.map(async (mandant) =>
            handlungsbedarf(
              await application.conflictRepository.list(mandant.id),
              await application.resultRepository.list(mandant.id)
            )
          )
        );

        return ok(zusammen(je));
      },
    },
    {
      method: 'GET',
      pattern: '/api/notifications',
      authorization: 'VIEW',
      handle: async ({ query }) => {
        const tenantId = query.get('tenantId') ?? 'default';
        const nurOffene = query.get('open') === 'true';

        return ok({
          meldungen: nurOffene
            ? await application.backgroundService.offene(tenantId)
            : await application.backgroundService.alle(tenantId),
          stand: await application.backgroundService.stand(tenantId),
          /*
           * Die Kanäletabelle geht mit hinaus, statt in der Oberfläche noch
           * einmal zu stehen. SPEC-01, Abschnitt 21, nennt sie verbindlich —
           * zweimal geschrieben wäre sie an einer Stelle irgendwann veraltet,
           * und dann zeigte der Bildschirm etwas anderes, als der Agent tut.
           */
          kanaele: KANAELE,
        });
      },
    },
    {
      /** Gesehen ist noch nicht erledigt — deshalb ein eigener Weg. */
      method: 'POST',
      pattern: '/api/notifications/:id/seen',
      authorization: 'VIEW',
      handle: async ({ params }) => {
        await application.backgroundService.gesehen(params.id);

        return ok({ gesehen: true });
      },
    },
    {
      method: 'POST',
      pattern: '/api/notifications/:id/acknowledge',
      authorization: 'VIEW',
      handle: async ({ params, session }) => {
        await application.backgroundService.bestaetigen(params.id, benutzer(session));

        return ok({ bestaetigt: true });
      },
    },
    {
      /**
       * Was sich von selbst zeigen soll.
       *
       * Nur die drängenden: Eine Information von vorgestern noch einmal
       * aufzuklappen, erzieht dazu, alles wegzuklicken. Wie oft ein offener
       * Konflikt darunter ist, entscheidet der Mandant — und zwar hier und
       * nicht im Browser: Eine Einstellung, die der Server nicht durchsetzt,
       * ist keine Einstellung, sondern eine Bitte.
       */
      method: 'GET',
      pattern: '/api/notifications/pending',
      authorization: 'VIEW',
      handle: async ({ query }) => {
        const tenantId = query.get('tenantId') ?? 'default';
        const mandant = await application.tenantService.getById(tenantId);

        return ok(await application.backgroundService.nachzuholen(tenantId, verhaltenVon(mandant?.konflikte)));
      },
    },
  ];
}

function benutzer(session: AuthenticatedSession | undefined): string {
  if (!session) {
    throw new ApiError(401, 'Zum Bestätigen ist eine Anmeldung nötig');
  }

  return session.user.username;
}
