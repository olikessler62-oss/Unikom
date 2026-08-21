import type { Benachrichtigung, Benachrichtigungsbestand } from '../../domain/background/Benachrichtigung.js';
import type { Herzschlag, Herzschlagbestand } from '../../domain/background/Heartbeat.js';

/**
 * Herzschlag und Meldungen im Arbeitsspeicher — fuer Tests und fuer eine
 * Installation ohne Datenbank.
 *
 * Der Herzschlag ist hier wenig wert: Er soll ja gerade ueber Prozessgrenzen
 * hinweg gelesen werden, und ein Arbeitsspeicher endet am Prozess. Fuer den
 * Test der Regeln reicht er trotzdem — geprueft wird, was aus einem alten
 * Lebenszeichen folgt, nicht wie es dorthin kam.
 */
export class InMemoryHeartbeatRepository implements Herzschlagbestand {
  private readonly schlaege = new Map<string, Herzschlag>();

  async melden(schlag: Herzschlag): Promise<void> {
    this.schlaege.set(schlag.prozess, { ...schlag });
  }

  async alle(): Promise<Herzschlag[]> {
    return [...this.schlaege.values()];
  }

  async abmelden(prozess: string): Promise<void> {
    this.schlaege.delete(prozess);
  }
}

export class InMemoryNotificationRepository implements Benachrichtigungsbestand {
  private readonly meldungen: Benachrichtigung[] = [];

  async anlegen(meldung: Benachrichtigung): Promise<void> {
    this.meldungen.push({ ...meldung });
  }

  async list(tenantId: string, nurOffene = false): Promise<Benachrichtigung[]> {
    return this.meldungen
      .filter((meldung) => meldung.tenantId === tenantId && (!nurOffene || meldung.bestaetigt === undefined))
      .map((meldung) => ({ ...meldung }))
      .reverse();
  }

  async gesehen(id: string, zeitpunkt: string): Promise<void> {
    const meldung = this.meldungen.find((eintrag) => eintrag.id === id);

    if (meldung && meldung.gesehen === undefined) {
      meldung.gesehen = zeitpunkt;
    }
  }

  /** Der erste Bestaetiger bleibt der, der im Bestand steht. */
  async bestaetigen(id: string, benutzer: string, zeitpunkt: string): Promise<void> {
    const meldung = this.meldungen.find((eintrag) => eintrag.id === id);

    if (meldung && meldung.bestaetigt === undefined) {
      meldung.bestaetigt = zeitpunkt;
      meldung.bestaetigtVon = benutzer;
      meldung.gesehen = meldung.gesehen ?? zeitpunkt;
    }
  }
}
