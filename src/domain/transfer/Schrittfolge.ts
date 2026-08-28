import type { StageInput, StageOutput } from './WorkflowStages.js';

/**
 * Die Reihenfolge mehrerer Konsolidierungsschritte (SPEC-06, Abschnitt 7).
 *
 * ```text
 * 1. Filialdateien zusammenlegen      →  /arbeit/gesammelt
 * 2. gegen die Kundenliste anreichern →  /ergebnis
 * ```
 *
 * ## Die Reihenfolge ist die Liste
 *
 * „Sie kann durch den Benutzer explizit festgelegt oder über definierte
 * Abhängigkeiten und Prioritäten bestimmt werden." Unikom nimmt das erste: Die
 * Reihenfolge, in der die Schritte dastehen, **ist** die Reihenfolge. Damit ist
 * sie eindeutig bestimmbar, ohne dass irgendetwas hergeleitet werden muss.
 *
 * Eine hergeleitete Reihenfolge wäre die bequemere Oberfläche und die
 * gefährlichere: „Eine automatisch ermittelte Reihenfolge darf keine fachliche
 * Entscheidung ersetzen." Wer zwei Schritte hat, deren Reihenfolge das Ergebnis
 * verändert, muss sie selbst festlegen — und sieht dann auch, dass er es getan
 * hat.
 *
 * ## Was trotzdem mehrdeutig sein kann
 *
 * Die *Abfolge* ist eindeutig, die *Verkettung* nicht unbedingt. Genau davon
 * spricht der letzte Satz des Abschnitts: „Ist die Reihenfolge für ein korrektes
 * Ergebnis relevant und nicht eindeutig bestimmbar, muss UniCom dies erkennen
 * und melden." Drei Fälle, in denen das Ergebnis von etwas abhängt, das niemand
 * festgelegt hat:
 *
 * ```text
 * Schritt liest PRECEDING, Vorgänger schreibt nirgendwohin
 *     → er liest, was er im Vorlauf vorfindet: nichts oder Altes
 *
 * Zwei Schritte schreiben in dasselbe Verzeichnis
 *     → der zweite überschreibt den ersten, und welcher das ist,
 *       entscheidet die Reihenfolge und nicht die Bedeutung
 *
 * Ein Schritt liest das Verzeichnis, in das ein späterer erst schreibt
 *     → beim ersten Lauf ist es leer, beim zweiten steht der Vorlauf darin
 * ```
 *
 * Der dritte ist der tückischste: Er *funktioniert* — beim zweiten Lauf. Ein
 * Ergebnis, das von den Resten des Vortages abhängt, sieht monatelang richtig
 * aus.
 */

/** Was ein Schritt für die Reihenfolge über sich sagen muss. */
export interface Folgeschritt {
  /** Wie er einem Menschen gegenüber heißt. */
  name?: string;
  input: StageInput;
  output?: StageOutput;
}

export type Mehrdeutigkeitsart = 'KEIN_VORGAENGER' | 'GLEICHES_ZIEL' | 'SPAETERER_SCHREIBER';

export interface Mehrdeutigkeit {
  art: Mehrdeutigkeitsart;
  /** Die Stelle in der Folge, ab 1 — so, wie ein Mensch zählt. */
  schritt: number;
  /** Der andere Schritt, um den es geht. */
  anderer?: number;
  /** Ein Satz, der die Entscheidung nennt, die getroffen werden muss. */
  hinweis: string;
}

/**
 * Prüft die Folge und benennt, was nicht bestimmt ist.
 *
 * Sie **ordnet nicht um**. Ein Programm, das die Schritte selbst sortiert, hätte
 * eine fachliche Entscheidung ersetzt — und beim nächsten Öffnen stünde etwas
 * anderes da, als der Benutzer eingetragen hat.
 */
export function pruefeFolge(schritte: readonly Folgeschritt[]): Mehrdeutigkeit[] {
  const gefunden: Mehrdeutigkeit[] = [];

  schritte.forEach((schritt, stelle) => {
    const nummer = stelle + 1;

    if (schritt.input.from === 'PRECEDING' && !schreibtIrgendwohin(schritte[stelle - 1])) {
      gefunden.push({
        art: 'KEIN_VORGAENGER',
        schritt: nummer,
        hinweis:
          `Schritt ${nummer} (${benennung(schritt, nummer)}) soll übernehmen, was der Schritt davor ablegt - ` +
          (stelle === 0
            ? 'er ist aber der erste. Geben Sie an, aus welchem Verzeichnis er liest'
            : `Schritt ${stelle} legt aber nichts ab. Geben Sie an, wohin Schritt ${stelle} schreibt`),
      });
    }

    const ziel = schreibtNach(schritt);

    if (!ziel) {
      return;
    }

    for (let andere = 0; andere < stelle; andere += 1) {
      if (schreibtNach(schritte[andere]) === ziel) {
        gefunden.push({
          art: 'GLEICHES_ZIEL',
          schritt: nummer,
          anderer: andere + 1,
          hinweis:
            `Schritt ${andere + 1} und Schritt ${nummer} schreiben beide nach „${ziel}". Der spätere ` +
            'überschreibt den früheren - welches Ergebnis am Ende dasteht, entscheidet damit die Reihenfolge ' +
            'und nicht die Bedeutung',
        });
      }
    }
  });

  /*
   * Getrennt und danach: Ein Schritt, der aus einem Verzeichnis liest, in das
   * ein **späterer** schreibt, funktioniert — beim zweiten Lauf. Beim ersten
   * ist es leer, danach steht der Vorlauf darin. Das sieht monatelang richtig
   * aus, und deshalb muss es dastehen.
   */
  schritte.forEach((schritt, stelle) => {
    if (schritt.input.from !== 'DIRECTORY') {
      return;
    }

    for (let spaeter = stelle + 1; spaeter < schritte.length; spaeter += 1) {
      if (schreibtNach(schritte[spaeter]) === schritt.input.directory) {
        gefunden.push({
          art: 'SPAETERER_SCHREIBER',
          schritt: stelle + 1,
          anderer: spaeter + 1,
          hinweis:
            `Schritt ${stelle + 1} liest aus „${schritt.input.directory}", und Schritt ${spaeter + 1} schreibt ` +
            'erst danach dorthin. Beim ersten Lauf ist das Verzeichnis leer, bei jedem weiteren steht der ' +
            'Vorlauf darin - das Ergebnis hinge damit am Vortag',
        });
      }
    }
  });

  return gefunden;
}

/** Ob die Folge ohne Rückfrage laufen darf. */
export function istEindeutig(schritte: readonly Folgeschritt[]): boolean {
  return pruefeFolge(schritte).length === 0;
}

function schreibtNach(schritt: Folgeschritt | undefined): string | undefined {
  return schritt?.output?.to === 'DIRECTORY' && schritt.output.directory.trim() !== ''
    ? schritt.output.directory
    : undefined;
}

/**
 * Ob ein Schritt überhaupt etwas ablegt.
 *
 * `FOLLOWING` zählt: Der Nachfolger übernimmt es dann unmittelbar, ohne dass ein
 * Verzeichnis dazwischensteht.
 */
function schreibtIrgendwohin(schritt: Folgeschritt | undefined): boolean {
  if (!schritt?.output) {
    return false;
  }

  return schritt.output.to === 'FOLLOWING' || schreibtNach(schritt) !== undefined;
}

function benennung(schritt: Folgeschritt, nummer: number): string {
  return schritt.name?.trim() || `ohne Namen, Stelle ${nummer}`;
}
