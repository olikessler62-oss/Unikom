import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { Meldeeinstellungen, Postausgang } from '../../../domain/background/Postausgang.js';
import {
  AUSLIEFERUNGSARTEN,
  KUERZESTE_WIEDERVORLAGE,
  VERHALTEN_ALLGEMEIN,
  VORLAGEARTEN,
  type Auslieferungsart,
  type Konfliktverhalten,
  type Vorlageart,
} from '../../../domain/conflicts/Konfliktverhalten.js';
import { ALLGEMEIN, type Mandanteneinstellungen } from '../../../domain/consolidation/Einstellungen.js';
import { dateOrderOf, regionOf, sampleDate, type Region } from '../../../domain/tenants/Region.js';
import type { Tenant } from '../../../domain/tenants/Tenant.js';
import { ApiError, created, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

/**
 * Der Mandant, wie die Oberfläche ihn bekommt — samt dem, was seine Region
 * *bedeutet*.
 *
 * Reihenfolge und Beispiel werden mitgeschickt und nicht im Browser gerechnet.
 * Sie müssen aus derselben Datumsformatierung stammen, die der Lauf später
 * benutzt; sonst zeigte die Oberfläche eine Lesart und der Server verwendete
 * eine andere — genau der Fehler, den die Einstellung verhindern soll.
 *
 * Auch ein Mandant ohne eigene Angabe bekommt sie: Was gilt, soll dastehen,
 * nicht erschlossen werden müssen.
 */
function toView(tenant: Tenant) {
  const region = regionOf(tenant);

  return {
    ...tenant,
    region,
    /** Ob die Angabe am Mandanten steht oder die Voreinstellung ist. */
    regionIsDefault: tenant.region === undefined,
    dateOrder: dateOrderOf(region.locale),
    /** Der 3. April 2026, geschrieben wie dieser Mandant ihn schreibt. */
    dateSample: sampleDate(region),
    /*
     * Was gilt, wenn am Mandanten nichts steht. Mitgeschickt und nicht im
     * Browser hinterlegt: Eine zweite Abschrift der Voreinstellungen wäre an
     * einer Stelle irgendwann veraltet, und dann zeigte das Formular als
     * Vorschlag etwas anderes, als der Lauf verwendet.
     */
    voreinstellungen: ALLGEMEIN,
    /*
     * Und dasselbe für die Konflikte: Was gilt, solange der Mandant nichts
     * eingestellt hat. Aus demselben Grund mitgeschickt — eine zweite
     * Abschrift im Browser wäre irgendwann die veraltete.
     */
    konflikteVoreinstellung: VERHALTEN_ALLGEMEIN,
  };
}

/** Die Region aus einer Anfrage — beide Angaben oder keine. */
function regionFrom(input: Record<string, unknown>): Region | undefined {
  const region = input.region;

  if (region === undefined || region === null) {
    return undefined;
  }

  const gelesen = region as Partial<Region>;

  if (typeof gelesen.locale !== 'string' || typeof gelesen.timeZone !== 'string') {
    throw new ApiError(400, 'Zur Region gehören eine Sprachkennung und eine Zeitzone.');
  }

  return { locale: gelesen.locale, timeZone: gelesen.timeZone };
}

export function tenantRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/tenants',
      authorization: 'VIEW',
      handle: async () => {
        const [tenants, jobs] = await Promise.all([
          application.tenantService.list(),
          application.jobService.getAll(),
        ]);

        // The job count travels with it: a client with none is either new or
        // forgotten, and that is worth seeing at a glance.
        return ok(
          tenants.map((tenant) => ({
            ...toView(tenant),
            jobCount: jobs.filter((job) => job.tenantId === tenant.id).length,
          }))
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/tenants/:id',
      authorization: 'VIEW',
      handle: async ({ params }) => {
        const tenant = await application.tenantService.getById(params.id);

        if (!tenant) {
          throw new ApiError(404, `Den Mandanten ${params.id} gibt es nicht`);
        }

        return ok(toView(tenant));
      },
    },
    {
      // Clients are part of the installation's setup, like credentials.
      method: 'POST',
      pattern: '/api/tenants',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The client');

        try {
          return created(
            toView(
              await application.tenantService.create({
                name: requireString(input, 'name'),
                description: optionalString(input, 'description'),
                rootDirectory: optionalString(input, 'rootDirectory'),
                region: regionFrom(input),
              })
            )
          );
        } catch (error) {
          if (error instanceof ApiError) {
            throw error;
          }

          // Jede Ablehnung betrifft die Angaben des Aufrufers und ist für ihn
          // geschrieben — Name, Wurzelverzeichnis oder Region.
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      method: 'PUT',
      pattern: '/api/tenants/:id',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The client');

        try {
          return ok(
            toView(
              await application.tenantService.update(params.id, {
                name: optionalString(input, 'name'),
                description: typeof input.description === 'string' ? input.description : undefined,
                rootDirectory: typeof input.rootDirectory === 'string' ? input.rootDirectory : undefined,
                region: regionFrom(input),
                enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
                benachrichtigung: meldeeinstellungenAus(input.benachrichtigung),
                consolidation: einstellungenAus(input.consolidation),
                /*
                 * Eine leere Eingabe nimmt die Einstellung fort und speichert
                 * keine Null: Sonst hieße „nichts eingetragen" ab dann
                 * „abgeschaltet", und niemand sähe den Unterschied.
                 */
                ausleitungenTage: zahlOderFort(input, 'ausleitungenTage'),
                archivTage: zahlOderFort(input, 'archivTage'),
                konflikte: konfliktverhaltenAus(input.konflikte),
              })
            )
          );
        } catch (error) {
          if (error instanceof ApiError) {
            throw error;
          }

          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/tenants/:id',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params }) => {
        await application.tenantService.delete(params.id);
        return { status: 204 };
      },
    },
  ];
}

/**
 * Die Meldeeinstellungen aus der Anfrage.
 *
 * `null` löscht sie, ein fehlendes Feld lässt sie stehen. Der Postausgang ist
 * unvollständig ohne Server, Port und Absender — dann gilt er als nicht
 * eingerichtet, statt als halb eingerichtet in den Bestand zu geraten und beim
 * ersten kritischen Ereignis zu scheitern.
 */
function meldeeinstellungenAus(wert: unknown): Meldeeinstellungen | null | undefined {
  if (wert === undefined) {
    return undefined;
  }

  if (wert === null) {
    return null;
  }

  const eintrag = requireObject(wert, 'Die Benachrichtigung') as Record<string, unknown>;
  const empfaenger = Array.isArray(eintrag.empfaenger)
    ? eintrag.empfaenger.map(String).map((anschrift) => anschrift.trim()).filter((anschrift) => anschrift !== '')
    : [];

  for (const anschrift of empfaenger) {
    if (!anschrift.includes('@')) {
      throw new ApiError(400, `„${anschrift}" ist keine E-Mail-Anschrift`);
    }
  }

  return {
    empfaenger,
    auchBeiErfolg: eintrag.auchBeiErfolg === true,
    postausgang: postausgangAus(eintrag.postausgang),
  };
}

function postausgangAus(wert: unknown): Postausgang | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  const eintrag = requireObject(wert, 'Der Postausgang') as Record<string, unknown>;
  const host = typeof eintrag.host === 'string' ? eintrag.host.trim() : '';
  const absender = typeof eintrag.absender === 'string' ? eintrag.absender.trim() : '';
  const port = Number(eintrag.port);

  if (host === '' || absender === '' || !Number.isInteger(port) || port <= 0) {
    return undefined;
  }

  const verschluesselung = eintrag.verschluesselung;

  if (verschluesselung !== 'STARTTLS' && verschluesselung !== 'IMPLIZIT' && verschluesselung !== 'KEINE') {
    throw new ApiError(400, 'Die Verschlüsselung muss STARTTLS, IMPLIZIT oder KEINE sein');
  }

  return {
    host,
    port,
    verschluesselung,
    absender,
    zugangId: typeof eintrag.zugangId === 'string' && eintrag.zugangId !== '' ? eintrag.zugangId : undefined,
  };
}

/**
 * Das Konfliktverhalten aus der Anfrage.
 *
 * `null` löscht es, ein fehlendes Feld lässt es stehen. Geprüft wird hier,
 * weil eine unbekannte Vorlageart nicht stillschweigend zur Voreinstellung
 * werden darf: Wer sich vertippt, soll es erfahren und nicht drei Wochen
 * später merken, dass die Wiedervorlage nie kam.
 */
function konfliktverhaltenAus(wert: unknown): Konfliktverhalten | null | undefined {
  if (wert === undefined) {
    return undefined;
  }

  if (wert === null) {
    return null;
  }

  const eintrag = requireObject(wert, 'Das Konfliktverhalten') as Record<string, unknown>;
  const vorlage = eintrag.vorlage;

  if (vorlage !== undefined && !VORLAGEARTEN.includes(vorlage as Vorlageart)) {
    throw new ApiError(400, `Die Vorlage muss ${VORLAGEARTEN.join(', ')} sein — nicht „${String(vorlage)}"`);
  }

  const stunden = zahl(eintrag.wiedervorlageStunden);

  /*
   * Eine Frist von null Stünden ist keine Frist, sondern `BEI_JEDEM_OEFFNEN`
   * unter anderem Namen — und die gibt es schon. Zwei Wege zu demselben
   * Verhalten sind einer zu viel.
   */
  if (stunden !== undefined && (!Number.isFinite(stunden) || stunden < KUERZESTE_WIEDERVORLAGE)) {
    throw new ApiError(400, `Die Wiedervorlage braucht mindestens ${KUERZESTE_WIEDERVORLAGE} Stunde`);
  }

  const auslieferung = eintrag.auslieferung;

  if (auslieferung !== undefined && !AUSLIEFERUNGSARTEN.includes(auslieferung as Auslieferungsart)) {
    throw new ApiError(
      400,
      `Die Auslieferung muss ${AUSLIEFERUNGSARTEN.join(' oder ')} sein — nicht „${String(auslieferung)}"`
    );
  }

  return {
    vorlage: vorlage as Vorlageart | undefined,
    wiedervorlageStunden: stunden,
    akzeptierenErlaubt: typeof eintrag.akzeptierenErlaubt === 'boolean' ? eintrag.akzeptierenErlaubt : undefined,
    auslieferung: auslieferung as Auslieferungsart | undefined,
  };
}

/**
 * Die Konsolidierungseinstellungen aus der Anfrage.
 *
 * `null` löscht sie, ein fehlendes Feld lässt sie stehen. Ein leeres Objekt ist
 * dasselbe wie keines: Wer alle Felder leert, will die Voreinstellung zurück
 * und keinen leeren Eintrag im Bestand.
 *
 * Geprüft wird hier **nicht** — das tut der Dienst, weil die Prüfung zu den
 * Werten gehört und nicht zu dem Weg, auf dem sie ankommen. Hier wird nur
 * gelesen, was da ist.
 */
function einstellungenAus(wert: unknown): Mandanteneinstellungen | null | undefined {
  if (wert === undefined) {
    return undefined;
  }

  if (wert === null) {
    return null;
  }

  const eintrag = requireObject(wert, 'Die Einstellungen') as Record<string, unknown>;

  const einstellungen: Mandanteneinstellungen = {
    jahrhundertGrenze: zahl(eintrag.jahrhundertGrenze),
    nullWerte: Array.isArray(eintrag.nullWerte) ? eintrag.nullWerte.map(String) : undefined,
    stichprobe: zahl(eintrag.stichprobe),
    stichprobeGrenze: zahl(eintrag.stichprobeGrenze),
    mindestKonfidenz: zahl(eintrag.mindestKonfidenz),
  };

  const gesetzt = Object.entries(einstellungen).filter(([, inhalt]) => inhalt !== undefined);

  return gesetzt.length === 0 ? null : (Object.fromEntries(gesetzt) as Mandanteneinstellungen);
}

/**
 * Eine Zahl aus der Anfrage — oder nichts.
 *
 * Ein leerer Text wird zu „nicht gesetzt" und nicht zu `0`: Im Formular heißt
 * ein leeres Feld „hier gilt die Voreinstellung", und `Number('')` ergäbe
 * ausgerechnet den Wert, der am meisten Schaden anrichtet.
 */
function zahl(wert: unknown): number | undefined {
  if (wert === undefined || wert === null || wert === '') {
    return undefined;
  }

  const gelesen = Number(wert);

  return Number.isNaN(gelesen) ? undefined : gelesen;
}

/**
 * Eine Zahl aus der Anfrage — mit dem Unterschied zwischen drei Dingen.
 *
 * ```text
 * Feld fehlt   →  undefined   nicht angefasst
 * null / leer  →  null        Einstellung fortnehmen
 * 0            →  0           abgeschaltet
 * ```
 *
 * Ohne diese drei Ausgänge ließe sich eine einmal gesetzte Frist nie wieder
 * leeren: Eine leere Eingabe käme als „nicht angefasst" an, und der alte Wert
 * bliebe stehen — während im Formular nichts mehr steht.
 */
function zahlOderFort(input: Record<string, unknown>, feld: string): number | null | undefined {
  if (!(feld in input)) {
    return undefined;
  }

  const wert = input[feld];

  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : null;
}
