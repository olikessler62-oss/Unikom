import assert from 'node:assert/strict';
import test from 'node:test';

import type { Credential } from '../../api/types.js';
import { zugangFuerFreigabe } from './freigaben.js';

const BS = String.fromCharCode(92);
const UNC = BS + BS;

function zugang(name: string, freigabe?: string): Credential {
  return {
    id: name,
    name,
    type: 'USERNAME_PASSWORD',
    freigabe,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Credential;
}

test('der Zugang der Freigabe wird gefunden', () => {
  const zugaenge = [zugang('fremd', UNC + 'SERVER09' + BS + 'Andere'), zugang('richtig', UNC + 'SERVER01' + BS + 'Austausch')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eingang')?.id, 'richtig');
});

test('der genauere Zugang gewinnt', () => {
  /*
   * Zwei Zugänge auf demselben Server sind der Regelfall: einer, der alles
   * darf, und einer, der nur in einen Unterordner sehen darf. Gewänne der
   * gröbere, liefe der Nachtlauf mit den weiteren Rechten — und das ist beim
   * Lesen nie die richtige Wahl.
   */
  const zugaenge = [
    zugang('breit', UNC + 'SERVER01' + BS + 'Austausch'),
    zugang('eng', UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Fremd'),
  ];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Fremd' + BS + 'Mai')?.id, 'eng');
  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eigen')?.id, 'breit');
});

test('ein Nachbar mit ähnlichem Namen bekommt den Zugang nicht', () => {
  // „…\Austausch" ist kein Anfang von „…\Austausch-alt", auch wenn die Zeichen
  // es nahelegen. Sonst bekäme eine fremde Freigabe den Zugang der benachbarten.
  const zugaenge = [zugang('breit', UNC + 'SERVER01' + BS + 'Austausch')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch-alt'), undefined);
});

test('Schreibweise und Trennzeichen sind gleichgültig', () => {
  // Windows macht dort keinen Unterschied. Ein Zugang, der wegen eines
  // Schrägstrichs nicht gefunden wird, sieht aus wie einer, den es nicht gibt.
  const zugaenge = [zugang('richtig', '//server01/austausch')];

  assert.equal(zugangFuerFreigabe(zugaenge, UNC + 'SERVER01' + BS + 'Austausch' + BS + 'Eingang')?.id, 'richtig');
});

test('ein Zugang ohne Freigabe wird nie von selbst gewählt', () => {
  // Sonst bekäme ein beliebiger Zugang jede Freigabe zugeteilt.
  assert.equal(zugangFuerFreigabe([zugang('ohne')], UNC + 'SERVER01' + BS + 'Austausch'), undefined);
  assert.equal(zugangFuerFreigabe([zugang('leer', '')], UNC + 'SERVER01' + BS + 'Austausch'), undefined);
});

test('ohne Pfad gibt es nichts zu wählen', () => {
  assert.equal(zugangFuerFreigabe([zugang('breit', UNC + 'SERVER01' + BS + 'Austausch')], ''), undefined);
});
