import type { Ebene } from '../consolidation/Einstellungen.js';
import { normalisiere } from './Bezeichnungen.js';

/**
 * Der Regelbestand der Mappings (SPEC-02, Abschnitt 15 bis 17).
 *
 * ## Zwei Arten, ein Bestand
 *
 * ```text
 * WERTMAPPING   FFm → Frankfurt am Main
 *               lernt sich selbst, wirkt ohne Freigabe,
 *               wird protokolliert und ist rücknehmbar
 *
 * FELDMAPPING   Kunde-ID, Kundennummer, Customer-ID → customerId
 *               wird erst durch eine ausdrückliche Bestätigung zur Regel
 * ```
 *
 * Der Unterschied ist nicht die Mühe, sondern die Wirkung: Ein falsches
 * Wertmapping trifft **einen Wert**, den man im Datensatz sieht. Ein falsches
 * Feldmapping leitet eine **ganze Spalte** still ins falsche Zielfeld — und das
 * fällt auf, wenn die Daten längst woanders sind.
 *
 * Beide liegen im selben Bestand, weil sie dieselben Fragen beantworten müssen:
 * Wer hat das eingerichtet, seit wann, wie oft hat es gewirkt, und wie nimmt man
 * es zurück. Was sie unterscheidet, steht in `wirkt()` — an einer Stelle und
 * nicht in jedem Aufrufer.
 *
 * ## Die Rangfolge
 *
 * ```text
 * Mandantenspezifisches Mapping
 *         ↓
 * Mapping des Profils
 *         ↓
 * Allgemeines Mapping
 *         ↓
 * automatische Erkennung
 *         ↓
 * Benutzerentscheidung
 * ```
 *
 * Dieselbe wie bei den Einstellungen (SPEC-02, Abschnitt 40 und 16).
 */
export type Mappingart = 'WERT' | 'FELD';

/** Woher eine Regel kommt — das entscheidet, wie viel sie wiegt. */
export type Regelherkunft = 'AUSGELIEFERT' | 'BENUTZER' | 'GELERNT';

export interface Mappingregel {
  id: string;
  art: Mappingart;
  ebene: Ebene;
  /** Bei MANDANT und PROFIL: für wen sie gilt. */
  tenantId?: string;
  profilId?: string;
  /**
   * Bei einem Wertmapping: in welchem Feld der Wert steht.
   *
   * Ohne Angabe gilt es überall — und das ist selten gemeint. „N" heißt im
   * Feld `land` Norwegen und im Feld `aktiv` Nein.
   */
  feld?: string;
  /** Der Ausgangswert (WERT) oder der Spaltenname (FELD). */
  von: string;
  /** Der fachliche Wert (WERT) oder das interne Feld (FELD). */
  nach: string;
  herkunft: Regelherkunft;
  /** Ob ein Mensch sie ausdrücklich bestätigt hat. */
  bestaetigt: boolean;
  /** Wie oft sie bestätigt wurde — die Grundlage des Lernens (Abschnitt 17). */
  bestaetigungen: number;
  /** Wie oft sie gewirkt hat. Betriebsdaten. */
  anwendungen: number;
  erstellt: Date;
  erstelltVon?: string;
  erstelltVonName?: string;
  /**
   * Vorläufig — einmal beobachtet, noch keine Regel.
   *
   * Der Zwischenzustand, ohne den der Lernweg aus Abschnitt 17 nicht
   * funktioniert: „wiederholt bestätigte Zuordnungen" setzt voraus, dass die
   * erste Beobachtung irgendwo steht. Stünde sie nirgends, wäre die zweite
   * wieder die erste, und die Regel entstünde nie.
   *
   * Eine vorläufige Zuordnung **wirkt nicht**. Sie ist eine Notiz, keine
   * Entscheidung — und in der Verwaltung als solche zu sehen.
   */
  vorlaeufig?: boolean;
  /**
   * Zurückgenommen — die Regel bleibt sichtbar und wirkt nicht mehr.
   *
   * Gelöscht wird sie nicht: Wer wissen will, warum ein Lauf vom März etwas
   * zugeordnet hat, das heute niemand mehr zuordnet, findet die Antwort sonst
   * nirgends.
   */
  zurueckgenommen?: Date;
}

export interface MappingRepository {
  list(tenantId?: string): Promise<Mappingregel[]>;
  getById(id: string): Promise<Mappingregel | undefined>;
  save(regel: Mappingregel): Promise<Mappingregel>;
}

/**
 * Ob eine Regel überhaupt wirkt.
 *
 * Hier steht der ganze Unterschied zwischen den beiden Arten — an einer Stelle.
 * Ein Feldmapping ohne Bestätigung ist ein Vorschlag und keine Regel; es liegt
 * im Bestand, damit man es bestätigen kann, und wirkt bis dahin nicht.
 */
export function wirkt(regel: Mappingregel): boolean {
  if (regel.zurueckgenommen || regel.vorlaeufig) {
    return false;
  }

  return regel.art === 'WERT' || regel.bestaetigt;
}

/** Die Rangfolge als Zahl — größer schlägt kleiner. */
const GEWICHT: Record<Ebene, number> = { ALLGEMEIN: 1, PROFIL: 2, MANDANT: 3 };

export interface Suchauftrag {
  art: Mappingart;
  /** Der Wert oder der Spaltenname, für den eine Regel gesucht wird. */
  von: string;
  /** Bei einem Wertmapping: das Feld, in dem er steht. */
  feld?: string;
  tenantId?: string;
  profilId?: string;
}

export interface Regeltreffer {
  regel: Mappingregel;
  /** Warum gerade diese — für das Protokoll und für den Bildschirm. */
  grund: string;
}

/**
 * Ob eine Regel auf diesen Auftrag überhaupt anwendbar ist.
 *
 * Verglichen wird normalisiert: `Kunden-Nr.` und `kundennr` sind derselbe Name,
 * und `FFm` soll auch `ffm` treffen. Ohne das wäre jede Schreibweise eine
 * eigene Regel, und der Bestand liefe voll mit Dubletten, die niemand als
 * solche erkennt.
 */
function passt(regel: Mappingregel, auftrag: Suchauftrag): boolean {
  if (regel.art !== auftrag.art || !wirkt(regel)) {
    return false;
  }

  if (normalisiere(regel.von) !== normalisiere(auftrag.von)) {
    return false;
  }

  // Eine Regel für ein bestimmtes Feld gilt nur dort. Eine ohne Feldangabe
  // gilt überall — sie ist die schwächere und wird unten auch so sortiert.
  if (regel.feld !== undefined && normalisiere(regel.feld) !== normalisiere(auftrag.feld ?? '')) {
    return false;
  }

  if (regel.ebene === 'MANDANT' && regel.tenantId !== auftrag.tenantId) {
    return false;
  }

  return !(regel.ebene === 'PROFIL' && regel.profilId !== auftrag.profilId);
}

/**
 * Die Regel, die gilt.
 *
 * Entschieden wird nach Ebene, und bei gleicher Ebene gewinnt die Regel mit
 * Feldangabe vor der ohne: `„N" im Feld land` ist genauer gemeint als `„N"
 * überall`. Bleibt es danach immer noch gleich, gewinnt die zuletzt angelegte —
 * denn sie ist die jüngere Entscheidung desselben Menschen.
 */
export function waehle(regeln: readonly Mappingregel[], auftrag: Suchauftrag): Regeltreffer | undefined {
  const geeignet = regeln.filter((regel) => passt(regel, auftrag));

  if (geeignet.length === 0) {
    return undefined;
  }

  const [gewaehlt] = [...geeignet].sort(
    (links, rechts) =>
      GEWICHT[rechts.ebene] - GEWICHT[links.ebene] ||
      Number(rechts.feld !== undefined) - Number(links.feld !== undefined) ||
      rechts.erstellt.getTime() - links.erstellt.getTime()
  );

  const ebene = gewaehlt.ebene === 'MANDANT' ? 'des Mandanten' : gewaehlt.ebene === 'PROFIL' ? 'des Profils' : 'allgemein';
  const herkunft =
    gewaehlt.herkunft === 'BENUTZER' ? 'von Hand eingerichtet' : gewaehlt.herkunft === 'GELERNT' ? 'gelernt' : 'ausgeliefert';

  return {
    regel: gewaehlt,
    grund:
      `Regel ${ebene}: „${gewaehlt.von}" → „${gewaehlt.nach}"` +
      (gewaehlt.feld ? ` im Feld „${gewaehlt.feld}"` : '') +
      ` (${herkunft}${gewaehlt.bestaetigt ? ', bestätigt' : ''})`,
  };
}

/**
 * Ab wie vielen übereinstimmenden Beobachtungen ein Wertmapping zur Regel wird.
 *
 * Zwei und nicht eine: „Eine einzelne unsichere automatische Vermutung darf
 * nicht automatisch zu einer dauerhaft gültigen Regel werden" (SPEC-02,
 * Abschnitt 17). Zwei unabhängige Beobachtungen sind keine Gewissheit, aber
 * sie sind kein Zufall mehr — und ein Wertmapping ist jederzeit
 * zurückzunehmen.
 */
export const LERNEN_AB = 2;

export interface Beobachtung {
  von: string;
  nach: string;
  feld?: string;
  /** Wie sicher die Zuordnung im Einzelfall war, zwischen 0 und 1. */
  sicherheit: number;
}

/** Ab hier gilt eine einzelne automatische Entscheidung als „ausreichend sicher". */
export const SICHER_AB = 0.95;

/**
 * Ob aus dieser Beobachtung eine dauerhafte Regel werden darf.
 *
 * Drei Wege führen nach SPEC-02, Abschnitt 17, dorthin, und alle drei laufen
 * hier zusammen:
 *
 * * eine **bestätigte Benutzerentscheidung** — sofort,
 * * eine **wiederholt bestätigte Zuordnung** — ab `LERNEN_AB`,
 * * eine **ausreichend sichere automatische Entscheidung** — ab `SICHER_AB`.
 *
 * Für Feldmappings gibt es diesen Weg nicht: Sie werden nur durch eine
 * ausdrückliche Bestätigung zur Regel, und diese Funktion sagt das auch.
 */
export function darfRegelWerden(
  art: Mappingart,
  beobachtung: Beobachtung,
  bisher: { bestaetigungen: number; durchMenschen: boolean }
): { erlaubt: boolean; grund: string } {
  if (bisher.durchMenschen) {
    return { erlaubt: true, grund: 'Ein Mensch hat diese Zuordnung ausdrücklich bestätigt' };
  }

  if (art === 'FELD') {
    return {
      erlaubt: false,
      grund:
        'Ein Feldmapping wird nur durch eine ausdrückliche Bestätigung zur Regel. ' +
        'Es leitet eine ganze Spalte, und ein Fehler daran fällt erst auf, wenn die Daten woanders sind',
    };
  }

  if (bisher.bestaetigungen + 1 >= LERNEN_AB) {
    return {
      erlaubt: true,
      grund: `Diese Zuordnung ist zum ${bisher.bestaetigungen + 1}. Mal so aufgetreten`,
    };
  }

  if (beobachtung.sicherheit >= SICHER_AB) {
    return {
      erlaubt: true,
      grund: `Die Zuordnung war mit ${Math.round(beobachtung.sicherheit * 100)} % sicher genug`,
    };
  }

  return {
    erlaubt: false,
    grund:
      `Erst zum ${bisher.bestaetigungen + 1}. Mal beobachtet und mit ` +
      `${Math.round(beobachtung.sicherheit * 100)} % nicht sicher genug. ` +
      'Eine einzelne unsichere Vermutung wird keine Regel',
  };
}
