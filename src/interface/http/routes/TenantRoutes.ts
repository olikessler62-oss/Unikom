import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { ApiError, created, ok, optionalString, requireObject, requireString, type Route } from '../Http.js';

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
            ...tenant,
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

        return ok(tenant);
      },
    },
    {
      // Clients are part of the installation's setup, like credentials.
      method: 'POST',
      pattern: '/api/tenants',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'The client');

        return created(
          await application.tenantService.create({
            name: requireString(input, 'name'),
            description: optionalString(input, 'description'),
            rootDirectory: optionalString(input, 'rootDirectory'),
          })
        );
      },
    },
    {
      method: 'PUT',
      pattern: '/api/tenants/:id',
      authorization: 'MANAGE_CREDENTIALS',
      handle: async ({ params, body }) => {
        const input = requireObject(body, 'The client');

        return ok(
          await application.tenantService.update(params.id, {
            name: optionalString(input, 'name'),
            description: typeof input.description === 'string' ? input.description : undefined,
            rootDirectory: typeof input.rootDirectory === 'string' ? input.rootDirectory : undefined,
            enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
          })
        );
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
