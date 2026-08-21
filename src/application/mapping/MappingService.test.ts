import assert from 'node:assert/strict';
import test from 'node:test';

import type { LogEntry } from '../../domain/logging/LogEntry.js';
import { InMemoryMappingRepository } from '../../infrastructure/persistence/InMemoryMappingRepository.js';
import { MappingService } from './MappingService.js';

function aufbau() {
  const geschrieben: LogEntry[] = [];
  const dienst = new MappingService(new InMemoryMappingRepository(), {
    log: (eintrag) => geschrieben.push(eintrag),
  });

  return { dienst, geschrieben, ort: { tenantId: 't1' } };
}

/* ---------- Die Vorschau (SPEC-09, Abschnitt 11) ---------- */

test('die Vorschau trennt Übernommenes, Vorschläge und Offenes', () => {
  // Der Benutzer soll sich auf die unklaren Fälle beschränken können. Dafür
  // müssen die klaren als klar erkennbar sein und nicht in derselben Liste
  // stehen.
  const { dienst, ort } = aufbau();

  return dienst
    .vorschau(
      [
        { name: 'Kundennummer', typ: 'INTEGER' },
        { name: 'Kundennummer2', typ: 'INTEGER' },
        { name: 'Ort', typ: 'STRING' },
      ],
      ort
    )
    .then((vorschau) => {
      assert.equal(vorschau.uebernommen, 2, 'Kundennummer und Ort');
      assert.equal(vorschau.offen, 1, 'Kundennummer2 kennt niemand');
      assert.equal(vorschau.zuordnungen.length, 3);
    });
});

test('eine bestätigte Regel steht in der Vorschau als Regel da, nicht als Vermutung', async () => {
  const { dienst, ort } = aufbau();

  await dienst.bestaetige({ art: 'FELD', von: 'Spalte 7', nach: 'customerId', ebene: 'MANDANT', tenantId: 't1' });

  const vorschau = await dienst.vorschau([{ name: 'Spalte 7', typ: 'STRING' }], ort);

  assert.equal(vorschau.zuordnungen[0].intern, 'customerId');
  assert.equal(vorschau.zuordnungen[0].istRegel, true);
  assert.match(vorschau.zuordnungen[0].ausRegel ?? '', /Regel des Mandanten/);
});

/* ---------- Bestätigen ---------- */

test('eine zweite Bestätigung verdoppelt die Regel nicht, sondern zählt', async () => {
  // Zwei Regeln mit demselben Ausgangswert wären ein Bestand, in dem niemand
  // mehr sagen kann, welche gilt.
  const { dienst } = aufbau();
  const auftrag = { art: 'FELD' as const, von: 'Kd-Nr', nach: 'customerId', ebene: 'MANDANT' as const, tenantId: 't1' };

  await dienst.bestaetige(auftrag);
  const zweite = await dienst.bestaetige(auftrag);

  assert.equal((await dienst.alle('t1')).length, 1);
  assert.equal(zweite.bestaetigungen, 2);
});

test('jede Bestätigung steht im Protokoll, mit dem Menschen dahinter', async () => {
  const { dienst, geschrieben } = aufbau();

  await dienst.bestaetige({
    art: 'FELD',
    von: 'Kd-Nr',
    nach: 'customerId',
    ebene: 'MANDANT',
    tenantId: 't1',
    wer: { id: 'u-1', name: 'anna' },
  });

  assert.equal(geschrieben[0].username, 'anna');
  assert.match(geschrieben[0].message, /Feldmapping bestätigt/);
});

/* ---------- Lernen (SPEC-02, Abschnitt 17) ---------- */

test('ein Wertmapping entsteht beim zweiten Mal', async () => {
  // Der Lernweg aus SPEC-02, Abschnitt 17: „wiederholt bestätigte Zuordnungen".
  // Er setzt voraus, dass die erste Beobachtung irgendwo steht — sonst wäre die
  // zweite wieder die erste und die Regel entstünde nie.
  const { dienst, ort } = aufbau();
  const beobachtung = { von: 'FFm', nach: 'Frankfurt am Main', feld: 'ort', sicherheit: 0.7 };

  const erste = await dienst.beobachte(beobachtung, ort);

  assert.equal(erste.gelernt, false);
  assert.equal(erste.regel?.vorlaeufig, true, 'vorgemerkt, aber noch keine Regel');
  assert.deepEqual((await dienst.wendeAn(['FFm'], 'ort', ort)).werte, ['FFm'], 'eine Vormerkung wirkt nicht');

  const zweite = await dienst.beobachte(beobachtung, ort);

  assert.equal(zweite.gelernt, true);
  assert.equal(zweite.regel?.vorlaeufig, false);
  assert.equal((await dienst.alle('t1')).length, 1, 'aus der Vormerkung wird die Regel, keine zweite daneben');
  assert.deepEqual((await dienst.wendeAn(['FFm'], 'ort', ort)).werte, ['Frankfurt am Main']);
});

test('eine Vormerkung wirkt auch dann nicht, wenn sie oft genug fehlt', async () => {
  // Zwei verschiedene Beobachtungen zum selben Ausgangswert merken sich beide
  // vor und keine wird zur Regel — die zweite widerspricht der ersten nicht,
  // weil noch keine gilt, aber sie stützt sie eben auch nicht.
  const { dienst, ort } = aufbau();

  await dienst.beobachte({ von: 'FFm', nach: 'Frankfurt am Main', feld: 'ort', sicherheit: 0.6 }, ort);
  await dienst.beobachte({ von: 'FFm', nach: 'Freiburg', feld: 'ort', sicherheit: 0.6 }, ort);

  assert.deepEqual((await dienst.wendeAn(['FFm'], 'ort', ort)).werte, ['FFm']);
  assert.equal((await dienst.alle('t1')).length, 2, 'beide Vormerkungen stehen da und werden sichtbar');
});

test('eine ausreichend sichere Beobachtung wird sofort zur Regel', async () => {
  const { dienst, ort, geschrieben } = aufbau();

  const ergebnis = await dienst.beobachte(
    { von: 'FFm', nach: 'Frankfurt am Main', feld: 'ort', sicherheit: 0.97 },
    ort
  );

  assert.equal(ergebnis.gelernt, true);
  assert.equal(ergebnis.regel?.herkunft, 'GELERNT');
  assert.equal(ergebnis.regel?.bestaetigt, false, 'gelernt heißt nicht bestätigt');
  assert.match(geschrieben.map((eintrag) => eintrag.message).join(' '), /Wertmapping gelernt/);
});

test('dieselbe Beobachtung noch einmal stärkt die Regel, statt eine zweite anzulegen', async () => {
  const { dienst, ort } = aufbau();
  const beobachtung = { von: 'FFm', nach: 'Frankfurt am Main', feld: 'ort', sicherheit: 0.97 };

  await dienst.beobachte(beobachtung, ort);
  const nochmal = await dienst.beobachte(beobachtung, ort);

  assert.equal(nochmal.gelernt, false);
  assert.equal(nochmal.regel?.bestaetigungen, 2);
  assert.equal((await dienst.alle('t1')).length, 1);
});

/* ---------- Schutz vor falschem Umlernen (SPEC-02, Abschnitt 18) ---------- */

test('ein einzelner widersprüchlicher Datensatz ändert keine bestehende Regel', async () => {
  // Ein System, das sich durch einzelne fehlerhafte Eingangsdaten selbst
  // umlernt, ist nach drei Monaten nicht mehr zu gebrauchen.
  const { dienst, ort, geschrieben } = aufbau();

  await dienst.beobachte({ von: 'FFm', nach: 'Frankfurt am Main', feld: 'ort', sicherheit: 0.97 }, ort);
  const widerspruch = await dienst.beobachte({ von: 'FFm', nach: 'Freiburg', feld: 'ort', sicherheit: 0.99 }, ort);

  assert.equal(widerspruch.gelernt, false);
  assert.equal(widerspruch.widerspruch?.beobachtet, 'Freiburg');
  assert.equal(widerspruch.widerspruch?.regel.nach, 'Frankfurt am Main');
  assert.match(geschrieben.map((eintrag) => eintrag.message).join(' '), /Widerspruch beim Wertmapping/);

  const bestand = await dienst.alle('t1');

  assert.equal(bestand.length, 1);
  assert.equal(bestand[0].nach, 'Frankfurt am Main', 'die Regel steht unverändert');
});

/* ---------- Anwenden und Zurücknehmen ---------- */

test('angewendete Werte werden ersetzt — und die Ersetzung wird ausgewiesen', async () => {
  // Ein still ersetzter Wert ist im Ergebnis nicht mehr von einem zu
  // unterscheiden, der so geliefert wurde.
  const { dienst, ort } = aufbau();

  await dienst.bestaetige({
    art: 'WERT',
    von: 'FFm',
    nach: 'Frankfurt am Main',
    feld: 'ort',
    ebene: 'MANDANT',
    tenantId: 't1',
  });

  const ergebnis = await dienst.wendeAn(['FFm', 'Köln', 'FFm'], 'ort', ort);

  assert.deepEqual(ergebnis.werte, ['Frankfurt am Main', 'Köln', 'Frankfurt am Main']);
  assert.equal(ergebnis.ersetzungen.length, 1, 'derselbe Wert wird einmal ausgewiesen');
  assert.equal(ergebnis.ersetzungen[0].von, 'FFm');
});

test('eine zurückgenommene Regel wirkt nicht mehr, bleibt aber sichtbar', async () => {
  const { dienst, ort, geschrieben } = aufbau();

  const regel = await dienst.bestaetige({
    art: 'WERT',
    von: 'FFm',
    nach: 'Frankfurt am Main',
    feld: 'ort',
    ebene: 'MANDANT',
    tenantId: 't1',
  });

  await dienst.nimmZurueck(regel.id, { id: 'u-1', name: 'anna' });

  assert.deepEqual((await dienst.wendeAn(['FFm'], 'ort', ort)).werte, ['FFm']);
  assert.equal((await dienst.alle('t1')).length, 1, 'sie steht weiterhin im Bestand');
  assert.match(geschrieben.map((eintrag) => eintrag.message).join(' '), /zur Nachvollziehbarkeit im Bestand/);
});

test('eine Rücknahme lässt sich zurücknehmen', async () => {
  const { dienst, ort } = aufbau();
  const regel = await dienst.bestaetige({
    art: 'WERT',
    von: 'FFm',
    nach: 'Frankfurt am Main',
    ebene: 'MANDANT',
    tenantId: 't1',
  });

  await dienst.nimmZurueck(regel.id);
  await dienst.gibFrei(regel.id);

  assert.deepEqual((await dienst.wendeAn(['FFm'], 'ort', ort)).werte, ['Frankfurt am Main']);
});

test('ein Mandant sieht die Regeln des anderen nicht', async () => {
  const { dienst } = aufbau();

  await dienst.bestaetige({ art: 'WERT', von: 'N', nach: 'Nord', ebene: 'MANDANT', tenantId: 't1' });
  await dienst.bestaetige({ art: 'WERT', von: 'N', nach: 'Nein', ebene: 'MANDANT', tenantId: 't2' });

  assert.deepEqual((await dienst.alle('t1')).map((regel) => regel.nach), ['Nord']);
  assert.deepEqual((await dienst.wendeAn(['N'], 'x', { tenantId: 't2' })).werte, ['Nein']);
});

test('ein allgemeines Mapping gilt für jeden Mandanten', async () => {
  const { dienst } = aufbau();

  await dienst.bestaetige({ art: 'WERT', von: 'DE', nach: 'Deutschland', ebene: 'ALLGEMEIN' });

  assert.deepEqual((await dienst.wendeAn(['DE'], 'land', { tenantId: 't9' })).werte, ['Deutschland']);
});
