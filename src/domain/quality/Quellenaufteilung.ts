import type { Quelle } from '../consolidation/Quellen.js';
import type { Datensatz, Pruefoptionen, Qualitaetsregel } from './Regeln.js';
import { teileAuf, type Zeilenurteil } from './Zeilenaufteilung.js';

/**
 * Die Zeilenaufteilung, angewandt auf eine gelesene Quelle.
 *
 * `teileAuf` rechnet auf Datensätzen — Feldname zu Wert. Eine Quelle ist etwas
 * anderes: eine Liste von Feldnamen und dazu Zeilen aus Werten, in derselben
 * Reihenfolge. Diese Datei ist die Übersetzung zwischen beidem, und sie ist
 * eigen, weil dabei zwei Dinge schiefgehen können, die niemandem auffallen.
 *
 * ## Die Zeilennummer ist nicht die Stelle in der Liste
 *
 * Eine Quelle kann **geteilt** sein: Bei blockweiser Verarbeitung trägt ein
 * Block nur einen Teil der Zeilen, und `zeilenNummern` sagt, welche Nummern sie
 * in der Datei hatten. Wer stattdessen die Stelle im Block zählt, schreibt in
 * die Ablehnungsdatei „Zeile 3", während der Fehler in Zeile 2003 steht.
 *
 * Das fällt nicht auf. Die Nummern sehen plausibel aus, und wer sie nachschlägt,
 * findet dort eine Zeile — nur eben die falsche.
 *
 * ## Was übrig bleibt, trägt seine Nummern mit
 *
 * Die verarbeitbare Quelle bekommt **immer** `zeilenNummern`, auch wenn nichts
 * herausgenommen wurde. Sonst hinge die Richtigkeit jeder späteren
 * Herkunftsangabe daran, ob zufällig alle Zeilen durchgekommen sind — und der
 * Fehler zeigte sich erst bei der ersten Lieferung mit einem Fehler darin.
 *
 * ## Eine kurze Zeile ist kein leeres Feld weniger
 *
 * CSV-Zeilen enden gern früher als die Kopfzeile. Ein fehlender Wert wird zum
 * leeren Text und nicht fortgelassen: Eine Pflichtregel muss anschlagen, wenn
 * die Spalte fehlt, und nicht schweigen, weil es das Feld im Datensatz gar
 * nicht gibt.
 */
export interface Quellenaufteilung {
  /** Dieselbe Quelle, aber nur mit den Zeilen, die weiterlaufen dürfen. */
  verarbeitbar: Quelle;
  /** Was an einen Menschen geht — mit den Zeilennummern der Datei. */
  pruefbedarf: Zeilenurteil[];
  /** Was nicht sicher zu verarbeiten ist — ebenso. */
  gescheitert: Zeilenurteil[];
  /**
   * Felder, über die eine Regel etwas sagen wollte und die es hier nicht gibt.
   *
   * Das ist ein Problem der **Struktur** und keines der Zeilen. Es entsteht
   * schon, wenn eine Datei nur aus Text besteht: Dann lässt sich nicht
   * erkennen, ob die erste Zeile eine Kopfzeile ist, und die Spalten heißen
   * „Spalte 1", „Spalte 2". Eine Regel für „Kundennummer" fände ihr Feld dann
   * in keiner einzigen Zeile.
   *
   * Würde sie trotzdem angewandt, wäre jede Zeile gescheitert — dreitausend
   * Absagen für einen einzigen Grund, und der stimmt nicht einmal: Die Daten
   * sind in Ordnung, nur die Überschriften fehlen. Solche Regeln bleiben
   * deshalb außen vor, und ihre Felder stehen hier, damit es jemand erfährt.
   */
  fehlendeFelder: string[];
}

/** Die Nummer, die diese Zeile in der Datei hatte. */
export function nummerVon(quelle: Quelle, stelle: number): number {
  return quelle.zeilenNummern?.[stelle] ?? stelle + 1;
}

/**
 * Eine Zeile als Datensatz.
 *
 * Werte, die über die Kopfzeile hinausgehen, fallen fort: Sie haben keinen
 * Namen, unter dem eine Regel sie ansprechen könnte, und eine erfundene
 * Spalte wäre schlimmer als eine fehlende.
 */
export function saetzeAus(quelle: Quelle): Datensatz[] {
  return quelle.zeilen.map(
    (zeile) => new Map(quelle.felder.map((feld, spalte) => [feld, zeile[spalte] ?? '']))
  );
}

export function teileQuelleAuf(
  quelle: Quelle,
  regeln: readonly Qualitaetsregel[],
  optionen: Pruefoptionen
): Quellenaufteilung {
  const vorhanden = new Set(quelle.felder);
  const anwendbar = regeln.filter((regel) => vorhanden.has(regel.feld));
  const fehlendeFelder = [
    ...new Set(regeln.filter((regel) => !vorhanden.has(regel.feld)).map((regel) => regel.feld)),
  ];
  const aufteilung = teileAuf(saetzeAus(quelle), anwendbar, optionen);
  const behalten = aufteilung.verarbeitbar.map((urteil) => urteil.zeile - 1);

  return {
    verarbeitbar: {
      ...quelle,
      zeilen: behalten.map((stelle) => quelle.zeilen[stelle]),
      zeilenNummern: behalten.map((stelle) => nummerVon(quelle, stelle)),
    },
    pruefbedarf: aufteilung.pruefbedarf.map((urteil) => mitNummer(quelle, urteil)),
    gescheitert: aufteilung.gescheitert.map((urteil) => mitNummer(quelle, urteil)),
    fehlendeFelder,
  };
}

function mitNummer(quelle: Quelle, urteil: Zeilenurteil): Zeilenurteil {
  return { ...urteil, zeile: nummerVon(quelle, urteil.zeile - 1) };
}

/**
 * Wie viele beanstandete Zeilen namentlich ins Protokoll kommen.
 *
 * Dreitausend Zeilen einzeln zu nennen macht das Protokoll unlesbar; nur eine
 * Zahl zu nennen schickt jemanden mit leeren Händen in die Datei. Eine Handvoll
 * mit Nummer und Grund reicht, um zu sehen, *was* für ein Fehler es ist — und
 * die Zahl dahinter sagt, wie viele noch kommen.
 */
export const GENANNTE_ZEILEN = 5;

/**
 * Was die Prüfung einer Datei ergeben hat — in Sätzen, die jemand nachschlägt.
 *
 * Auch wenn nichts zu beanstanden war, steht eine Zeile da. „Nichts im
 * Protokoll" heißt sonst zweierlei — alles in Ordnung, oder es wurde nicht
 * geprüft —, und die beiden auseinanderzuhalten ist genau das, wonach jemand
 * sucht, wenn ein Ergebnis nicht stimmt.
 */
export function befundzeilen(name: string, berichte: readonly Quellenaufteilung[]): string[] {
  const gescheitert = berichte.flatMap((bericht) => bericht.gescheitert);
  const pruefbedarf = berichte.flatMap((bericht) => bericht.pruefbedarf);
  const verarbeitbar = berichte.reduce((summe, bericht) => summe + bericht.verarbeitbar.zeilen.length, 0);
  const gesamt = verarbeitbar + gescheitert.length + pruefbedarf.length;
  const fehlend = [...new Set(berichte.flatMap((bericht) => bericht.fehlendeFelder))];
  const struktur =
    fehlend.length === 0
      ? []
      : [
          `„${name}": Das Schema hat Regeln für ${fehlend.map((feld) => `„${feld}"`).join(', ')} — ` +
            'diese Spalten gibt es in der Datei nicht. Die Regeln blieben außen vor. ' +
            'Häufigster Grund: Die Kopfzeile wurde nicht erkannt, weil alle Spalten Text sind',
        ];

  if (gesamt === 0) {
    return struktur;
  }

  if (gescheitert.length === 0 && pruefbedarf.length === 0) {
    return [...struktur, `„${name}": ${gesamt} Zeilen gegen das Schema geprüft, nichts zu beanstanden`];
  }

  const kopf =
    `„${name}": ${gesamt} Zeilen gegen das Schema geprüft — ${verarbeitbar} verarbeitbar, ` +
    `${gescheitert.length} gescheitert, ${pruefbedarf.length} zur Prüfung durch einen Menschen`;

  /* Nach Zeilennummer, damit die Auswahl nicht davon abhängt, welche Regel zuerst stand. */
  const genannt = [...gescheitert, ...pruefbedarf].sort((eine, andere) => eine.zeile - andere.zeile);
  const zeilen = genannt.slice(0, GENANNTE_ZEILEN).map((urteil) => `  Zeile ${urteil.zeile}: ${urteil.gruende.join(' ')}`);
  const rest = genannt.length - zeilen.length;

  return rest > 0
    ? [...struktur, kopf, ...zeilen, `  … und ${rest} weitere Zeilen mit Befund`]
    : [...struktur, kopf, ...zeilen];
}
