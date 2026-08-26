/**
 * Welches Archivpaket zu welchem Lauf gehört.
 *
 * ```text
 * Lauf 1 ──► Lieferung ──► Paket_20260826_0300_TR-1.zip.enc
 *                             │
 *                             └──► Korrekturlauf: dieselbe Lieferung,
 *                                  diesmal mit den Entscheidungen
 * ```
 *
 * ## Warum ein Eintrag und nicht der Dateiname
 *
 * Im Namen steht die Laufkennung, und man käme versucht sein, sie dort
 * herauszulesen. Das hält genau so lange, bis jemand einen Workflow umbenennt
 * oder ein Paket von Hand verschiebt — dann findet der Korrekturlauf nichts und
 * meldet „kein Paket", obwohl eines daliegt.
 *
 * Der Eintrag ist außerdem die Antwort auf eine Frage, die die Bereinigung
 * bisher nicht stellen konnte: **Darf dieses Paket schon fort?** Solange zu
 * seinem Lauf noch ein Konflikt offen ist, ist es das Original, aus dem der
 * Korrekturlauf rechnen wird. Eine Frist, die es vorher fortnimmt, macht die
 * Konfliktbearbeitung wertlos — man entscheidet zwanzig Fälle und hat nichts
 * mehr, worauf man sie anwenden könnte.
 *
 * ## Der Eintrag bleibt, wenn die Datei fort ist
 *
 * Wie bei den Ausleitungen: `entferntAm` trägt dann den Zeitpunkt. Wer im März
 * wissen will, warum ein Paket vom Januar nicht mehr da ist, findet hier die
 * Antwort und nicht eine Lücke, die nach einem Fehler aussieht.
 */
export interface Archivpaket {
  id: string;
  tenantId: string;
  /** Der Workflow, dessen Lieferung darin liegt. */
  jobId: string;
  /** Der Lauf — der Griff, an dem der Korrekturlauf es wiederfindet. */
  laufId: string;
  /** Wohin geschrieben wurde. */
  pfad: string;
  name: string;
  /** Wie viele Eingangsdateien darin liegen. */
  dateien: number;
  erstellt: string;
  /** Wann die Datei fortgeräumt wurde — der Eintrag bleibt stehen. */
  entferntAm?: string;
}

/**
 * Der Bestand der Archivpakete.
 *
 * Kein `delete`: Was fortgeräumt wird, ist die **Datei**. Der Eintrag bleibt
 * und trägt ab dann `entferntAm`.
 */
export interface Paketbestand {
  list(tenantId?: string): Promise<Archivpaket[]>;
  /** Das Paket eines Laufs — mehr braucht der Korrekturlauf nicht. */
  zuLauf(laufId: string): Promise<Archivpaket | undefined>;
  save(paket: Archivpaket): Promise<void>;
}

/** Wie lange ein Paket liegen bleibt, wenn niemand etwas anderes sagt. */
export const ARCHIV_TAGE = 90;

/**
 * Ob dieses Paket fortgeräumt werden darf.
 *
 * Dieselben drei Bedingungen wie bei einer Ausleitung — siehe
 * `darfFortgeraeumtWerden`. Sie stehen in SPEC-07, Abschnitt 5, und gelten
 * ausdrücklich für *Dateien*, nicht für diese eine Art davon:
 *
 * 1. Die Frist ist um.
 * 2. Es liegt noch da — zweimal löschen ist kein Fortschritt.
 * 3. **Der Lauf ist erfolgreich abgeschlossen.** Ein Paket ist das Original
 *    einer Lieferung; solange sein Lauf offene Fälle hat, ist es genau das,
 *    woraus der Korrekturlauf rechnen wird. Eine Frist, die es vorher
 *    fortnimmt, macht die Konfliktbearbeitung wertlos — man entscheidet
 *    zwanzig Fälle und hat nichts mehr, worauf man sie anwenden könnte.
 *
 * Ist der Lauf **unbekannt**, bleibt die Datei liegen. Das ist die unbequemere
 * Antwort und die richtige: Eine Frist, die im Zweifel löscht, löscht
 * irgendwann das, was jemand gebraucht hätte.
 */
export function darfPaketFort(
  paket: Pick<Archivpaket, 'entferntAm' | 'erstellt'>,
  lauf: { abgeschlossen: boolean } | undefined,
  optionen: { tage?: number; jetzt: Date }
): boolean {
  if (paket.entferntAm !== undefined) {
    return false;
  }

  if (!lauf?.abgeschlossen) {
    return false;
  }

  return paketAbgelaufen(paket, optionen);
}

/** Ob die Frist um ist. Eine Frist von null Tagen räumt nichts fort, sondern schaltet ab. */
export function paketAbgelaufen(
  paket: Pick<Archivpaket, 'erstellt'>,
  optionen: { tage?: number; jetzt: Date }
): boolean {
  const tage = optionen.tage ?? ARCHIV_TAGE;

  if (tage <= 0) {
    return false;
  }

  const erstellt = Date.parse(paket.erstellt);

  if (Number.isNaN(erstellt)) {
    // Ein unlesbarer Zeitpunkt ist kein abgelaufener. Im Zweifel bleibt es
    // liegen — dieselbe Richtung wie beim unbekannten Lauf.
    return false;
  }

  return optionen.jetzt.getTime() - erstellt >= tage * 24 * 60 * 60 * 1000;
}
