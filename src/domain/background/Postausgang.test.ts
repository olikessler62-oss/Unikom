import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alsNachricht,
  alsRfcDatum,
  base64Zeilen,
  empfaengerFuer,
  kodiereKopfzeile,
  type Meldeeinstellungen,
} from './Postausgang.js';

const AUSGANG = {
  host: 'mail.example.com',
  port: 587,
  verschluesselung: 'STARTTLS' as const,
  absender: 'unikom@example.com',
};

function einstellungen(teile: Partial<Meldeeinstellungen> = {}): Meldeeinstellungen {
  return { empfaenger: ['anna@example.com'], postausgang: AUSGANG, ...teile };
}

/* ---------- Wer etwas bekommt ---------- */

test('ein kritisches Ereignis geht hinaus', () => {
  assert.deepEqual(empfaengerFuer('KRITISCH', einstellungen()), ['anna@example.com']);
});

test('eine Aktion, die jemand vornehmen muss, geht hinaus', () => {
  assert.deepEqual(empfaengerFuer('AKTION_ERFORDERLICH', einstellungen()), ['anna@example.com']);
});

test('ein Erfolg bleibt im Center, bis jemand ihn ausdrücklich bestellt', () => {
  /*
   * „Eine E-Mail über den Erfolg kann eingeschaltet werden, etwa für einen
   * Lauf, den niemand beobachtet." Wer sie ungefragt bekäme, richtete sich eine
   * Regel im Posteingang ein — und sähe danach auch die kritische nicht mehr.
   */
  assert.deepEqual(empfaengerFuer('INFORMATION', einstellungen()), []);
  assert.deepEqual(empfaengerFuer('INFORMATION', einstellungen({ auchBeiErfolg: true })), ['anna@example.com']);
});

test('ohne Postausgang wird nichts versandt, auch nicht Kritisches', () => {
  // Ein Empfänger ohne Server ist eine Anschrift ohne Weg dorthin.
  assert.deepEqual(empfaengerFuer('KRITISCH', einstellungen({ postausgang: undefined })), []);
});

test('ohne Empfänger wird nichts versandt', () => {
  assert.deepEqual(empfaengerFuer('KRITISCH', einstellungen({ empfaenger: [] })), []);
});

test('ohne Einstellungen wird nichts versandt', () => {
  // Der Normalfall einer Installation, in der niemand etwas eingetragen hat.
  assert.deepEqual(empfaengerFuer('KRITISCH', undefined), []);
});

/* ---------- Die Nachricht ---------- */

const MELDUNG = {
  titel: 'Verarbeitung unerwartet beendet',
  text: 'Kein Prozess meldet sich mehr für den Lauf.',
  stufe: 'KRITISCH' as const,
  entstanden: '2026-08-20T12:34:56.000Z',
};

test('die Nachricht trägt alle Kopfzeilen, die ein Postfach erwartet', () => {
  const sendung = alsNachricht(MELDUNG, 'Unikom <unikom@example.com>', ['anna@example.com'], 'm1@unikom');

  for (const kopfzeile of ['From:', 'To:', 'Subject:', 'Date:', 'Message-ID:', 'MIME-Version:', 'Content-Type:']) {
    assert.ok(sendung.roh.includes(kopfzeile), `${kopfzeile} fehlt`);
  }
});

test('der Rumpf ist vom Kopf durch eine Leerzeile getrennt', () => {
  // Ohne sie ist alles Kopf, und der Empfänger zeigt eine leere Nachricht.
  const sendung = alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom');
  const trenner = String.fromCharCode(13) + String.fromCharCode(10);

  const [kopf, koerper] = sendung.roh.split(trenner + trenner);

  assert.ok(kopf.includes('Subject:'));
  assert.match(Buffer.from(koerper.split(trenner).join(''), 'base64').toString('utf-8'), /Kein Prozess meldet/);
});

test('der Betreff sagt, worum es geht, und woher es kommt', () => {
  const sendung = alsNachricht(MELDUNG, 'unikom@example.com', ['anna@example.com'], 'm1@unikom');

  assert.equal(sendung.betreff, '[Unikom] Verarbeitung unerwartet beendet');
});

/* ---------- Kopfzeilen mit Umlauten ---------- */

test('reiner ASCII wird nicht kodiert', () => {
  // Eine kodierte Betreffzeile ist in jedem Postfach schlechter zu durchsuchen.
  assert.equal(kodiereKopfzeile('[Unikom] Run finished'), '[Unikom] Run finished');
});

test('ein Umlaut wird kodiert und kommt wieder heraus', () => {
  const kodiert = kodiereKopfzeile('Prüflauf');

  assert.match(kodiert, /^=\?UTF-8\?B\?/);
  assert.equal(Buffer.from(kodiert.slice('=?UTF-8?B?'.length, -'?='.length), 'base64').toString('utf-8'), 'Prüflauf');
});

test('eine lange Kopfzeile wird zerlegt, ohne einen Umlaut zu zerreißen', () => {
  /*
   * Zerlegt wird entlang der Zeichen und nicht der Bytes. Ein Stück, das mitten
   * in einem Umlaut endet, ergibt beim Empfänger zwei kaputte Zeichen — und das
   * trifft ausgerechnet die Sprache, für die die Kodierung da ist.
   */
  const lang = 'Verarbeitung für Müller & Söhne über Nacht abgebrochen — bitte prüfen, ob die Änderungen ankamen';
  const kodiert = kodiereKopfzeile(lang);
  const stuecke = kodiert.split(String.fromCharCode(13) + String.fromCharCode(10) + ' ');

  assert.ok(stuecke.length > 1, 'die Zeile muss zerlegt werden');

  const zusammen = stuecke
    .map((stueck) => Buffer.from(stueck.slice('=?UTF-8?B?'.length, -'?='.length), 'base64').toString('utf-8'))
    .join('');

  assert.equal(zusammen, lang);
});

test('kein kodiertes Wort überschreitet, was RFC 2047 zulässt', () => {
  const kodiert = kodiereKopfzeile('Ä'.repeat(200));

  for (const stueck of kodiert.split(String.fromCharCode(13) + String.fromCharCode(10) + ' ')) {
    assert.ok(stueck.length <= 75, `${stueck.length} Zeichen: ${stueck}`);
  }
});

/* ---------- Format ---------- */

test('das Datum steht in der Schreibweise, die RFC 5322 verlangt', () => {
  /*
   * `toUTCString` läge nahe und endet auf „GMT" — die Zeitzone muss numerisch
   * sein. Manche Postfächer zeigen eine Nachricht mit unlesbarem Datum am
   * 1. Januar 1970 an.
   */
  assert.equal(alsRfcDatum(new Date('2026-08-20T12:34:56.000Z')), 'Thu, 20 Aug 2026 12:34:56 +0000');
  assert.equal(alsRfcDatum(new Date('2026-01-05T00:00:00.000Z')), 'Mon, 05 Jan 2026 00:00:00 +0000');
});

test('keine Base64-Zeile ist länger, als RFC 2045 erlaubt', () => {
  const zeilen = base64Zeilen(new TextEncoder().encode('x'.repeat(1000)));

  for (const zeile of zeilen.split(String.fromCharCode(13) + String.fromCharCode(10))) {
    assert.ok(zeile.length <= 76, `${zeile.length} Zeichen`);
  }
});

test('ein kurzer Rumpf bleibt eine Zeile', () => {
  assert.equal(base64Zeilen(new TextEncoder().encode('kurz')).includes(String.fromCharCode(10)), false);
});
