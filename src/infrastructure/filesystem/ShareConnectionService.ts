import { spawn } from 'node:child_process';

import type { SourceTrace } from '../../domain/source/SourceAdapter.js';

/**
 * Verbindungen zu Windows-Freigaben, die eigene Anmeldedaten brauchen.
 *
 * Eine Freigabe wird sonst mit der Identität des Prozesses erreicht — das
 * genügt, solange Unikom unter einem Konto läuft, das überall Rechte hat. Bei
 * hunderten Kunden weltweit ist das keine Annahme, auf die man ein Erzeugnis
 * stellt: Es gibt Freigaben, für die ein eigener Zugang hinterlegt werden muss.
 *
 * **Warum das nicht einfach ein Feld mehr ist.** Windows baut eine
 * SMB-Verbindung nicht je Zugriff auf, sondern als Sitzung für das ganze Konto.
 * Zwei verschiedene Zugänge zu *demselben* Server können deshalb nicht
 * gleichzeitig bestehen; der zweite Versuch wird mit Systemfehler 1219
 * abgewiesen. Zwei Workflows, die parallel gegen denselben Server laufen,
 * würden sich also gegenseitig die Verbindung unter den Füßen wegziehen.
 *
 * **Wie streng das hier genommen wird.** Nachgemessen ist die Sperre nicht: Um
 * sie auszulösen, hätte es zwei gültige Konten gebraucht, und der Aufwand stand
 * in keinem Verhältnis. Also wird sie angenommen — je Server läuft immer nur
 * ein Zugang, und wer wartet, wartet. Der Fehler „zu vorsichtig" kostet
 * Wartezeit, der Fehler „zu optimistisch" kostet eine Übertragung, die nachts
 * scheitert. Sobald eine echte Kundenumgebung mit zwei Zugängen zur Verfügung
 * steht, lässt sich das nachmessen und lockern.
 */

export interface ShareCredentials {
  username: string;
  password: string;
}

/**
 * Was ein Aufrufer von der Verbindungsverwaltung braucht — mehr nicht.
 *
 * Als eigene Schnittstelle und nicht als Klasse, damit eine Prüfung sie
 * ersetzen kann, ohne `net use` und ohne Windows: Was hier zu prüfen ist, ist
 * *ob* verbunden wird und mit welchem Zugang, nicht wie das Kommando heißt.
 */
export interface ShareConnections {
  withConnection<T>(
    directory: string,
    credentials: ShareCredentials | undefined,
    trace: SourceTrace | undefined,
    work: () => Promise<T>
  ): Promise<T>;
}

export class ShareConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShareConnectionError';
  }
}

/**
 * Der Servername aus einem UNC-Pfad: `\\SERVER01\Austausch\Eingang` → `SERVER01`.
 *
 * Er ist der Schlüssel, unter dem die Sitzungen auseinandergehalten werden —
 * nicht die Freigabe. Windows kennt die Sitzung zum Server, nicht zur Freigabe,
 * und zwei Freigaben desselben Servers teilen sie sich.
 */
export function serverOf(uncPath: string): string | undefined {
  const match = /^\\\\([^\\/]+)/.exec(uncPath.trim());
  return match?.[1]?.toLowerCase();
}

/** Ob dieser Pfad überhaupt über das Netz führt. */
export function isUncPath(value: string): boolean {
  return /^\\\\[^\\/]+\\/.test(value.trim());
}

export class ShareConnectionService implements ShareConnections {
  /**
   * Was je Server gerade läuft, als Kette.
   *
   * Jede neue Anforderung hängt sich hinten an. Damit laufen zwei Workflows zum
   * selben Server nacheinander statt gleichzeitig — genau das, was die Sperre
   * von Windows verlangt, und der Grund, warum hier eine Warteschlange steht
   * und kein Zähler.
   */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    /** Austauschbar, damit die Prüfung nicht wirklich `net use` aufrufen muss. */
    private readonly run: (args: string[], input?: string) => Promise<{ code: number; output: string }> = netUse
  ) {}

  /**
   * Führt `work` aus, während die Freigabe verbunden ist, und löst danach
   * wieder auf.
   *
   * Ohne Zugangsdaten geschieht nichts weiter: Der Pfad wird dann mit der
   * Identität des Prozesses erreicht, so wie bisher. Das ist der häufige Fall
   * und darf keine Verbindung aufmachen, die niemand verlangt hat.
   */
  async withConnection<T>(
    directory: string,
    credentials: ShareCredentials | undefined,
    trace: SourceTrace | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    const server = credentials && isUncPath(directory) ? serverOf(directory) : undefined;

    if (!server || !credentials) {
      return work();
    }

    if (process.platform !== 'win32') {
      throw new ShareConnectionError(
        `Für ${directory} sind Anmeldedaten hinterlegt. Eine Windows-Freigabe mit eigenen Anmeldedaten ` +
          'lässt sich nur unter Windows verbinden.'
      );
    }

    // Anstellen statt danebenstellen: Der Vorgänger wird abgewartet, sein
    // Ausgang aber nicht übernommen — ein gescheiterter Lauf darf den nächsten
    // nicht mitreißen.
    const vorgänger = this.queues.get(server) ?? Promise.resolve();
    const eigener = vorgänger.catch(() => undefined).then(() => this.connectAndRun(server, directory, credentials, trace, work));

    this.queues.set(server, eigener);

    try {
      return await eigener;
    } finally {
      // Nur aufräumen, wenn niemand nachgerückt ist — sonst nähme man dem
      // Nächsten seinen Platz in der Kette weg.
      if (this.queues.get(server) === eigener) {
        this.queues.delete(server);
      }
    }
  }

  private async connectAndRun<T>(
    server: string,
    directory: string,
    credentials: ShareCredentials,
    trace: SourceTrace | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    const share = shareOf(directory);

    trace?.(`Freigabe ${share} wird als „${credentials.username}“ verbunden`);

    // Erst lösen, was von einem abgebrochenen Lauf übrig sein könnte. Ohne das
    // stünde eine alte Sitzung mit fremden Anmeldedaten im Weg, und Windows
    // wiese die neue mit Systemfehler 1219 ab.
    const alt = await this.run(['use', share, '/delete', '/y']);
    if (alt.code === 0) {
      trace?.(`Eine vorhandene Verbindung zu ${share} wurde zuvor gelöst`);
    }

    // Das Kennwort geht über die Eingabe, nicht über die Befehlszeile: Was in
    // der Befehlszeile steht, kann jeder Prozess auf dem Rechner mitlesen.
    const verbunden = await this.run(['use', share, `/user:${credentials.username}`, '*'], `${credentials.password}\n`);

    if (verbunden.code !== 0) {
      trace?.(`Verbinden von ${share} fehlgeschlagen: ${verbunden.output}`);
      throw new ShareConnectionError(
        `Die Freigabe ${share} lässt sich nicht als „${credentials.username}“ verbinden: ${verbunden.output}`
      );
    }

    trace?.(`Freigabe ${share} verbunden`);

    try {
      return await work();
    } finally {
      const gelöst = await this.run(['use', share, '/delete', '/y']);

      // Ein Lösen, das scheitert, hält den Lauf nicht auf — aber es wird
      // gesagt: Eine liegengebliebene Sitzung ist der Grund, aus dem der
      // nächste Lauf mit anderen Anmeldedaten abgewiesen würde.
      trace?.(
        gelöst.code === 0
          ? `Freigabe ${share} wieder gelöst`
          : `Freigabe ${share} ließ sich nicht lösen: ${gelöst.output}`
      );
    }
  }
}

/** `\\SERVER01\Austausch\Eingang` → `\\SERVER01\Austausch`. */
export function shareOf(uncPath: string): string {
  const parts = uncPath.trim().replace(/\//g, '\\').split('\\').filter(Boolean);
  return `\\\\${parts[0]}\\${parts[1] ?? ''}`;
}

/**
 * `net use`, mit dem Kennwort über die Eingabe.
 *
 * `spawn` und nicht `exec`: Die Argumente gehen als Liste an den Prozess, statt
 * durch eine Befehlszeile zu laufen, in der ein Anführungszeichen im
 * Benutzernamen alles Weitere umdeuten könnte.
 */
function netUse(args: string[], input?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('net', args, { windowsHide: true });
    let output = '';

    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }

    child.on('error', (error) => resolve({ code: -1, output: error.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, output: output.trim() }));
  });
}
