import { randomUUID } from 'node:crypto';

import type { Logger } from '../../domain/logging/LogEntry.js';
import type { Einstellungen } from '../../domain/consolidation/Einstellungen.js';
import { einstellungenDesMandanten } from '../../domain/consolidation/Einstellungen.js';
import type { Feststellungen } from '../../domain/consolidation/Feststellungen.js';
import {
  aktuelleVersion,
  fortschreiben,
  neuesProfil,
  type Fortschreibung,
  type Profil,
  type ProfilRepository,
} from '../../domain/consolidation/Profil.js';
import type { Strukturvorgabe } from '../../domain/discovery/Expectation.js';
import type { Qualitaetsregel } from '../../domain/quality/Regeln.js';
import type { Schluessel } from '../../domain/consolidation/Schluessel.js';
import {
  schnappschussVon,
  type Schnappschuss,
  type SchnappschussRepository,
} from '../../domain/consolidation/Snapshot.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';

/**
 * Eingangsprofile anlegen, fortschreiben und einem Lauf mitgeben (Etappe 2).
 *
 * Der Dienst ist die einzige Stelle, an der ein Profil entsteht oder wächst.
 * Das ist Absicht: Eine zweite Stelle, die eine Version anhängt, wird eines
 * Tages die Notiz vergessen oder den Urheber — und dann steht in der Kette ein
 * Sprung, den niemand mehr erklären kann.
 */
export interface Anlage {
  id?: string;
  tenantId: string;
  name: string;
  description?: string;
  vorgabe: Strukturvorgabe;
  regeln?: readonly Qualitaetsregel[];
  schluessel?: Schluessel;
  einstellungen?: Einstellungen;
  feststellungen?: Feststellungen;
  erstelltVon?: string;
  erstelltVonName?: string;
}

export interface Fortschreibungswunsch {
  name?: string;
  description?: string;
  vorgabe?: Strukturvorgabe;
  regeln?: readonly Qualitaetsregel[];
  schluessel?: Schluessel;
  einstellungen?: Einstellungen;
  feststellungen?: Feststellungen;
  notiz?: string;
}

export class ProfileService {
  constructor(
    private readonly profile: ProfilRepository,
    private readonly snapshots: SchnappschussRepository,
    private readonly tenants: TenantRepository,
    private readonly logger: Logger
  ) {}

  async anlegen(anlage: Anlage): Promise<Profil> {
    const profil = neuesProfil({ ...anlage, id: anlage.id ?? randomUUID() });

    await this.profile.save(profil);

    this.logger.log({
      timestamp: new Date(),
      level: 'INFO',
      userId: anlage.erstelltVon,
      username: anlage.erstelltVonName,
      message: `Eingangsprofil „${profil.name}" angelegt (Version 1, ${anlage.vorgabe.spalten?.length ?? 0} Spalten)`,
    });

    return profil;
  }

  /**
   * Schreibt ein Profil fort.
   *
   * Name und Beschreibung sind Beschriftungen: Sie ändern sich, ohne dass eine
   * Version entsteht. Was gelesen wird — Struktur, Regeln, Schlüssel,
   * Einstellungen, Feststellungen — erzeugt eine, sofern es sich wirklich
   * ändert.
   */
  async fortschreiben(
    id: string,
    wunsch: Fortschreibungswunsch,
    wer?: { id: string; name: string }
  ): Promise<Fortschreibung> {
    const vorhanden = await this.profile.getById(id);

    if (!vorhanden) {
      throw new Error(`Ein Profil mit der Kennung ${id} gibt es nicht`);
    }

    const ergebnis = fortschreiben(
      vorhanden,
      {
        vorgabe: wunsch.vorgabe,
        regeln: wunsch.regeln,
        schluessel: wunsch.schluessel,
        einstellungen: wunsch.einstellungen,
        feststellungen: wunsch.feststellungen,
        notiz: wunsch.notiz,
      },
      wer
    );

    const beschriftet: Profil = {
      ...ergebnis.profil,
      name: wunsch.name ?? ergebnis.profil.name,
      description: wunsch.description ?? ergebnis.profil.description,
    };

    await this.profile.save(beschriftet);

    if (ergebnis.neu) {
      this.logger.log({
        timestamp: new Date(),
        level: 'INFO',
        userId: wer?.id,
        username: wer?.name,
        message:
          `Eingangsprofil „${beschriftet.name}" fortgeschrieben auf Version ${ergebnis.version.version}` +
          (wunsch.notiz ? `: ${wunsch.notiz}` : ''),
      });
    }

    return { ...ergebnis, profil: beschriftet };
  }

  /**
   * Zählt einen Treffer.
   *
   * Betriebsdaten, kein Teil der Regel — deshalb entsteht dabei **keine**
   * Version. Ein Zähler, der die Definition fortschreibt, füllte die Kette mit
   * Einträgen, in denen sich nichts geändert hat.
   */
  async getroffen(id: string): Promise<void> {
    const profil = await this.profile.getById(id);

    if (profil) {
      await this.profile.save({ ...profil, matches: profil.matches + 1 });
    }
  }

  /**
   * Friert die geltende Konfiguration ein und legt sie ab (SPEC-01, Abschnitt 10).
   *
   * Das geschieht **vor** der Verarbeitung, nicht danach: Ein Schnappschuss,
   * der am Ende entsteht, beschreibt den Stand am Ende — und wenn jemand
   * zwischendurch etwas umgestellt hat, beschreibt er genau nicht den Lauf.
   */
  async schnappschuss(auftrag: {
    tenantId: string;
    profilId?: string;
    version?: number;
    runId?: string;
    feststellungen?: Feststellungen;
  }): Promise<Schnappschuss> {
    const mandant = await this.tenants.getById(auftrag.tenantId);

    if (!mandant) {
      throw new Error(`Den Mandanten ${auftrag.tenantId} gibt es nicht`);
    }

    const profil = auftrag.profilId ? await this.profile.getById(auftrag.profilId) : undefined;

    if (auftrag.profilId && !profil) {
      throw new Error(`Ein Profil mit der Kennung ${auftrag.profilId} gibt es nicht`);
    }

    const schnappschuss = schnappschussVon({
      id: randomUUID(),
      tenantId: auftrag.tenantId,
      runId: auftrag.runId,
      mandant: einstellungenDesMandanten(mandant),
      profil,
      version: auftrag.version,
      feststellungen: auftrag.feststellungen,
    });

    await this.snapshots.save(schnappschuss);

    return schnappschuss;
  }

  /** Die Version, auf die ein Schnappschuss zeigt — die Frage „womit lief das". */
  async versionZu(schnappschuss: Schnappschuss): Promise<{ profil: Profil; version: number } | undefined> {
    if (!schnappschuss.profilId) {
      return undefined;
    }

    const profil = await this.profile.getById(schnappschuss.profilId);

    return profil ? { profil, version: schnappschuss.profilVersion ?? aktuelleVersion(profil).version } : undefined;
  }
}
