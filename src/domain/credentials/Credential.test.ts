import assert from 'node:assert/strict';
import test from 'node:test';

import { zugangFuerFreigabe } from './Credential.js';

/*
 * Dieselbe Regel steht noch einmal in der Oberfläche
 * (`web/src/screens/job/freigaben.ts`) — bewusst, damit der Server entscheidet
 * und die Oberfläche nur vorschlägt. Hier steht die verbindliche Fassung.
 */

const BS = String.fromCharCode(92);
const UNC = BS + BS;

function zugang(id: string, freigabe?: string): { id: string; freigabe?: string } {
  return { id, freigabe };
}

test('der Zugang der Freigabe wird über den Anfang des Pfades gefunden', () => {
  const zugaenge = [zugang('fremd', UNC + 'SERVER09' + BS + 'Andere'), zugang('richtig', UNC + 'SERVER01' + BS + 'Austausch')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eingang')?.id, 'richtig');
});

test('der genauere Zugang gewinnt', () => {
  /*
   * Einer darf auf der ganzen Freigabe alles, einer nur in einen Unterordner
   * hineinsehen. Gewänne der gröbere, liefe der Nachtlauf mit den weiteren
   * Rechten — beim Lesen nie die richtige Wahl.
   */
  const zugaenge = [
    zugang('breit', UNC + 'SERVER01' + BS + 'Austausch'),
    zugang('eng', UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Fremd'),
  ];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Fremd' + BS + 'Mai')?.id, 'eng');
  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eigen')?.id, 'breit');
});

test('ein Nachbar mit ähnlichem Namen bekommt den Zugang nicht', () => {
  // Verglichen wird an der Grenze eines Gliedes und nicht Zeichen für Zeichen.
  const zugaenge = [zugang('breit', UNC + 'SERVER01' + BS + 'Austausch')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch-alt'), undefined);
});

test('Schreibweise und Trennzeichen sind gleichgültig', () => {
  const zugaenge = [zugang('richtig', '//server01/austausch/')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eingang')?.id, 'richtig');
});

test('ein Zugang ohne Freigabe wird nie von selbst gewählt', () => {
  assert.equal(zugangFuerFreigabe([zugang('ohne')], UNC + 'SERVER01' + BS + 'Austausch'), undefined);
  assert.equal(zugangFuerFreigabe([zugang('leer', '')], UNC + 'SERVER01' + BS + 'Austausch'), undefined);
});

test('ohne Pfad gibt es nichts zu wählen', () => {
  assert.equal(zugangFuerFreigabe([zugang('breit', UNC + 'SERVER01' + BS + 'Austausch')], ''), undefined);
});
