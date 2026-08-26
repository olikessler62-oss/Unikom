import type { Dateiwahl } from './Konsolidierungsschritt.js';
import type { StageInput } from './WorkflowStages.js';

/**
 * Die vier Verzeichnisse, ohne die ein Durchgang nicht anfängt.
 *
 * ```text
 * Abholverzeichnis  →  Archiv         die verschlüsselte Kopie, bevor etwas angefasst wird
 *                   →  Arbeit         der Zugriff selbst: hierher wird verschoben
 *                   →  Erledigt       wohin ein gelungener Durchgang die Eingangsdateien legt
 *                   →  Gescheitert    wohin ein misslungener sie legt
 * ```
 *
 * ## Warum alle vier und nicht die, die gerade gebraucht werden
 *
 * Jedes einzelne war freiwillig, und jedes hatte sein „läuft auch ohne": ohne
 * Arbeitsverzeichnis wird aus dem Abholverzeichnis gelesen, ohne Archiv nicht
 * gesichert, ohne Erledigt bleiben die Dateien liegen. Zusammengenommen ergibt
 * das einen Durchgang, der jede Nacht dieselbe Lieferung noch einmal
 * verarbeitet, während jemand hineinschreibt — und der dabei nichts anrichtet,
 * was man an einem Ergebnis sähe.
 *
 * Die vier hängen aneinander. Herausnehmen darf nur, wer vorher gesichert hat
 * („Was nicht archiviert ist, wird nicht gelöscht"); wegräumen kann nur, wer
 * herausgenommen hat — sonst griffe er in ein Verzeichnis, in das inzwischen
 * die nächste Lieferung geschrieben wurde. Drei von vieren sind deshalb keine
 * Einstellung, sondern eine halbe.
 *
 * ## Warum der Lauf abbricht, statt auszuhelfen
 *
 * Eine fehlende Angabe ist ein Einrichtungsfehler und keine schlechte
 * Lieferung. Die Dateien nach „Gescheitert" zu räumen — wenn es das überhaupt
 * gibt — hieße, die Daten für den Fehler von jemand anderem zu bestrafen: Wer
 * hinterher die Verzeichnisse einträgt, müsste sie erst wieder herausfischen.
 *
 * Deshalb wird **nichts** angefasst. Die Lieferung bleibt im Abholverzeichnis
 * liegen, der Lauf sagt ins Protokoll, was fehlt, und der nächste Blick des
 * Workers nimmt sie mit — sobald die Angabe steht.
 */
export type Ablageort = 'archiv' | 'arbeit' | 'erledigt' | 'gescheitert';

/** Die vier Wege, alle gefüllt. */
export interface Ablageorte {
  archiv: string;
  arbeit: string;
  erledigt: string;
  gescheitert: string;
}

/**
 * Die Reihenfolge ist der Weg, den eine Datei nimmt.
 *
 * Sie steht hier und nicht in der Oberfläche, damit Fenster, Prüfung und
 * Protokoll dieselben Namen benutzen. Wer im Protokoll „Erledigt" liest, findet
 * im Fenster ein Feld, das so heißt.
 */
export const ABLAGEORTE: readonly { feld: Ablageort; name: string }[] = [
  { feld: 'archiv', name: 'Archiv' },
  { feld: 'arbeit', name: 'Arbeitsverzeichnis' },
  { feld: 'erledigt', name: 'Erledigt' },
  { feld: 'gescheitert', name: 'Gescheitert' },
];

/** Was ein Durchgang über seine Ablage sagen muss — mehr braucht die Prüfung nicht. */
export interface Abholender {
  input: StageInput;
  dateien?: Dateiwahl;
}

/**
 * Alle vier stehen; der Durchgang darf zugreifen.
 *
 * Das Abholverzeichnis steht mit dabei, obwohl es woanders herkommt. Nur so ist
 * dieser Befund für sich allein vollständig: Wer ihn in der Hand hat, hat jedes
 * Verzeichnis, das der Zugriff braucht, und muss keines mehr aus einer Angabe
 * herausholen, die auch fehlen könnte. Genau das ist der Unterschied zwischen
 * einer Zusicherung und einem Kommentar, der sie behauptet.
 */
export interface Abholbereit {
  art: 'BEREIT';
  verzeichnis: string;
  orte: Ablageorte;
}

export type Ablagestand =
  | Abholbereit
  /**
   * Der Durchgang bekommt seine Dateien gereicht und holt sie nicht.
   *
   * Dann gibt es kein Abholverzeichnis, aus dem etwas herauszunehmen wäre, und
   * die vier Angaben hätten nichts, worauf sie sich bezögen. Sie hier zu
   * verlangen wäre eine Pflicht ohne Wirkung — und wer sie ausfüllt, bekäme ein
   * Archiv, in das nie etwas gelegt wird.
   */
  | { art: 'GEREICHT' }
  | { art: 'UNVOLLSTAENDIG'; fehlend: readonly Ablageort[]; hinweis: string };

/**
 * Ob dieser Durchgang laufen darf — und wenn nicht, warum nicht.
 *
 * `benennung` ist der Name, unter dem der Durchgang einem Menschen begegnet.
 * Er kommt von außen, weil er an zwei Stellen verschieden lautet: Im Lauf heißt
 * er „Durchgang 2 von 3", beim Speichern heißt er, wie er im Fenster steht.
 */
export function ablagestand(durchgang: Abholender, benennung: string): Ablagestand {
  if (durchgang.input.from !== 'DIRECTORY') {
    return { art: 'GEREICHT' };
  }

  const gesetzt = durchgang.dateien?.abholung ?? {};
  const orte = Object.fromEntries(
    ABLAGEORTE.map((ort) => [ort.feld, (gesetzt[ort.feld] ?? '').trim()])
  ) as unknown as Ablageorte;
  const fehlend = ABLAGEORTE.filter((ort) => orte[ort.feld] === '').map((ort) => ort.feld);

  if (fehlend.length === 0) {
    return { art: 'BEREIT', verzeichnis: durchgang.input.directory, orte };
  }

  return { art: 'UNVOLLSTAENDIG', fehlend, hinweis: satz(benennung, durchgang.input.directory, fehlend) };
}

/**
 * Der Satz, den ein Mensch zu sehen bekommt.
 *
 * Er nennt drei Dinge, und jedes davon fehlte einmal in einer Meldung, die
 * daraufhin niemand gebrauchen konnte: **was** fehlt, **was deshalb geschieht**
 * und **wo** man es einträgt.
 */
function satz(benennung: string, verzeichnis: string, fehlend: readonly Ablageort[]): string {
  const namen = fehlend.map((feld) => `„${nameVon(feld)}"`);

  return (
    `${benennung} liest aus „${verzeichnis}". ` +
    `${namen.length === 1 ? 'Es fehlt das Verzeichnis' : 'Es fehlen die Verzeichnisse'} ${aufzaehlung(namen)}. ` +
    'Der Durchgang läuft deshalb nicht — die Lieferung bleibt unangetastet liegen. ' +
    'Einzutragen sind sie am Durchgang unter „Verzeichnisse".'
  );
}

export function nameVon(feld: Ablageort): string {
  return ABLAGEORTE.find((ort) => ort.feld === feld)?.name ?? feld;
}

/** „A", „B" und „C" — mit „und" vor dem letzten, wie man es spricht. */
function aufzaehlung(teile: readonly string[]): string {
  if (teile.length < 2) {
    return teile.join('');
  }

  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}
