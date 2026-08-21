import type { TransferJob } from '../transfer/TransferJob.js';

/**
 * Die Verarbeitung, die nicht stattgefunden hat (SPEC-01, Abschnitt 21).
 *
 * ```text
 * erwartet 02:00 ────────────────── 02:05 ─────────────────▶
 *                                     │
 *                    Nachfrist        └── ab hier: ausgeblieben
 * ```
 *
 * ## Warum das eine eigene Meldung ist
 *
 * Alle anderen Meldungen entstehen, weil etwas geschehen ist. Diese entsteht,
 * weil **nichts** geschehen ist — und das ist die Meldung, die am schwersten zu
 * bauen und am wichtigsten ist: Ein Lauf, der fehlschlägt, meldet sich. Ein
 * Lauf, der gar nicht erst anfängt, meldet gar nichts, und niemand vermisst um
 * drei Uhr nachts eine Nachricht, die nie kam.
 *
 * Der häufigste Grund ist banal: Der Worker läuft nicht. Genau dann fehlt aber
 * auch derjenige, der es merken könnte — deshalb prüft **jeder** Tick zuerst,
 * was er verpasst hat, bevor er anfängt zu arbeiten.
 *
 * ## Die Nachfrist ist knapp, und das mit Absicht
 *
 * Anders als beim Herzschlag geht es hier nicht um einen Prozess, der
 * vielleicht gerade rechnet, sondern um einen Zeitpunkt, der überschritten ist.
 * Fünf Minuten decken den Taktabstand des Workers und eine träge Maschine ab;
 * länger zu warten hieße, den Ausfall einer Nachtverarbeitung erst am
 * Vormittag zu melden.
 */
export const VERSPAETET_AB_MS = 5 * 60 * 1000;

export interface Versaeumnis {
  jobId: string;
  tenantId: string;
  name: string;
  /** Wann der Lauf hätte beginnen sollen — ISO, für den Bestand. */
  erwartet: string;
  /**
   * Derselbe Zeitpunkt für einen Menschen, in der Zeitzone des Zeitplans.
   *
   * Nicht dieselbe Angabe zweimal: Ein Nachtlauf um 02:00 steht als
   * `00:00:00.000Z` im Bestand, und wer das um acht Uhr morgens liest, sucht
   * nach einem Lauf um Mitternacht. Der Zeitplan trägt seine Zeitzone mit sich
   * — sie ist die einzige, die hier stimmt.
   */
  erwartetLokal: string;
  /** Wie lange das her ist — in Worten, für die Meldung. */
  ueberfaellig: string;
  /**
   * Womit die Kennung eindeutig wird.
   *
   * Ohne sie meldete sich derselbe versäumte Termin bei jedem Tick erneut,
   * solange ihn etwas am Nachholen hindert — etwa eine abgelaufene Lizenz.
   * Zwölf gleiche Meldungen pro Stunde sind keine Warnung mehr.
   */
  kennung: string;
}

/**
 * Welche Workflows ihren Termin verpasst haben.
 *
 * Geprüft wird dasselbe wie bei der Fälligkeit — abgeschaltet, ohne Zeitplan
 * oder nur von Hand zu starten zählt nicht —, nur mit einer Nachfrist davor.
 * Sonst wäre jeder Workflow in der Sekunde seiner Fälligkeit „ausgeblieben",
 * eine Sekunde bevor der Tick ihn startet.
 */
export function ausgeblieben(
  jobs: readonly TransferJob[],
  jetzt: Date,
  frist: number = VERSPAETET_AB_MS
): Versaeumnis[] {
  const grenze = jetzt.getTime() - frist;

  return jobs
    .filter((job) => job.enabled && job.schedule && job.executionMode !== 'MANUAL')
    .filter((job) => job.nextExecutionAt !== undefined && job.nextExecutionAt.getTime() < grenze)
    .map((job) => {
      const erwartet = job.nextExecutionAt as Date;

      return {
        jobId: job.id,
        tenantId: job.tenantId,
        name: job.name,
        erwartet: erwartet.toISOString(),
        erwartetLokal: oertlich(erwartet, job.schedule?.timezone),
        ueberfaellig: dauer(jetzt.getTime() - erwartet.getTime()),
        kennung: `${job.id}@${erwartet.toISOString()}`,
      };
    });
}

/** Wie lange her, in Worten — für die Meldung, die ein Mensch liest. */
export function dauer(millisekunden: number): string {
  const minuten = Math.max(0, Math.round(millisekunden / 60_000));

  if (minuten < 90) {
    return `${minuten} Minuten`;
  }

  const stunden = Math.round(minuten / 60);

  return stunden < 48 ? `${stunden} Stunden` : `${Math.round(stunden / 24)} Tage`;
}

/**
 * Ein Zeitpunkt so, wie ein Mensch ihn ausspricht.
 *
 * Die Zeitzone kommt aus dem Zeitplan und nicht aus der Einstellung des
 * Rechners: Ein Dienstleister betreibt Workflows für Kunden in mehreren
 * Ländern, und der Nachtlauf, der in Wien um zwei beginnt, beginnt nicht um
 * zwei, wenn der Server in London steht.
 *
 * Sie steht dabei — sonst ist die Angabe nur dann eindeutig, wenn der Leser die
 * Zeitzone auswendig weiß.
 */
export function oertlich(zeitpunkt: Date, zeitzone?: string): string {
  if (!zeitzone) {
    return zeitpunkt.toISOString();
  }

  try {
    const geschrieben = new Intl.DateTimeFormat('de-DE', {
      timeZone: zeitzone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(zeitpunkt);

    return `${geschrieben} (${zeitzone})`;
  } catch {
    // Eine Zeitzone, die dieses System nicht kennt. Lieber die technische
    // Schreibweise als eine Meldung, die an der Formatierung scheitert.
    return zeitpunkt.toISOString();
  }
}
