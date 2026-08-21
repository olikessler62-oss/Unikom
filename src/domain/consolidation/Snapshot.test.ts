import assert from 'node:assert/strict';
import test from 'node:test';

import type { Strukturvorgabe } from '../discovery/Expectation.js';
import { einstellungenDesMandanten } from './Einstellungen.js';
import { fortschreiben, neuesProfil } from './Profil.js';
import { schnappschussVon } from './Snapshot.js';

const VORGABE: Strukturvorgabe = {
  verbindlichkeit: 'HINWEIS',
  columns: 2,
  spalten: [{ position: 1, name: 'Nummer', type: 'INTEGER' }],
};

const JETZT = new Date('2026-08-19T10:00:00.000Z');

function profil() {
  return neuesProfil({
    id: 'p1',
    tenantId: 'default',
    name: 'Bestellung Müller GmbH',
    vorgabe: VORGABE,
    einstellungen: { locale: 'fr-FR' },
    jetzt: JETZT,
  });
}

test('der Schnappschuss hält die Werte fest, nicht die Verweise darauf', () => {
  // Ein Schnappschuss, der beim Lesen nachschlägt, ist kein Schnappschuss.
  const schnapp = schnappschussVon({
    id: 's1',
    tenantId: 'default',
    mandant: einstellungenDesMandanten({ region: { locale: 'en-US', timeZone: 'America/New_York' } }),
    profil: profil(),
    runId: 'RUN-1',
    jetzt: JETZT,
  });

  assert.equal(schnapp.einstellungen.locale, 'en-US');
  assert.equal(schnapp.herkunft.locale, 'MANDANT');
  assert.equal(schnapp.profilVersion, 1);
  assert.deepEqual(schnapp.vorgabe, VORGABE);
  assert.equal(schnapp.runId, 'RUN-1');
});

test('eine spätere Profiländerung ändert einen vorhandenen Schnappschuss nicht', () => {
  // SPEC-02, Abschnitt 43: Eine Änderung darf einen abgeschlossenen Lauf nicht
  // nachträglich verändern.
  const stand = profil();
  const schnapp = schnappschussVon({ id: 's1', tenantId: 'default', profil: stand, jetzt: JETZT });

  const geaendert = fortschreiben(stand, { einstellungen: { locale: 'it-IT' } }, undefined, JETZT).profil;
  const zweiter = schnappschussVon({ id: 's2', tenantId: 'default', profil: geaendert, jetzt: JETZT });

  assert.equal(schnapp.einstellungen.locale, 'fr-FR', 'der erste Lauf liest weiter französisch');
  assert.equal(schnapp.profilVersion, 1);
  assert.equal(zweiter.einstellungen.locale, 'it-IT');
  assert.equal(zweiter.profilVersion, 2);
});

test('ein Lauf kann eine alte Version festhalten', () => {
  const geaendert = fortschreiben(profil(), { einstellungen: { locale: 'it-IT' } }, undefined, JETZT).profil;
  const schnapp = schnappschussVon({ id: 's1', tenantId: 'default', profil: geaendert, version: 1, jetzt: JETZT });

  assert.equal(schnapp.profilVersion, 1);
  assert.equal(schnapp.einstellungen.locale, 'fr-FR');
});

test('eine Version, die es nicht gibt, wird abgewiesen statt ersetzt', () => {
  // Ein Lauf, der glaubt, mit Version 3 zu arbeiten, und in Wahrheit Version 5
  // benutzt, ist schlimmer als einer, der gar nicht erst startet.
  assert.throws(
    () => schnappschussVon({ id: 's1', tenantId: 'default', profil: profil(), version: 3, jetzt: JETZT }),
    /keine Version 3/
  );
});

test('ohne Profil gilt der Mandant über dem Allgemeinen', () => {
  const schnapp = schnappschussVon({
    id: 's1',
    tenantId: 'default',
    mandant: einstellungenDesMandanten({ region: { locale: 'en-US', timeZone: 'America/New_York' } }),
    jetzt: JETZT,
  });

  assert.equal(schnapp.einstellungen.locale, 'en-US');
  assert.equal(schnapp.herkunft.locale, 'MANDANT');
  assert.equal(schnapp.herkunft.stichprobe, 'ALLGEMEIN');
  assert.equal(schnapp.profilId, undefined);
});

test('der Schnappschuss lässt sich nicht nachträglich ändern', () => {
  const schnapp = schnappschussVon({ id: 's1', tenantId: 'default', profil: profil(), jetzt: JETZT });

  assert.throws(() => {
    (schnapp.einstellungen as { locale: string }).locale = 'de-DE';
  }, TypeError);
});

test('was der Leser feststellt, gewinnt vor dem, was das Profil sich gemerkt hat', () => {
  // Eine Feststellung beschreibt die Datei, die gerade vorliegt — nicht die
  // vom letzten Mal.
  const gemerkt = fortschreiben(profil(), { feststellungen: { trennzeichen: ';' } }, undefined, JETZT).profil;
  const schnapp = schnappschussVon({
    id: 's1',
    tenantId: 'default',
    profil: gemerkt,
    feststellungen: { trennzeichen: ',' },
    jetzt: JETZT,
  });

  assert.equal(schnapp.feststellungen?.trennzeichen, ',');
});
