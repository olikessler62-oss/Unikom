import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import type { LicenceStatus } from '../../../domain/licensing/Licence.js';
import { ApiError, ok, type Route } from '../Http.js';

/**
 * What the interface is told about the paid period. It carries no signature and
 * no key: the interface only reports, it never decides — the server does that
 * in front of every run.
 */
export interface LicenceView {
  state: LicenceStatus['state'];
  mayRun: boolean;
  customer?: string;
  licenceId?: string;
  validUntil?: string;
  daysRemaining?: number;
  problem?: string;
  features?: string[];
}

export function toLicenceView(status: LicenceStatus): LicenceView {
  return {
    state: status.state,
    mayRun: status.mayRun,
    customer: status.licence?.customer,
    licenceId: status.licence?.id,
    validUntil: status.licence?.validUntil.toISOString(),
    daysRemaining: status.daysRemaining,
    problem: status.problem,
    features: status.licence ? [...status.licence.features] : undefined,
  };
}

export function licenceRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'GET',
      pattern: '/api/licence',
      // Everybody who is logged in may see how long the installation still
      // runs. It is not a secret, and the person who notices the warning is
      // rarely the one who pays the invoice.
      authorization: 'SESSION',
      handle: async () => ok(toLicenceView(await application.licenceService.refresh())),
    },
    {
      method: 'POST',
      pattern: '/api/licence',
      authorization: 'MANAGE_USERS',
      handle: async ({ body }) => {
        const text = (body as { licence?: unknown } | undefined)?.licence;

        if (typeof text !== 'string' || text.trim() === '') {
          throw new ApiError(400, 'Es wurde keine Lizenz übergeben.');
        }

        try {
          return ok(toLicenceView(await application.licenceService.install(text)));
        } catch (error) {
          // Every rejection here is about the document the caller handed in,
          // and its message is written to be read by them.
          throw new ApiError(400, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ];
}
