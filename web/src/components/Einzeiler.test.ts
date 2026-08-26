import assert from 'node:assert/strict';
import test from 'node:test';

import { MEHR, alsEineZeile } from './Einzeiler.js';

const UMBRUCH = String.fromCharCode(10);
const WAGEN = String.fromCharCode(13);

test('eine Zeile bleibt, wie sie ist', () => {
  assert.equal(alsEineZeile('Norddeutsche Handels AG'), 'Norddeutsche Handels AG');
});

test('leer bleibt leer', () => {
  // Sonst stünde in einem Feld, in das noch niemand etwas geschrieben hat, ein
  // Zeichen für Verborgenes.
  assert.equal(alsEineZeile(''), '');
});

test('was nach der ersten Zeile steht, wird zu einem Zeichen', () => {
  const memo = ['Norddeutsche Handels AG', 'Ansprechpartner: Frau Ohlsen'].join(UMBRUCH);

  assert.equal(alsEineZeile(memo), `Norddeutsche Handels AG ${MEHR}`);
});

test('auch der Umbruch aus Windows wird erkannt', () => {
  /*
   * Der Text kommt aus einem Memo im Browser, kann aber auch aus einer Datei
   * eingefügt sein — und dort steht unter Windows der Wagenrücklauf davor.
   *
   * Die zweite Zusicherung ist die, an der es hängt: Steht nach dem Umbruch
   * nichts mehr, wird die erste Zeile unverändert zurückgegeben. Gilt nur der
   * Umbruch als Trenner, bleibt der Wagenrücklauf an ihrem Ende hängen — ein
   * Zeichen, das in keinem Text steht und in keiner Anzeige zu sehen ist, aber
   * in jedem Vergleich mitzählt.
   */
  const memo = ['Nordwind GmbH', 'Zahlungsziel 30 Tage'].join(WAGEN + UMBRUCH);

  assert.equal(alsEineZeile(memo), `Nordwind GmbH ${MEHR}`);
  assert.equal(alsEineZeile('Nordwind GmbH' + WAGEN + UMBRUCH), 'Nordwind GmbH');
});

test('ein leerer Nachlauf ist kein Nachlauf', () => {
  const memo = ['Nordwind GmbH', '', '   '].join(UMBRUCH);

  assert.equal(alsEineZeile(memo), 'Nordwind GmbH');
});

test('der Leerraum vor dem Umbruch fällt fort', () => {
  // Sonst hinge die Lücke vor dem Zeichen daran, wie oft jemand vor der
  // Eingabetaste noch die Leertaste getroffen hat.
  const memo = ['Nordwind GmbH   ', 'Zahlungsziel 30 Tage'].join(UMBRUCH);

  assert.equal(alsEineZeile(memo), `Nordwind GmbH ${MEHR}`);
});

test('eine leere erste Zeile steht nicht als Lücke da', () => {
  const memo = ['', 'Der Text fängt erst hier an'].join(UMBRUCH);

  assert.equal(alsEineZeile(memo), MEHR);
});

test('die Punkte sind ein Zeichen und nicht drei', () => {
  /*
   * Der Browser kürzt zu breite Zeilen selbst und setzt dafür das
   * Auslassungszeichen. Stünde daneben die getippte Fassung, hätte dieselbe
   * Aussage in einer Zeile zwei verschiedene Breiten.
   */
  assert.equal(MEHR.length, 1);
});
