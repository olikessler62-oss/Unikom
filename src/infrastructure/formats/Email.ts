/**
 * Eine E-Mail in ihre Teile zerlegen (FR_007, Abschnitt 11 und 12).
 *
 * Zerlegt wird hier, geholt wird anderswo: Ob die Nachricht über IMAP kommt,
 * aus einer .eml-Datei oder aus einem Postfach, das jemand exportiert hat, ist
 * für die Erkennung gleichgültig. Genau das verlangt die Spec — keine zweite
 * Erkennungslogik für E-Mails, sondern derselbe Weg über denselben Inhalt.
 *
 * Umgesetzt ist so viel von MIME, wie eine Bestellung braucht: Kopfzeilen mit
 * Faltung und kodierten Wörtern, mehrteilige Nachrichten, Base64 und
 * Quoted-Printable, Anhänge mit ihrem Namen.
 */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface EmailMessage {
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  /** Der Text der Nachricht. Bei mehreren Teilen der reine Text, nicht HTML. */
  body: string;
  attachments: EmailAttachment[];
  notes: string[];
}

export function parseEmail(roh: Buffer | string): EmailMessage {
  const bytes = typeof roh === 'string' ? Buffer.from(roh, 'utf-8') : roh;
  const notes: string[] = [];
  const { headers, body } = trenne(bytes);

  const nachricht: EmailMessage = {
    from: kopf(headers, 'from'),
    to: kopf(headers, 'to'),
    subject: kopf(headers, 'subject'),
    date: kopf(headers, 'date'),
    body: '',
    attachments: [],
    notes,
  };

  sammle(headers, body, nachricht, notes);

  return nachricht;
}

/** Kopf und Rumpf trennen — die erste Leerzeile scheidet sie. */
function trenne(bytes: Buffer): { headers: Map<string, string>; body: Buffer } {
  const grenze = grenzeSuchen(bytes);
  const kopfteil = bytes.subarray(0, grenze.ende).toString('utf-8');

  return { headers: leseKopfzeilen(kopfteil), body: bytes.subarray(grenze.beginn) };
}

function grenzeSuchen(bytes: Buffer): { ende: number; beginn: number } {
  const doppelt = bytes.indexOf('\r\n\r\n');

  if (doppelt >= 0) {
    return { ende: doppelt, beginn: doppelt + 4 };
  }

  const einfach = bytes.indexOf('\n\n');

  return einfach >= 0 ? { ende: einfach, beginn: einfach + 2 } : { ende: bytes.length, beginn: bytes.length };
}

/**
 * Kopfzeilen lesen, samt Faltung: Eine lange Zeile darf umgebrochen werden,
 * und die Fortsetzung beginnt mit einem Leerzeichen.
 */
function leseKopfzeilen(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  let name: string | undefined;
  let wert = '';

  const ablegen = (): void => {
    if (name) {
      headers.set(name.toLowerCase(), wert.trim());
    }
  };

  for (const zeile of text.split(/\r\n|\n/)) {
    if (/^[ \t]/.test(zeile) && name) {
      wert += ` ${zeile.trim()}`;
      continue;
    }

    const doppelpunkt = zeile.indexOf(':');

    if (doppelpunkt <= 0) {
      continue;
    }

    ablegen();
    name = zeile.slice(0, doppelpunkt).trim();
    wert = zeile.slice(doppelpunkt + 1);
  }

  ablegen();

  return headers;
}

function kopf(headers: Map<string, string>, name: string): string | undefined {
  const wert = headers.get(name);

  return wert === undefined ? undefined : entschluesselteWoerter(wert);
}

/**
 * Kodierte Wörter im Kopf: `=?UTF-8?Q?Bestellung_M=C3=BCller?=`
 *
 * Ohne diese Behandlung steht im Betreff einer deutschen Bestellung
 * Buchstabensalat — und der Betreff ist oft das Einzige, woran ein Mensch die
 * Nachricht wiedererkennt.
 */
function entschluesselteWoerter(text: string): string {
  return text.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (ganz, zeichensatz: string, art: string, inhalt: string) => {
    try {
      const bytes =
        art.toUpperCase() === 'B'
          ? Buffer.from(inhalt, 'base64')
          : quotedPrintable(inhalt.replace(/_/g, ' '));

      return new TextDecoder(zeichensatz.toLowerCase()).decode(bytes);
    } catch {
      return ganz;
    }
  });
}

function quotedPrintable(text: string): Buffer {
  const ohneUmbruch = text.replace(/=\r?\n/g, '');
  const bytes: number[] = [];

  for (let stelle = 0; stelle < ohneUmbruch.length; stelle += 1) {
    const zeichen = ohneUmbruch[stelle];

    if (zeichen === '=' && stelle + 2 < ohneUmbruch.length) {
      const wert = Number.parseInt(ohneUmbruch.slice(stelle + 1, stelle + 3), 16);

      if (Number.isFinite(wert)) {
        bytes.push(wert);
        stelle += 2;
        continue;
      }
    }

    bytes.push(...Buffer.from(zeichen, 'binary'));
  }

  return Buffer.from(bytes);
}

function parameter(wert: string | undefined, name: string): string | undefined {
  if (!wert) {
    return undefined;
  }

  const treffer = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*([^;\\s]+)`, 'i').exec(wert);

  return treffer ? entschluesselteWoerter(treffer[1] ?? treffer[2]) : undefined;
}

/**
 * Den Rumpf einsammeln — bei mehrteiligen Nachrichten Teil für Teil.
 *
 * Genommen wird der erste Textteil als Rumpf; alles mit Dateinamen wird
 * Anhang. HTML-Teile bleiben liegen: Aus ihnen ließe sich Text gewinnen, aber
 * schlecht, und daneben steht fast immer derselbe Inhalt als reiner Text.
 */
function sammle(headers: Map<string, string>, body: Buffer, nachricht: EmailMessage, notes: string[]): void {
  const contentType = headers.get('content-type') ?? 'text/plain';
  const grenze = parameter(contentType, 'boundary');

  if (!grenze) {
    const inhalt = dekodiere(body, headers);

    if (parameter(headers.get('content-disposition'), 'filename') ?? parameter(contentType, 'name')) {
      nachricht.attachments.push({
        filename:
          parameter(headers.get('content-disposition'), 'filename') ?? parameter(contentType, 'name') ?? 'anhang',
        contentType: contentType.split(';')[0].trim(),
        content: inhalt,
      });
      return;
    }

    if (/^text\/html/i.test(contentType)) {
      notes.push('Die Nachricht enthält nur HTML; daraus wird kein Text gelesen');
      return;
    }

    nachricht.body = inhalt.toString('utf-8');
    return;
  }

  for (const teil of teile(body, grenze)) {
    const { headers: teilKopf, body: teilRumpf } = trenne(teil);
    const teilTyp = teilKopf.get('content-type') ?? 'text/plain';
    const name = parameter(teilKopf.get('content-disposition'), 'filename') ?? parameter(teilTyp, 'name');

    if (name) {
      nachricht.attachments.push({
        filename: name,
        contentType: teilTyp.split(';')[0].trim(),
        content: dekodiere(teilRumpf, teilKopf),
      });
      continue;
    }

    if (parameter(teilTyp, 'boundary')) {
      // Verschachtelte Teile, wie sie entstehen, wenn Text und Anhang noch
      // einmal zusammengefasst sind.
      sammle(teilKopf, teilRumpf, nachricht, notes);
      continue;
    }

    if (/^text\/plain/i.test(teilTyp) && nachricht.body === '') {
      nachricht.body = dekodiere(teilRumpf, teilKopf).toString('utf-8');
    } else if (/^text\/html/i.test(teilTyp) && nachricht.body === '') {
      notes.push('Es gibt nur einen HTML-Teil; daraus wird kein Text gelesen');
    }
  }
}

function teile(body: Buffer, grenze: string): Buffer[] {
  const text = body.toString('binary');
  const marke = `--${grenze}`;
  const stuecke: Buffer[] = [];
  let stelle = text.indexOf(marke);

  while (stelle >= 0) {
    const beginn = stelle + marke.length;

    if (text.startsWith('--', beginn)) {
      break;
    }

    const naechste = text.indexOf(marke, beginn);
    const ende = naechste < 0 ? text.length : naechste;

    stuecke.push(Buffer.from(text.slice(beginn, ende).replace(/^\r?\n/, ''), 'binary'));

    if (naechste < 0) {
      break;
    }

    stelle = naechste;
  }

  return stuecke;
}

function dekodiere(body: Buffer, headers: Map<string, string>): Buffer {
  const art = (headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase();
  const zeichensatz = parameter(headers.get('content-type'), 'charset');

  const roh =
    art === 'base64'
      ? Buffer.from(body.toString('binary').replace(/\s+/g, ''), 'base64')
      : art === 'quoted-printable'
        ? quotedPrintable(body.toString('binary'))
        : body;

  if (!zeichensatz || /utf-?8/i.test(zeichensatz)) {
    return roh;
  }

  try {
    return Buffer.from(new TextDecoder(zeichensatz.toLowerCase()).decode(roh), 'utf-8');
  } catch {
    return roh;
  }
}
