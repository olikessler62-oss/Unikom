import { assertBegriffIsUsable, type Bestand, type Bestandsauskunft } from '../../domain/privacy/DataStore.js';
import type { Logger } from '../../domain/logging/LogEntry.js';

/**
 * Auskunft und Löschauftrag über alle Bestände (FR_009, Abschnitt 5 und 6).
 *
 * Beides ist dieselbe Suche; der Unterschied ist der zweite Schritt. Deshalb
 * steht hier nicht zweimal derselbe Code, sondern einmal — und `erase` verlangt
 * ausdrücklich, dass vorher gesucht wurde.
 */
export interface Auskunft {
  begriff: string;
  tenantId?: string;
  bestaende: Bestandsauskunft[];
  treffer: number;
  /** Wo Unikom von sich aus nichts tun wird. */
  nurAnzeige: string[];
}

export interface Loeschbericht {
  begriff: string;
  tenantId?: string;
  /** Je Bestand: wie viele Stellen betroffen waren. */
  entfernt: { key: string; name: string; behandlung: string; stellen: number }[];
  /** Bestände, in denen etwas gefunden wurde, das Unikom nicht anfassen darf. */
  offen: Bestandsauskunft[];
  /** Wann der Auftrag ausgeführt wurde — der Beleg braucht einen Zeitpunkt. */
  zeitpunkt: Date;
  /** Wer ihn veranlasst hat, sofern bekannt. */
  veranlasser?: string;
}

export class PrivacyService {
  constructor(
    private readonly bestaende: readonly Bestand[],
    private readonly logger: Logger
  ) {}

  /** Die Anmeldung aller Bestände — Grundlage der Auskunftsseite. */
  verzeichnis(): readonly Omit<Bestand, 'suchen' | 'ausfuehren'>[] {
    return this.bestaende.map(({ suchen, ausfuehren, ...angaben }) => angaben);
  }

  async search(begriff: string, tenantId?: string, grenze?: number): Promise<Auskunft> {
    const gesucht = assertBegriffIsUsable(begriff);
    const bestaende = await Promise.all(
      this.bestaende.map(async (bestand) => {
        const auskunft = await bestand.suchen(gesucht, tenantId, grenze);

        return tenantId && !bestand.mandantenweise ? { ...auskunft, hinweis: ueberMandant(auskunft) } : auskunft;
      })
    );

    return {
      begriff: gesucht,
      tenantId,
      bestaende,
      treffer: bestaende.reduce((summe, bestand) => summe + bestand.treffer, 0),
      nurAnzeige: bestaende
        .filter((bestand) => bestand.behandlung === 'ANZEIGEN' && bestand.treffer > 0)
        .map((bestand) => bestand.name),
    };
  }

  /**
   * Führt aus, was die Suche gezeigt hat.
   *
   * Protokolliert wird der Auftrag selbst — mit Begriff, Umfang und dem
   * Menschen dahinter. Die gelöschten Werte stehen dort nicht noch einmal;
   * ein Löschprotokoll, das den Wert wiederholt, ist keines (FR_009,
   * Abschnitt 5).
   */
  async erase(
    begriff: string,
    tenantId: string | undefined,
    veranlasser?: { id: string; name: string }
  ): Promise<Loeschbericht> {
    const gesucht = assertBegriffIsUsable(begriff);
    const vorher = await this.search(gesucht, tenantId);
    const entfernt: Loeschbericht['entfernt'] = [];
    const uebergangen: Bestandsauskunft[] = [];

    for (const bestand of this.bestaende) {
      if (bestand.behandlung === 'ANZEIGEN') {
        continue;
      }

      /*
       * Ein Bestand, der sich nicht auf den Mandanten eingrenzen lässt, wird
       * bei einer Eingrenzung nicht ausgeführt.
       *
       * Er zu löschen hieße, die Zeilen aller anderen Mandanten mitzunehmen —
       * mehr, als beauftragt wurde, und nicht mehr zurückzuholen. Er wird
       * stattdessen vorgelegt: Wer ihn wirklich meint, führt den Auftrag ohne
       * Eingrenzung aus.
       */
      if (tenantId && !bestand.mandantenweise) {
        const auskunft = await bestand.suchen(gesucht, tenantId);

        if (auskunft.treffer > 0) {
          uebergangen.push({ ...auskunft, hinweis: ueberMandant(auskunft) });
        }

        continue;
      }

      const stellen = await bestand.ausfuehren(gesucht, tenantId);

      entfernt.push({ key: bestand.key, name: bestand.name, behandlung: bestand.behandlung, stellen });
    }

    const summe = entfernt.reduce((wert, eintrag) => wert + eintrag.stellen, 0);
    const offen = [
      ...vorher.bestaende.filter((bestand) => bestand.behandlung === 'ANZEIGEN' && bestand.treffer > 0),
      ...uebergangen,
    ];
    const zeitpunkt = new Date();

    this.logger.log({
      timestamp: zeitpunkt,
      level: 'WARNING',
      userId: veranlasser?.id,
      username: veranlasser?.name,
      message:
        `Löschauftrag ausgeführt: ${summe} Stelle(n) in ${entfernt.filter((eintrag) => eintrag.stellen > 0).length} ` +
        `Bestand/Beständen bereinigt` +
        (offen.length > 0 ? `; ${offen.length} Bestand/Bestände bleiben zur Prüfung durch einen Menschen` : ''),
    });

    return { begriff: gesucht, tenantId, entfernt, offen, zeitpunkt, veranlasser: veranlasser?.name };
  }
}

/** Der Nachsatz für einen Bestand, der die Eingrenzung auf einen Mandanten nicht kennt. */
function ueberMandant(auskunft: Bestandsauskunft): string {
  return (
    `${auskunft.hinweis ? `${auskunft.hinweis}. ` : ''}Dieser Bestand lässt sich in dieser Installation nicht auf ` +
    'einen Mandanten eingrenzen; die Zahl gilt für die gesamte Installation. Gelöscht wird hier deshalb nur ein ' +
    'Auftrag ohne Eingrenzung'
  );
}
