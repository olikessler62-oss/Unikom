import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { isAtLeast, type LogLevel } from '../../../domain/logging/LogEntry.js';
import { ApiError, ok, type Route } from '../Http.js';

const LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];

function levelFrom(query: URLSearchParams): LogLevel {
  const requested = query.get('minimumLevel');

  if (requested === null) {
    return 'INFO';
  }

  if (!LEVELS.includes(requested as LogLevel)) {
    throw new ApiError(400, `"${requested}" is not a log level. Expected one of: ${LEVELS.join(', ')}`);
  }

  return requested as LogLevel;
}

function limitFrom(query: URLSearchParams): number | undefined {
  const raw = query.get('limit');

  if (raw === null) {
    return undefined;
  }

  const limit = Number.parseInt(raw, 10);

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new ApiError(400, '"limit" has to be a positive number');
  }

  return limit;
}

export function historyRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/dashboard',
      authorization: 'VIEW',
      handle: async () => ok(await application.historyService.statistics()),
    },
    {
      method: 'GET',
      pattern: '/api/jobs/:id/runs',
      authorization: 'VIEW',
      handle: async ({ params, query }) =>
        ok(await application.historyService.listRuns(params.id, limitFrom(query))),
    },
    {
      method: 'GET',
      pattern: '/api/jobs/:id/failures',
      authorization: 'VIEW',
      handle: async ({ params }) => ok(await application.historyService.listFailures(params.id)),
    },
    {
      method: 'GET',
      pattern: '/api/runs/:id',
      authorization: 'VIEW',
      handle: async ({ params, query }) => {
        const detail = await application.historyService.getRun(params.id, levelFrom(query));

        if (!detail) {
          throw new ApiError(404, `There is no run ${params.id}`);
        }

        return ok(detail);
      },
    },
    {
      method: 'GET',
      pattern: '/api/logs',
      authorization: 'VIEW',
      handle: async ({ query }) => {
        const minimumLevel = levelFrom(query);
        const entries = await application.logRepository.list({
          jobId: query.get('jobId') ?? undefined,
          runId: query.get('runId') ?? undefined,
          minimumLevel,
          limit: limitFrom(query) ?? 500,
        });

        return ok(entries.filter((entry) => isAtLeast(entry.level, minimumLevel)));
      },
    },
  ];
}
