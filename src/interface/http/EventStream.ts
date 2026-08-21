import type { ServerResponse } from 'node:http';

import type { Benachrichtigung } from '../../domain/background/Benachrichtigung.js';
import { TransferRunStatus, type TransferRun } from '../../domain/transfer/TransferRun.js';

/**
 * Server-Sent Events (SPEC-01, Abschnitt 17; SPEC-02, Abschnitt 49).
 *
 * ## Was SSE hier ist — und was nicht
 *
 * „SSE dient **ausschließlich** der Live-Kommunikation mit der Oberfläche. Der
 * persistente Status wird unabhängig davon in SQLite gespeichert. Wenn der
 * Browser geschlossen wird, läuft die Verarbeitung weiter."
 *
 * Der Strom ist also eine Bequemlichkeit, kein Bestand. Wer ihn verpasst, hat
 * nichts verloren — beim nächsten Öffnen steht alles in der Datenbank. Deshalb
 * gibt es hier auch keine Zustellgarantie und keinen Puffer: Ein Ereignis, das
 * niemanden erreicht, ist nicht verloren, sondern nur ungesehen.
 *
 * ## Warum gelesen und nicht gemeldet wird
 *
 * Die Ereignisse entstehen im **Worker**, angezeigt werden sie vom **Server** —
 * zwei Prozesse. Ein Meldeweg dazwischen wäre ein dritter Bestandteil, der
 * ausfallen kann, und für den es keinen Bedarf gibt: Was der Worker tut, steht
 * ohnehin in der Datenbank, sobald er es getan hat. Der Server sieht deshalb
 * in kurzen Abständen nach, was sich geändert hat, und schickt den Unterschied.
 *
 * Der Preis ist eine Verzögerung von bis zu zwei Sekunden. Der Gewinn ist, dass
 * es keine zweite Wahrheit gibt: Was auf dem Bildschirm steht, stand vorher in
 * der Datenbank — nie umgekehrt.
 */
export type EreignisName =
  | 'PROCESSING_STARTED'
  | 'PROGRESS_CHANGED'
  | 'PROCESSING_COMPLETED'
  | 'ERROR'
  | 'CONFLICT_FOUND'
  | 'NOTIFICATION';

export interface Ereignis {
  name: EreignisName;
  daten: Record<string, unknown>;
}

/** Wie oft nachgesehen wird, was sich geändert hat. */
export const NACHSEHEN_ALLE_MS = 2_000;

/** Ein Lebenszeichen für die Verbindung selbst — sonst schließen Zwischenserver sie. */
export const STROM_HERZSCHLAG_MS = 25_000;

/** Der Stand eines Laufs, soweit er für die Anzeige zählt. */
export interface Laufstand {
  status: TransferRunStatus;
  verarbeitet: number;
  gelungen: number;
  fehlgeschlagen: number;
}

export function standVon(lauf: TransferRun): Laufstand {
  return {
    status: lauf.status,
    verarbeitet: lauf.filesProcessed,
    gelungen: lauf.filesSucceeded,
    fehlgeschlagen: lauf.filesFailed,
  };
}

const ABGESCHLOSSEN: readonly TransferRunStatus[] = [
  TransferRunStatus.SUCCESS,
  TransferRunStatus.SUCCESS_NO_FILES,
  TransferRunStatus.COMPLETED_WITH_ERRORS,
  TransferRunStatus.CANCELLED,
];

/**
 * Was sich seit dem letzten Blick geändert hat.
 *
 * Eine reine Funktion über zwei Momentaufnahmen — deshalb prüfbar, ohne einen
 * Server zu starten. Sie entscheidet auch, was **kein** Ereignis ist: Ein Lauf,
 * an dem sich nichts getan hat, erzeugt keines. Ein Strom, der jede Sekunde
 * denselben Stand wiederholt, ist ein Strom, den niemand liest.
 */
export function unterschied(
  vorher: ReadonlyMap<string, Laufstand>,
  nachher: ReadonlyMap<string, Laufstand>
): Ereignis[] {
  const ereignisse: Ereignis[] = [];

  for (const [id, stand] of nachher) {
    const alt = vorher.get(id);

    if (!alt) {
      /*
       * Ein Lauf, den es beim letzten Blick nicht gab. Nur als „gestartet"
       * melden, wenn er auch läuft — beim allerersten Blick nach dem Öffnen
       * der Seite sind sonst alle Läufe der letzten Woche „gerade gestartet".
       */
      if (stand.status === TransferRunStatus.RUNNING) {
        ereignisse.push({ name: 'PROCESSING_STARTED', daten: { laufId: id, ...stand } });
      }

      continue;
    }

    if (alt.status === stand.status && alt.verarbeitet === stand.verarbeitet) {
      continue;
    }

    if (stand.status === TransferRunStatus.FAILED) {
      ereignisse.push({ name: 'ERROR', daten: { laufId: id, ...stand } });
      continue;
    }

    if (ABGESCHLOSSEN.includes(stand.status)) {
      ereignisse.push({ name: 'PROCESSING_COMPLETED', daten: { laufId: id, ...stand } });
      continue;
    }

    ereignisse.push({ name: 'PROGRESS_CHANGED', daten: { laufId: id, ...stand } });
  }

  return ereignisse;
}

/** Neue Meldungen seit dem letzten Blick — an ihrer Kennung erkannt. */
export function neueMeldungen(gesehen: ReadonlySet<string>, meldungen: readonly Benachrichtigung[]): Ereignis[] {
  return meldungen
    .filter((meldung) => !gesehen.has(meldung.id))
    .map((meldung) => ({
      name: meldung.anlass === 'KONFLIKTE_ENTSTANDEN' ? ('CONFLICT_FOUND' as const) : ('NOTIFICATION' as const),
      daten: {
        id: meldung.id,
        stufe: meldung.stufe,
        titel: meldung.titel,
        text: meldung.text,
        ziel: meldung.ziel,
      },
    }));
}

/**
 * Ein Ereignis in der Schreibweise, die SSE verlangt.
 *
 * Zeilenumbrüche im Text müssen fort: Ein `\n` im Datenfeld beendet für den
 * Browser das Ereignis, und der Rest der Meldung käme als abgeschnittener
 * Unsinn an. Deshalb geht alles durch JSON, das keine rohen Umbrüche enthält.
 */
export function alsSse(ereignis: Ereignis): string {
  return `event: ${ereignis.name}\ndata: ${JSON.stringify(ereignis.daten)}\n\n`;
}


/**
 * Ein Kommentar als Lebenszeichen der Verbindung.
 *
 * Er hält sie offen, ohne ein Ereignis vorzutäuschen: Eine Zeile, die mit
 * einem Doppelpunkt beginnt, überliest jeder SSE-Leser. Ohne sie schließen
 * Zwischenserver eine Verbindung, auf der eine Weile nichts geschieht — und
 * das ist bei einem ruhigen Vormittag der Normalfall.
 */
export const STROM_LEBENSZEICHEN = ': .\n\n';

export function oeffneStrom(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Kein Puffern durch einen vorgeschalteten Server — sonst kommt der ganze
    // Strom erst an, wenn er zu Ende ist.
    'X-Accel-Buffering': 'no',
  });

  response.write(': verbunden\n\n');
}
