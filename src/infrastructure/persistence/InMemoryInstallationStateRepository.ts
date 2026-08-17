import type { InstallationStateRepository } from '../../domain/installation/InstallationState.js';

/** Volatile counterpart for tests and the in-memory wiring. */
export class InMemoryInstallationStateRepository implements InstallationStateRepository {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}
