import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { protocolDocument, protocolFilename } from '../../../application/logging/ProtocolDocument.js';
import { isAtLeast, type LogLevel } from '../../../domain/logging/LogEntry.js';
import { ApiError, ok, type Route } from '../Http.js';

const LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];

function levelFrom(query: URLSearchParams): LogLevel {
  const requested = query.get('minimumLevel');

  if (requested === null) {
    return 'INFO';
  }

  if (!LEVELS.includes(requested as LogLevel)) {
    throw new ApiError(400, `„${requested}“ ist kein Protokoll-Level. Erwartet wird eines von: ${LEVELS.join(', ')}`);
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
    throw new ApiError(400, '„limit“ muss eine positive Zahl sein');
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
      // Three segments, so it never collides with /api/runs/:id, which has
      // four — the router compares segment counts before anything else.
      method: 'GET',
      pattern: '/api/runs',
      authorization: 'VIEW',
      handle: async ({ query }) =>
        ok(
          await application.historyService.listRecentRuns({
            tenantId: query.get('tenantId') ?? undefined,
            limit: limitFrom(query),
          })
        ),
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
          throw new ApiError(404, `Den Lauf ${params.id} gibt es nicht`);
        }

        return ok(detail);
      },
    },
    {
      /*
       * Das Protokoll zum Aus-der-Hand-geben.
       *
       * Mitgeschrieben wird in die Datenbank; wer ein Protokoll verschicken
       * oder über seine Aufbewahrungsfrist hinaus behalten will, holt es sich
       * hier als Datei. Ohne Filter: Die Anzeige zeigt einen Detailgrad, die
       * Datei nimmt jede Zeile mit — wer sie weitergibt, soll nicht vorher
       * entscheiden müssen, welche Zeile die wichtige ist.
       */
      method: 'GET',
      pattern: '/api/runs/:id/protokoll',
      authorization: 'VIEW',
      handle: async ({ params }) => {
        const detail = await application.historyService.getRun(params.id, 'DEBUG');

        if (!detail) {
          throw new ApiError(404, `Den Lauf ${params.id} gibt es nicht`);
        }

        const entries = await application.logRepository.list({ runId: params.id, limit: 1_000_000 });

        return ok({
          filename: protocolFilename(detail),
          lines: entries.length,
          text: protocolDocument(detail, entries),
        });
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
