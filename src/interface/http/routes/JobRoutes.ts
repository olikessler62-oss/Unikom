import fs from 'node:fs/promises';
import path from 'node:path';

import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { requiredFeaturesFor } from '../../../application/licensing/JobLicensing.js';
import { DEFAULT_TENANT_ID } from '../../../domain/tenants/Tenant.js';
import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import type { TransferJob } from '../../../domain/transfer/TransferJob.js';
import { checkDirectory } from '../../../infrastructure/filesystem/DirectoryCheck.js';
import { isSafeFilename } from '../../../infrastructure/filesystem/SafePath.js';
import { ApiError, created, ok, requireObject, type Route } from '../Http.js';

/**
 * Führt `arbeit` aus, während die Freigabe mit ihrem hinterlegten Zugang
 * verbunden ist. Ist die Seite keine Freigabe, geschieht nichts weiter.
 *
 * Der Editor sieht damit dasselbe wie der Lauf. Ohne das griffen
 * Verbindungsprobe, Verzeichnisbrowser und Zielprüfung mit dem Konto zu, unter
 * dem Unikom gerade läuft — bei der Einrichtung ist das die Sitzung dessen, der
 * davorsitzt. Ein grünes Häkchen sagte dann nur, dass *diese* Person die
 * Freigabe erreicht, und nichts darüber, ob der eingetragene Zugang es tut. Das
 * ist der schlimmste Ausgang einer Prüfung, weil er beruhigt.
 *
 * Was dabei geschieht, steht im Protokoll: Wer eine Freigabe einrichtet und
 * scheitert, soll nachlesen können, mit welchem Namen verbunden wurde und woran
 * es lag — und zwar ohne Zugang zu diesem Rechner.
 */
async function inFreigabe<T>(
  application: UnikomApplication,
  seite: 'Quelle' | 'Ziel',
  istFreigabe: boolean,
  angaben: { name: string; tenantId: string; credentialId?: string; directory: string },
  arbeit: () => Promise<T>
): Promise<T> {
  if (!istFreigabe) {
    return arbeit();
  }

  const zugang = await application.shareAccess.forShare(angaben, angaben.credentialId, seite);

  return application.shares.withConnection(
    angaben.directory,
    zugang,
    (message) => application.logger.log({ timestamp: new Date(), level: 'INFO', message }),
    arbeit
  );
}

/** Die Angaben, die jede dieser Prüfungen gemeinsam hat. */
function angabenAus(input: Record<string, unknown>, directory: string, credentialId: unknown) {
  return {
    name: typeof input.name === 'string' ? input.name : 'Neuer Job',
    tenantId: typeof input.tenantId === 'string' ? input.tenantId : DEFAULT_TENANT_ID,
    credentialId: typeof credentialId === 'string' ? credentialId : undefined,
    directory,
  };
}

/**
 * A job carries dates, which JSON does not. Everything else is handed to the
 * job service unchanged, so the rules stay in one place instead of being
 * half-checked here and half there.
 */
function reviveJob(body: unknown): TransferJob {
  const input = requireObject(body, 'The job');

  const revive = (field: string, fallback: Date): Date => {
    const value = input[field];
    return typeof value === 'string' ? new Date(value) : fallback;
  };

  const now = new Date();

  return {
    ...(input as unknown as TransferJob),
    createdAt: revive('createdAt', now),
    updatedAt: now,
    lastExecutionAt: typeof input.lastExecutionAt === 'string' ? new Date(input.lastExecutionAt) : undefined,
    nextExecutionAt: typeof input.nextExecutionAt === 'string' ? new Date(input.nextExecutionAt) : undefined,
  };
}

export function jobRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/jobs',
      authorization: 'VIEW',
      handle: async () => {
        const [jobs, unlicensed] = await Promise.all([
          application.jobService.getAll(),
          application.jobService.listUnlicensed(),
        ]);

        const missing = new Map(unlicensed.map((entry) => [entry.job.id, entry.missing]));

        // A job whose module is gone still exists and still shows up - it just
        // cannot run. Hiding it would make a schedule stop without a trace.
        return ok(jobs.map((job) => ({ ...job, missingFeatures: missing.get(job.id) ?? [] })));
      },
    },
    {
      method: 'GET',
      pattern: '/api/jobs/:id',
      authorization: 'VIEW',
      handle: async ({ params }) => {
        const job = await application.jobService.getById(params.id);

        if (!job) {
          throw new ApiError(404, `Den Workflow ${params.id} gibt es nicht`);
        }

        return ok({ ...job, requiredFeatures: requiredFeaturesFor(job) });
      },
    },
    {
      // Before the pattern with an id, so "test-connection" is not read as one.
      method: 'POST',
      pattern: '/api/jobs/test-connection',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The connection test');
        const config = input.sourceConfig as TransferJob['sourceConfig'];
        const adapter = await application.adapterProvider.forSource({
          name: typeof input.name === 'string' ? input.name : 'Neuer Job',
          tenantId: typeof input.tenantId === 'string' ? input.tenantId : DEFAULT_TENANT_ID,
          sourceType: input.sourceType as TransferJob['sourceType'],
          sourceConfig: config,
          credentialId: typeof input.credentialId === 'string' ? input.credentialId : undefined,
        });

        try {
          // The adapter reports rather than throws, so a wrong host reads as a
          // result the editor can show instead of as a failure.
          return ok(
            await inFreigabe(
              application,
              'Quelle',
              input.sourceType === 'SHARE',
              angabenAus(input, config?.directory ?? '', input.credentialId),
              () => adapter.testConnection()
            )
          );
        } catch (error) {
          // Ein Zugang, der sich nicht verbinden lässt, ist ein Ergebnis der
          // Probe und kein Fehler des Servers — er gehört in dieselbe Zeile
          // neben dem Feld wie ein falscher Hostname.
          return ok({ ok: false, message: error instanceof Error ? error.message : String(error) });
        } finally {
          await adapter.dispose?.();
        }
      },
    },
    {
      /*
       * Looking at the remote server while the job is being written: does this
       * directory exist, and what is below it.
       *
       * One endpoint for the tick-or-cross and for the directory browser,
       * because they are the same question — a listing that succeeds is the
       * proof that the directory is there, and its contents are what the
       * browser shows.
       */
      method: 'POST',
      pattern: '/api/jobs/browse-remote',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The directory request');

        return ok(
          await application.remoteDirectories.browse({
            name: typeof input.name === 'string' ? input.name : 'Neuer Job',
            tenantId: typeof input.tenantId === 'string' ? input.tenantId : DEFAULT_TENANT_ID,
            sourceType: input.sourceType as TransferJob['sourceType'],
            sourceConfig: input.sourceConfig as TransferJob['sourceConfig'],
            credentialId: typeof input.credentialId === 'string' ? input.credentialId : undefined,
            directory: typeof input.directory === 'string' ? input.directory : '',
          })
        );
      },
    },
    {
      /*
       * Ein Verzeichnis auf dem Rechner aussuchen, auf dem Unikom läuft.
       *
       * Für jedes Feld, das immer lokal ist — das Protokollverzeichnis etwa —
       * und für Quelle, Archiv und Ziel, solange sie lokal eingestellt sind.
       * Dass der Server antwortet und nicht der Browser, ist kein Notbehelf:
       * Ein Dateidialog im Browser nennt den Pfad des Rechners, an dem jemand
       * sitzt, und der ist bei einer Weboberfläche nicht der, auf dem
       * geschrieben wird.
       */
      method: 'POST',
      pattern: '/api/jobs/browse-local',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The directory request');
        const directory = typeof input.directory === 'string' ? input.directory : '';

        return ok(
          await inFreigabe(
            application,
            'Quelle',
            input.sourceType === 'SHARE',
            angabenAus(input, directory, input.credentialId),
            () =>
              application.localDirectories.browse({
                tenantId: typeof input.tenantId === 'string' ? input.tenantId : undefined,
                directory,
                known: Array.isArray(input.known)
                  ? input.known.filter((e): e is string => typeof e === 'string')
                  : [],
              })
          )
        );
      },
    },
    {
      /*
       * Derselbe Browser für die Zielseite.
       *
       * Blättern ist Lesen, und ein Zielserver spricht dasselbe Protokoll wie
       * ein Quellserver — die Zielangaben werden deshalb auf eine Quelle
       * abgebildet, statt einen zweiten Browser danebenzustellen. Zwei
       * Fassungen würden sich darüber uneins, was ein eingetippter Pfad
       * bedeutet, und genau das darf es nur einmal geben.
       */
      method: 'POST',
      pattern: '/api/jobs/browse-destination',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The directory request');
        const type = typeof input.destinationType === 'string' ? input.destinationType : 'LOCAL';

        /*
         * Ein lokales Ziel wird vom Server durchgesehen, nicht vom Browser.
         * Ein Dateidialog im Browser nennt den Pfad des Rechners, an dem
         * jemand sitzt — und das ist nicht der, auf dem geschrieben wird.
         */
        // Eine Freigabe ebenso: Ein UNC-Pfad ist ein Pfad im Dateisystem.
        if (type === 'LOCAL' || type === 'SHARE') {
          const directory = typeof input.directory === 'string' ? input.directory : '';

          return ok(
            await inFreigabe(
              application,
              'Ziel',
              type === 'SHARE',
              angabenAus(input, directory, input.destinationCredentialId),
              () =>
                application.localDirectories.browse({
                  tenantId: typeof input.tenantId === 'string' ? input.tenantId : undefined,
                  directory,
                  // Vom Aufrufer genannt und hier geprüft: Was nicht mehr da ist
                  // oder einem anderen Mandanten gehört, wird nicht angeboten.
                  known: Array.isArray(input.known)
                    ? input.known.filter((e): e is string => typeof e === 'string')
                    : [],
                })
            )
          );
        }

        return ok(
          await application.remoteDirectories.browse({
            name: typeof input.name === 'string' ? input.name : 'Neuer Job',
            tenantId: typeof input.tenantId === 'string' ? input.tenantId : DEFAULT_TENANT_ID,
            sourceType: input.destinationType as TransferJob['sourceType'],
            sourceConfig: input.destinationConfig as TransferJob['sourceConfig'],
            credentialId:
              typeof input.destinationCredentialId === 'string' ? input.destinationCredentialId : undefined,
            directory: typeof input.directory === 'string' ? input.directory : '',
          })
        );
      },
    },
    {
      // The destination is as easy to mistype as the source, and on a share it
      // is just as likely to be unreachable — so it gets its own check.
      method: 'POST',
      pattern: '/api/jobs/check-destination',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The destination check');
        const directory = typeof input.directory === 'string' ? input.directory : '';
        const tenantId = typeof input.tenantId === 'string' ? input.tenantId : undefined;
        const destinationType = typeof input.destinationType === 'string' ? input.destinationType : 'LOCAL';

        // Ein entferntes Ziel wird über dieselbe Verbindung geprüft, die der
        // Lauf später aufmacht — mit Zugang, Hostkey und Arbeitsverzeichnis.
        // Eine Prüfung, die stattdessen im hiesigen Dateisystem nachsieht,
        // meldete Erfolg für ein Verzeichnis, in das nie geschrieben wird.
        if (destinationType === 'SFTP' || destinationType === 'FTPS') {
          const adapter = await application.destinationProvider.forDestination({
            name: typeof input.name === 'string' ? input.name : 'Dieser Workflow',
            tenantId: tenantId ?? '',
            destinationType,
            destinationConfig: input.destinationConfig as never,
            destinationDirectory: directory,
            destinationCredentialId:
              typeof input.destinationCredentialId === 'string' ? input.destinationCredentialId : undefined,
          });

          try {
            const mayCreate = input.createDestinationDirectory === true;
            await adapter.prepareDirectory(directory, mayCreate);

            return ok({
              ok: true,
              exists: true,
              writable: true,
              message: `Zielverzeichnis auf ${adapter.describe()} erreichbar und beschreibbar`,
            });
          } catch (error) {
            return ok({
              ok: false,
              exists: false,
              writable: false,
              message: error instanceof Error ? error.message : String(error),
            });
          } finally {
            await adapter.dispose?.();
          }
        }

        // The client boundary is reported here rather than only on save, so a
        // wrong directory is caught while somebody is still typing it.
        if (tenantId) {
          const tenant = await application.tenantService.getById(tenantId);

          if (tenant?.rootDirectory) {
            try {
              assertWithinTenant(tenant, directory, 'The destination');
            } catch (error) {
              return ok({
                ok: false,
                exists: false,
                writable: false,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        try {
          return ok(
            await inFreigabe(
              application,
              'Ziel',
              destinationType === 'SHARE',
              angabenAus(input, directory, input.destinationCredentialId),
              () => checkDirectory(directory, { createIfMissing: input.createDestinationDirectory === true })
            )
          );
        } catch (error) {
          // Wie oben: Ein Zugang, der nicht verbindet, ist das Urteil über das
          // Ziel und nicht ein Fehler dieser Anfrage.
          return ok({
            ok: false,
            exists: false,
            writable: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      /*
       * Das Archivverzeichnis liegt auf der Quelle, nicht hier.
       *
       * Deshalb wird es über die Verbindung der *Quelle* geprüft und nicht über
       * die des Ziels: Die Datei wird dort verschoben, wo sie liegt, und eine
       * Prüfung im hiesigen Dateisystem meldete Erfolg für ein Verzeichnis, das
       * mit dem Lauf nichts zu tun hat.
       *
       * Bei einem Server wird angelegt, was fehlt. Ob dort geschrieben werden
       * darf, lässt sich nur durch Schreiben beantworten — und der Lauf legte
       * das Verzeichnis ohnehin beim ersten Verschieben an. Im Dateisystem
       * genügt der Blick auf das übergeordnete Verzeichnis, dort wird nichts
       * angefasst.
       */
      method: 'POST',
      pattern: '/api/jobs/check-archive',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The archive check');
        const directory = typeof input.directory === 'string' ? input.directory : '';
        const sourceType = typeof input.sourceType === 'string' ? input.sourceType : 'LOCAL';

        if (sourceType === 'SFTP' || sourceType === 'FTPS') {
          const adapter = await application.destinationProvider.forDestination({
            name: typeof input.name === 'string' ? input.name : 'Dieser Workflow',
            tenantId: typeof input.tenantId === 'string' ? input.tenantId : '',
            // Dieselbe Verbindung wie die Quelle, nur in die andere Richtung
            // benutzt: Blättern ist Lesen, Prüfen ist Schreiben.
            destinationType: sourceType,
            destinationConfig: input.sourceConfig as never,
            destinationDirectory: directory,
            destinationCredentialId: typeof input.credentialId === 'string' ? input.credentialId : undefined,
          });

          try {
            await adapter.prepareDirectory(directory, true);

            return ok({
              ok: true,
              exists: true,
              writable: true,
              message: `Archivverzeichnis auf ${adapter.describe()} erreichbar und beschreibbar`,
            });
          } catch (error) {
            return ok({
              ok: false,
              exists: false,
              writable: false,
              message: error instanceof Error ? error.message : String(error),
            });
          } finally {
            await adapter.dispose?.();
          }
        }

        try {
          return ok(
            await inFreigabe(
              application,
              'Quelle',
              sourceType === 'SHARE',
              angabenAus(input, directory, input.credentialId),
              () => checkDirectory(directory, { createIfMissing: true })
            )
          );
        } catch (error) {
          return ok({
            ok: false,
            exists: false,
            writable: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      /*
       * Einen Ordner anlegen, während jemand einen aussucht.
       *
       * Der häufige Fall ist das Archiv: Es gibt es noch nicht, also lässt es
       * sich nicht aussuchen — und es blind zu tippen heißt, sich beim ersten
       * Lauf überraschen zu lassen. Hier entsteht er dort, wo er später
       * gebraucht wird, über dieselbe Verbindung wie alles andere.
       *
       * Das ist der einzige dieser Endpunkte, der auf dem System des Kunden
       * *schreibt*. Deshalb drei Schranken: ein einfacher Name und kein Pfad,
       * die Mandantengrenze, und eine Zeile im Protokoll über jeden angelegten
       * Ordner — wer hinterher fragt, woher das Verzeichnis kommt, soll es
       * nachlesen können.
       */
      method: 'POST',
      pattern: '/api/jobs/create-directory',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The new directory');
        const seite: 'Quelle' | 'Ziel' = input.side === 'DESTINATION' ? 'Ziel' : 'Quelle';
        const type =
          (typeof (seite === 'Ziel' ? input.destinationType : input.sourceType) === 'string'
            ? (seite === 'Ziel' ? input.destinationType : input.sourceType)
            : 'LOCAL') as TransferJob['sourceType'];
        const parent = typeof input.directory === 'string' ? input.directory.trim() : '';
        const folder = typeof input.folder === 'string' ? input.folder.trim() : '';
        const credentialId = seite === 'Ziel' ? input.destinationCredentialId : input.credentialId;
        const tenantId = typeof input.tenantId === 'string' ? input.tenantId : undefined;

        if (!parent) {
          throw new ApiError(400, 'Es steht nicht fest, in welchem Verzeichnis der Ordner angelegt werden soll');
        }

        // Ein Name und kein Pfad: „..\woanders“ legte den Ordner sonst dort an,
        // wo niemand ihn vermutet — und bei einem Kunden ist das schlimmstenfalls
        // ein fremdes Mandantenverzeichnis.
        if (!isSafeFilename(folder)) {
          return ok({
            ok: false,
            message:
              `„${folder}“ lässt sich nicht als Ordnername verwenden. Es muss ein einfacher Name sein — ohne ` +
              'Pfad und ohne Zeichen, die das Dateisystem ablehnt.',
          });
        }

        if (type === 'SFTP' || type === 'FTPS') {
          const adapter = await application.destinationProvider.forDestination({
            name: typeof input.name === 'string' ? input.name : 'Dieser Workflow',
            tenantId: tenantId ?? '',
            destinationType: type,
            destinationConfig: (seite === 'Ziel' ? input.destinationConfig : input.sourceConfig) as never,
            destinationDirectory: parent,
            destinationCredentialId: typeof credentialId === 'string' ? credentialId : undefined,
          });

          try {
            const angelegt = adapter.resolve(parent, folder);
            await adapter.prepareDirectory(angelegt, true);
            application.logger.log({
              timestamp: new Date(),
              level: 'INFO',
              message: `Ordner ${angelegt} auf ${adapter.describe()} angelegt`,
            });

            return ok({ ok: true, path: angelegt, message: `${angelegt} wurde angelegt` });
          } catch (error) {
            return ok({ ok: false, message: error instanceof Error ? error.message : String(error) });
          } finally {
            await adapter.dispose?.();
          }
        }

        const angelegt = path.join(parent, folder);

        if (tenantId) {
          const tenant = await application.tenantService.getById(tenantId);

          if (tenant?.rootDirectory) {
            try {
              assertWithinTenant(tenant, angelegt, 'Der neue Ordner');
            } catch (error) {
              return ok({ ok: false, message: error instanceof Error ? error.message : String(error) });
            }
          }
        }

        try {
          return ok(
            await inFreigabe(
              application,
              seite,
              type === 'SHARE',
              angabenAus(input, parent, credentialId),
              async () => {
                // Ohne `recursive`: Ein Ordner, den es schon gibt, ist eine
                // Meldung wert und kein stilles Nichts — sonst führt der Knopf
                // scheinbar zum Erfolg und legt doch nichts an.
                await fs.mkdir(angelegt);
                application.logger.log({
                  timestamp: new Date(),
                  level: 'INFO',
                  message: `Ordner ${angelegt} angelegt`,
                });

                return { ok: true, path: angelegt, message: `${angelegt} wurde angelegt` };
              }
            )
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;

          return ok({
            ok: false,
            message:
              code === 'EEXIST'
                ? `${angelegt} gibt es schon.`
                : code === 'EACCES' || code === 'EPERM'
                  ? `${angelegt} lässt sich nicht anlegen: keine Berechtigung.`
                  : error instanceof Error
                    ? error.message
                    : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      pattern: '/api/jobs',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => created(await application.jobService.create(reviveJob(body))),
    },
    {
      method: 'PUT',
      pattern: '/api/jobs/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params, body }) => {
        const updated = await application.jobService.update(params.id, reviveJob(body));

        if (!updated) {
          throw new ApiError(404, `Den Workflow ${params.id} gibt es nicht`);
        }

        return ok(updated);
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/jobs/:id',
      authorization: 'MANAGE_JOBS',
      handle: async ({ params }) => {
        await application.jobService.delete(params.id);
        return { status: 204 };
      },
    },
    {
      method: 'POST',
      pattern: '/api/jobs/:id/run',
      authorization: 'RUN_JOBS',
      handle: async ({ params }) => {
        const run = await application.runtime.orchestrator.runJobNow(params.id);

        if (!run) {
          throw new ApiError(404, `Den Workflow ${params.id} gibt es nicht, oder er darf nicht von Hand gestartet werden`);
        }

        return ok(run);
      },
    },
  ];
}
