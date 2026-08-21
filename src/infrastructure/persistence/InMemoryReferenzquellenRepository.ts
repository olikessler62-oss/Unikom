import type { Referenzquelle, Referenzquellenbestand } from '../../domain/consolidation/Referenzquelle.js';

/** Die Referenzquellen im Arbeitsspeicher — für Tests und Vorführungen. */
export class InMemoryReferenzquellenRepository implements Referenzquellenbestand {
  private readonly bestand = new Map<string, Referenzquelle>();

  async list(tenantId?: string): Promise<Referenzquelle[]> {
    return [...this.bestand.values()]
      .filter((quelle) => !tenantId || quelle.tenantId === tenantId)
      .sort((links, rechts) => links.name.localeCompare(rechts.name, 'de'));
  }

  async byId(id: string): Promise<Referenzquelle | undefined> {
    return this.bestand.get(id);
  }

  async save(quelle: Referenzquelle): Promise<void> {
    this.bestand.set(quelle.id, { ...quelle });
  }

  async entferne(id: string): Promise<void> {
    this.bestand.delete(id);
  }
}
