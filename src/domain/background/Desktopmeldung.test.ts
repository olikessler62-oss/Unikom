import assert from 'node:assert/strict';
import test from 'node:test';

import type { Benachrichtigung } from './Benachrichtigung.js';
import {
  ANWENDUNGSKENNUNG,
  FENSTER_UMGEBUNGSVARIABLE,
  gehoertAufDenBildschirm,
  holtFensterNachVorn,
  KEIN_FENSTER,
  maskiere,
  toastBefehl,
  toastXml,
  TOAST_UMGEBUNGSVARIABLE,
  vordergrundBefehl,
  zielAdresse,
} from './Desktopmeldung.js';

function meldung(teile: Partial<Benachrichtigung> = {}): Benachrichtigung {
  return {
    id: 'm1',
    tenantId: 'default',
    anlass: 'KONFLIKTE_ENTSTANDEN',
    stufe: 'AKTION_ERFORDERLICH',
    titel: '17 Konfliktdatensätze',
    text: 'Sie müssen bearbeitet werden.',
    entstanden: '2026-08-20T12:00:00.000Z',
    ...teile,
  };
}

/* ---------- Wer auf den Bildschirm darf ---------- */

test('ein Erfolg erscheint nicht als Blase', () => {
  /*
   * „Eine erfolgreiche Verarbeitung meldet sich im Benachrichtigungscenter und
   * sonst nirgends." Wer jeden Erfolg als Blase bekommt, klickt auch das
   * Konfliktfenster weg, ohne es gelesen zu haben.
   */
  assert.equal(gehoertAufDenBildschirm({ stufe: 'INFORMATION' }), false);
});

test('was eine Handlung verlangt und was kritisch ist, erscheint', () => {
  assert.equal(gehoertAufDenBildschirm({ stufe: 'AKTION_ERFORDERLICH' }), true);
  assert.equal(gehoertAufDenBildschirm({ stufe: 'KRITISCH' }), true);
});

/* ---------- Der Inhalt ---------- */

test('Titel und Text stehen in der Blase', () => {
  const xml = toastXml(meldung());

  assert.match(xml, /<text>17 Konfliktdatensätze<\/text>/);
  assert.match(xml, /<text>Sie müssen bearbeitet werden\.<\/text>/);
});

test('ein Kaufmanns-Und zerstört das XML nicht', () => {
  /*
   * Ohne Maskierung liest Windows das XML nicht — und dann erscheint keine
   * Blase, ausgerechnet bei dem Kunden, dessen Name ein „&" enthält.
   */
  const xml = toastXml(meldung({ titel: 'Müller & Söhne' }));

  assert.match(xml, /<text>Müller &amp; Söhne<\/text>/);
  assert.equal(xml.includes('& S'), false);
});

test('spitze Klammern im Text erzeugen kein zweites Element', () => {
  const xml = toastXml(meldung({ text: 'Datei <neu>.csv fehlt' }));

  assert.match(xml, /Datei &lt;neu&gt;\.csv fehlt/);
});

test('ein Anführungszeichen im Ziel sprengt das Attribut nicht', () => {
  const xml = toastXml(meldung({ ziel: { art: 'KONFLIKTE', id: 'a"b' } }), 'http://127.0.0.1:8383');

  assert.equal(xml.includes('launch="http://127.0.0.1:8383/#/konflikte/a"b"'), false);
  assert.match(xml, /&quot;|%22/);
});

test('alle fünf Zeichen mit Bedeutung werden maskiert', () => {
  assert.equal(maskiere(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('das Kaufmanns-Und wird zuerst maskiert, sonst maskiert es sich selbst', () => {
  // Andersherum würde aus „<" erst „&lt;" und daraus „&amp;lt;".
  assert.equal(maskiere('<'), '&lt;');
});

/* ---------- Wohin ein Klick führt ---------- */

test('ein Konfliktbestand führt zur Konfliktbearbeitung', () => {
  assert.equal(
    zielAdresse('http://127.0.0.1:8383', { art: 'KONFLIKTE', id: 'TR-7' }),
    'http://127.0.0.1:8383/#/konflikte/TR-7'
  );
});

test('ohne Ziel führt der Klick auf die Startseite', () => {
  // Besser als eine Seite, die es nicht gibt.
  assert.equal(zielAdresse('http://127.0.0.1:8383', undefined), 'http://127.0.0.1:8383');
});

test('ein Schrägstrich zu viel ergibt keine doppelte Adresse', () => {
  assert.equal(
    zielAdresse('http://127.0.0.1:8383/', { art: 'ERGEBNIS', id: 'e1' }),
    'http://127.0.0.1:8383/#/ergebnis/e1'
  );
});

test('ohne Oberflächenadresse trägt die Blase kein Ziel', () => {
  assert.match(toastXml(meldung()), /^<toast>/);
});

/* ---------- Der Befehl ---------- */

test('der Meldungstext steht in keinem Befehlsargument', () => {
  /*
   * In einem Titel steht der Name eines Workflows, und den hat ein Mensch
   * getippt. Stünde er in der Befehlszeile, könnte jeder, der einen Workflow
   * anlegen darf, beliebige Befehle ausführen lassen — ein Anführungszeichen
   * genügt.
   */
  const befehl = toastBefehl();
  const zusammen = befehl.argumente.join(' ');

  assert.equal(zusammen.includes('Konfliktdatensätze'), false);
  assert.match(zusammen, new RegExp(TOAST_UMGEBUNGSVARIABLE));
});

test('der Befehl ist für jede Meldung derselbe', () => {
  // Eine Konstante hat keine Stelle, an der etwas eingesetzt werden könnte.
  assert.deepEqual(toastBefehl(), toastBefehl());

  /*
   * Und sie kann keine bekommen: Eine Meldung entgegenzunehmen wäre der
   * erste Schritt dazu, sie einzusetzen. Diese Zeile schlägt an, sobald
   * jemand der Funktion einen Parameter gibt.
   */
  assert.equal(toastBefehl.length, 0);
});

test('das Skript läuft ohne Profil und ohne Rückfragen', () => {
  // Ein Profil kann alles Mögliche laden; eine Rückfrage hält einen Prozess
  // an, den niemand sieht.
  const argumente = toastBefehl().argumente;

  assert.ok(argumente.includes('-NoProfile'));
  assert.ok(argumente.includes('-NonInteractive'));
});

test('die Blase erscheint unter einer Anwendungskennung', () => {
  /*
   * Windows verlangt eine registrierte Kennung. Ohne sie — oder mit einer
   * erfundenen — läuft das Skript ohne Fehler durch und **zeigt nichts an**.
   * Das ist der schlimmste aller Ausgänge: Der Agent meldet Erfolg, und
   * niemand sieht je eine Meldung.
   */
  const skript = toastBefehl().argumente.join(' ');

  assert.match(skript, /CreateToastNotifier\(\$env:UNIKOM_TOAST_APPID\)/);
  assert.match(ANWENDUNGSKENNUNG, /powershell\.exe$/);
});

/* ---------- Das Fenster nach vorn ---------- */

test('nur die dringenden Stufen holen das Fenster nach vorn', () => {
  /*
   * SPEC-01, Abschnitt 21, letzte Spalte. Ein Fenster, das sich vordrängt,
   * während jemand tippt, ist eine Zumutung — deshalb steht bei „Information‟
   * ein Nein, und deshalb ist diese Zeile die einzige Schranke, die es braucht.
   */
  assert.equal(holtFensterNachVorn({ stufe: 'INFORMATION' }), false);
  assert.equal(holtFensterNachVorn({ stufe: 'AKTION_ERFORDERLICH' }), true);
  assert.equal(holtFensterNachVorn({ stufe: 'KRITISCH' }), true);
});

test('der Fenstertitel geht nicht über die Befehlszeile', () => {
  const skript = vordergrundBefehl().argumente.join(' ');

  assert.match(skript, new RegExp(FENSTER_UMGEBUNGSVARIABLE));
});

test('der Titel wird als Text gesucht und nicht als Suchmuster', () => {
  /*
   * Mit `-like` wäre ein Sternchen im Titel ein Platzhalter — und dann holte
   * der Agent irgendein Fenster nach vorn, nicht das von Unikom.
   */
  const skript = vordergrundBefehl().argumente.join(' ');

  assert.match(skript, /MainWindowTitle\.Contains\(\$titel\)/);
  assert.equal(skript.includes('-like'), false);
});

test('kein offenes Fenster ist kein Fehler, sondern ein eigener Rückgabewert', () => {
  /*
   * Sonst stünde jede Nacht ein Fehler im Protokoll, in der niemand am Rechner
   * saß — und der eine echte Fehler ginge darin unter.
   */
  const skript = vordergrundBefehl().argumente.join(' ');

  assert.match(skript, new RegExp('exit ' + KEIN_FENSTER));
  assert.notEqual(KEIN_FENSTER, 0, 'sonst wäre „kein Fenster‟ dasselbe wie „erledigt‟');
});

test('auch dieser Befehl ist eine Konstante', () => {
  assert.deepEqual(vordergrundBefehl(), vordergrundBefehl());
  assert.equal(vordergrundBefehl.length, 0);
});
