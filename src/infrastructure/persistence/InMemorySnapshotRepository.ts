import type { Schnappschuss, SchnappschussRepository } from '../../domain/consolidation/Snapshot.js';

/**
 * Ein Schnappschuss wird geschrieben und danach nur gelesen — auch hier gibt es
 * kein Ändern. Die Ablage ist eine Karte und keine Liste: Zu einem Lauf gehört
 * genau einer, und der letzte gewinnt, falls doch zwei entstehen.
 */
export class InMemorySnapshotRepository implements SchnappschussRepository {
  private readonly schnappschuesse = new Map<string, Schnappschuss>();

  async save(schnappschuss: Schnappschuss): Promise<Schnappschuss> {
    this.schnappschuesse.set(schnappschuss.id, schnappschuss);
    return schnappschuss;
  }

  async getById(id: string): Promise<Schnappschuss | undefined> {
    return this.schnappschuesse.get(id);
  }

  async findByRun(runId: string): Promise<Schnappschuss | undefined> {
    return [...this.schnappschuesse.values()]
      .filter((eintrag) => eintrag.runId === runId)
      .sort((links, rechts) => rechts.erstellt.getTime() - links.erstellt.getTime())[0];
  }
}
