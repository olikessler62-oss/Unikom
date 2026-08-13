/**
 * Retry for temporary failures (spec sections 65-66).
 *
 * The classification errs on the side of not retrying: an unknown error is
 * treated as permanent. Repeating a request against a server that rejected the
 * password or the configuration wastes time and can lock an account, whereas a
 * genuinely temporary fault is caught by the next scheduler run anyway.
 */

import type { RetryConfig } from '../../domain/transfer/TransferJob.js';

export const DEFAULT_RETRY_CONFIG: RetryConfig = { attempts: 3, delaysSeconds: [5, 15] };

/** Network faults that usually disappear on their own. */
const TRANSIENT_SYSTEM_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'EAI_AGAIN',
  'EBUSY',
]);

/** Conditions that will not improve by asking again. */
const PERMANENT_PATTERNS = [
  /authentication/i,
  /all configured authentication methods failed/i,
  /permission denied/i,
  /not logged in/i,
  /host key/i,
  /fingerprint/i,
  /certificate/i,
  /self.signed/i,
  /unsafe filename/i,
  /does not exist/i,
  /no such file/i,
  /not implemented/i,
  /no host configured/i,
];

const TRANSIENT_PATTERNS = [
  /timed?\s?out/i,
  /timeout/i,
  /connection reset/i,
  /connection closed/i,
  /temporarily unavailable/i,
  /service not available/i,
  /try again/i,
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransientError(error: unknown): boolean {
  const message = messageOf(error);

  // A permanent condition wins even if its text also mentions a timeout.
  if (PERMANENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }

  const code = (error as { code?: unknown } | undefined)?.code;

  // FTP reply codes: 4xx is a temporary negative reply, 5xx a permanent one.
  if (typeof code === 'number') {
    return code >= 400 && code < 500;
  }

  if (typeof code === 'string' && TRANSIENT_SYSTEM_CODES.has(code)) {
    return true;
  }

  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RetryAttemptInfo {
  attempt: number;
  error: unknown;
  delaySeconds: number;
}

const defaultWait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RetryPolicy {
  constructor(
    private readonly config: RetryConfig = DEFAULT_RETRY_CONFIG,
    private readonly wait: (milliseconds: number) => Promise<void> = defaultWait
  ) {}

  /**
   * Runs the operation, repeating it for temporary failures only. `onRetry` is
   * called before each further attempt so the run log shows what happened.
   */
  async run<T>(operation: () => Promise<T>, onRetry?: (info: RetryAttemptInfo) => void): Promise<T> {
    const attempts = Math.max(1, this.config.attempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === attempts || !isTransientError(error)) {
          throw error;
        }

        const delaySeconds = this.config.delaysSeconds[attempt - 1] ?? 0;
        onRetry?.({ attempt, error, delaySeconds });
        await this.wait(delaySeconds * 1000);
      }
    }

    throw lastError;
  }
}
