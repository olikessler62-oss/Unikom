import {
  isAtLeast,
  type LogEntry,
  type Logger,
  type TransferLogQuery,
  type TransferLogRepository,
} from '../../domain/logging/LogEntry.js';

/**
 * Das Protokoll eines Laufs — im Arbeitsspeicher, nicht in der Datenbank.
 *
 * Ein Laufprotokoll ist eine Mitschrift und kein Datenbestand. Es wird
 * gebraucht, solange jemand hinsieht: während der Lauf läuft, und danach so
 * lange, bis geklärt ist, was er getan hat. Was darüber hinaus aufbewahrt
 * werden soll, entscheidet der Benutzer, indem er es speichert — und nicht die
 * Software, indem sie alles behält.
 *
 * Das kostet und bringt jeweils etwas, und beides gehört gesagt:
 *
 * — Die Datenbank wächst nicht mehr mit dem Protokoll. Bei ausführlicher
 *   Protokollierung waren das gemessene 1,6 kB je Datei, also gut ein halbes
 *   Gigabyte im Jahr bei tausend Dateien am Tag.
 * — Ein Neustart nimmt die Protokolle mit. Wer die Nacht erklären will,
 *   braucht sie am Morgen — deshalb die Grenze unten in Läufen und nicht in
 *   Minuten, und deshalb speichert man, was man behalten will.
 *
 * **Verworfen wird ein Lauf im Ganzen**, nie einzelne Zeilen daraus. Ein
 * Protokoll, dem vorne die Hälfte fehlt, ist schlimmer als keines: Es sieht
 * vollständig aus und beantwortet die Frage trotzdem nicht.
 */

export interface RunProtocolMemoOptions {
  /**
   * Wie viele Läufe gleichzeitig im Speicher liegen. Zwanzig deckt eine Nacht
   * mit einem Lauf je Stunde und den Morgen danach ab.
   */
  runs?: number;
  /**
   * Obergrenze in Zeilen über alles. Sie greift vor der Lauf-Grenze, wenn ein
   * einzelner Lauf sehr viel schreibt — hunderttausend Zeilen sind bei der
   * gemessenen Zeilenlänge rund 15 MB, und mehr darf ein Protokoll dem
   * Arbeitsspeicher nicht wert sein.
   */
  entries?: number;
}

const DEFAULT_RUNS = 20;
const DEFAULT_ENTRIES = 100_000;

/** Zeilen, die zu keinem Lauf gehören — Start des Dienstes, Aufräumen. */
const WITHOUT_RUN = '(ohne Lauf)';

export class RunProtocolMemo implements Logger, TransferLogRepository {
  /**
   * Läufe in der Reihenfolge ihres ersten Auftretens. `Map` hält diese
   * Reihenfolge zu, deshalb ist der älteste Lauf immer der erste Schlüssel —
   * ohne dass irgendwo ein Zeitstempel verglichen werden muss.
   */
  private readonly runs = new Map<string, LogEntry[]>();
  private readonly maxRuns: number;
  private readonly maxEntries: number;
  /** Fortlaufende Position, wie sie die Anzeige zum Nachladen braucht. */
  private nextSequence = 1;
  private total = 0;

  constructor(options: RunProtocolMemoOptions = {}) {
    this.maxRuns = Math.max(1, options.runs ?? DEFAULT_RUNS);
    this.maxEntries = Math.max(1, options.entries ?? DEFAULT_ENTRIES);
  }

  log(entry: LogEntry): void {
    const key = entry.runId ?? WITHOUT_RUN;
    const lines = this.runs.get(key) ?? [];

    if (!this.runs.has(key)) {
      this.runs.set(key, lines);
    }

    lines.push({ ...entry, sequence: this.nextSequence++ });
    this.total += 1;

    this.forgetOldest();
  }

  async list(query: TransferLogQuery): Promise<LogEntry[]> {
    const source = query.runId !== undefined ? (this.runs.get(query.runId) ?? []) : this.everything();

    const result = source.filter(
      (entry) =>
        (query.jobId === undefined || entry.jobId === query.jobId) &&
        (query.minimumLevel === undefined || isAtLeast(entry.level, query.minimumLevel)) &&
        (query.afterSequence === undefined || (entry.sequence ?? 0) > query.afterSequence)
    );

    const limited = query.limit !== undefined ? result.slice(0, Math.max(1, Math.floor(query.limit))) : result;

    return limited.map((entry) => ({ ...entry }));
  }

  /**
   * Aufräumen nach Alter gibt es hier nicht mehr, und das ist keine Lücke:
   * Die Grenze ist die Zahl der Läufe im Speicher, und ein Neustart räumt
   * ohnehin alles fort. Die Methode bleibt, weil die Aufbewahrung sie für die
   * Übernahme-Historie mit aufruft — sie meldet ehrlich, dass sie nichts
   * gelöscht hat.
   */
  async deleteOlderThan(): Promise<number> {
    return 0;
  }

  /** Wie viele Läufe gerade im Speicher liegen — für Anzeige und Tests. */
  get size(): number {
    return this.runs.size;
  }

  private everything(): LogEntry[] {
    return [...this.runs.values()].flat().sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }

  private forgetOldest(): void {
    while (this.runs.size > this.maxRuns || this.total > this.maxEntries) {
      const oldest = this.runs.keys().next();

      if (oldest.done) {
        return;
      }

      // Der Lauf, der gerade schreibt, darf nicht unter sich selbst
      // weggeräumt werden — sonst verlöre ausgerechnet der laufende Lauf
      // seinen Anfang, während man ihm zusieht.
      if (this.runs.size === 1) {
        return;
      }

      this.total -= this.runs.get(oldest.value)?.length ?? 0;
      this.runs.delete(oldest.value);
    }
  }
}
