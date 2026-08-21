import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { alsNachricht, type Postausgang } from '../../domain/background/Postausgang.js';
import { anschriftAus, istVollstaendig, punkteVerdoppeln, SmtpPostbote } from './SmtpPostbote.js';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const ZEILE = CR + LF;

/* ---------- Das Kleingedruckte ---------- */

test('die Anschrift wird aus dem Absenderfeld geschält', () => {
  /*
   * Im Kopf steht der Name, im Befehl darf er nicht stehen. Ein Server lehnt
   * das sonst mit „550 syntax error" ab — und die Meldung, die dann niemand
   * bekommt, ist ausgerechnet die kritische.
   */
  assert.equal(anschriftAus('Unikom <unikom@example.com>'), 'unikom@example.com');
  assert.equal(anschriftAus('unikom@example.com'), 'unikom@example.com');
  assert.equal(anschriftAus('  unikom@example.com  '), 'unikom@example.com');
});

test('eine Zeile aus einem Punkt beendet die Nachricht nicht', () => {
  // Die älteste Falle des Protokolls: Der Rest ginge als Unsinn in den
  // Befehlsstrom.
  const text = ['Zeile eins', '.', 'Zeile zwei'].join(ZEILE);

  assert.equal(punkteVerdoppeln(text), ['Zeile eins', '..', 'Zeile zwei'].join(ZEILE));
});

test('auch ein Punkt am Anfang einer sonst gefüllten Zeile wird verdoppelt', () => {
  assert.equal(punkteVerdoppeln('.gitignore steht dort'), '..gitignore steht dort');
});

test('ein Punkt in der Mitte bleibt, was er ist', () => {
  assert.equal(punkteVerdoppeln('Datei a.csv gelesen'), 'Datei a.csv gelesen');
});

test('eine mehrzeilige Antwort gilt erst mit ihrer letzten Zeile als fertig', () => {
  /*
   * `250-STARTTLS` geht weiter, `250 OK` ist das Ende. Wer nur auf die erste
   * Zeile hört, schickt seinen nächsten Befehl mitten in die Antwort hinein.
   */
  assert.equal(istVollstaendig('250-example.com' + ZEILE), false);
  assert.equal(istVollstaendig('250-example.com' + ZEILE + '250-STARTTLS' + ZEILE), false);
  assert.equal(istVollstaendig('250-example.com' + ZEILE + '250 STARTTLS' + ZEILE), true);
});

/* ---------- Ein Postfach, das mitschreibt ---------- */

interface Postfach {
  port: number;
  gespraech: string[];
  nachrichten: string[];
  schliesse(): Promise<void>;
}

async function postfach(optionen: { verlangtAnmeldung?: boolean; lehntAb?: string } = {}): Promise<Postfach> {
  const gespraech: string[] = [];
  const nachrichten: string[] = [];

  const server = net.createServer((leitung) => {
    let puffer = '';
    let imText = false;
    let text = '';

    leitung.setEncoding('utf-8');
    // Ein echter Server hat einen; ohne ihn wirft Node beim Verbindungsabbruch.
    leitung.on('error', () => undefined);
    leitung.write('220 postfach.test bereit' + ZEILE);

    leitung.on('data', (stueck: string) => {
      puffer += stueck;

      let umbruch = puffer.indexOf(ZEILE);

      while (umbruch >= 0) {
        const zeile = puffer.slice(0, umbruch);

        puffer = puffer.slice(umbruch + 2);

        if (imText) {
          if (zeile === '.') {
            imText = false;
            nachrichten.push(text);
            text = '';
            leitung.write('250 angenommen' + ZEILE);
          } else {
            // Was der Absender verdoppelt hat, nimmt der Empfänger wieder
            // auseinander — so steht es in RFC 5321, und nur deshalb ist die
            // Verdopplung überhaupt unschädlich.
            const entpackt = zeile.startsWith('.') ? zeile.slice(1) : zeile;

            text += (text === '' ? '' : ZEILE) + entpackt;
          }
        } else {
          gespraech.push(zeile);
          antworte(zeile);
        }

        umbruch = puffer.indexOf(ZEILE);
      }
    });

    let angemeldet = 0;

    function antworte(zeile: string): void {
      if (zeile.startsWith('EHLO')) {
        // Mehrzeilig, wie es echte Server tun.
        leitung.write('250-postfach.test' + ZEILE + '250-AUTH LOGIN' + ZEILE + '250 OK' + ZEILE);
        return;
      }

      if (zeile.startsWith('AUTH LOGIN')) {
        angemeldet = 1;
        leitung.write('334 VXNlcm5hbWU6' + ZEILE);
        return;
      }

      if (angemeldet > 0 && !/^(MAIL|RCPT|DATA|QUIT)/.test(zeile)) {
        angemeldet += 1;
        leitung.write(angemeldet === 2 ? '334 UGFzc3dvcmQ6' + ZEILE : '235 angemeldet' + ZEILE);
        return;
      }

      if (zeile.startsWith('MAIL FROM')) {
        leitung.write(
          optionen.verlangtAnmeldung && angemeldet < 3
            ? '530 Authentifizierung nötig' + ZEILE
            : '250 ok' + ZEILE
        );
        return;
      }

      if (zeile.startsWith('RCPT TO')) {
        leitung.write(
          optionen.lehntAb && zeile.includes(optionen.lehntAb)
            ? '550 unbekannter Empfänger' + ZEILE
            : '250 ok' + ZEILE
        );
        return;
      }

      if (zeile.startsWith('DATA')) {
        imText = true;
        leitung.write('354 los' + ZEILE);
        return;
      }

      if (zeile.startsWith('QUIT')) {
        leitung.write('221 tschüss' + ZEILE);
        leitung.end();
      }
    }
  });

  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));

  const adresse = server.address() as net.AddressInfo;

  return {
    port: adresse.port,
    gespraech,
    nachrichten,
    schliesse: () => new Promise<void>((fertig) => server.close(() => fertig())),
  };
}

function ausgang(port: number, zugangId?: string): Postausgang {
  return { host: '127.0.0.1', port, verschluesselung: 'KEINE', absender: 'Unikom <unikom@example.com>', zugangId };
}

const MELDUNG = {
  titel: 'Verarbeitung unerwartet beendet',
  text: 'Der Lauf steht auf RUNNING, aber kein Prozess meldet sich mehr dafür.',
  stufe: 'KRITISCH' as const,
  entstanden: '2026-08-20T12:00:00.000Z',
};

/* ---------- Der Versand ---------- */

test('eine Meldung geht als vollständige Nachricht hinaus', async () => {
  const fach = await postfach();

  try {
    const sendung = alsNachricht(MELDUNG, 'Unikom <unikom@example.com>', ['anna@example.com'], 'm1@unikom');

    await new SmtpPostbote().sende(sendung, ausgang(fach.port));

    assert.deepEqual(
      fach.gespraech.filter((zeile) => /^(MAIL|RCPT|DATA)/.test(zeile)),
      ['MAIL FROM:<unikom@example.com>', 'RCPT TO:<anna@example.com>', 'DATA']
    );

    assert.equal(fach.nachrichten.length, 1);
    assert.match(fach.nachrichten[0], /^From: Unikom <unikom@example.com>/);
    assert.match(fach.nachrichten[0], /Content-Transfer-Encoding: base64/);
  } finally {
    await fach.schliesse();
  }
});

test('der Rumpf kommt unverändert an — Umlaute inbegriffen', async () => {
  const fach = await postfach();

  try {
    await new SmtpPostbote().sende(
      alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom'),
      ausgang(fach.port)
    );

    const [kopf, koerper] = fach.nachrichten[0].split(ZEILE + ZEILE);
    const rumpf = Buffer.from(koerper.split(ZEILE).join(''), 'base64').toString('utf-8');

    assert.match(kopf, /Subject: /);
    assert.match(rumpf, /kein Prozess meldet sich mehr dafür/);
    assert.match(rumpf, /Stufe: Kritisches Ereignis/);
  } finally {
    await fach.schliesse();
  }
});

test('mehrere Empfänger bekommen je ein RCPT', async () => {
  const fach = await postfach();

  try {
    await new SmtpPostbote().sende(
      alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com', 'bert@example.com'], 'm1@unikom'),
      ausgang(fach.port)
    );

    assert.deepEqual(
      fach.gespraech.filter((zeile) => zeile.startsWith('RCPT')),
      ['RCPT TO:<anna@example.com>', 'RCPT TO:<bert@example.com>']
    );
  } finally {
    await fach.schliesse();
  }
});

test('die Anmeldung läuft über AUTH LOGIN', async () => {
  const fach = await postfach({ verlangtAnmeldung: true });

  try {
    const postbote = new SmtpPostbote({
      anmeldung: async () => ({ benutzer: 'unikom', kennwort: 'geheim' }),
    });

    await postbote.sende(
      alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom'),
      ausgang(fach.port, 'zugang-1')
    );

    assert.ok(fach.gespraech.includes('AUTH LOGIN'), fach.gespraech.join(' | '));
    assert.ok(fach.gespraech.includes(Buffer.from('geheim').toString('base64')));
    assert.equal(fach.nachrichten.length, 1);
  } finally {
    await fach.schliesse();
  }
});

test('ein Postausgang, dessen Zugang fehlt, versendet nichts — und sagt warum', async () => {
  /*
   * Ohne Anmeldung weiterzumachen wäre der schlechtere Weg: Der Server lehnte
   * ab, und in der Meldung stünde „530" statt des eigentlichen Grundes.
   */
  const fach = await postfach();

  try {
    const postbote = new SmtpPostbote({ anmeldung: async () => undefined });

    await assert.rejects(
      postbote.sende(
        alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom'),
        ausgang(fach.port, 'geloescht')
      ),
      /Zugang „geloescht"/
    );

    assert.deepEqual(fach.nachrichten, []);
  } finally {
    await fach.schliesse();
  }
});

test('ein abgelehnter Empfänger wird gemeldet und nicht verschwiegen', async () => {
  const fach = await postfach({ lehntAb: 'unbekannt@example.com' });

  try {
    await assert.rejects(
      new SmtpPostbote().sende(
        alsNachricht(MELDUNG, 'unikom@example.com', ['unbekannt@example.com'], 'm1@unikom'),
        ausgang(fach.port)
      ),
      /550/
    );
  } finally {
    await fach.schliesse();
  }
});

test('ein Punkt allein in einer Zeile kommt als Punkt an', async () => {
  /*
   * Der Rumpf geht als Base64 hinaus, sodass so eine Zeile dort gar nicht
   * entstehen kann — aber der Schutz muss auch dann greifen, wenn jemand
   * später eine Nachricht ohne Kodierung schickt.
   */
  const fach = await postfach();

  try {
    const roh = ['Subject: Test', '', 'oben', '.', 'unten'].join(ZEILE);

    await new SmtpPostbote().sende(
      { an: ['anna@example.com'], absender: 'unikom@example.com', betreff: 'Test', roh },
      ausgang(fach.port)
    );

    assert.equal(fach.nachrichten[0], roh);
  } finally {
    await fach.schliesse();
  }
});

test('ein Postausgang, den es nicht gibt, endet in einem Fehler statt in einer Wartezeit', async () => {
  const postbote = new SmtpPostbote(undefined, { zeitgrenzeMs: 1000 });

  await assert.rejects(
    postbote.sende(
      alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom'),
      { host: '127.0.0.1', port: 1, verschluesselung: 'KEINE', absender: 'unikom@example.com' }
    )
  );
});

test('ein abgelehntes Kennwort taucht in der Fehlermeldung nicht auf', async () => {
  /*
   * Nach `AUTH LOGIN` sind die nächsten beiden Zeilen Benutzer und Kennwort in
   * Base64 — also lesbar für jeden, der die Zeile findet. Diese Fehlermeldung
   * geht ins Protokoll, und Protokolle werden ausgeleitet und mit Kunden
   * geteilt. Was einmal darin steht, ist nicht wieder einzusammeln.
   */
  const fach = await postfachMitFalscherAnmeldung();

  try {
    const postbote = new SmtpPostbote({
      anmeldung: async () => ({ benutzer: 'unikom', kennwort: 'sehr-geheim' }),
    });

    await assert.rejects(
      postbote.sende(
        alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom'),
        ausgang(fach.port, 'zugang-1')
      ),
      (fehler: Error) => {
        assert.equal(fehler.message.includes('sehr-geheim'), false, fehler.message);
        assert.equal(
          fehler.message.includes(Buffer.from('sehr-geheim').toString('base64')),
          false,
          fehler.message
        );
        assert.match(fehler.message, /535/);

        return true;
      }
    );
  } finally {
    await fach.schliesse();
  }
});

/** Ein Postfach, das jede Anmeldung ablehnt. */
async function postfachMitFalscherAnmeldung(): Promise<Postfach> {
  const gespraech: string[] = [];

  const server = net.createServer((leitung) => {
    let puffer = '';
    let schritte = 0;

    leitung.setEncoding('utf-8');
    leitung.on('error', () => undefined);
    leitung.write('220 postfach.test bereit' + ZEILE);

    leitung.on('data', (stueck: string) => {
      puffer += stueck;

      let umbruch = puffer.indexOf(ZEILE);

      while (umbruch >= 0) {
        const zeile = puffer.slice(0, umbruch);

        puffer = puffer.slice(umbruch + 2);
        gespraech.push(zeile);

        if (zeile.startsWith('EHLO')) {
          leitung.write('250 OK' + ZEILE);
        } else if (zeile.startsWith('AUTH LOGIN')) {
          schritte = 1;
          leitung.write('334 VXNlcm5hbWU6' + ZEILE);
        } else if (schritte === 1) {
          schritte = 2;
          leitung.write('334 UGFzc3dvcmQ6' + ZEILE);
        } else {
          leitung.write('535 Anmeldung abgelehnt' + ZEILE);
        }

        umbruch = puffer.indexOf(ZEILE);
      }
    });
  });

  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));

  const adresse = server.address() as net.AddressInfo;

  return {
    port: adresse.port,
    gespraech,
    nachrichten: [],
    schliesse: () => new Promise<void>((fertig) => server.close(() => fertig())),
  };
}
