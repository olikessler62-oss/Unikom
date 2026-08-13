import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { requiredFeaturesFor } from '../../../application/licensing/JobLicensing.js';
import { DEFAULT_TENANT_ID } from '../../../domain/tenants/Tenant.js';
import { assertWithinTenant } from '../../../domain/tenants/TenantContainment.js';
import type { TransferJob } from '../../../domain/transfer/TransferJob.js';
import { checkDirectory } from '../../../infrastructure/filesystem/DirectoryCheck.js';
import { ApiError, created, ok, requireObject, type Route } from '../Http.js';

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
          throw new ApiError(404, `There is no job ${params.id}`);
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
        const adapter = await application.adapterProvider.forSource({
          name: typeof input.name === 'string' ? input.name : 'Neuer Job',
          tenantId: typeof input.tenantId === 'string' ? input.tenantId : DEFAULT_TENANT_ID,
          sourceType: input.sourceType as TransferJob['sourceType'],
          sourceConfig: input.sourceConfig as TransferJob['sourceConfig'],
          credentialId: typeof input.credentialId === 'string' ? input.credentialId : undefined,
        });

        try {
          // The adapter reports rather than throws, so a wrong host reads as a
          // result the editor can show instead of as a failure.
          return ok(await adapter.testConnection());
        } finally {
          await adapter.dispose?.();
        }
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

        return ok(
          await checkDirectory(directory, { createIfMissing: input.createDestinationDirectory === true })
        );
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
          throw new ApiError(404, `There is no job ${params.id}`);
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
          throw new ApiError(404, `There is no job ${params.id}, or it may not be started by hand`);
        }

        return ok(run);
      },
    },
  ];
}
