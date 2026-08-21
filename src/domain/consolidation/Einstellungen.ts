import { DEFAULT_REGION, type Region } from '../tenants/Region.js';
import { CONFIDENCE_THRESHOLD, DEFAULT_NULL_VALUES, SAMPLE_LIMIT, SAMPLE_SIZE } from './Recognition.js';
import { DEFAULT_PIVOT } from './Dates.js';

/**
 * Die Konfigurationshierarchie (SPEC-02, Abschnitt 40).
 *
 * ```text
 * Mandant   ← gewinnt immer
 *    ↓
 * Profil    ← darf Allgemeines überschreiben, Mandantenspezifisches nicht
 *    ↓
 * Allgemein ← was Unikom mitbringt
 * ```
 *
 * Ein Profil ist eine **Sammlung von Einstellungen und keine übergeordnete
 * Ebene**. Wer am Mandanten etwas festlegt, hat für diesen Kunden entschieden;
 * ein Profil für eine einzelne Eingangsquelle darf das nicht aufheben.
 *
 * ## Warum das hier steht und nicht in einem Formular
 *
 * Eine Vererbung, die an dreißig Stellen einzeln ausgerechnet wird, geht an
 * einer davon anders aus. Hier steht sie einmal — und sie gibt nicht nur den
 * Wert zurück, sondern auch, **woher** er kommt: Der Benutzer muss erkennen
 * können, welche Einstellung tatsächlich gilt (SPEC-02, Abschnitt 41).
 */

/**
 * Was eingestellt werden kann.
 *
 * Bewusst nur das, was heute auch wirkt. Ein Feld für „Verhalten bei Dubletten"
 * ließe sich in fünf Minuten hinzufügen und wäre bis Etappe 6 eine Einstellung
 * ohne Wirkung — also eine Behauptung auf dem Bildschirm, die niemand einlöst.
 * Die Liste wächst mit den Etappen, nicht vor ihnen.
 */
export interface Einstellungen {
  /** Sprache und Land nach BCP 47 — entscheidet Zahlen- und Datumslesart. */
  locale?: string;
  /** Zeitzone nach IANA. */
  timeZone?: string;
  /**
   * Ab welcher zweistelligen Jahreszahl das vorige Jahrhundert gemeint ist.
   * `50` heißt: 49 → 2049, 50 → 1950.
   */
  jahrhundertGrenze?: number;
  /** Werte, die als „nichts" gelten. */
  nullWerte?: readonly string[];
  /** Wie viele Werte je Feld geprüft werden (SPEC-02, Abschnitt 4). */
  stichprobe?: number;
  /** Worauf erweitert wird, wenn die Stichprobe nicht reicht. */
  stichprobeGrenze?: number;
  /** Ab welchem Anteil passender Werte ein Typ als sicher gilt. */
  mindestKonfidenz?: number;
}

/** Jede Einstellung mit einem Wert — das Ergebnis der Vererbung. */
export type WirksameEinstellungen = Required<Einstellungen>;

/** Die drei Ebenen, in der Reihenfolge ihres Gewichts. */
export type Ebene = 'ALLGEMEIN' | 'PROFIL' | 'MANDANT';

/**
 * Was Unikom mitbringt.
 *
 * Die Werte stehen nicht ein zweites Mal hier, sondern kommen aus den Modulen,
 * die sie anwenden. Eine Voreinstellung, die an zwei Stellen geschrieben ist,
 * ist an einer davon irgendwann veraltet — und dann zeigt der Bildschirm etwas
 * anderes, als die Erkennung tut.
 */
export const ALLGEMEIN: WirksameEinstellungen = {
  locale: DEFAULT_REGION.locale,
  timeZone: DEFAULT_REGION.timeZone,
  jahrhundertGrenze: DEFAULT_PIVOT,
  nullWerte: DEFAULT_NULL_VALUES,
  stichprobe: SAMPLE_SIZE,
  stichprobeGrenze: SAMPLE_LIMIT,
  mindestKonfidenz: CONFIDENCE_THRESHOLD,
};

export type Einstellungsname = keyof Einstellungen;

/** Die Namen in fester Reihenfolge — sie bestimmt die Anzeige. */
export const EINSTELLUNGEN: readonly Einstellungsname[] = [
  'locale',
  'timeZone',
  'jahrhundertGrenze',
  'nullWerte',
  'stichprobe',
  'stichprobeGrenze',
  'mindestKonfidenz',
];

/** Wie eine Einstellung heißt, wenn ein Mensch sie liest. */
export const EINSTELLUNG_LABELS: Record<Einstellungsname, string> = {
  locale: 'Sprache und Land',
  timeZone: 'Zeitzone',
  jahrhundertGrenze: 'Jahrhundertgrenze',
  nullWerte: 'Werte, die als „nichts" gelten',
  stichprobe: 'Stichprobe',
  stichprobeGrenze: 'Stichprobe, erweitert',
  mindestKonfidenz: 'Mindestkonfidenz',
};

export interface Herkunft<T = unknown> {
  /** Die Ebene, die sich durchgesetzt hat. */
  ebene: Ebene;
  wert: T;
  /** Was auf den einzelnen Ebenen steht — auch das, was überstimmt wurde. */
  ebenen: { ebene: Ebene; wert: T }[];
}

export type EffektiveEinstellungen = { [K in Einstellungsname]: Herkunft<WirksameEinstellungen[K]> };

/**
 * Die geltende Einstellung samt Begründung.
 *
 * Beispiel aus SPEC-02, Abschnitt 41:
 *
 * ```text
 * Allgemein:  de-DE
 * Profil:     fr-FR
 * Mandant:    en-US
 * Effektiv:   en-US
 * ```
 *
 * Zurückgegeben werden **alle drei** Zeilen und nicht nur die letzte. Ein
 * Benutzer, der `en-US` liest und `fr-FR` eingestellt hat, muss sehen können,
 * wer ihn überstimmt hat — sonst sucht er den Fehler im Profil, und dort ist
 * er nicht.
 */
export function effektiveEinstellungen(
  mandant: Einstellungen | undefined,
  profil: Einstellungen | undefined
): EffektiveEinstellungen {
  const ergebnis = {} as EffektiveEinstellungen;

  for (const name of EINSTELLUNGEN) {
    const ebenen: { ebene: Ebene; wert: unknown }[] = [{ ebene: 'ALLGEMEIN', wert: ALLGEMEIN[name] }];

    if (profil?.[name] !== undefined) {
      ebenen.push({ ebene: 'PROFIL', wert: profil[name] });
    }

    if (mandant?.[name] !== undefined) {
      ebenen.push({ ebene: 'MANDANT', wert: mandant[name] });
    }

    // Die letzte gewinnt, weil die Liste in der Reihenfolge des Gewichts
    // aufgebaut ist. Keine Sonderregel, kein Vergleich — die Reihenfolge ist
    // die Regel.
    const gewinner = ebenen[ebenen.length - 1];

    // Der Umweg über `Record`, weil TypeScript beim Schreiben in ein Feld,
    // dessen Name aus einer Vereinigung stammt, den Schnitt aller Wertetypen
    // verlangt — und den kann kein einzelner Wert erfüllen. Gelesen wird
    // trotzdem typsicher: `EffektiveEinstellungen` bleibt die Zusage nach außen.
    (ergebnis as Record<string, Herkunft>)[name] = { ebene: gewinner.ebene, wert: gewinner.wert, ebenen };
  }

  return ergebnis;
}

/** Dieselbe Vererbung, aber nur die Werte — für alles, was damit arbeitet. */
export function wirksameEinstellungen(
  mandant: Einstellungen | undefined,
  profil: Einstellungen | undefined
): WirksameEinstellungen {
  const effektiv = effektiveEinstellungen(mandant, profil);
  const ergebnis = { ...ALLGEMEIN };

  for (const name of EINSTELLUNGEN) {
    (ergebnis as Record<string, unknown>)[name] = effektiv[name].wert;
  }

  return ergebnis;
}

/** Die Region, wie sie sich aus der Hierarchie ergibt. */
export function regionAus(einstellungen: WirksameEinstellungen): Region {
  return { locale: einstellungen.locale, timeZone: einstellungen.timeZone };
}

/**
 * Was am Mandanten eingestellt werden kann — ohne Sprache und Zeitzone.
 *
 * Die trägt `Tenant.region`, seit es Mandanten gibt, und sie steht dort
 * richtig. Ein zweites Feld daneben wäre kein Zugewinn, sondern die Frage,
 * welches von beiden gilt.
 */
export type Mandanteneinstellungen = Omit<Einstellungen, 'locale' | 'timeZone'>;

/**
 * Die Mandantenebene, aus den beiden Stellen zusammengesetzt, an denen sie
 * wirklich steht.
 *
 * Strukturell getippt und nicht gegen `Tenant`: Sonst müsste die Konsolidierung
 * die Mandantenverwaltung kennen, um eine Einstellung zu lesen.
 */
export function einstellungenDesMandanten(mandant: {
  region?: Region;
  consolidation?: Mandanteneinstellungen;
}): Einstellungen {
  return {
    ...mandant.consolidation,
    // Nur eintragen, was wirklich gesetzt ist: Ein `locale: undefined` sähe für
    // die Vererbung aus wie „am Mandanten nichts eingestellt" — und genau das
    // ist es auch. Ohne diese Prüfung stünde die Voreinstellung als
    // Mandantenwahl da und überstimmte jedes Profil.
    ...(mandant.region?.locale ? { locale: mandant.region.locale } : {}),
    ...(mandant.region?.timeZone ? { timeZone: mandant.region.timeZone } : {}),
  };
}
