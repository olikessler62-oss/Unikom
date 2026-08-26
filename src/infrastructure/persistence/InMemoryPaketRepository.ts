import type { Archivpaket, Paketbestand } from '../../domain/transfer/Archivpaket.js';

/** Der Paketbestand im Arbeitsspeicher — für Tests und für den Trockenlauf. */
export class InMemoryPaketRepository implements Paketbestand {
  private readonly pakete = new Map<string, Archivpaket>();

  async list(tenantId?: string): Promise<Archivpaket[]> {
    const alle = [...this.pakete.values()];

    return (tenantId ? alle.filter((paket) => paket.tenantId === tenantId) : alle).sort((eines, anderes) =>
      anderes.erstellt.localeCompare(eines.erstellt)
    );
  }

  /** Das jüngste Paket dieses Laufs — dieselbe Regel wie in SQLite. */
  async zuLauf(laufId: string): Promise<Archivpaket | undefined> {
    return (await this.list()).find((paket) => paket.laufId === laufId);
  }

  async save(paket: Archivpaket): Promise<void> {
    this.pakete.set(paket.id, { ...paket });
  }
}
