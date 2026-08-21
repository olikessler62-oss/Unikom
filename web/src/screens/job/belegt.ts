import type { Job, StageInput, StageOutput } from '../../api/types.js';

/**
 * Wann ein Panel „belegt" ist — und was das heißen soll.
 *
 * ## Die Frage, die der Streifen beantwortet
 *
 * Ein Workflow-Editor hat zwei Dutzend Flächen, und die meisten sind
 * zugeklappt. Der helle Streifen am linken Rand sagt beim Vorbeiscrollen: **Hier
 * steht etwas, und es hält zusammen.** Er ersetzt das Aufklappen, nicht das
 * Prüfen.
 *
 * ## Die Trennlinie: Auswahlfeld gegen Eingabefeld
 *
 * Ein **Auswahlfeld** trägt zu jeder Zeit einen Wert, und der Anwender sieht
 * ihn. Eine Fläche, die nur aus Auswahlfeldern besteht, ist damit vollständig —
 * es sei denn, eine Wahl verlangt eine weitere Angabe, die fehlt („verschieben"
 * ohne Archivverzeichnis).
 *
 * Ein **Eingabefeld** dagegen ist leer, bis jemand hineinschreibt. Ein leeres
 * Feld ist keine Entscheidung, sondern ihr Fehlen — und leuchtet nicht.
 *
 * Deshalb leuchtet „Nach erfolgreicher Übernahme" von Anfang an und „Welche
 * Dateien" erst, wenn dort etwas steht. Das ist kein Widerspruch: In der einen
 * Fläche *steht* eine Antwort, in der anderen nicht.
 *
 * ## Warum halbe Angaben nicht leuchten
 *
 * Ein SFTP-Quellverzeichnis ohne Zugang ist keine halbe Quelle, sondern keine:
 * Der Lauf scheitert. Leuchtete es trotzdem, wäre der Streifen genau dort
 * falsch, wo man ihn braucht — beim schnellen Durchsehen vor dem Speichern.
 */

/** Ob eine Zeichenkette wirklich etwas trägt. */
function steht(wert: string | undefined): boolean {
  return Boolean(wert && wert.trim());
}

/**
 * Die Quelle des Übertragens.
 *
 * Ein Verzeichnis allein genügt nur örtlich. Eine Freigabe braucht ihren Zugang
 * — ohne ihn wird sie mit dem Konto erreicht, unter dem der Dienst läuft. SFTP
 * und FTPS brauchen zusätzlich den Server.
 */
export function quelleBelegt(job: Job): boolean {
  if (!steht(job.sourceDirectory)) {
    return false;
  }

  if (job.sourceType === 'LOCAL') {
    return true;
  }

  if (job.sourceType === 'SHARE') {
    return steht(job.credentialId);
  }

  return steht(job.sourceConfig.host) && steht(job.credentialId);
}

/**
 * Das Ziel des Übertragens.
 *
 * Dieselbe Rechnung wie bei der Quelle, mit einem Unterschied: Fehlt die Art,
 * ist das Ziel örtlich — so verhielt sich jeder Workflow, bevor es entfernte
 * Ziele gab.
 */
export function zielBelegt(job: Job): boolean {
  if (!steht(job.destinationDirectory)) {
    return false;
  }

  const art = job.destinationType ?? 'LOCAL';

  if (art === 'LOCAL') {
    return true;
  }

  if (art === 'SHARE') {
    return steht(job.destinationCredentialId);
  }

  return steht(job.destinationConfig?.host) && steht(job.destinationCredentialId);
}

/**
 * Welche Dateien genommen werden.
 *
 * Leer heißt: alles. Das ist eine brauchbare Voreinstellung und keine Eingabe —
 * erst ein Namensanfang oder eine Endungsliste ist eine Entscheidung.
 */
export function dateiwahlBelegt(job: Job): boolean {
  return steht(job.filenamePrefix) || job.allowedExtensions.length > 0;
}

/**
 * Was nach der Übernahme mit der Quelldatei geschieht.
 *
 * Hier steht **immer** eine Entscheidung: Ein Auswahlfeld zeigt zu jeder Zeit
 * einen Wert, und der Anwender sieht ihn. Die Fläche ist damit vollständig —
 * es sei denn, die Wahl verlangt eine weitere Angabe, die fehlt.
 *
 * Verschieben **ohne** Archivverzeichnis leuchtet deshalb nicht: Das ist die
 * halbe Angabe, bei der der Lauf hängenbliebe. Behalten und Löschen brauchen
 * nichts weiter.
 */
export function nachlaufBelegt(job: Job): boolean {
  return job.sourceSuccessAction === 'MOVE' ? steht(job.sourceArchiveDirectory) : true;
}

/**
 * Die Quelle eines Kettengliedes.
 *
 * Die Übernahme vom Vorgänger ist vollständig, sobald sie gewählt ist — sie
 * trägt keinen eigenen Pfad, sondern einen Verweis.
 */
export function eingangBelegt(eingang: StageInput): boolean {
  if (eingang.from === 'PRECEDING') {
    return true;
  }

  if (!steht(eingang.directory)) {
    return false;
  }

  return eingang.art === 'SHARE' ? steht(eingang.credentialId) : true;
}

/** Das Ziel eines Kettengliedes. Weiterreichen ist ein Verweis und braucht keinen Pfad. */
export function ausgangBelegt(ausgang: StageOutput | undefined): boolean {
  if (!ausgang) {
    return false;
  }

  return ausgang.to === 'FOLLOWING' || steht(ausgang.directory);
}
