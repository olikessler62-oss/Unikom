import assert from 'node:assert/strict';
import test from 'node:test';

import { darfRegelWerden, waehle, wirkt, type Mappingregel } from './Regelbestand.js';

const JETZT = new Date('2026-08-19T10:00:00.000Z');

function regel(teil: Partial<Mappingregel>): Mappingregel {
  return {
    id: teil.id ?? 'r1',
    art: 'WERT',
    ebene: 'ALLGEMEIN',
    von: 'FFm',
    nach: 'Frankfurt am Main',
    herkunft: 'GELERNT',
    bestaetigt: false,
    bestaetigungen: 0,
    anwendungen: 0,
    erstellt: JETZT,
    ...teil,
  };
}

/* ---------- Der Unterschied der beiden Arten ---------- */

test('ein Wertmapping wirkt ohne Freigabe', () => {
  // Es trifft einen Wert, den man im Datensatz sieht.
  assert.equal(wirkt(regel({ art: 'WERT', bestaetigt: false })), true);
});

test('ein Feldmapping wirkt erst mit Bestätigung', () => {
  // Es leitet eine ganze Spalte still ins falsche Zielfeld, und das fällt auf,
  // wenn die Daten längst woanders sind.
  assert.equal(wirkt(regel({ art: 'FELD', bestaetigt: false })), false);
  assert.equal(wirkt(regel({ art: 'FELD', bestaetigt: true })), true);
});

test('eine zurückgenommene Regel wirkt nicht mehr — bleibt aber im Bestand', () => {
  const zurueck = regel({ zurueckgenommen: JETZT });

  assert.equal(wirkt(zurueck), false);
  assert.equal(waehle([zurueck], { art: 'WERT', von: 'FFm' }), undefined);
});

/* ---------- Die Rangfolge ---------- */

test('der Mandant schlägt das Profil, das Profil das Allgemeine', () => {
  const regeln = [
    regel({ id: 'a', ebene: 'ALLGEMEIN', nach: 'allgemein' }),
    regel({ id: 'p', ebene: 'PROFIL', profilId: 'p1', nach: 'profil' }),
    regel({ id: 'm', ebene: 'MANDANT', tenantId: 't1', nach: 'mandant' }),
  ];

  const auftrag = { art: 'WERT' as const, von: 'FFm', tenantId: 't1', profilId: 'p1' };

  assert.equal(waehle(regeln, auftrag)?.regel.nach, 'mandant');
  assert.equal(waehle(regeln.slice(0, 2), auftrag)?.regel.nach, 'profil');
  assert.equal(waehle(regeln.slice(0, 1), auftrag)?.regel.nach, 'allgemein');
});

test('eine Mandantenregel gilt nicht für einen anderen Mandanten', () => {
  const regeln = [regel({ ebene: 'MANDANT', tenantId: 't1', nach: 'nur für t1' })];

  assert.equal(waehle(regeln, { art: 'WERT', von: 'FFm', tenantId: 't2' }), undefined);
});

test('eine Regel für ein bestimmtes Feld schlägt die für alle Felder', () => {
  // „N" heißt im Feld land Norwegen und im Feld aktiv Nein.
  const regeln = [
    regel({ id: 'ueberall', von: 'N', nach: 'Nein' }),
    regel({ id: 'land', von: 'N', nach: 'Norwegen', feld: 'land' }),
  ];

  assert.equal(waehle(regeln, { art: 'WERT', von: 'N', feld: 'land' })?.regel.nach, 'Norwegen');
  assert.equal(waehle(regeln, { art: 'WERT', von: 'N', feld: 'aktiv' })?.regel.nach, 'Nein');
});

test('bei sonst gleichem Rang gewinnt die jüngere Entscheidung', () => {
  const regeln = [
    regel({ id: 'alt', nach: 'alt', erstellt: new Date('2026-01-01T00:00:00.000Z') }),
    regel({ id: 'neu', nach: 'neu', erstellt: new Date('2026-08-01T00:00:00.000Z') }),
  ];

  assert.equal(waehle(regeln, { art: 'WERT', von: 'FFm' })?.regel.nach, 'neu');
});

test('Schreibweisen sind kein Unterschied', () => {
  // Sonst liefe der Bestand mit Dubletten voll, die niemand als solche erkennt.
  const regeln = [regel({ von: 'Kunden-Nr.', nach: 'customerId', art: 'FELD', bestaetigt: true })];

  assert.ok(waehle(regeln, { art: 'FELD', von: 'kundennr' }));
  assert.ok(waehle(regeln, { art: 'FELD', von: 'KUNDEN NR' }));
});

test('die gewählte Regel begründet sich selbst', () => {
  // Für das Protokoll und für den Bildschirm: Eine Zuordnung ohne Grund kann
  // niemand nachvollziehen.
  const treffer = waehle([regel({ ebene: 'MANDANT', tenantId: 't1', herkunft: 'BENUTZER', bestaetigt: true })], {
    art: 'WERT',
    von: 'FFm',
    tenantId: 't1',
  });

  assert.match(treffer?.grund ?? '', /Regel des Mandanten/);
  assert.match(treffer?.grund ?? '', /von Hand eingerichtet, bestätigt/);
});

/* ---------- Lernverhalten (SPEC-02, Abschnitt 17) ---------- */

test('eine einzelne unsichere Vermutung wird keine Regel', () => {
  const urteil = darfRegelWerden(
    'WERT',
    { von: 'FFm', nach: 'Frankfurt am Main', sicherheit: 0.7 },
    { bestaetigungen: 0, durchMenschen: false }
  );

  assert.equal(urteil.erlaubt, false);
  assert.match(urteil.grund, /Eine einzelne unsichere Vermutung wird keine Regel/);
});

test('zweimal dasselbe beobachtet reicht', () => {
  const urteil = darfRegelWerden(
    'WERT',
    { von: 'FFm', nach: 'Frankfurt am Main', sicherheit: 0.7 },
    { bestaetigungen: 1, durchMenschen: false }
  );

  assert.equal(urteil.erlaubt, true);
  assert.match(urteil.grund, /zum 2\. Mal/);
});

test('eine ausreichend sichere Entscheidung reicht auch beim ersten Mal', () => {
  const urteil = darfRegelWerden(
    'WERT',
    { von: 'FFm', nach: 'Frankfurt am Main', sicherheit: 0.97 },
    { bestaetigungen: 0, durchMenschen: false }
  );

  assert.equal(urteil.erlaubt, true);
  assert.match(urteil.grund, /97 % sicher genug/);
});

test('ein Feldmapping lernt sich nicht selbst, wie sicher es auch aussieht', () => {
  const urteil = darfRegelWerden(
    'FELD',
    { von: 'Kunden-Nr', nach: 'customerId', sicherheit: 1 },
    { bestaetigungen: 5, durchMenschen: false }
  );

  assert.equal(urteil.erlaubt, false);
  assert.match(urteil.grund, /nur durch eine ausdrückliche Bestätigung/);
});

test('ein Mensch darf beides sofort zur Regel machen', () => {
  for (const art of ['WERT', 'FELD'] as const) {
    const urteil = darfRegelWerden(art, { von: 'a', nach: 'b', sicherheit: 0 }, { bestaetigungen: 0, durchMenschen: true });

    assert.equal(urteil.erlaubt, true, art);
    assert.match(urteil.grund, /ausdrücklich bestätigt/);
  }
});
