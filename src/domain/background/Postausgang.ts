import { KANAELE, type Benachrichtigung, type Meldestufe } from './Benachrichtigung.js';

/**
 * Die Meldung als E-Mail (SPEC-01, Abschnitt 20 und 21).
 *
 * ```text
 * Information           optional   „kann eingeschaltet werden"
 * Aktion erforderlich   ja
 * Kritisches Ereignis   ja
 * ```
 *
 * Die erste Zeile ist der ganze Unterschied zu den übrigen Kanälen: Eine
 * erfolgreiche Verarbeitung geht **nicht** hinaus, außer jemand hat es
 * ausdrücklich verlangt — „etwa für einen Lauf, den niemand beobachtet". Wer
 * jede Nacht eine Erfolgsmeldung bekommt, richtet sich eine Regel im
 * Posteingang ein, und danach sieht er auch die kritische nicht mehr.
 *
 * ## Warum die Einstellung am Mandanten hängt
 *
 * Empfänger sind je Kunde verschieden, und bei einem Dienstleister ist es auch
 * der Postausgang: Der eine will seine Meldungen über seinen eigenen Server
 * versenden, weil sein Spamfilter nur den kennt. An der Installation stünde
 * eine Anschrift, die für alle gilt — und für niemanden stimmt.
 *
 * ## Das Kennwort steht nicht hier
 *
 * `zugangId` verweist auf einen hinterlegten Zugang. Ein Kennwort im Klartext
 * in den Einstellungen wäre über jede Sicherung, jede Ausleitung und jede
 * Fehlermeldung mitgereist.
 */
export interface Postausgang {
  host: string;
  port: number;
  /** STARTTLS auf dem gewöhnlichen Port; `IMPLIZIT` heißt TLS ab dem ersten Byte. */
  verschluesselung: 'STARTTLS' | 'IMPLIZIT' | 'KEINE';
  /** Der Zugang mit Benutzer und Kennwort; fehlt er, wird ohne Anmeldung versandt. */
  zugangId?: string;
  /** Was im Absenderfeld steht. */
  absender: string;
}

export interface Meldeeinstellungen {
  empfaenger: readonly string[];
  /**
   * Auch dann schreiben, wenn nichts anliegt (SPEC-01, Abschnitt 21).
   *
   * Ohne dieses Häkchen bleibt die Stufe „Information" im Center und geht nicht
   * hinaus.
   */
  auchBeiErfolg?: boolean;
  postausgang?: Postausgang;
}

/**
 * Ob diese Stufe hinausgeht — und an wen.
 *
 * Eine leere Liste heißt: Es wird nichts versandt. Das ist der Normalfall einer
 * Installation, in der niemand Empfänger eingetragen hat, und er ist kein
 * Fehler.
 */
export function empfaengerFuer(
  stufe: Meldestufe,
  einstellungen: Meldeeinstellungen | undefined
): readonly string[] {
  if (!einstellungen || einstellungen.empfaenger.length === 0 || !einstellungen.postausgang) {
    return [];
  }

  if (KANAELE[stufe].email) {
    return einstellungen.empfaenger;
  }

  return einstellungen.auchBeiErfolg ? einstellungen.empfaenger : [];
}

export interface Postsendung {
  an: readonly string[];
  absender: string;
  betreff: string;
  /** Der fertige Nachrichtentext samt Kopfzeilen — RFC 5322. */
  roh: string;
}

const ZEILE = String.fromCharCode(13) + String.fromCharCode(10);

/**
 * Eine Meldung als vollständige Nachricht.
 *
 * Der Rumpf geht als Base64 hinaus. Das ist nicht Vorsicht um ihrer selbst
 * willen: Ein Umlaut als rohes Byte kommt bei einem Server, der von 7 Bit
 * ausgeht, als Fragezeichen an, und eine überlange Zeile wird umgebrochen —
 * mitten in einem Pfad, den jemand herauskopieren will.
 */
export function alsNachricht(
  meldung: Pick<Benachrichtigung, 'titel' | 'text' | 'stufe' | 'entstanden'>,
  absender: string,
  an: readonly string[],
  kennung: string
): Postsendung {
  const betreff = `[Unikom] ${meldung.titel}`;
  const rumpf = [
    meldung.titel,
    '',
    meldung.text,
    '',
    `Stufe: ${STUFENTEXT[meldung.stufe]}`,
    `Entstanden: ${meldung.entstanden}`,
    '',
    'Diese Nachricht kommt von Unikom. Die Meldung steht auch im Benachrichtigungscenter,',
    'und erledigt ist sie erst, wenn dort jemand sie bestätigt.',
  ].join(ZEILE);

  const koerper = base64Zeilen(new TextEncoder().encode(rumpf));

  const kopf = [
    `From: ${absender}`,
    `To: ${an.join(', ')}`,
    `Subject: ${kodiereKopfzeile(betreff)}`,
    `Date: ${alsRfcDatum(new Date(Date.parse(meldung.entstanden)))}`,
    `Message-ID: <${kennung}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].join(ZEILE);

  return { an, absender, betreff, roh: kopf + ZEILE + ZEILE + koerper };
}

const STUFENTEXT: Record<Meldestufe, string> = {
  INFORMATION: 'Information',
  AKTION_ERFORDERLICH: 'Aktion erforderlich',
  KRITISCH: 'Kritisches Ereignis',
};

/** Base64 in Zeilen zu 76 Zeichen — mehr erlaubt RFC 2045 nicht. */
export function base64Zeilen(bytes: Uint8Array): string {
  const alles = Buffer.from(bytes).toString('base64');
  const zeilen: string[] = [];

  for (let stelle = 0; stelle < alles.length; stelle += 76) {
    zeilen.push(alles.slice(stelle, stelle + 76));
  }

  return zeilen.join(ZEILE);
}

/**
 * Eine Kopfzeile, die Umlaute tragen darf (RFC 2047).
 *
 * Reiner ASCII bleibt, wie er ist — eine kodierte Betreffzeile, die niemand
 * kodieren musste, ist in jedem Postfach schlechter zu durchsuchen.
 *
 * Zerlegt wird **entlang der Zeichen und nicht der Bytes**: Ein Wortstück, das
 * mitten in einem Umlaut endet, ergibt beim Empfänger zwei kaputte Zeichen —
 * und das trifft ausgerechnet die Sprache, für die die Kodierung da ist.
 */
export function kodiereKopfzeile(text: string): string {
  if (!/[^ -~]/.test(text)) {
    return text;
  }

  const woerter: string[] = [];
  let haufen = '';

  for (const zeichen of text) {
    const naechster = haufen + zeichen;

    // 45 Bytes werden zu 60 Base64-Zeichen; mit der Hülle bleibt das
    // kodierte Wort unter den 75 Zeichen, die RFC 2047 zulässt.
    if (new TextEncoder().encode(naechster).length > 45) {
      woerter.push(haufen);
      haufen = zeichen;
      continue;
    }

    haufen = naechster;
  }

  if (haufen !== '') {
    woerter.push(haufen);
  }

  return woerter
    .map((stueck) => `=?UTF-8?B?${Buffer.from(stueck, 'utf-8').toString('base64')}?=`)
    .join(ZEILE + ' ');
}

const TAGE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONATE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Der Zeitpunkt in der Schreibweise, die RFC 5322 verlangt — englisch und in
 * UTC.
 *
 * `toUTCString` läge nahe und ist falsch: Es endet auf „GMT", und die
 * Zeitzonenangabe muss numerisch sein. Manche Postfächer zeigen eine Nachricht
 * mit unlesbarem Datum am 1. Januar 1970 an.
 */
export function alsRfcDatum(zeitpunkt: Date): string {
  const zwei = (wert: number): string => String(wert).padStart(2, '0');

  return (
    `${TAGE[zeitpunkt.getUTCDay()]}, ${zwei(zeitpunkt.getUTCDate())} ${MONATE[zeitpunkt.getUTCMonth()]} ` +
    `${zeitpunkt.getUTCFullYear()} ${zwei(zeitpunkt.getUTCHours())}:${zwei(zeitpunkt.getUTCMinutes())}:` +
    `${zwei(zeitpunkt.getUTCSeconds())} +0000`
  );
}

/**
 * Wer eine Meldung hinausträgt.
 *
 * Als Anschluss, weil der Versand scheitern darf: Ein Postfach, das nicht
 * antwortet, ist kein Grund, eine Verarbeitung anzuhalten — die Meldung steht
 * bereits im Bestand, und dort bleibt sie.
 */
export interface Postbote {
  sende(sendung: Postsendung, ausgang: Postausgang): Promise<void>;
}
