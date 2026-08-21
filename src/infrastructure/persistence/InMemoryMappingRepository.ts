import type { MappingRepository, Mappingregel } from '../../domain/mapping/Regelbestand.js';

export class InMemoryMappingRepository implements MappingRepository {
  private readonly regeln = new Map<string, Mappingregel>();

  /** Wie in der Datenbank: die eigenen **und** die allgemeinen. */
  async list(tenantId?: string): Promise<Mappingregel[]> {
    return [...this.regeln.values()]
      .filter((regel) => !tenantId || regel.tenantId === undefined || regel.tenantId === tenantId)
      .sort((links, rechts) => rechts.erstellt.getTime() - links.erstellt.getTime())
      .map((regel) => ({ ...regel }));
  }

  async getById(id: string): Promise<Mappingregel | undefined> {
    const gefunden = this.regeln.get(id);

    return gefunden ? { ...gefunden } : undefined;
  }

  async save(regel: Mappingregel): Promise<Mappingregel> {
    this.regeln.set(regel.id, { ...regel });
    return regel;
  }
}
