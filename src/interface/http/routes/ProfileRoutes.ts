import { randomUUID } from 'node:crypto';

import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import {
  effektiveEinstellungen,
  einstellungenDesMandanten,
  EINSTELLUNGEN,
  EINSTELLUNG_LABELS,
  type Einstellungen,
} from '../../../domain/consolidation/Einstellungen.js';
import { aktuelleVersion, type Profil } from '../../../domain/consolidation/Profil.js';
import type { DataBlock } from '../../../domain/discovery/Discovery.js';
import { vorgabeAusBlock } from '../../../domain/discovery/Profilabgleich.js';
import { regelnAus, schluesselAus, vorgabeAus } from '../Profileingabe.js';
import { ApiError, created, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

/**
 * Eingangsprofile eines Mandanten (SPEC-02, Abschnitt 3; SPEC-03, Abschnitt 18).
 *
 * Ein Profil entsteht aus einem Block, den ein Mensch bestätigt hat — deshalb
 * nimmt das Anlegen den erkannten Block entgegen und nicht eine von Hand
 * getippte Spaltenliste. Geändert wird es nicht: Es wird **fortgeschrieben**,
 * und die alten Versionen bleiben stehen, weil Läufe auf sie zeigen.
 */
export function profileRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/profiles',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => {
        const tenantId = query.get('tenantId');

        if (!tenantId) {
          throw new ApiError(400, 'Bitte den Mandanten angeben, dessen Profile gemeint sind');
        }

        return ok((await application.profilRepository.list(tenantId)).map(toView));
      },
    },
    {
      /*
       * Die effektiven Einstellungen (SPEC-02, Abschnitt 41).
       *
       * Ohne `profileId` steht hier, was ohne Profil gälte — die Antwort auf
       * „was macht Unikom mit einer Datei, für die es noch kein Profil gibt".
       */
      method: 'GET',
      pattern: '/api/profiles/effective',
      authorization: 'MANAGE_JOBS',
      handle: async ({ query }) => {
        const tenantId = query.get('tenantId');

        if (!tenantId) {
          throw new ApiError(400, 'Bitte den Mandanten angeben');
        }

        const mandant = await application.tenantService.getById(tenantId);

        if (!mandant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const profileId = query.get('profileId') ?? undefined;
        const profil = profileId ? await application.profilRepository.getById(profileId) : undefined;

        if (profileId && !profil) {
          throw new ApiError(404, 'Dieses Profil gibt es nicht');
        }

        const effektiv = effektiveEinstellungen(
          einstellungenDesMandanten(mandant),
          profil ? aktuelleVersion(profil).einstellungen : undefined
        );

        return ok({
          tenantId,
          tenantName: mandant.name,
          profileId: profil?.id,
          profileName: profil?.name,
          profileVersion: profil ? aktuelleVersion(profil).version : undefined,
          einstellungen: EINSTELLUNGEN.map((name) => ({
            name,
            label: EINSTELLUNG_LABELS[name],
            wert: effektiv[name].wert,
            ebene: effektiv[name].ebene,
            ebenen: effektiv[name].ebenen,
          })),
        });
      },
    },
    {
      method: 'POST',
      pattern: '/api/profiles',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'Das Profil');
        const tenantId = requireString(input, 'tenantId');

        if (!(await application.tenantService.getById(tenantId))) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const block = input.block as DataBlock | undefined;

        if (!block || !Array.isArray(block.columns) || block.columns.length === 0) {
          throw new ApiError(400, 'Ein Eingangsprofil entsteht aus einem erkannten Datenblock; der fehlt');
        }

        const profil = await application.profileService.anlegen({
          id: randomUUID(),
          tenantId,
          name: requireString(input, 'name'),
          description: optionalString(input, 'description'),
          vorgabe: vorgabeAusBlock(block),
          regeln: regelnAus(input.regeln),
          schluessel: schluesselAus(input.schluessel),
          einstellungen: einstellungenAus(input.einstellungen),
          erstelltVon: session?.user.id,
          erstelltVonName: session?.user.username,
        });

        return created(toView(profil));
      },
    },
    {
      /*
       * Fortschreiben statt ändern.
       *
       * Name und Beschreibung sind Beschriftungen und keine Definition — sie
       * ändern sich, ohne dass eine Version entsteht. Alles, wonach gelesen
       * wird, erzeugt eine neue: Ein Lauf, der auf Version 2 zeigt, muss
       * Version 2 vorfinden.
       */
      method: 'PUT',
      pattern: '/api/profiles/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, params, session }) => {
        const input = requireObject(body, 'Das Profil');
        const vorhanden = await application.profilRepository.getById(params.id);

        if (!vorhanden) {
          throw new ApiError(404, 'Dieses Profil gibt es nicht');
        }

        const ergebnis = await application.profileService.fortschreiben(
          params.id,
          {
            name: optionalString(input, 'name'),
            description: optionalString(input, 'description'),
            /*
             * Struktur, Regeln und Schlüssel kamen bisher nicht durch — die
             * Domäne konnte sie fortschreiben, die Route reichte sie nicht
             * weiter. Damit war der Reiter „Spalten" nicht speicherbar, und ein
             * Profil blieb für immer das, was die Erkennung einmal gesehen hat.
             */
            vorgabe: vorgabeAus(input.vorgabe),
            regeln: regelnAus(input.regeln),
            schluessel: schluesselAus(input.schluessel),
            einstellungen: einstellungenAus(input.einstellungen),
            notiz: optionalString(input, 'notiz'),
          },
          session ? { id: session.user.id, name: session.user.username } : undefined
        );

        return ok({ ...toView(ergebnis.profil), neueVersion: ergebnis.neu });
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/profiles/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params }) => {
        if (!(await application.profilRepository.getById(params.id))) {
          throw new ApiError(404, 'Dieses Profil gibt es nicht');
        }

        await application.profilRepository.delete(params.id);

        return { status: 204 };
      },
    },
    {
      /* Womit lief ein Lauf — die Frage, für die es den Schnappschuss gibt. */
      method: 'GET',
      pattern: '/api/snapshots/:id',
      authorization: 'VIEW',
      handle: async ({ params }) => {
        const schnappschuss = await application.snapshots.getById(params.id);

        if (!schnappschuss) {
          throw new ApiError(404, 'Diesen Konfigurations-Schnappschuss gibt es nicht');
        }

        return ok(schnappschuss);
      },
    },
  ];
}

/**
 * Nimmt nur an, was es wirklich gibt.
 *
 * Ein unbekannter Name würde stillschweigend im Profil landen und dort für
 * immer stehen bleiben, ohne je zu wirken — eine Einstellung, die niemand
 * einlöst und die auch niemand mehr findet.
 */
function einstellungenAus(wert: unknown): Einstellungen | undefined {
  if (wert === undefined || wert === null) {
    return undefined;
  }

  if (typeof wert !== 'object') {
    throw new ApiError(400, 'Die Einstellungen müssen als Objekt übergeben werden');
  }

  const eingang = wert as Record<string, unknown>;
  const unbekannt = Object.keys(eingang).filter((name) => !(EINSTELLUNGEN as readonly string[]).includes(name));

  if (unbekannt.length > 0) {
    throw new ApiError(
      400,
      `Unbekannte Einstellung(en): ${unbekannt.join(', ')}. Bekannt sind: ${EINSTELLUNGEN.join(', ')}`
    );
  }

  const ergebnis: Record<string, unknown> = {};

  for (const name of EINSTELLUNGEN) {
    if (eingang[name] !== undefined && eingang[name] !== null) {
      ergebnis[name] = eingang[name];
    }
  }

  return ergebnis as Einstellungen;
}

export function toView(profil: Profil): Record<string, unknown> {
  const aktuell = aktuelleVersion(profil);

  return {
    id: profil.id,
    tenantId: profil.tenantId,
    name: profil.name,
    description: profil.description,
    version: aktuell.version,
    columns: aktuell.vorgabe.spalten?.map((spalte) => ({
      position: spalte.position,
      name: spalte.name,
      type: spalte.type,
    })),
    verbindlichkeit: aktuell.vorgabe.verbindlichkeit,
    /*
     * Die ganze Vorgabe daneben, nicht nur die Spaltenliste.
     *
     * `columns` und `verbindlichkeit` darüber bleiben stehen — die
     * Erkennungsfläche liest sie. Der Schemaeditor braucht mehr: Mindestzahl
     * und Blockbeginn gehören zum Reiter „Aufbau", und wer sie nicht zurück-
     * bekommt, löscht sie beim ersten Speichern.
     */
    vorgabe: aktuell.vorgabe,
    regeln: aktuell.regeln,
    schluessel: aktuell.schluessel,
    einstellungen: aktuell.einstellungen,
    feststellungen: aktuell.feststellungen,
    /*
     * Die ganze Kette, nicht nur die aktuelle Fassung. Wer wissen will, warum
     * ein Lauf vom März anders gelesen hat als einer vom Mai, findet die
     * Antwort hier — und nicht in einem Protokoll, das längst gelöscht ist.
     */
    versionen: profil.versionen.map((version) => ({
      version: version.version,
      erstellt: version.erstellt.toISOString(),
      erstelltVonName: version.erstelltVonName,
      notiz: version.notiz,
      einstellungen: version.einstellungen,
      spalten: version.vorgabe.spalten?.length ?? 0,
    })),
    confirmedByName: profil.versionen[0].erstelltVonName,
    matches: profil.matches,
    createdAt: profil.createdAt.toISOString(),
    updatedAt: profil.updatedAt.toISOString(),
  };
}
