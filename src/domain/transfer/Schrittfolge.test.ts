import assert from 'node:assert/strict';
import test from 'node:test';

import { istEindeutig, pruefeFolge, type Folgeschritt } from './Schrittfolge.js';

function ausVerzeichnis(verzeichnis: string, nach?: string): Folgeschritt {
  return {
    input: { from: 'DIRECTORY', directory: verzeichnis },
    output: nach ? { to: 'DIRECTORY', directory: nach } : undefined,
  };
}

function ausVorgaenger(nach?: string): Folgeschritt {
  return {
    input: { from: 'PRECEDING' },
    output: nach ? { to: 'DIRECTORY', directory: nach } : undefined,
  };
}

test('eine durchgehende Kette ist eindeutig', () => {
  // Erst sammeln, dann anreichern — jeder Schritt liest, was der davor ablegt.
  const folge = [ausVerzeichnis('/eingang', '/arbeit'), ausVerzeichnis('/arbeit', '/ergebnis')];

  assert.deepEqual(pruefeFolge(folge), []);
  assert.equal(istEindeutig(folge), true);
});

test('ein einzelner Schritt ist nie mehrdeutig', () => {
  assert.equal(istEindeutig([ausVerzeichnis('/eingang', '/ergebnis')]), true);
});

test('die Prüfung ordnet nicht um', () => {
  /*
   * „Eine automatisch ermittelte Reihenfolge darf keine fachliche Entscheidung
   * ersetzen." Ein Programm, das selbst sortiert, hätte genau das getan — und
   * beim nächsten Öffnen stünde etwas anderes da, als jemand eingetragen hat.
   */
  const folge = [ausVerzeichnis('/arbeit', '/ergebnis'), ausVerzeichnis('/eingang', '/arbeit')];

  pruefeFolge(folge);

  assert.equal(folge[0].input.from === 'DIRECTORY' && folge[0].input.directory, '/arbeit', 'unverändert');
});

/* ---------- Was gemeldet werden muss ---------- */

test('ein Schritt ohne Vorgänger, der vom Vorgänger lesen will, wird gemeldet', () => {
  const [fund, ...weitere] = pruefeFolge([ausVorgaenger('/ergebnis')]);

  assert.equal(weitere.length, 0);
  assert.equal(fund.art, 'KEIN_VORGAENGER');
  assert.equal(fund.schritt, 1);
  assert.match(fund.hinweis, /er ist aber der erste/);
});

test('ein Vorgänger, der nichts ablegt, wird beim Namen genannt', () => {
  const funde = pruefeFolge([ausVerzeichnis('/eingang'), ausVorgaenger('/ergebnis')]);

  assert.equal(funde.length, 1);
  assert.equal(funde[0].art, 'KEIN_VORGAENGER');
  assert.equal(funde[0].schritt, 2);
  assert.match(funde[0].hinweis, /Schritt 1 legt aber nichts ab/);
});

test('unmittelbare Übergabe zählt als Ablage', () => {
  // FOLLOWING heißt: Der Nachfolger übernimmt es direkt, ohne Verzeichnis
  // dazwischen. Das ist eine Verkettung und keine Lücke.
  const folge: Folgeschritt[] = [
    { input: { from: 'DIRECTORY', directory: '/eingang' }, output: { to: 'FOLLOWING' } },
    ausVorgaenger('/ergebnis'),
  ];

  assert.deepEqual(pruefeFolge(folge), []);
});

test('zwei Schritte auf dasselbe Ziel werden gemeldet', () => {
  /*
   * Der spätere überschreibt den früheren. Welches Ergebnis am Ende dasteht,
   * entscheidet damit die Reihenfolge und nicht die Bedeutung.
   */
  const funde = pruefeFolge([ausVerzeichnis('/a', '/ergebnis'), ausVerzeichnis('/b', '/ergebnis')]);

  assert.equal(funde.length, 1);
  assert.equal(funde[0].art, 'GLEICHES_ZIEL');
  assert.equal(funde[0].schritt, 2);
  assert.equal(funde[0].anderer, 1);
  assert.match(funde[0].hinweis, /überschreibt/);
});

test('ein späterer Schreiber auf ein früher gelesenes Verzeichnis wird gemeldet', () => {
  /*
   * Der tückischste Fall: Er funktioniert — beim zweiten Lauf. Beim ersten ist
   * das Verzeichnis leer, danach steht der Vorlauf darin. Ein Ergebnis, das vom
   * Vortag abhängt, sieht monatelang richtig aus.
   */
  const funde = pruefeFolge([ausVerzeichnis('/ring', '/ergebnis'), ausVerzeichnis('/eingang', '/ring')]);

  assert.equal(funde.length, 1);
  assert.equal(funde[0].art, 'SPAETERER_SCHREIBER');
  assert.equal(funde[0].schritt, 1);
  assert.equal(funde[0].anderer, 2);
  assert.match(funde[0].hinweis, /Vortag/);
});

test('ein Schritt, der aus seinem eigenen Ziel liest, ist nicht gemeint', () => {
  // Dasselbe Verzeichnis lesen und beschreiben ist eine Verarbeitung an Ort und
  // Stelle — eine Frage an den Lauf, nicht an die Reihenfolge.
  assert.deepEqual(pruefeFolge([ausVerzeichnis('/daten', '/daten')]), []);
});

test('ein leeres Zielverzeichnis gilt als kein Ziel', () => {
  // Sonst kollidierten zwei noch nicht ausgefüllte Schritte miteinander, und
  // die Meldung erschiene, während jemand noch tippt.
  const funde = pruefeFolge([ausVerzeichnis('/a', ''), ausVerzeichnis('/b', '')]);

  assert.deepEqual(funde, []);
});

test('mehrere Mängel werden alle genannt', () => {
  // Einen nach dem anderen zu melden hieße, dreimal zu speichern, um dreimal
  // dasselbe zu erfahren.
  const funde = pruefeFolge([
    ausVorgaenger('/ergebnis'),
    ausVerzeichnis('/eingang', '/ergebnis'),
  ]);

  assert.equal(funde.length, 2);
  assert.deepEqual(
    funde.map((fund) => fund.art),
    ['KEIN_VORGAENGER', 'GLEICHES_ZIEL']
  );
});

test('der Name des Schritts steht in der Meldung', () => {
  // „Schritt 2" allein zwingt zum Nachzählen in einer Liste, die man gerade
  // nicht sieht.
  const funde = pruefeFolge([{ name: 'Filialen sammeln', input: { from: 'PRECEDING' } }]);

  assert.match(funde[0].hinweis, /Filialen sammeln/);
});
