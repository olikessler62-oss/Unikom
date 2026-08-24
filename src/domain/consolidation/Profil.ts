import type { Strukturvorgabe } from '../discovery/Expectation.js';
import type { Qualitaetsregel } from '../quality/Regeln.js';
import type { Schluessel } from './Schluessel.js';
import type { Einstellungen } from './Einstellungen.js';
import type { Feststellungen } from './Feststellungen.js';

/**
 * Das Eingangsprofil (SPEC-02, Abschnitt 3; SPEC-03, Abschnitt 18).
 *
 * Ein Profil beschreibt eine Eingangsquelle: was für eine Struktur von dort
 * kommt, wie sie zu lesen ist und welche Einstellungen dabei gelten. Es
 * entsteht daraus, dass ein Mensch eine erkannte Struktur **bestätigt** hat —
 * nicht daraus, dass Unikom sie einmal erkannt hat. Eine Vermutung, die sich
 * selbst zur Regel erklärt, wäre genau das, was SPEC-02, Abschnitt 18,
 * ausschließt.
 *
 * ## Versionen
 *
 * Ein Profil ändert sich; ein Lauf darf sich nicht ändern. Deshalb ist ein
 * Profil eine **Kette von Versionen**, und jede Version ist unveränderlich —
 * nicht als Absichtserklärung, sondern eingefroren (`Object.freeze`, in die
 * Tiefe). Wer einen Wert einer alten Version zu setzen versucht, bekommt einen
 * Fehler und keine stille Änderung.
 *
 * Ein Lauf merkt sich Profil **und** Versionsnummer. Damit bleibt Jahre später
 * nachvollziehbar, mit welchen Definitionen er lief (SPEC-03, Abschnitt 18) —
 * und eine spätere Profiländerung ändert einen abgeschlossenen Lauf nicht
 * nachträglich (SPEC-02, Abschnitt 3).
 */
export interface Profilversion {
  /** Fortlaufend ab 1. Die Nummer eines Laufs zeigt auf genau eine davon. */
  version: number;
  erstellt: Date;
  erstelltVon?: string;
  erstelltVonName?: string;
  /** Warum es diese Version gibt — der Satz, den man später sucht. */
  notiz?: string;
  /** Die Struktur, die von dieser Quelle erwartet wird. */
  vorgabe: Strukturvorgabe;
  /**
   * Was ein Wert erfüllen muss — Pflicht, Format, Bereich, Auswahlliste.
   *
   * Hier stand einmal nichts, und die Antwort auf „welche Werte sind gültig"
   * war eine **JSON-Schema-Datei**, die jemand von Hand schreiben sollte. Sie
   * ist fort: Niemand schreibt so etwas, und wer es täte, bekäme für die Hälfte
   * der Schlüsselwörter nur die Meldung, dass Unikom sie nicht prüft.
   *
   * An ihrer Stelle stehen die Qualitätsregeln, die es längst gibt — und die
   * mehr können als ein JSON Schema: vier Schweregrade statt zwei, Ursache und
   * Auswirkung in Worten, und Bedingungen über mehrere Felder (`WENN
   * Zahlungsart = Lastschrift DANN IBAN`), an denen JSON Schema scheitert.
   *
   * Sie binden über den **Feldnamen** an die Spalten der Vorgabe. Struktur und
   * Werte bleiben damit zwei Fragen: Welche Spalten kommen, und was darf
   * darinstehen.
   */
  regeln?: readonly Qualitaetsregel[];
  /**
   * Woran ein Datensatz dieser Quelle zu erkennen ist.
   *
   * Am Profil und nicht nur am Workflow: Dass die Kundennummer den Datensatz
   * identifiziert, ist eine Eigenschaft **der Quelle** und keine des einzelnen
   * Auftrags. Wer sie an jedem Workflow neu einrichtet, richtet sie beim
   * dritten anders ein.
   *
   * Der Workflow darf sie weiterhin selbst setzen — er kennt mehrere Quellen
   * und muss sagen, welches Feld welcher davon gemeint ist.
   */
  schluessel?: Schluessel;
  /** Die Wahlmöglichkeiten dieser Ebene; leer heißt „was von oben kommt". */
  einstellungen: Einstellungen;
  /**
   * Was an der zuletzt gesehenen Datei festgestellt wurde.
   *
   * Steht hier als Gedächtnis, nicht als Vorgabe: Feststellungen sind nicht
   * überschreibbar (siehe `Feststellungen`). Weicht die nächste Lieferung ab,
   * ist das eine Meldung wert — gelesen wird sie trotzdem so, wie sie ist.
   */
  feststellungen?: Feststellungen;
}

export interface Profil {
  id: string;
  tenantId: string;
  /** Wie der Mensch sie nennt: „Bestellung Müller GmbH". */
  name: string;
  description?: string;
  /** Aufsteigend, mindestens eine. Die letzte gilt. */
  versionen: readonly Profilversion[];
  /** Wie oft die Struktur seither gepasst hat. Betriebsdaten, kein Teil der Regel. */
  matches: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfilRepository {
  list(tenantId: string): Promise<Profil[]>;
  getById(id: string): Promise<Profil | undefined>;
  save(profil: Profil): Promise<Profil>;
  delete(id: string): Promise<void>;
}

/**
 * Friert ein Wertgebilde in die Tiefe ein.
 *
 * `readonly` in TypeScript ist eine Zusage an den Übersetzer und verschwindet
 * beim Übersetzen. Eine Profilversion, die ein Lauf verwendet hat, muss aber
 * auch dann unverändert bleiben, wenn irgendwo im Code jemand ein Feld setzt —
 * und das fällt sonst niemandem auf. Im ES-Modul gilt der strikte Modus, also
 * wirft ein solcher Versuch.
 */
export function einfrieren<T>(wert: T): T {
  if (wert === null || typeof wert !== 'object' || Object.isFrozen(wert)) {
    return wert;
  }

  for (const inhalt of Object.values(wert as Record<string, unknown>)) {
    einfrieren(inhalt);
  }

  return Object.freeze(wert);
}

/** Die geltende Version — die letzte der Kette. */
export function aktuelleVersion(profil: Profil): Profilversion {
  return profil.versionen[profil.versionen.length - 1];
}

/** Eine bestimmte Version, so wie ein Lauf sie festgehalten hat. */
export function versionOf(profil: Profil, nummer: number): Profilversion | undefined {
  return profil.versionen.find((eintrag) => eintrag.version === nummer);
}

export interface Profilentwurf {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  vorgabe: Strukturvorgabe;
  regeln?: readonly Qualitaetsregel[];
  schluessel?: Schluessel;
  einstellungen?: Einstellungen;
  feststellungen?: Feststellungen;
  notiz?: string;
  erstelltVon?: string;
  erstelltVonName?: string;
  jetzt?: Date;
}

export function neuesProfil(entwurf: Profilentwurf): Profil {
  const jetzt = entwurf.jetzt ?? new Date();

  return einfrieren({
    id: entwurf.id,
    tenantId: entwurf.tenantId,
    name: entwurf.name,
    description: entwurf.description,
    versionen: [
      {
        version: 1,
        erstellt: jetzt,
        erstelltVon: entwurf.erstelltVon,
        erstelltVonName: entwurf.erstelltVonName,
        notiz: entwurf.notiz ?? 'Aus einem bestätigten Datenblock angelegt',
        vorgabe: entwurf.vorgabe,
        regeln: entwurf.regeln,
        schluessel: entwurf.schluessel,
        einstellungen: entwurf.einstellungen ?? {},
        feststellungen: entwurf.feststellungen,
      },
    ],
    matches: 0,
    createdAt: jetzt,
    updatedAt: jetzt,
  });
}

/** Was sich an einer Version ändern lässt. Alles andere ist ein neues Profil. */
export type Aenderung = Partial<
  Pick<Profilversion, 'vorgabe' | 'regeln' | 'schluessel' | 'einstellungen' | 'feststellungen'>
> & {
  notiz?: string;
};

export interface Fortschreibung {
  profil: Profil;
  version: Profilversion;
  /** Ob wirklich eine neue Version entstanden ist. */
  neu: boolean;
}

/**
 * Schreibt ein Profil fort.
 *
 * Die alten Versionen bleiben unangetastet — sie werden nicht kopiert und nicht
 * neu gebaut, sondern übernommen; sie sind eingefroren.
 *
 * Ändert sich nichts, entsteht **keine** Version. Eine Kette aus zwanzig
 * gleichen Versionen ist keine Geschichte, sondern Rauschen: Wer darin sucht,
 * wann sich etwas geändert hat, findet zwanzig Kandidaten und keine Antwort.
 * Dass nichts entstanden ist, sagt `neu: false` — verschwiegen wird es nicht.
 */
export function fortschreiben(
  profil: Profil,
  aenderung: Aenderung,
  wer?: { id?: string; name?: string },
  jetzt: Date = new Date()
): Fortschreibung {
  const bisher = aktuelleVersion(profil);
  const kandidat: Profilversion = {
    version: bisher.version + 1,
    erstellt: jetzt,
    erstelltVon: wer?.id,
    erstelltVonName: wer?.name,
    notiz: aenderung.notiz,
    vorgabe: aenderung.vorgabe ?? bisher.vorgabe,
    regeln: aenderung.regeln ?? bisher.regeln,
    schluessel: aenderung.schluessel ?? bisher.schluessel,
    einstellungen: aenderung.einstellungen ?? bisher.einstellungen,
    feststellungen: aenderung.feststellungen ?? bisher.feststellungen,
  };

  if (!veraendert(bisher, kandidat)) {
    return { profil, version: bisher, neu: false };
  }

  return {
    profil: einfrieren({
      ...profil,
      versionen: [...profil.versionen, kandidat],
      updatedAt: jetzt,
    }),
    version: kandidat,
    neu: true,
  };
}

/**
 * Ob sich am Inhalt etwas geändert hat.
 *
 * Verglichen wird der Inhalt, nicht die Begleitangaben: Zeitpunkt, Urheber und
 * Notiz sind bei jeder Fortschreibung anders und wären als Vergleich wertlos —
 * jede Speicherung ergäbe eine Version.
 */
function veraendert(bisher: Profilversion, kandidat: Profilversion): boolean {
  const inhalt = (version: Profilversion): string =>
    JSON.stringify([
      version.vorgabe,
      version.regeln ?? null,
      version.schluessel ?? null,
      version.einstellungen,
      version.feststellungen ?? null,
    ]);

  return inhalt(bisher) !== inhalt(kandidat);
}
