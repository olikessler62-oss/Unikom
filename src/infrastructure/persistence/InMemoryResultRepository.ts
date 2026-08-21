import type { Ergebnisbestand, Ergebnisstand } from '../../domain/result/Ergebnisstand.js';
import type { Freigabevermerk, Verarbeitungsstatus } from '../../domain/result/Freigabe.js';

/**
 * Ergebnisstaende im Arbeitsspeicher.
 *
 * Gespeichert wird eine Kopie, und `save` legt nur an: Ein Stand, der sich
 * nachtraeglich aendern liesse, waere kein historischer Stand mehr, sondern
 * eine Variable.
 */
export class InMemoryResultRepository implements Ergebnisbestand {
  private readonly staende = new Map<string, Ergebnisstand>();

  async list(tenantId: string, laufId?: string): Promise<Ergebnisstand[]> {
    return [...this.staende.values()]
      .filter((stand) => stand.tenantId === tenantId && (laufId === undefined || stand.laufId === laufId))
      .sort((links, rechts) => links.entstanden.localeCompare(rechts.entstanden))
      .map(kopie);
  }

  async byId(id: string): Promise<Ergebnisstand | undefined> {
    const stand = this.staende.get(id);

    return stand ? kopie(stand) : undefined;
  }

  async save(stand: Ergebnisstand): Promise<void> {
    this.staende.set(stand.id, kopie(stand));
  }

  async freigabeVermerken(id: string, status: Verarbeitungsstatus, vermerk: Freigabevermerk): Promise<void> {
    const stand = this.staende.get(id);

    if (stand) {
      this.staende.set(id, { ...stand, status, freigabe: vermerk });
    }
  }
}

function kopie(stand: Ergebnisstand): Ergebnisstand {
  return {
    ...stand,
    felder: [...stand.felder],
    zeilen: stand.zeilen.map((zeile) => [...zeile]),
    pruefung: { ...stand.pruefung, befunde: stand.pruefung.befunde.map((befund) => ({ ...befund })) },
    freigabe: stand.freigabe ? { ...stand.freigabe, bedingungen: [...stand.freigabe.bedingungen] } : undefined,
  };
}
