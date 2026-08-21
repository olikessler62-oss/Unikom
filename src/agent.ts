import { spawn } from 'node:child_process';
import path from 'node:path';

import { createPersistentApplication } from './application/runtime/UnikomApplication.js';
import type { Benachrichtigung } from './domain/background/Benachrichtigung.js';
import {
  ANWENDUNGSKENNUNG,
  FENSTERTITEL,
  FENSTER_UMGEBUNGSVARIABLE,
  gehoertAufDenBildschirm,
  holtFensterNachVorn,
  KEIN_FENSTER,
  toastBefehl,
  toastXml,
  TOAST_UMGEBUNGSVARIABLE,
  vordergrundBefehl,
} from './domain/background/Desktopmeldung.js';

/**
 * Der Notification Agent (SPEC-01, Abschnitt 19 bis 22).
 *
 * ```text
 * npm run serve    Oberfläche, HTTP
 * npm run worker   Läufe, Status, Meldungen entstehen
 * npm run agent    Meldungen erscheinen auf dem Bildschirm
 * ```
 *
 * ## Warum ein dritter Prozess
 *
 * „Benachrichtigungen dürfen nicht davon abhängig sein, dass der Unikom-Browser
 * geöffnet ist." Das allein täte der Worker auch. Der eigentliche Grund ist
 * enger: Ein Windows-Dienst läuft in Sitzung 0, und Sitzung 0 hat keinen
 * Bildschirm. Der Worker **kann** keine Blase zeigen, gleich wie er
 * programmiert ist. Also braucht es einen Prozess in der Sitzung des Benutzers,
 * und genau das ist dieser.
 *
 * ## Warum er die Datenbank liest und nicht den Server fragt
 *
 * Er läuft auf demselben Rechner — dafür ist er da. Über HTTP zu fragen hieße,
 * eine Anmeldung ohne Benutzer zu erfinden: ein Dauertoken, das auf der Platte
 * liegt und nie abläuft. Ein Schlüssel mehr für eine Frage, die die Datenbank
 * unmittelbar beantwortet. Dass drei Prozesse in dieselbe SQLite schreiben, ist
 * bereits entschieden (siehe `Prozessrollen`); dieser schreibt am wenigsten von
 * allen — er vermerkt, dass etwas gezeigt wurde.
 *
 * ## Gezeigt ist nicht erledigt
 *
 * Der Agent setzt **gesehen** und niemals **bestätigt**. Eine Blase, die eine
 * Meldung abhaken würde, wäre die zuverlässigste Art, einen Konfliktbestand zu
 * verlieren: Sie erscheint, wenn niemand am Platz ist, und verschwindet nach
 * fünf Sekunden von selbst.
 */
const DATA_DIRECTORY = path.resolve(process.env.UNIKOM_DATA_DIRECTORY ?? 'application-data');
const TENANT_ID = process.env.UNIKOM_TENANT_ID ?? 'default';
const OBERFLAECHE = process.env.UNIKOM_URL ?? 'http://127.0.0.1:8383';

/** Wie oft nachgesehen wird. Zwei Sekunden wären Hektik, eine Minute Trödelei. */
const NACHSEHEN_ALLE_MS = Number.parseInt(process.env.UNIKOM_AGENT_INTERVAL_MS ?? '10000', 10);

/** Woran das Unikom-Fenster erkannt wird — ein Teilstück seines Titels. */
const FENSTER = process.env.UNIKOM_FENSTERTITEL ?? FENSTERTITEL;

/**
 * PowerShell aufrufen und auf das Ende warten.
 *
 * Ein eigener Aufruf und keine Aneinanderreihung: Blase und Vordergrund sind
 * zwei Dinge, die unabhängig voneinander misslingen dürfen. Wer sie in ein
 * Skript legte, verlöre die Blase, sobald kein Fenster offen ist.
 */
function powershell(
  befehl: { datei: string; argumente: string[] },
  umgebung: Record<string, string>
): Promise<number> {
  return new Promise((fertig, misslungen) => {
    const kind = spawn(befehl.datei, befehl.argumente, {
      env: { ...process.env, ...umgebung },
      windowsHide: true,
    });

    let klage = '';

    kind.stderr?.on('data', (teil: Buffer) => {
      klage += teil.toString('utf-8');
    });

    kind.on('error', misslungen);
    kind.on('close', (code) => {
      if (code === 0 || code === KEIN_FENSTER) {
        fertig(code ?? 0);
        return;
      }

      misslungen(new Error(klage.trim() || `PowerShell endete mit Code ${code}`));
    });
  });
}

/**
 * Eine Blase zeigen.
 *
 * Der Text geht als Base64 durch eine Umgebungsvariable — siehe
 * `Desktopmeldung`. Was hier misslingt, wird gemeldet und nicht verschwiegen:
 * Ein Agent, der stumm nichts anzeigt, ist schlimmer als keiner, weil man sich
 * auf ihn verlässt.
 */
async function zeige(meldung: Benachrichtigung): Promise<void> {
  await powershell(toastBefehl(), {
    [TOAST_UMGEBUNGSVARIABLE]: Buffer.from(toastXml(meldung, OBERFLAECHE), 'utf-8').toString('base64'),
    UNIKOM_TOAST_APPID: ANWENDUNGSKENNUNG,
  });
}

/**
 * Das Unikom-Fenster nach vorn holen (SPEC-01, Abschnitt 21).
 *
 * Nur für die beiden dringenden Stufen — bei „Information" steht in der Tabelle
 * ein Nein, und das ist keine Nachlässigkeit: Ein Fenster, das sich vordrängt,
 * während jemand tippt, ist eine Zumutung.
 *
 * **Nach der Blase und nicht davor.** Die Blase ist der Teil, der immer
 * gelingt; sie erst zu zeigen, nachdem ein Fenster gefunden wurde, hieße, sie
 * bei einem geschlossenen Browser zu verlieren.
 */
async function nachVorn(): Promise<boolean> {
  return (await powershell(vordergrundBefehl(), { [FENSTER_UMGEBUNGSVARIABLE]: FENSTER })) === 0;
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error('Unikom Agent — Desktop-Benachrichtigungen gibt es nur unter Windows. Der Agent beendet sich.');
    process.exit(0);
  }

  const application = createPersistentApplication(DATA_DIRECTORY, { logger: undefined });
  const hintergrund = application.backgroundService;

  console.log(`Unikom Agent — läuft in der Sitzung von ${process.env.USERNAME ?? 'unbekannt'} (PID ${process.pid})`);
  console.log(`Unikom Agent — Daten in ${DATA_DIRECTORY}, Oberfläche ${OBERFLAECHE}`);

  /*
   * Beim Start das Offene noch einmal — auch, was schon gesehen wurde.
   *
   * „Beim nächsten Start des Notification Agents können offene kritische
   * Meldungen erneut angezeigt werden" (SPEC-01, Abschnitt 22). Genau dafür ist
   * der Unterschied zwischen gesehen und bestätigt da: Wer nach einem Neustart
   * an den Rechner kommt, soll sehen, was in der Nacht liegen geblieben ist.
   */
  const nachzuholen = await hintergrund.nachzuholen(TENANT_ID);

  if (nachzuholen.length > 0) {
    console.log(`Unikom Agent — ${nachzuholen.length} offene Meldung(en) vom letzten Mal`);
  }

  const gezeigt = new Set<string>();

  const zeigeAlle = async (meldungen: readonly Benachrichtigung[]): Promise<void> => {
    for (const meldung of meldungen) {
      gezeigt.add(meldung.id);

      try {
        await zeige(meldung);
        await hintergrund.gesehen(meldung.id);

        /*
         * Und dann das Fenster. Findet sich keines, geschieht nichts — der
         * Agent öffnet ausdrücklich keinen Browser: Er liefe sonst nachts um
         * drei auf einem Rechner, an dem niemand sitzt.
         */
        if (holtFensterNachVorn(meldung) && !(await nachVorn())) {
          console.log(`Unikom Agent — kein Fenster „${FENSTER}" offen, nur die Blase gezeigt`);
        }
      } catch (fehler) {
        console.error(
          `Unikom Agent — „${meldung.titel}" ließ sich nicht anzeigen:`,
          fehler instanceof Error ? fehler.message : fehler
        );
      }
    }
  };

  await zeigeAlle(nachzuholen);

  const nachsehen = async (): Promise<void> => {
    try {
      const offene = await hintergrund.offene(TENANT_ID);

      /*
       * Frisch heißt: noch nicht gesehen. Die bereits gesehenen wieder zu
       * zeigen, ergäbe alle zehn Sekunden dieselbe Blase — und danach klickt
       * niemand mehr eine an.
       */
      await zeigeAlle(
        offene.filter(
          (meldung) => gehoertAufDenBildschirm(meldung) && !meldung.gesehen && !gezeigt.has(meldung.id)
        )
      );
    } catch (fehler) {
      console.error('Unikom Agent — Nachsehen misslungen:', fehler instanceof Error ? fehler.message : fehler);
    }
  };

  await nachsehen();

  const takt = setInterval(() => void nachsehen(), NACHSEHEN_ALLE_MS);

  const verabschieden = (signal: string): void => {
    console.log(`Unikom Agent — ${signal}, beende mich`);
    clearInterval(takt);
    application.close?.();
    process.exit(0);
  };

  process.on('SIGINT', () => verabschieden('SIGINT'));
  process.on('SIGTERM', () => verabschieden('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Unikom Agent konnte nicht starten:', error instanceof Error ? error.message : error);
  process.exit(1);
});
