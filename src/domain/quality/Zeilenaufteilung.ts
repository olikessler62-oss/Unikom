import { pruefe, type Befund, type Datensatz, type Pruefoptionen, type Qualitaetsregel } from './Regeln.js';

/**
 * Was mit einer einzelnen Zeile geschieht, wenn sie ihrem Schema nicht genügt.
 *
 * ## Warum die Zeile und nicht die Datei
 *
 * Bisher galt: Eine Eingangsdatei wandert nach dem Durchgang als Ganzes nach
 * „Erledigt" oder nach „Gescheitert". Bei einer Lieferung mit dreitausend
 * Zeilen, von denen siebzehn nicht stimmen, ist beides falsch — entweder gehen
 * 2.983 gute Zeilen mit ins Gescheiterte, oder siebzehn schlechte gelten als
 * erledigt.
 *
 * Aufgeteilt wird deshalb nach Zeilen. Das ist nur zu verantworten, weil das
 * **Archiv** die Originaldatei verschlüsselt vorhält: Erledigt und Gescheitert
 * tragen abgeleitete Dateien, das Original bleibt unberührt und vollständig.
 *
 * ## Drei Ausgänge und nicht zwei
 *
 * Die Schweregrade der Regeln sind vierstufig, und sie bedeuten Verschiedenes:
 *
 * ```text
 * INFO      →  fällt auf, ändert nichts        →  verarbeitbar
 * WARNUNG   →  ungewöhnlich, aber möglich      →  verarbeitbar
 * KONFLIKT  →  geht an einen Menschen          →  Prüfbedarf
 * FEHLER    →  nichts sicher zu verarbeiten    →  gescheitert
 * ```
 *
 * KONFLIKT in „gescheitert" zu werfen wäre die bequemere Rechnung und der
 * Verlust der eigentlichen Zusage: Ein Konflikt ist eine Frage an einen
 * Menschen und kein Fehlschlag. Wer ihn nach „Gescheitert" räumt, hat die
 * Entscheidung weggeräumt, statt sie zu stellen.
 *
 * ## Die Gründe reisen mit
 *
 * Eine Ablehnungsdatei ohne Grund je Zeile ist wertlos: Sie schickt jemanden
 * ins Protokoll, um dort dreißig Meldungen den Zeilennummern zuzuordnen. Jedes
 * Urteil trägt deshalb seine Sätze mit — Ursache und Auswirkung, so wie sie ein
 * Mensch nachprüfen kann.
 */
export type Ausgang = 'VERARBEITBAR' | 'PRUEFBEDARF' | 'GESCHEITERT';

export interface Zeilenurteil {
  /** Die Zeile im Bestand, ab 1 — so, wie ein Mensch sie zählt. */
  zeile: number;
  satz: Datensatz;
  ausgang: Ausgang;
  /** Je Befund ein Satz. Leer, wo nichts zu beanstanden war. */
  gruende: string[];
  befunde: Befund[];
}

export interface Aufteilung {
  verarbeitbar: Zeilenurteil[];
  pruefbedarf: Zeilenurteil[];
  gescheitert: Zeilenurteil[];
}

/**
 * Die Spalte, in der der Grund steht — in der Ablehnungsdatei und nur dort.
 *
 * Der Name ist absichtlich unhandlich: Er soll in keinem Kundenbestand
 * vorkommen. Kommt er trotzdem vor, weicht `grundspalte` aus, statt eine echte
 * Spalte zu überschreiben.
 */
export const GRUNDSPALTE = 'Unikom_Grund';

/**
 * Ein freier Name für die Grundspalte.
 *
 * Gäbe es in der Lieferung schon eine Spalte dieses Namens, überschriebe die
 * Ablehnungsdatei sie stillschweigend — und ausgerechnet in der Datei, die
 * jemand liest, um einen Fehler zu suchen, stünde dann ein falscher Wert.
 */
export function grundspalte(felder: Iterable<string>): string {
  const genommen = new Set(felder);

  if (!genommen.has(GRUNDSPALTE)) {
    return GRUNDSPALTE;
  }

  for (let nummer = 2; ; nummer += 1) {
    if (!genommen.has(`${GRUNDSPALTE}_${nummer}`)) {
      return `${GRUNDSPALTE}_${nummer}`;
    }
  }
}

/**
 * Teilt einen Bestand nach dem Ausgang seiner Zeilen auf.
 *
 * Ohne Regeln gibt es nichts zu beanstanden: Dann ist alles verarbeitbar, und
 * es entsteht keine Ablehnungsdatei. Das ist der Regelfall für eine Quelle
 * ohne Schema — und keine stillschweigende Zustimmung, sondern das Ergebnis
 * einer Prüfung, die nichts zu prüfen hatte.
 */
export function teileAuf(
  saetze: readonly Datensatz[],
  regeln: readonly Qualitaetsregel[],
  optionen: Pruefoptionen
): Aufteilung {
  const aufteilung: Aufteilung = { verarbeitbar: [], pruefbedarf: [], gescheitert: [] };

  saetze.forEach((satz, stelle) => {
    const zeile = stelle + 1;
    const befunde = pruefe(satz, zeile, regeln, optionen);
    const urteil: Zeilenurteil = {
      zeile,
      satz,
      ausgang: ausgangVon(befunde),
      gruende: befunde.filter((befund) => zaehlt(befund)).map((befund) => satzZu(befund)),
      befunde,
    };

    if (urteil.ausgang === 'GESCHEITERT') {
      aufteilung.gescheitert.push(urteil);
    } else if (urteil.ausgang === 'PRUEFBEDARF') {
      aufteilung.pruefbedarf.push(urteil);
    } else {
      aufteilung.verarbeitbar.push(urteil);
    }
  });

  return aufteilung;
}

/**
 * Der schwerste Befund entscheidet.
 *
 * Und nicht der erste: Eine Zeile mit einer Warnung und einem Fehler ist
 * gescheitert, gleich in welcher Reihenfolge die Regeln stehen. Sonst hinge das
 * Ergebnis daran, in welcher Folge jemand die Regeln angelegt hat.
 */
function ausgangVon(befunde: readonly Befund[]): Ausgang {
  if (befunde.some((befund) => befund.schwere === 'FEHLER')) {
    return 'GESCHEITERT';
  }

  return befunde.some((befund) => befund.schwere === 'KONFLIKT') ? 'PRUEFBEDARF' : 'VERARBEITBAR';
}

/** Was zählt, sind die Befunde, die den Ausgang bestimmt haben. */
function zaehlt(befund: Befund): boolean {
  return befund.schwere === 'FEHLER' || befund.schwere === 'KONFLIKT';
}

/**
 * Ursache und Auswirkung in einem Satz.
 *
 * Getrennt gespeichert, zusammen gelesen: In einer Tabellenzelle sind zwei
 * Spalten für einen Gedanken eine Spalte zu viel, und wer die Datei in Excel
 * öffnet, will den Grund sehen und nicht nach rechts scrollen.
 */
function satzZu(befund: Befund): string {
  return `${befund.ursache}. ${befund.auswirkung}`;
}
