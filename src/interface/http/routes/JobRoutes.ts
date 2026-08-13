import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { requiredFeaturesFor } from '../../../application/licensing/JobLicensing.js';
import type { TransferJob } from '../../../domain/transfer/TransferJob.js';
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
