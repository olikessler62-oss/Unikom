import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { isAtLeast, type LogLevel } from '../../../domain/logging/LogEntry.js';
import { ApiError, ok, type Route } from '../Http.js';

/**
 * The control room: what is in flight, what it is doing right now, and the three
 * things somebody standing in front of it may do about it.
 *
 * Holding and stopping act between two files (see `RunControl`), so a request
 * here is answered immediately while the effect arrives with the next file. The
 * state travels back with every answer, which is what the interface shows.
 */
export function runControlRoutes(application: UnikomApplication): Route[] {
  const controllerFor = (runId: string) => {
    const controller = application.runControls.get(runId);

    if (!controller) {
      // Either it never existed or it finished a moment ago — for the caller
      // both mean the same: there is nothing here to steer any more.
      throw new ApiError(404, `Der Lauf ${runId} läuft nicht (mehr).`);
    }

    return controller;
  };

  return [
    {
      method: 'GET',
      // Not /api/runs/active: the router takes the first matching pattern, and
      // /api/runs/:id would swallow it with an id of "active".
      pattern: '/api/active-runs',
      authorization: 'VIEW',
      handle: () =>
        ok(
          application.runControls.active().map((run) => ({
            ...run,
            startedAt: run.startedAt.toISOString(),
          }))
        ),
    },
    {
      method: 'POST',
      pattern: '/api/runs/:id/pause',
      authorization: 'RUN_JOBS',
      handle: ({ params }) => {
        const controller = controllerFor(params.id);
        controller.pause();

        return ok({ runId: params.id, state: controller.state() });
      },
    },
    {
      method: 'POST',
      pattern: '/api/runs/:id/resume',
      authorization: 'RUN_JOBS',
      handle: ({ params }) => {
        const controller = controllerFor(params.id);
        controller.resume();

        return ok({ runId: params.id, state: controller.state() });
      },
    },
    {
      method: 'POST',
      pattern: '/api/runs/:id/cancel',
      authorization: 'RUN_JOBS',
      handle: ({ params }) => {
        const controller = controllerFor(params.id);
        controller.cancel();

        return ok({ runId: params.id, state: controller.state() });
      },
    },
    {
      /**
       * The running log. The caller names the highest position it already has
       * and gets only what arrived since — which keeps a look every few seconds
       * cheap even when a run writes thousands of lines.
       */
      method: 'GET',
      pattern: '/api/runs/:id/log',
      authorization: 'VIEW',
      handle: async ({ params, query }) => {
        const minimumLevel = (query.get('minimumLevel') as LogLevel | null) ?? 'INFO';
        const after = query.get('after');
        const afterSequence = after === null ? undefined : Number.parseInt(after, 10);

        if (afterSequence !== undefined && !Number.isFinite(afterSequence)) {
          throw new ApiError(400, '„after“ muss eine Zahl sein');
        }

        const entries = await application.logRepository.list({
          runId: params.id,
          minimumLevel,
          afterSequence,
          limit: 500,
        });

        return ok(entries.filter((entry) => isAtLeast(entry.level, minimumLevel)));
      },
    },
  ];
}
