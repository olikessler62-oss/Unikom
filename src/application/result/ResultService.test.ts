import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { InMemoryResultRepository } from '../../infrastructure/persistence/InMemoryResultRepository.js';
import type { Konsolidierungsbericht } from '../consolidation/ConsolidationService.js';
import { ErgebnisFehler, ResultService, type Abschlussauftrag } from './ResultService.js';

const ANNA = { id: 'anna', name: 'Anna Meier' };

const EINGANG = {
  felder: ['kdnr', 'ort'],
  zeilen: [
    ['4711', 'Bonn'],
    ['4712', 'Köln'],
  ],
};

function bericht(teile: Partial<Konsolidierungsbericht> = {}): Konsolidierungsbericht {
  return {
    quellen: [],
    felder: ['kdnr', 'ort'],
    zeilen: [
      { werte: ['4711', 'Bonn'], herkunft: [{ quelle: 'a', zeile: 1 }], entscheidungen: [], schluessel: '4711' },
      { werte: ['4712', 'Köln'], herkunft: [{ quelle: 'a', zeile: 2 }], entscheidungen: [], schluessel: '4712' },
    ],
    konflikte: [],
    dubletten: [],
    zurueckgestellt: [],
    verdacht: [],
    nichtVerarbeitet: [],
    ergaenzungen: [],
    ergaenzungsluecken: [],
    referenzen: [],
    hinweise: [],
    zusammenfassung: {
      quellen: 1,
      gelesen: 2,
      ergebnis: 2,
      zusammengefuehrt: 0,
      dubletten: 0,
      konflikte: 0,
      ergaenzt: 0,
      verdacht: 0,
      nichtVerarbeitet: 0,
    },
    ...teile,
  };
}

function auftrag(teile: Partial<Abschlussauftrag> = {}): Abschlussauftrag {
  return {
    tenantId: 'default',
    laufId: 'lauf1',
    jobId: 'job1',
    bericht: bericht(),
    eingang: EINGANG,
    region: DEFAULT_REGION,
    jetzt: new Date('2026-08-20T10:00:00.000Z'),
    ...teile,
  };
}

function dienst() {
  return new ResultService(new InMemoryResultRepository());
}

/* ---------- Abschluss und automatische Freigabe ---------- */

test('ein sauberer Lauf gibt sich selbst frei — mit Vermerk', async () => {
  const service = dienst();
  const { stand, urteil } = await service.schliesseAb(auftrag());

  assert.equal(urteil.frei, true);
  assert.equal(stand.status, 'COMPLETED');
  assert.equal(stand.freigabe?.art, 'AUTOMATISCH');
  assert.equal(stand.freigabe?.benutzer, undefined, 'automatisch heißt: niemand, und das steht da');
  assert.ok((stand.freigabe?.bedingungen.length ?? 0) >= 3);
  assert.equal(stand.freigabe?.zeitpunkt, '2026-08-20T10:00:00.000Z');
});

test('ein offener kritischer Konflikt lässt den Lauf warten', async () => {
  const service = dienst();
  const { stand, urteil } = await service.schliesseAb(auftrag({ konflikte: { offen: 1, kritischOffen: 1 } }));

  assert.equal(stand.status, 'WAITING_FOR_RELEASE');
  assert.equal(stand.freigabe, undefined, 'ohne Freigabe kein Vermerk');
  assert.match(urteil.erklaerung, /wartet auf eine Freigabe/);
});

test('die Prüfung allein legt nichts an', async () => {
  // SPEC-08, Abschnitt 11: „Der Testlauf darf Originaldaten nicht verändern."
  const service = dienst();

  service.pruefe(auftrag());

  assert.deepEqual(await service.liste('default'), []);
});

test('die Verbleibsrechnung zählt jede Herkunft nur einmal', async () => {
  /*
   * Bei einem Mehrfachtreffer steht derselbe Eingangsdatensatz in mehreren
   * Ergebniszeilen. Zählte man die Herkünfte doppelt, käme mehr heraus als
   * hineinging — und die Vollständigkeitsprüfung meldete einen Fehler, den es
   * nicht gibt.
   */
  const service = dienst();
  const { stand } = await service.schliesseAb(
    auftrag({
      bericht: bericht({
        zeilen: [
          { werte: ['4711', 'Bonn'], herkunft: [{ quelle: 'a', zeile: 1 }], entscheidungen: [] },
          { werte: ['4711', 'Köln'], herkunft: [{ quelle: 'a', zeile: 1 }], entscheidungen: [] },
          { werte: ['4712', 'Kiel'], herkunft: [{ quelle: 'a', zeile: 2 }], entscheidungen: [] },
        ],
      }),
    })
  );

  assert.equal(
    stand.pruefung.befunde.some((befund) => befund.art === 'VOLLSTAENDIGKEIT'),
    false
  );
});

/* ---------- Manuelle Freigabe ---------- */

test('eine wartende Freigabe braucht eine Begründung, wenn etwas offen ist', async () => {
  const service = dienst();
  const { stand } = await service.schliesseAb(auftrag({ konflikte: { offen: 1, kritischOffen: 1 } }));

  await assert.rejects(
    () => service.gibFrei(stand.id, ANNA, { konflikte: { offen: 1, kritischOffen: 1 } }),
    (fehler: ErgebnisFehler) => fehler.status === 422 && /braucht deshalb eine Begründung/.test(fehler.message)
  );

  const frei = await service.gibFrei(stand.id, ANNA, {
    konflikte: { offen: 1, kritischOffen: 1 },
    begruendung: 'Mit dem Kunden telefoniert, die Fälle sind geklärt',
  });

  assert.equal(frei.status, 'COMPLETED_WITH_CONFLICTS');
  assert.equal(frei.freigabe?.art, 'MANUELL');
  assert.equal(frei.freigabe?.benutzerName, 'Anna Meier');
  assert.match(frei.freigabe?.begruendung ?? '', /telefoniert/);
});

test('ein blockierender Fehler lässt sich nicht wegbegründen', async () => {
  const service = dienst();
  const { stand } = await service.schliesseAb(
    auftrag({
      bericht: bericht({
        zeilen: [{ werte: ['4711', 'Bonn'], herkunft: [{ quelle: 'a', zeile: 1 }], entscheidungen: [] }],
      }),
    })
  );

  assert.equal(stand.pruefung.blockiert, true);

  await assert.rejects(
    () => service.gibFrei(stand.id, ANNA, { begruendung: 'passt schon' }),
    (fehler: ErgebnisFehler) => fehler.status === 422 && /was genau freigegeben würde/.test(fehler.message)
  );
});

test('zweimal freigeben geht nicht', async () => {
  const service = dienst();
  const { stand } = await service.schliesseAb(auftrag());

  await assert.rejects(
    () => service.gibFrei(stand.id, ANNA),
    (fehler: ErgebnisFehler) => fehler.status === 409 && /bereits automatisch/.test(fehler.message)
  );
});

/* ---------- Ergebnisstände (SPEC-06, Abschnitt 14) ---------- */

test('jeder Lauf bekommt einen eigenen Stand; keiner überschreibt den anderen', async () => {
  const service = dienst();
  const erster = await service.schliesseAb(auftrag({ laufId: 'lauf1' }));
  const zweiter = await service.schliesseAb(auftrag({ laufId: 'lauf2', ausLauf: 'lauf1' }));

  const alle = await service.liste('default');

  assert.equal(alle.length, 2);
  assert.notEqual(erster.stand.id, zweiter.stand.id);
  assert.equal(zweiter.stand.ausLauf, 'lauf1');
});

test('wiederherstellen kopiert und spult nicht zurück', async () => {
  const service = dienst();
  const alt = await service.schliesseAb(auftrag({ laufId: 'lauf1' }));

  const neu = await service.stelleWiederHer(alt.stand.id, ANNA, { neuerLaufId: 'lauf3' });

  assert.notEqual(neu.id, alt.stand.id);
  assert.equal(neu.wiederhergestelltAus, alt.stand.id);
  assert.equal(neu.ausLauf, 'lauf1');
  assert.deepEqual(neu.zeilen, alt.stand.zeilen);
  assert.equal(neu.status, 'WAITING_FOR_RELEASE', 'ob er hinausgeht, ist eine neue Entscheidung');
  assert.equal(neu.freigabe, undefined);

  const alter = await service.stand(alt.stand.id);

  assert.equal(alter?.status, 'COMPLETED', 'der alte Stand bleibt, wie er war');
  assert.equal((await service.liste('default')).length, 2);
});

test('ein Stand ohne Freigabe lässt sich nicht wiederherstellen', async () => {
  // Was nicht gültig war, wird es durch eine Kopie nicht.
  const service = dienst();
  const { stand } = await service.schliesseAb(auftrag({ konflikte: { offen: 1, kritischOffen: 1 } }));

  await assert.rejects(
    () => service.stelleWiederHer(stand.id, ANNA, { neuerLaufId: 'lauf3' }),
    (fehler: ErgebnisFehler) => fehler.status === 422 && /Nur ein freigegebener Ergebnisstand/.test(fehler.message)
  );
});

test('ein gespeicherter Stand lässt sich nicht nachträglich verbiegen', async () => {
  const service = dienst();
  const { stand } = await service.schliesseAb(auftrag());

  stand.zeilen.push(['9999', 'Erfunden']);
  stand.status = 'FAILED';

  const gelesen = await service.stand(stand.id);

  assert.equal(gelesen?.zeilen.length, 2);
  assert.equal(gelesen?.status, 'COMPLETED');
});
