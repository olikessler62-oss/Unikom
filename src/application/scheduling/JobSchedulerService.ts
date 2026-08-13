import type { JobSchedule, TransferJob } from '../../domain/transfer/TransferJob.js';

export class JobSchedulerService {
  static calculateNextExecution(now: Date, schedule: JobSchedule): Date {
    const timezone = schedule.timezone || 'UTC';

    if (schedule.type === 'INTERVAL') {
      const result = new Date(now.getTime());
      result.setMinutes(result.getMinutes() + (schedule.intervalMinutes ?? 15));
      return result;
    }

    if (schedule.type === 'HOURLY') {
      const result = new Date(now.getTime());
      result.setHours(result.getHours() + 1, 0, 0, 0);
      return result;
    }

    if (schedule.type === 'DAILY') {
      const executionTime = schedule.executionTime ?? '00:00';
      const [hour, minute] = executionTime.split(':').map(Number);
      const date = this.toTimezoneDateParts(now, timezone);
      const wallTimeUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
      const offsetMs = this.getTimezoneOffsetMs(new Date(wallTimeUtc), timezone);
      const candidate = new Date(wallTimeUtc - offsetMs);

      if (candidate.getTime() <= now.getTime()) {
        const nextDay = new Date(Date.UTC(date.year, date.month - 1, date.day + 1, hour, minute, 0, 0));
        return new Date(nextDay.getTime() - this.getTimezoneOffsetMs(nextDay, timezone));
      }

      return candidate;
    }

    if (schedule.type === 'WEEKLY') {
      const result = new Date(now.getTime());
      result.setDate(result.getDate() + 7);
      return result;
    }

    const result = new Date(now.getTime());
    result.setMinutes(result.getMinutes() + 5);
    return result;
  }

  shouldSkipExecution(job: TransferJob, now: Date): boolean {
    if (!job.enabled) {
      return true;
    }

    if (!job.lastExecutionAt) {
      return false;
    }

    const elapsedMs = now.getTime() - job.lastExecutionAt.getTime();
    return elapsedMs < 60_000;
  }

  private static toTimezoneDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value ?? 0);
    const month = Number(parts.find((part) => part.type === 'month')?.value ?? 1);
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? 1);

    return { year, month, day };
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
    const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second)
    );

    return localAsUtc - date.getTime();
  }
}
