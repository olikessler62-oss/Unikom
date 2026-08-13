import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Minimal durable collection store backed by a JSON file.
 *
 * It exists so schedules, runs and processed files survive a restart
 * (spec sections 31 and 39) without pulling in a database dependency. Writes go
 * through a temporary file and an atomic rename, and read-modify-write cycles
 * are serialised so two concurrent updates cannot lose each other.
 */
export class JsonFileStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly revive: (raw: Record<string, unknown>) => T
  ) {}

  async readAll(): Promise<T[]> {
    let content: string;

    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }

    if (content.trim().length === 0) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      // Never silently discard data the user may still need.
      throw new Error(
        `${this.filePath} is not valid JSON and was left untouched: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`${this.filePath} does not contain a JSON array`);
    }

    return parsed.map((entry) => this.revive(entry as Record<string, unknown>));
  }

  /** Serialised read-modify-write; the callback receives the current contents. */
  async mutate(change: (items: T[]) => T[]): Promise<T[]> {
    return this.enqueue(async () => {
      const updated = change(await this.readAll());
      await this.write(updated);
      return updated;
    });
  }

  private async write(items: T[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(items, null, 2), 'utf8');

    try {
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );

    return result;
  }
}

export function optionalDate(value: unknown): Date | undefined {
  return typeof value === 'string' ? new Date(value) : undefined;
}

export function requiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`Stored record is missing the required date field "${field}"`);
  }

  return new Date(value);
}
