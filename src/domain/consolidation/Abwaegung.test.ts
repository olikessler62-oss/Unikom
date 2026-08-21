import assert from 'node:assert/strict';
import test from 'node:test';

import { entscheide, wurdeAbgewogen, type Angebot } from './Prioritaet.js';

function angebot(quelle: string, wert: string, geaendert?: string): Angebot {
  return { quelle, wert, stand: geaendert ? { geaendert } : undefined };
}

test('Einigkeit ist keine Entscheidung', () => {
  /*
   * Einen Wert zu nehmen, den alle anbieten, ist eine Abschrift. Ihn zu
   * begründen ist so wenig nötig, wie es unmöglich ist, es zu lesen: Ein Lauf
   * über 225 000 Zeilen erzeugte 600 000 solcher Sätze.
   */
  const ergebnis = entscheide('ort', [angebot('A', 'Bonn'), angebot('B', 'Bonn')], {});

  assert.equal(ergebnis.entschieden, true);
  assert.equal(ergebnis.entschieden && ergebnis.grund, 'EINIG');
  assert.equal(wurdeAbgewogen(ergebnis as { grund: 'EINIG' }), false);
});

test('ein einziger gefüllter Wert ist auch keine', () => {
  /*
   * Ein leeres Feld widerspricht nichts — hier wird ergänzt, nicht
   * entschieden. Welchen der beiden Gründe die Entscheidung dafür trägt,
   * hängt am Weg dorthin; abgewogen wurde in keinem der beiden Fälle.
   */
  const ergebnis = entscheide('telefon', [angebot('A', ''), angebot('B', '0228/1')], {});

  assert.equal(ergebnis.entschieden && ergebnis.wert, '0228/1');
  assert.equal(wurdeAbgewogen(ergebnis as { grund: 'EINIG' }), false);
  assert.equal(wurdeAbgewogen({ grund: 'EINZIGER_WERT' }), false);
});

test('wo zwei Werte im Streit lagen, wurde abgewogen', () => {
  const ergebnis = entscheide('ort', [angebot('A', 'Bonn'), angebot('B', 'Köln')], { quellen: ['A', 'B'] });

  assert.equal(ergebnis.entschieden, true);
  assert.ok(ergebnis.entschieden && wurdeAbgewogen(ergebnis), ergebnis.entschieden ? ergebnis.grund : '');
});

test('ein Prüfhinweis erhält die Begründung, auch bei Einigkeit', () => {
  /*
   * „Die Entscheidung gilt, aber etwas spricht dagegen" (SPEC-04, Abschnitt 8).
   * Genau dieser Satz ist der, den jemand liest — er darf nie wegfallen.
   */
  assert.equal(wurdeAbgewogen({ grund: 'EINIG', pruefhinweis: 'Der jüngere Stand sagt etwas anderes' }), true);
});

test('was nicht abgewogen wurde, verschwindet nicht aus dem Ergebnis', () => {
  // Der Wert steht in der Zeile; nur der Satz darüber entfällt.
  const ergebnis = entscheide('ort', [angebot('A', 'Bonn'), angebot('B', 'Bonn')], {});

  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Bonn');
});
