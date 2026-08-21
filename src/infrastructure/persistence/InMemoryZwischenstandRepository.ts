import type {
  Blockauskunft,
  Zwischenstand,
  Zwischenstandbestand,
} from '../../domain/consolidation/Zwischenstand.js';

/**
 * Zwischenstände im Arbeitsspeicher.
 *
 * Für Tests — und für eine Installation, die blockweise Verarbeitung nutzt,
 * ohne sie fortsetzen zu wollen. Sie erfüllt dann die Aufteilung, aber nicht
 * die Zusage aus SPEC-06, Abschnitt 15, dass ein unterbrochener Lauf
 * fortgesetzt werden kann: Was hier liegt, geht mit dem Prozess unter — und
 * genau der ist bei einem Abbruch der Verschwundene.
 */
export class InMemoryZwischenstandRepository<T> implements Zwischenstandbestand<T> {
  private readonly staende = new Map<string, Zwischenstand<T>[]>();

  async speichere(stand: Zwischenstand<T>): Promise<void> {
    const vorhanden = (this.staende.get(stand.laufId) ?? []).filter((eintrag) => eintrag.block !== stand.block);

    this.staende.set(stand.laufId, [...vorhanden, stand]);
  }

  async auskunft(laufId: string): Promise<Blockauskunft[]> {
    return this.geordnet(laufId).map(({ teilbericht, ...auskunft }) => {
      void teilbericht;

      return auskunft;
    });
  }

  async lies(laufId: string, block: number): Promise<Zwischenstand<T> | undefined> {
    return this.geordnet(laufId).find((stand) => stand.block === block);
  }

  private geordnet(laufId: string): Zwischenstand<T>[] {
    return [...(this.staende.get(laufId) ?? [])].sort((links, rechts) => links.block - rechts.block);
  }

  async entferne(laufId: string): Promise<void> {
    this.staende.delete(laufId);
  }
}
