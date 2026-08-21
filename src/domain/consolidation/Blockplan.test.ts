import assert from 'node:assert/strict';
import test from 'node:test';

import { blockFuer, BLOCK_SPEICHER_MB, planeBloecke, streuung } from './Blockplan.js';
import { SPEICHER_JE_DATENSATZ_BYTES } from './Menge.js';

/* ---------- Der Plan ---------- */

test('eine gewöhnliche Menge bleibt ein einziger Schritt', () => {
  /*
   * Blockweise Verarbeitung, die sich auch bei kleinen Mengen einschaltet,
   * kostet Zwischenstände, Schreibvorgänge und Erklärungen für einen Gewinn,
   * den es dort nicht gibt.
   */
  const plan = planeBloecke(5_000);

  assert.equal(plan.bloecke, 1);
  assert.match(plan.begruendung, /passen in einen Schritt/);
});

test('eine große Menge wird aufgeteilt', () => {
  const plan = planeBloecke(1_200_000);

  assert.ok(plan.bloecke > 1, `${plan.bloecke} Blöcke`);
  assert.ok(plan.jeBlockMb <= BLOCK_SPEICHER_MB, `${plan.jeBlockMb} MB je Block`);
});

test('die Blockgröße folgt dem Speicher, den ein Block kosten darf', () => {
  const plan = planeBloecke(10_000_000, { speicherMb: 64 });

  assert.equal(plan.jeBlock, Math.floor((64 * 1024 * 1024) / SPEICHER_JE_DATENSATZ_BYTES));
  assert.ok(plan.jeBlockMb <= 64);
});

test('eine ausdrücklich gesetzte Blockgröße sticht die Rechnung', () => {
  // „muss abhängig von … Konfiguration … bestimmt bzw. konfiguriert werden können"
  assert.equal(planeBloecke(1_000, { jeBlock: 100 }).bloecke, 10);
});

test('kein Datensatz ergibt trotzdem einen Schritt und keine Division durch null', () => {
  assert.equal(planeBloecke(0).bloecke, 1);
});

test('die Begründung nennt Schritte, Größe und den Grund der Aufteilung', () => {
  // Sie steht im Protokoll und auf dem Bildschirm; „wird aufgeteilt" allein
  // beantwortet keine Frage.
  const plan = planeBloecke(1_000_000, { jeBlock: 100_000 });

  assert.match(plan.begruendung, /10 Schritten/);
  assert.match(plan.begruendung, /100\.000/);
  assert.match(plan.begruendung, /Konsolidierungsschlüssel/);
});

test('der letzte Block darf kleiner sein', () => {
  assert.equal(planeBloecke(250, { jeBlock: 100 }).bloecke, 3);
});

/* ---------- Die Zuordnung ---------- */

test('derselbe Schlüssel landet immer im selben Block', () => {
  /*
   * Die Bedingung für alles Weitere: Ein Kunde mit Sätzen in zwei Blöcken
   * würde zweimal verarbeitet und käme zweimal ins Ergebnis.
   */
  for (const schluessel of ['4711', 'Meier|Bonn', 'ä', '', 'x'.repeat(200)]) {
    const erster = blockFuer(schluessel, 16);

    for (let versuch = 0; versuch < 5; versuch += 1) {
      assert.equal(blockFuer(schluessel, 16), erster, schluessel);
    }
  }
});

test('bei einem Block kommt alles in den einen', () => {
  assert.equal(blockFuer('irgendwas', 1), 0);
  assert.equal(blockFuer('irgendwas', 0), 0);
});

test('der Block liegt immer im gültigen Bereich', () => {
  for (let i = 0; i < 500; i += 1) {
    const block = blockFuer(`schluessel-${i}`, 7);

    assert.ok(block >= 0 && block < 7, `${block}`);
  }
});

test('die Streuung verteilt und häuft nicht', () => {
  // Ein Verfahren, das alles in einen Block legt, teilt nichts auf.
  const zaehler = new Array(8).fill(0) as number[];

  for (let i = 0; i < 8_000; i += 1) {
    zaehler[blockFuer(`kunde-${i}`, 8)] += 1;
  }

  for (const anzahl of zaehler) {
    assert.ok(anzahl > 700 && anzahl < 1300, `ungleich verteilt: ${zaehler.join(', ')}`);
  }
});

test('die Streuung bleibt in 32 Bit ohne Vorzeichen', () => {
  // Ein negativer Wert ergäbe einen negativen Blockindex — und der Zugriff
  // liefe ins Leere, statt einen Fehler zu werfen.
  for (const text of ['', 'a', 'ü', 'x'.repeat(1000), 'Meier|Bonn|4711']) {
    const wert = streuung(text);

    assert.ok(Number.isInteger(wert) && wert >= 0 && wert <= 0xffffffff, `${text}: ${wert}`);
  }
});

test('die Streuung ist über Programmläufe hinweg dieselbe', () => {
  /*
   * Fest verdrahtete Werte und nicht „irgendetwas Gestreutes": Ein
   * fortgesetzter Lauf muss dieselbe Aufteilung wiederfinden, sonst wäre der
   * gespeicherte Zwischenstand von Block 2 beim nächsten Mal der von etwas
   * anderem.
   */
  assert.equal(streuung(''), 0x811c9dc5);
  assert.equal(streuung('a'), 0xe40c292c);
  assert.equal(streuung('foobar'), 0xbf9cf968);
});
