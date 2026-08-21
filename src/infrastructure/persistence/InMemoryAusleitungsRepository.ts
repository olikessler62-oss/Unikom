import type { Ausleitung, Ausleitungsbestand } from '../../domain/conflicts/Ausleitung.js';

/** Der Bestand der Ausleitungen im Arbeitsspeicher — für Tests und Vorführungen. */
export class InMemoryAusleitungsRepository implements Ausleitungsbestand {
  private readonly bestand = new Map<string, Ausleitung>();

  async list(tenantId?: string): Promise<Ausleitung[]> {
    return [...this.bestand.values()]
      .filter((ausleitung) => !tenantId || ausleitung.tenantId === tenantId)
      .sort((links, rechts) => rechts.erstellt.localeCompare(links.erstellt));
  }

  async save(ausleitung: Ausleitung): Promise<void> {
    this.bestand.set(ausleitung.id, { ...ausleitung });
  }
}
