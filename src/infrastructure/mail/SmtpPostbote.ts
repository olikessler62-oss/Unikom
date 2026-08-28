import net from 'node:net';
import tls from 'node:tls';

import type { Postausgang, Postbote, Postsendung } from '../../domain/background/Postausgang.js';

/**
 * SMTP, so viel davon wie nötig.
 *
 * ```text
 * 220  der Server meldet sich
 * EHLO         →  250  was er kann
 * STARTTLS     →  220  ab hier verschlüsselt, EHLO noch einmal
 * AUTH LOGIN   →  235  angemeldet
 * MAIL FROM    →  250
 * RCPT TO      →  250  je Empfänger
 * DATA         →  354  … Text …  CRLF . CRLF  →  250 angenommen
 * QUIT
 * ```
 *
 * Eine Fremdbibliothek wäre der bequemere Weg gewesen. Dagegen sprach, was
 * dieses Erzeugnis verspricht: Es läuft im Haus des Kunden, und jede
 * Abhängigkeit ist eine, die dort mit ihren eigenen Abhängigkeiten
 * eingespielt, geprüft und aktualisiert werden muss. Für sieben Befehle ist das
 * ein schlechtes Geschäft.
 *
 * ## Der Punkt am Zeilenanfang
 *
 * Eine Zeile, die aus einem einzigen Punkt besteht, beendet für den Server die
 * Nachricht. Ein Text, der so eine Zeile enthält, würde also mittendrin
 * abgeschnitten — und der Rest ginge als Unsinn in den Befehlsstrom. Deshalb
 * bekommt jede Zeile, die mit einem Punkt beginnt, einen zweiten davor; der
 * Empfänger entfernt ihn wieder. Das ist keine Feinheit, sondern die älteste
 * Falle des Protokolls.
 */
const ZEILE = String.fromCharCode(13) + String.fromCharCode(10);

export interface Anmeldung {
  benutzer: string;
  kennwort: string;
}

export interface SmtpOptionen {
  /** Wie lange auf eine Antwort gewartet wird, bevor abgebrochen wird. */
  zeitgrenzeMs?: number;
  /** Welchen Namen wir im EHLO nennen. */
  eigenerName?: string;
  /** Zertifikate prüfen. Nur zum Erproben abschaltbar — und dann sichtbar. */
  zertifikatePruefen?: boolean;
}

export const ZEITGRENZE_MS = 30_000;

/**
 * Wer die Anmeldedaten liefert.
 *
 * Der Postbote holt sie sich beim Versand und hält sie nicht: Ein Kennwort, das
 * in einem langlebigen Objekt liegt, steht in jedem Speicherabbild.
 */
export interface Anmeldebuch {
  anmeldung(zugangId: string): Promise<Anmeldung | undefined>;
}

export class SmtpPostbote implements Postbote {
  constructor(
    private readonly anmeldebuch?: Anmeldebuch,
    private readonly optionen: SmtpOptionen = {}
  ) {}

  async sende(sendung: Postsendung, ausgang: Postausgang): Promise<void> {
    const anmeldung = ausgang.zugangId ? await this.anmeldebuch?.anmeldung(ausgang.zugangId) : undefined;

    if (ausgang.zugangId && !anmeldung) {
      throw new Error(
        `Der Postausgang verweist auf den Zugang „${ausgang.zugangId}", den es nicht gibt - es wurde nichts versandt`
      );
    }

    const gespraech = await verbinde(ausgang, this.optionen);

    try {
      await gespraech.fuehre(sendung, ausgang, anmeldung);
    } finally {
      gespraech.schliesse();
    }
  }
}

/**
 * Die Anschrift ohne den Namen davor.
 *
 * Im Kopf der Nachricht steht `Unikom <unikom@example.com>`, im Befehl `MAIL
 * FROM` darf nur die Anschrift stehen. Beides gleichzusetzen ist der Fehler,
 * bei dem ein Server die Nachricht mit „550 syntax error" ablehnt — und die
 * Meldung, die niemand bekommt, ist ausgerechnet die kritische.
 */
export function anschriftAus(eintrag: string): string {
  const links = eintrag.lastIndexOf('<');
  const rechts = eintrag.lastIndexOf('>');

  return links >= 0 && rechts > links ? eintrag.slice(links + 1, rechts).trim() : eintrag.trim();
}

/** Jede Zeile, die mit einem Punkt beginnt, bekommt einen zweiten davor. */
export function punkteVerdoppeln(text: string): string {
  return text
    .split(ZEILE)
    .map((zeile) => (zeile.startsWith('.') ? '.' + zeile : zeile))
    .join(ZEILE);
}

/** Was der Server geantwortet hat — der Code und alles, was dabeistand. */
export interface Antwort {
  code: number;
  text: string;
}

/**
 * Ob eine Antwort vollständig ist.
 *
 * SMTP darf mehrzeilig antworten, und die Fortsetzung erkennt man am
 * Bindestrich hinter dem Code: `250-STARTTLS` geht weiter, `250 OK` ist das
 * Ende. Wer nur auf die erste Zeile hört, schickt seinen nächsten Befehl
 * mitten in die Antwort hinein.
 */
export function istVollstaendig(rohtext: string): boolean {
  const zeilen = rohtext.split(ZEILE).filter((zeile) => zeile !== '');
  const letzte = zeilen[zeilen.length - 1];

  return letzte !== undefined && /^\d{3} /.test(letzte);
}

export function alsAntwort(rohtext: string): Antwort {
  return { code: Number.parseInt(rohtext.slice(0, 3), 10), text: rohtext.trim() };
}

interface Gespraech {
  fuehre(sendung: Postsendung, ausgang: Postausgang, anmeldung?: Anmeldung): Promise<void>;
  schliesse(): void;
}

async function verbinde(ausgang: Postausgang, optionen: SmtpOptionen): Promise<Gespraech> {
  const zeitgrenze = optionen.zeitgrenzeMs ?? ZEITGRENZE_MS;
  const eigenerName = optionen.eigenerName ?? 'unikom.local';

  let leitung: net.Socket =
    ausgang.verschluesselung === 'IMPLIZIT'
      ? tls.connect({
          host: ausgang.host,
          port: ausgang.port,
          rejectUnauthorized: optionen.zertifikatePruefen !== false,
        })
      : net.connect({ host: ausgang.host, port: ausgang.port });

  let puffer = '';
  let warte: ((rohtext: string) => void) | undefined;
  let fehler: ((grund: Error) => void) | undefined;

  const anhaengen = (socket: net.Socket): void => {
    socket.setEncoding('utf-8');
    socket.on('data', (stueck: string) => {
      puffer += stueck;

      if (warte && istVollstaendig(puffer)) {
        const fertig = puffer;

        puffer = '';
        const gewartet = warte;

        warte = undefined;
        gewartet(fertig);
      }
    });
    socket.on('error', (grund) => fehler?.(grund));
  };

  anhaengen(leitung);

  const lies = (): Promise<Antwort> =>
    new Promise((erfuelle, verwirf) => {
      const uhr = setTimeout(
        () => verwirf(new Error(`Der Postausgang ${ausgang.host}:${ausgang.port} antwortet nicht`)),
        zeitgrenze
      );

      fehler = (grund) => {
        clearTimeout(uhr);
        verwirf(grund);
      };

      warte = (rohtext) => {
        clearTimeout(uhr);
        erfuelle(alsAntwort(rohtext));
      };

      // Der Puffer kann die Antwort schon enthalten, wenn der Server schneller
      // war als wir. Ohne diese Zeile wartete das Gespräch auf etwas, das
      // längst da ist.
      if (istVollstaendig(puffer)) {
        const fertig = puffer;

        puffer = '';
        warte = undefined;
        clearTimeout(uhr);
        erfuelle(alsAntwort(fertig));
      }
    });

  const sage = async (befehl: string, erwartet: number[]): Promise<Antwort> => {
    leitung.write(befehl + ZEILE);

    const antwort = await lies();

    if (!erwartet.includes(antwort.code)) {
      throw new Error(`${sichtbar(befehl)} wurde abgelehnt: ${antwort.text}`);
    }

    return antwort;
  };

  await lies();

  return {
    async fuehre(sendung, ausgangDaten, anmeldung) {
      await sage(`EHLO ${eigenerName}`, [250]);

      if (ausgangDaten.verschluesselung === 'STARTTLS') {
        await sage('STARTTLS', [220]);

        leitung = await hochstufen(leitung, ausgangDaten.host, optionen.zertifikatePruefen !== false);
        anhaengen(leitung);
        puffer = '';

        await sage(`EHLO ${eigenerName}`, [250]);
      }

      if (anmeldung) {
        await sage('AUTH LOGIN', [334]);
        await sage(Buffer.from(anmeldung.benutzer, 'utf-8').toString('base64'), [334]);
        await sage(Buffer.from(anmeldung.kennwort, 'utf-8').toString('base64'), [235]);
      }

      await sage(`MAIL FROM:<${anschriftAus(sendung.absender)}>`, [250]);

      for (const empfaenger of sendung.an) {
        await sage(`RCPT TO:<${anschriftAus(empfaenger)}>`, [250, 251]);
      }

      await sage('DATA', [354]);
      await sage(punkteVerdoppeln(sendung.roh) + ZEILE + '.', [250]);

      /*
       * `QUIT` mit Absicht ohne Prüfung: Angenommen ist die Nachricht mit der
       * 250 auf DATA. Ein Server, der danach die Verbindung hart schließt,
       * hätte sonst einen erfolgreichen Versand zu einem Fehler gemacht — und
       * beim nächsten Lauf käme dieselbe Meldung ein zweites Mal.
       */
      try {
        leitung.write('QUIT' + ZEILE);
      } catch {
        // Siehe oben.
      }
    },
    schliesse() {
      /*
       * Erst das Ende ankündigen, dann abräumen. Ein hart abgerissener Socket
       * lässt beim Gegenüber einen Verbindungsfehler zurück — und in dessen
       * Protokoll steht dann eine abgebrochene Zustellung, obwohl die Nachricht
       * angenommen war.
       */
      leitung.end();
      leitung.destroy();
    },
  };
}

function hochstufen(leitung: net.Socket, host: string, pruefen: boolean): Promise<net.Socket> {
  return new Promise((erfuelle, verwirf) => {
    const sicher = tls.connect({ socket: leitung, servername: host, rejectUnauthorized: pruefen }, () =>
      erfuelle(sicher)
    );

    sicher.once('error', verwirf);
  });
}

/**
 * Was von einem Befehl im Protokoll stehen darf.
 *
 * Nach `AUTH LOGIN` sind die nächsten beiden Zeilen Benutzer und Kennwort in
 * Base64 — also lesbar für jeden, der die Zeile findet. Ins Protokoll gehört
 * davon nichts.
 */
function sichtbar(befehl: string): string {
  return /^(EHLO|STARTTLS|AUTH|MAIL|RCPT|DATA|QUIT)/.test(befehl) ? befehl.split(' ')[0] : 'Die Übergabe';
}
