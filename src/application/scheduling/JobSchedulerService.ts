import type { JobSchedule, TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * Schedule arithmetic (spec sections 21-31). Every calculation goes through the
 * schedule's explicit timezone; neither UTC nor the server timezone is ever
 * assumed implicitly (section 25).
 *
 * This service contains no transfer logic at all — it only answers when a job
 * is due (section 27).
 */
export class JobSchedulerService {
  static calculateNextExecution(now: Date, schedule: JobSchedule): Date {
    const timezone = schedule.timezone || 'UTC';

    switch (schedule.type) {
      case 'INTERVAL': {
        const minutes = schedule.intervalMinutes ?? 15;
        if (minutes <= 0) {
          throw new Error('An INTERVAL schedule needs a positive intervalMinutes value');
        }

        return new Date(now.getTime() + minutes * 60_000);
      }

      case 'HOURLY': {
        const next = new Date(now.getTime());
        next.setUTCMinutes(0, 0, 0);
        next.setUTCHours(next.getUTCHours() + 1);
        return next;
      }

      case 'DAILY':
        return this.nextOccurrence(now, timezone, schedule.executionTime ?? '00:00');

      case 'WEEKLY': {
        const weekdays = schedule.weekdays ?? [];
        if (weekdays.length === 0) {
          throw new Error('A WEEKLY schedule needs at least one weekday');
        }

        return this.nextOccurrence(now, timezone, schedule.executionTime ?? '00:00', weekdays);
      }

      case 'CRON':
        throw new Error(
          'Custom cron expressions are not supported yet. Use INTERVAL, HOURLY, DAILY or WEEKLY until the cron parser exists.'
        );

      default:
        throw new Error(`Unsupported schedule type: ${String(schedule.type)}`);
    }
  }

  /**
   * After a restart a job must not replay everything it missed; the next
   * regular time is computed instead (spec sections 30-31).
   */
  static ensureNextExecution(job: TransferJob, now: Date): TransferJob {
    if (!job.schedule || job.nextExecutionAt) {
      return job;
    }

    return { ...job, nextExecutionAt: this.calculateNextExecution(now, job.schedule) };
  }

  /** Whether the scheduler itself may start this job right now. */
  isDue(job: TransferJob, now: Date): boolean {
    if (!job.enabled || !job.schedule || job.executionMode === 'MANUAL') {
      return false;
    }

    if (!job.nextExecutionAt) {
      return false;
    }

    return job.nextExecutionAt.getTime() <= now.getTime();
  }

  /**
   * Walks forward day by day until it finds a wall-clock occurrence that lies
   * in the future and, for weekly schedules, falls on an allowed weekday.
   * Weekdays follow the JavaScript convention: 0 = Sunday .. 6 = Saturday.
   */
  private static nextOccurrence(now: Date, timezone: string, executionTime: string, weekdays?: number[]): Date {
    const { hour, minute } = this.parseExecutionTime(executionTime);
    const today = this.toTimezoneDateParts(now, timezone);

    for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
      const day = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));

      if (weekdays && !weekdays.includes(day.getUTCDay())) {
        continue;
      }

      const candidate = this.zonedWallTimeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        timezone
      );

      if (candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }

    throw new Error(`Could not determine the next execution time for ${executionTime} in ${timezone}`);
  }

  private static parseExecutionTime(executionTime: string): { hour: number; minute: number } {
    const match = /^(\d{1,2}):(\d{2})$/.exec(executionTime.trim());
    if (!match) {
      throw new Error(`Invalid execution time "${executionTime}", expected HH:MM`);
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour > 23 || minute > 59) {
      throw new Error(`Invalid execution time "${executionTime}", expected HH:MM`);
    }

    return { hour, minute };
  }

  /** Turns a wall-clock time in a timezone into the matching UTC instant. */
  private static zonedWallTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string
  ): Date {
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const firstOffset = this.getTimezoneOffsetMs(new Date(naiveUtc), timezone);
    const candidate = new Date(naiveUtc - firstOffset);

    // Around a daylight saving change the offset at the naive instant can
    // differ from the offset at the real instant, so refine once.
    const refinedOffset = this.getTimezoneOffsetMs(candidate, timezone);
    return refinedOffset === firstOffset ? candidate : new Date(naiveUtc - refinedOffset);
  }

  private static toTimezoneDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const parts = formatter.formatToParts(date);
    return {
      year: Number(parts.find((part) => part.type === 'year')?.value ?? 0),
      month: Number(parts.find((part) => part.type === 'month')?.value ?? 1),
      day: Number(parts.find((part) => part.type === 'day')?.value ?? 1),
    };
  }

  private static getTimezoneOffsetMs(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(
      parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
    );

    const localAsUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second)
    );

    return localAsUtc - date.getTime();
  }
}
