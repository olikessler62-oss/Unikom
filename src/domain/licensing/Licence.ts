import type { Feature } from './Feature.js';

/**
 * The paid period of one installation, together with the modules it covers.
 *
 * A licence is a signed document the vendor issues and the customer's own
 * installation checks by itself — see `LicenceDocument`. Unikom runs on the
 * customer's machine, often without internet access, and the interface promises
 * that nothing is reported back to the vendor; asking a licence server would
 * break both. What can be done offline is verifying a signature, and that is
 * enough: only the vendor's private key can produce one.
 */
export interface Licence {
  /** Names this licence when talking about it. Not a secret. */
  id: string;
  /** Who the installation belongs to; shown in the interface. */
  customer: string;
  issuedAt: Date;
  /**
   * The paid period ends with this instant. The issuing tool puts it at the end
   * of the last paid day, so a licence "until the 31st" still works on the 31st.
   */
  validUntil: Date;
  /** The modules this customer paid for. */
  features: readonly Feature[];
  /** How many days before the end the interface starts warning. */
  warningDays: number;
}

/** How long the interface warns ahead of the end when a licence says nothing. */
export const DEFAULT_WARNING_DAYS = 14;

export type LicenceState =
  /** No public key is built in: development, tests and the demo. */
  | 'UNLICENSED'
  | 'ACTIVE'
  /** Still valid, but the end is near enough to say so. */
  | 'EXPIRING'
  | 'EXPIRED'
  /** A licence is expected but none was found. */
  | 'MISSING'
  /** One was found, but its signature or its content does not hold. */
  | 'INVALID';

export interface LicenceStatus {
  state: LicenceState;
  /** Absent for UNLICENSED, MISSING and INVALID. */
  licence?: Licence;
  /** Whole days until the end; negative once it has passed. */
  daysRemaining?: number;
  /** Why it does not hold — for the interface and for the log. */
  problem?: string;
  /**
   * Whether transfers may start. Everything else — logging in, the history,
   * settings, installing a new licence — stays reachable in every state: an
   * installation that locks the customer out of their own records would make
   * the overdue payment harder to settle, not easier.
   */
  mayRun: boolean;
}

/**
 * Turns a licence into the state it has at `now`.
 *
 * The boundary is the instant in `validUntil`: up to it the licence holds, past
 * it it does not. There is no grace period beyond the warning, because a grace
 * period is just a later end date that nobody agreed on.
 */
export function evaluateLicence(licence: Licence, now: Date): LicenceStatus {
  const daysRemaining = wholeDaysBetween(now, licence.validUntil);

  if (now.getTime() > licence.validUntil.getTime()) {
    return {
      state: 'EXPIRED',
      licence,
      daysRemaining,
      mayRun: false,
      problem: `Der bezahlte Zeitraum endete am ${formatDay(licence.validUntil)}.`,
    };
  }

  if (daysRemaining <= licence.warningDays) {
    return {
      state: 'EXPIRING',
      licence,
      daysRemaining,
      mayRun: true,
      problem: `Der bezahlte Zeitraum endet am ${formatDay(licence.validUntil)}.`,
    };
  }

  return { state: 'ACTIVE', licence, daysRemaining, mayRun: true };
}

/**
 * Rounded up, so the last partial day still counts as one: on the morning of
 * the final day the answer is "1 day left", not "0".
 */
function wholeDaysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * What stands in front of a transfer. Kept as an interface here so the
 * orchestrator and the execution service depend on the question, not on the
 * service that answers it — and so tests can hand in a closed gate in one line.
 */
export interface RunGate {
  /** Throws a LicenceExpiredError when the paid period does not cover `now`. */
  assertMayRun(now?: Date): Promise<void>;
}

/** Raised where a run would start. Payment is the one thing a retry cannot fix. */
export class LicenceExpiredError extends Error {
  constructor(readonly status: LicenceStatus) {
    super(
      status.state === 'MISSING'
        ? 'Für diese Installation ist keine Lizenz hinterlegt. Übertragungen starten erst, wenn eine gültige Lizenz eingespielt wurde.'
        : status.state === 'INVALID'
          ? `Die hinterlegte Lizenz gilt nicht: ${status.problem ?? 'Sie konnte nicht geprüft werden.'}`
          : `${status.problem ?? 'Der bezahlte Zeitraum ist abgelaufen.'} Übertragungen starten erst wieder, wenn eine gültige Lizenz eingespielt wurde.`
    );
    this.name = 'LicenceExpiredError';
  }
}
