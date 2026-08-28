import type { Konfliktfall, Sperre } from './Konfliktfall.js';

/**
 * Zuständigkeit und gleichzeitige Bearbeitung (SPEC-07, Abschnitt 11).
 *
 * ## Zwei Sicherungen, weil eine nicht reicht
 *
 * ```text
 * Sperre    →  „Anna sitzt gerade daran"      höflich, läuft ab
 * Fassung   →  „darauf beruht meine Antwort"  hart, läuft nicht ab
 * ```
 *
 * Die **Sperre** verhindert, dass zwei Leute überhaupt anfangen. Sie muss
 * ablaufen können — sonst blockiert ein geschlossener Browser den Fall für
 * immer, und irgendwann gibt es einen Knopf „alle Sperren aufheben", den
 * jemand in der Not drückt.
 *
 * Genau deshalb reicht sie nicht. Nach dem Ablauf könnten wieder zwei
 * gleichzeitig daran sitzen. Die **Fassung** fängt das auf: Wer entscheidet,
 * nennt die Nummer, die er vor sich hatte. Stimmt sie nicht mehr, wird
 * abgelehnt — „bereits vorhandene Bearbeitungen dürfen dabei nicht unbemerkt
 * überschrieben werden".
 */

/**
 * Nach welcher Untätigkeit eine Sperre von selbst verfällt.
 *
 * Eine Viertelstunde: lang genug, um in Ruhe nachzudenken oder ans Telefon zu
 * gehen, kurz genug, dass eine vergessene Sperre den Kollegen nicht den Tag
 * kostet. Wer weiterarbeitet, erneuert sie ohnehin mit jedem Schritt.
 */
export const SPERRE_VERFAELLT_NACH_MS = 15 * 60 * 1000;

export function abgelaufen(sperre: Sperre, jetzt: Date, frist = SPERRE_VERFAELLT_NACH_MS): boolean {
  return jetzt.getTime() - Date.parse(sperre.seit) > frist;
}

/** Die Sperre, sofern sie noch gilt — sonst gar keine. */
export function geltendeSperre(fall: Konfliktfall, jetzt: Date, frist = SPERRE_VERFAELLT_NACH_MS): Sperre | undefined {
  return fall.sperre && !abgelaufen(fall.sperre, jetzt, frist) ? fall.sperre : undefined;
}

export type Sperrpruefung =
  | { ok: true; uebernommen: boolean }
  | { ok: false; grund: string; inhaber: Sperre };

/**
 * Ob dieser Benutzer den Fall bearbeiten darf.
 *
 * `uebernommen` sagt, dass eine abgelaufene Sperre eines anderen übergangen
 * wurde. Das ist erlaubt und wird gemeldet — der Historieneintrag hält fest,
 * wem der Fall vorher gehörte, damit hinterher niemand rätselt, wieso seine
 * Bearbeitung verschwunden ist.
 */
export function darfBearbeiten(
  fall: Konfliktfall,
  benutzer: string,
  jetzt: Date,
  frist = SPERRE_VERFAELLT_NACH_MS
): Sperrpruefung {
  const sperre = fall.sperre;

  if (!sperre || sperre.benutzer === benutzer) {
    return { ok: true, uebernommen: false };
  }

  if (abgelaufen(sperre, jetzt, frist)) {
    return { ok: true, uebernommen: true };
  }

  return {
    ok: false,
    inhaber: sperre,
    grund:
      `${sperre.benutzerName ?? sperre.benutzer} hat diesen Fall seit ${sperre.seit} in Bearbeitung. ` +
      `Die Sperre verfällt nach ${Math.round(frist / 60000)} Minuten ohne Tätigkeit`,
  };
}

export type Fassungspruefung = { ok: true } | { ok: false; grund: string };

/**
 * Ob die Entscheidung auf dem Stand beruht, der noch gilt.
 *
 * Ohne Angabe wird nicht geprüft — das ist für die Massenbearbeitung nötig,
 * die auf einer frisch gelesenen Liste arbeitet und nicht auf einer Ansicht,
 * die jemand seit einer Stunde offen hat.
 */
export function pruefeFassung(fall: Konfliktfall, fassung: number | undefined): Fassungspruefung {
  if (fassung === undefined || fassung === fall.fassung) {
    return { ok: true };
  }

  return {
    ok: false,
    grund:
      `Dieser Fall ist inzwischen in Fassung ${fall.fassung}; die Entscheidung beruht auf Fassung ${fassung}. ` +
      'Jemand anderes war schneller. Bitte den Fall neu ansehen - sonst überschriebe die Entscheidung eine, ' +
      'die niemand gesehen hat',
  };
}
