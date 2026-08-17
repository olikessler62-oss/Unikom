import type { SourceFile, FileSelectionCriteria } from '../../domain/files/SourceFile.js';

export type FileRejectionReason =
  | 'DIRECTORY'
  | 'TEMPORARY_EXTENSION'
  | 'PREFIX_MISMATCH'
  | 'EXTENSION_MISMATCH'
  | 'TOO_YOUNG'
  | 'AGE_UNKNOWN';

export interface FileSelectionResult {
  selected: boolean;
  reason?: FileRejectionReason;
}

/**
 * Central file filter (spec sections 19-20). Every source uses the same rules,
 * so no protocol adapter is allowed to filter on its own.
 *
 * The stability check is deliberately not part of this service: it requires
 * repeated measurements over time and lives in FileStabilityService.
 */
export class FileSelectionService {
  /**
   * Whether a filename matches what the job asks for.
   *
   * Three shapes, and they are the ones everybody already knows from a file
   * dialog:
   *
   *   `ORDER`    the name begins with it — also written `ORDER*`
   *   `*ORDER`   the name ends with it
   *   `*ORDER*`  the name contains it somewhere
   *
   * A star is dropped where it only repeats what the shape already says. Taken
   * literally it would search for a star inside the filename and quietly find
   * nothing — a job that runs, reports success and moves no file, which is the
   * worst answer a filter can give.
   *
   * Only at the ends. A star in the middle would be a real pattern language,
   * and half of one is worse than none: it looks like it works.
   *
   * An extension typed into the pattern is understood rather than removed. The
   * field asks for a name without one, and people write it anyway — `ORDER_.csv`
   * is what they would type into any file dialog. Read literally it would be a
   * name beginning with "ORDER_.csv" and match nothing.
   *
   * Nothing is guessed here: the tail of the pattern counts as an extension
   * only when it *is* the extension of the file in front of us. That is what
   * makes this the right place for it, and not the input field — there one has
   * to decide whether `Rechnung_2026.2026` ends in a version or an extension,
   * and here the file answers it. Both readings keep working: against
   * `Rechnung_2026.2026` the tail matches and the names are compared without
   * it; against `Rechnung_2026.2026_final.csv` it does not, and the whole
   * pattern is compared as written.
   */
  matchesFilename(filename: string, pattern?: string, caseSensitive = false): boolean {
    const wanted = pattern?.trim() ?? '';

    // Nichts, oder nur Sterne: schränkt nichts ein, wie ein leeres Feld.
    if (wanted.replace(/\*/g, '') === '') {
      return true;
    }

    const leading = wanted.startsWith('*');
    const trailingStar = wanted.endsWith('*');
    const core = wanted.replace(/^\*+/, '').replace(/\*+$/, '');

    /*
     * Erst die Endung abtrennen, dann die Form bestimmen. Andersherum ginge
     * `MeinDatei*.csv` verloren — dort steht der Stern zwischen Name und
     * Endung, also weder vorn noch hinten, und genau so schreibt man es in
     * jedem Dateidialog.
     */
    const carried = this.sharedExtension(core, filename, leading);
    const withoutCarried = carried ? core.slice(0, core.length - carried.length - 1) : core;

    const trailing = trailingStar || withoutCarried.endsWith('*');
    const needleText = withoutCarried.replace(/\*+$/, '');

    // `*.csv` sagt „jeder Name, diese Endung" — die hat bereits entschieden.
    if (needleText === '') {
      return true;
    }

    // Die Endung verlässt beide Seiten oder keine, damit Gleiches verglichen wird.
    const subjectText = carried || (leading && !trailing) ? this.withoutExtension(filename) : filename;

    const name = caseSensitive ? subjectText : subjectText.toLowerCase();
    const needle = caseSensitive ? needleText : needleText.toLowerCase();

    if (leading && trailing) {
      return name.includes(needle);
    }

    return leading ? name.endsWith(needle) : name.startsWith(needle);
  }

  /**
   * The extension the pattern and the file have in common, if any.
   *
   * Returned as written in the pattern, so the caller can cut exactly that many
   * characters off it.
   */
  private sharedExtension(core: string, filename: string, leading: boolean): string | undefined {
    const dot = core.lastIndexOf('.');

    if (dot < 0) {
      return undefined;
    }

    /*
     * Ein Punkt am Anfang ist der Anfang eines Namens, kein Trenner: `.csv` ist
     * eine Datei, die so heißt, und wer danach sucht, meint den Namen. Stand
     * aber ein Stern davor — `*.csv` —, dann ist der Stern der Name und der
     * Punkt trennt.
     */
    if (dot === 0 && !leading) {
      return undefined;
    }

    const fromPattern = core.slice(dot + 1);
    // `getExtension` liefert den Punkt mit und in Kleinbuchstaben.
    const fromFile = this.getExtension(filename).replace(/^\./, '');

    if (fromPattern === '' || fromFile === '') {
      return undefined;
    }

    /*
     * Der Vergleich der Endung achtet nie auf Groß- und Kleinschreibung — auch
     * dann nicht, wenn der Job es für den Namen tut. Ob eine Quelle .CSV oder
     * .csv schreibt, ist ihre Angewohnheit und keine Aussage über den Namen,
     * nach dem gesucht wird.
     */
    return fromPattern.toLowerCase() === fromFile ? fromPattern : undefined;
  }

  /** `Rechnung_2026.csv` becomes `Rechnung_2026`; a name without a dot stays. */
  private withoutExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(0, dot) : filename;
  }

  matchesExtension(filename: string, allowedExtensions: string[]): boolean {
    if (allowedExtensions.length === 0) {
      return true;
    }

    const normalizedAllowed = allowedExtensions.map((extension) => this.normalizeExtension(extension));
    return normalizedAllowed.includes(this.getExtension(filename));
  }

  /**
   * A file whose last extension marks an unfinished upload is never picked up,
   * no matter which other filters would match (spec sections 37-38).
   */
  isTemporary(filename: string, ignoredTemporaryExtensions: string[] = []): boolean {
    if (ignoredTemporaryExtensions.length === 0) {
      return false;
    }

    const normalizedIgnored = ignoredTemporaryExtensions.map((extension) => this.normalizeExtension(extension));
    return normalizedIgnored.includes(this.getExtension(filename));
  }

  isOldEnough(fileAgeSeconds: number, minimumFileAgeSeconds: number): boolean {
    return fileAgeSeconds >= minimumFileAgeSeconds;
  }

  ageInSeconds(file: SourceFile, now: Date): number | undefined {
    if (!file.lastModified) {
      return undefined;
    }

    return (now.getTime() - file.lastModified.getTime()) / 1000;
  }

  /**
   * Applies all active filters with AND semantics (spec section 18) and reports
   * why a file was rejected, which feeds both the run statistics and the
   * "show matching files" preview of spec section 53.
   */
  evaluate(file: SourceFile, criteria: FileSelectionCriteria, now: Date = new Date()): FileSelectionResult {
    if (file.isDirectory) {
      return { selected: false, reason: 'DIRECTORY' };
    }

    if (this.isTemporary(file.name, criteria.ignoredTemporaryExtensions)) {
      return { selected: false, reason: 'TEMPORARY_EXTENSION' };
    }

    if (!this.matchesFilename(file.name, criteria.filenamePrefix, criteria.caseSensitivePrefix)) {
      return { selected: false, reason: 'PREFIX_MISMATCH' };
    }

    if (!this.matchesExtension(file.name, criteria.allowedExtensions)) {
      return { selected: false, reason: 'EXTENSION_MISMATCH' };
    }

    if (criteria.minimumFileAgeSeconds > 0) {
      const age = this.ageInSeconds(file, now);
      if (age === undefined) {
        // Without a timestamp the age requirement cannot be proven, and an
        // unproven file must never be treated as ready (spec section 116).
        return { selected: false, reason: 'AGE_UNKNOWN' };
      }

      if (!this.isOldEnough(age, criteria.minimumFileAgeSeconds)) {
        return { selected: false, reason: 'TOO_YOUNG' };
      }
    }

    return { selected: true };
  }

  matches(file: SourceFile, criteria: FileSelectionCriteria, now: Date = new Date()): boolean {
    return this.evaluate(file, criteria, now).selected;
  }

  private normalizeExtension(extension: string): string {
    const cleaned = extension.trim().toLowerCase();
    return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === filename.length - 1) {
      return '';
    }

    return filename.slice(lastDot).toLowerCase();
  }
}
