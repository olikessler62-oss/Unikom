import { filtere, type Konfliktfilter } from '../../domain/conflicts/Auswahl.js';
import type { Bearbeitungsstand } from '../../domain/conflicts/Fortschritt.js';
import type { Bearbeitungsschritt } from '../../domain/conflicts/Historie.js';
import type { Konfliktbestand } from '../../domain/conflicts/Konfliktbestand.js';
import type { Konfliktfall } from '../../domain/conflicts/Konfliktfall.js';

/**
 * Der Konfliktbestand im Arbeitsspeicher — für Tests und für eine Installation
 * ohne Datenbank.
 *
 * Gespeichert wird eine **Kopie**. Ohne sie hielte der Aufrufer eine Referenz
 * auf den Fall im Bestand und könnte ihn ändern, ohne zu speichern — und der
 * Test, der die Fassungsprüfung beweisen soll, bewiese nichts, weil beide
 * Seiten dasselbe Objekt in der Hand hätten.
 */
export class InMemoryConflictRepository implements Konfliktbestand {
  private readonly faelle = new Map<string, Konfliktfall>();
  private readonly schritte = new Map<string, Bearbeitungsschritt[]>();
  private readonly staende = new Map<string, Bearbeitungsstand>();

  async list(tenantId: string, filter?: Konfliktfilter): Promise<Konfliktfall[]> {
    const eigene = [...this.faelle.values()].filter((fall) => fall.tenantId === tenantId);

    return filtere(eigene, filter ?? {}).map(kopie);
  }

  async byId(id: string): Promise<Konfliktfall | undefined> {
    const fall = this.faelle.get(id);

    return fall ? kopie(fall) : undefined;
  }

  async save(fall: Konfliktfall): Promise<void> {
    this.faelle.set(fall.id, kopie(fall));
  }

  async historie(fallId: string): Promise<Bearbeitungsschritt[]> {
    return [...(this.schritte.get(fallId) ?? [])];
  }

  async schrittAnfuegen(schritt: Bearbeitungsschritt): Promise<void> {
    this.schritte.set(schritt.fallId, [...(this.schritte.get(schritt.fallId) ?? []), schritt]);
  }

  async standOf(benutzer: string, tenantId: string): Promise<Bearbeitungsstand | undefined> {
    return this.staende.get(`${tenantId}/${benutzer}`);
  }

  async standSpeichern(stand: Bearbeitungsstand): Promise<void> {
    this.staende.set(`${stand.tenantId}/${stand.benutzer}`, { ...stand });
  }
}

function kopie(fall: Konfliktfall): Konfliktfall {
  return {
    ...fall,
    quellen: [...fall.quellen],
    felder: fall.felder.map((feld) => ({ ...feld, angebote: feld.angebote.map((angebot) => ({ ...angebot })) })),
    ergebnis: fall.ergebnis ? { ...fall.ergebnis } : undefined,
    sperre: fall.sperre ? { ...fall.sperre } : undefined,
  };
}
