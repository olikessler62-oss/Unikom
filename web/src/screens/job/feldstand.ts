import type { Job, StageInput, StageOutput } from '../../api/types.js';

/**
 * Der Zustand einer Fläche, wie ihn der Punkt neben der Überschrift zeigt.
 *
 * ```text
 * grau   nichts eingetragen
 * gelb   angefangen, aber etwas Nötiges fehlt
 * rot    eingetragen und in sich falsch
 * grün   vollständig und brauchbar
 * ```
 *
 * ## Warum vier Zustände und nicht zwei
 *
 * „Gefüllt oder nicht" beantwortet die Frage nicht, die man beim Überfliegen
 * eines Dutzends zugeklappter Flächen hat. Zwischen *noch nichts* und *fertig*
 * liegt der Fall, der Arbeit macht: angefangen und unvollständig. Und davon
 * wieder zu trennen ist der Fall, in dem etwas dasteht, das so nicht laufen
 * kann — ein Freigabepfad ohne UNC-Form etwa. Grau lädt zum Ausfüllen ein, gelb
 * zum Weitermachen, rot zum Nachsehen.
 *
 * ## Die Trennlinie: Auswahlfeld gegen Eingabefeld
 *
 * Ein **Auswahlfeld** trägt zu jeder Zeit einen Wert, und der Anwender sieht
 * ihn. Eine Fläche, die nur aus Auswahlfeldern besteht, ist damit nicht leer —
 * es sei denn, eine Wahl verlangt eine weitere Angabe, die fehlt.
 *
 * Ein **Eingabefeld** dagegen ist leer, bis jemand hineinschreibt. Ein leeres
 * Feld ist keine Entscheidung, sondern ihr Fehlen.
 */
export type Feldstand = 'LEER' | 'UNVOLLSTAENDIG' | 'FEHLERHAFT' | 'GUELTIG';

/** Ob eine Zeichenkette wirklich etwas trägt. */
function steht(wert: string | undefined): boolean {
  return Boolean(wert && wert.trim());
}

/**
 * Ob ein Pfad wie eine Windows-Freigabe aussieht.
 *
 * `D:\Daten` als Freigabe einzutragen ergäbe einen Workflow, der einen Zugang
 * mit sich trägt, den nichts benutzt — er liefe scheinbar richtig und griffe die
 * ganze Zeit auf die eigene Platte zu. Der Server weist das beim Speichern ab;
 * der Punkt sagt es schon vorher.
 */
function istUnc(pfad: string | undefined): boolean {
  const doppelt = String.fromCharCode(92, 92);

  return steht(pfad) && (pfad!.trim().startsWith(doppelt) || pfad!.trim().startsWith('//'));
}

/**
 * Die Quelle des Übertragens.
 *
 * Ein Verzeichnis allein genügt nur örtlich. Eine Freigabe braucht ihren Zugang
 * — ohne ihn wird sie mit dem Konto erreicht, unter dem der Dienst läuft. SFTP
 * und FTPS brauchen zusätzlich den Server.
 */
export function quelleStand(job: Job): Feldstand {
  if (!steht(job.sourceDirectory)) {
    return 'LEER';
  }

  if (job.sourceType === 'LOCAL') {
    return 'GUELTIG';
  }

  if (job.sourceType === 'SHARE') {
    if (!istUnc(job.sourceDirectory)) {
      return 'FEHLERHAFT';
    }

    return steht(job.credentialId) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
  }

  return steht(job.sourceConfig.host) && steht(job.credentialId) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
}

/**
 * Das Ziel des Übertragens.
 *
 * Dieselbe Rechnung wie bei der Quelle, mit einem Unterschied: Fehlt die Art,
 * ist das Ziel örtlich — so verhielt sich jeder Workflow, bevor es entfernte
 * Ziele gab.
 */
export function zielStand(job: Job): Feldstand {
  if (!steht(job.destinationDirectory)) {
    return 'LEER';
  }

  const art = job.destinationType ?? 'LOCAL';

  if (art === 'LOCAL') {
    return 'GUELTIG';
  }

  if (art === 'SHARE') {
    if (!istUnc(job.destinationDirectory)) {
      return 'FEHLERHAFT';
    }

    return steht(job.destinationCredentialId) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
  }

  return steht(job.destinationConfig?.host) && steht(job.destinationCredentialId) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
}

/**
 * Welche Dateien genommen werden.
 *
 * Leer heißt: alles. Das ist eine brauchbare Voreinstellung und keine Eingabe —
 * erst ein Namensanfang oder eine Endungsliste ist eine Entscheidung.
 */
export function dateiwahlStand(job: Job): Feldstand {
  return steht(job.filenamePrefix) || job.allowedExtensions.length > 0 ? 'GUELTIG' : 'LEER';
}

/**
 * Was nach der Übernahme mit der Quelldatei geschieht.
 *
 * Hier steht **immer** eine Entscheidung: Ein Auswahlfeld zeigt zu jeder Zeit
 * einen Wert. Nur das Verschieben verlangt eine weitere Angabe — ohne
 * Archivverzeichnis bliebe der Lauf hängen, und das ist keine halbe Eingabe,
 * sondern eine unfertige.
 */
export function nachlaufStand(job: Job): Feldstand {
  if (job.sourceSuccessAction !== 'MOVE') {
    return 'GUELTIG';
  }

  return steht(job.sourceArchiveDirectory) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
}

/**
 * Die Quelle eines Kettengliedes.
 *
 * Die Übernahme vom Vorgänger ist vollständig, sobald sie gewählt ist — sie
 * trägt keinen eigenen Pfad, sondern einen Verweis.
 */
export function eingangStand(eingang: StageInput): Feldstand {
  if (eingang.from === 'PRECEDING') {
    return 'GUELTIG';
  }

  if (!steht(eingang.directory)) {
    return 'LEER';
  }

  if (eingang.art !== 'SHARE') {
    return 'GUELTIG';
  }

  if (!istUnc(eingang.directory)) {
    return 'FEHLERHAFT';
  }

  return steht(eingang.credentialId) ? 'GUELTIG' : 'UNVOLLSTAENDIG';
}

/** Das Ziel eines Kettengliedes. Weiterreichen ist ein Verweis und braucht keinen Pfad. */
export function ausgangStand(ausgang: StageOutput | undefined): Feldstand {
  if (!ausgang) {
    return 'LEER';
  }

  if (ausgang.to === 'FOLLOWING') {
    return 'GUELTIG';
  }

  return steht(ausgang.directory) ? 'GUELTIG' : 'LEER';
}
