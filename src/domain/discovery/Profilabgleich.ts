import { aktuelleVersion, type Profil, type Profilversion } from '../consolidation/Profil.js';
import type { DataBlock } from './Discovery.js';
import { alsVorgabe, combine, type Strukturvorgabe } from './Expectation.js';

/**
 * Welches Eingangsprofil zu einem erkannten Block passt (FR_008, Abschnitt 7).
 *
 * Das ist der eigentliche Gewinn: Bei der dritten Lieferung desselben
 * Lieferanten erkennt Unikom sie wieder, statt jedes Mal von vorn zu raten.
 *
 * Verglichen wird gegen die **aktuelle** Version eines Profils. Ältere
 * Versionen beschreiben, wie früher gelesen wurde, und sind für die Frage
 * „was kommt hier gerade an" die falsche Auskunft.
 *
 * Zurückgegeben werden alle Kandidaten, nicht nur der beste — passen zwei
 * Profile gleich gut, ist das eine Auskunft für einen Menschen und keine, die
 * Unikom für ihn treffen darf.
 */
export interface ProfileMatch {
  profil: Profil;
  version: Profilversion;
  /** Anteil der hinterlegten Angaben, die zutreffen. */
  score: number;
  abweichungen: number;
}

export function rankProfiles(block: DataBlock, profile: readonly Profil[]): ProfileMatch[] {
  return profile
    .map((profil) => {
      const version = aktuelleVersion(profil);
      const ergebnis = combine([block], version.vorgabe, 'BEIDE');

      return { profil, version, score: ergebnis.configurationMatch, abweichungen: ergebnis.abweichungen.length };
    })
    .filter((treffer) => treffer.score > 0)
    .sort((links, rechts) => rechts.score - links.score || links.abweichungen - rechts.abweichungen);
}

/**
 * Die Struktur eines bestätigten Blocks, wie sie in ein Profil eingeht.
 *
 * Als Hinweis und nicht als harte Vorgabe: Eine bestätigte Struktur ist ein
 * sehr gutes Argument und trotzdem keines, das eindeutige Daten überstimmen
 * darf. Wer es strenger will, stellt es am Profil um.
 */
export function vorgabeAusBlock(block: DataBlock): Strukturvorgabe {
  return alsVorgabe(block, 'HINWEIS');
}
