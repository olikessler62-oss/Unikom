import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { InMemoryConflictRepository } from '../../infrastructure/persistence/InMemoryConflictRepository.js';
import type { Konsolidierungsbericht, Konsolidierungskonflikt } from '../consolidation/ConsolidationService.js';
import { ConflictService, KonfliktFehler } from './ConflictService.js';
import { neuesProfil } from '../../domain/consolidation/Profil.js';
import { InMemoryProfilRepository } from '../../infrastructure/persistence/InMemoryProfilRepository.js';
import type { Konfliktfall } from '../../domain/conflicts/Konfliktfall.js';

const ANNA = { id: 'anna', name: 'Anna Meier' };
const BERND = { id: 'bernd', name: 'Bernd Schmitt' };
const OPTIONEN = { region: DEFAULT_REGION };

function konflikt(teile: Partial<Konsolidierungskonflikt> = {}): Konsolidierungskonflikt {
  return {
    art: 'WERTEKONFLIKT',
    schluessel: '4711',
    feld: 'ort',
    quelle: 'CRM.csv, ERP.csv',
    erwartet: 'Einen Wert',
    vorgefunden: 'CRM.csv: „Bonn" · ERP.csv: „Köln"',
    ursache: 'Zwei verschiedene Werte und keine Regel',
    naechsteSchritte: 'Den richtigen Wert auswählen',
    ...teile,
  };
}

function bericht(konflikte: Konsolidierungskonflikt[]): Konsolidierungsbericht {
  return {
    quellen: [],
    felder: ['kdnr', 'ort'],
    zeilen: [
      {
        werte: ['4711', ''],
        herkunft: [],
        schluessel: '4711',
        entscheidungen: [
          {
            feld: 'ort',
            wert: 'Bonn',
            quelle: 'CRM.csv',
            grund: 'QUELLENPRIORITAET',
            begruendung: 'CRM steht vorn',
            konfidenz: 1,
            uebergangen: [{ quelle: 'ERP.csv', wert: 'Köln' }],
          },
        ],
      },
    ],
    konflikte,
    dubletten: [],
    zurueckgestellt: [],
    verdacht: [],
    nichtVerarbeitet: [],
    ergaenzungen: [],
    ergaenzungsluecken: [],
    referenzen: [],
    hinweise: [],
    zusammenfassung: {
      quellen: 2,
      gelesen: 2,
      ergebnis: 1,
      zusammengefuehrt: 1,
      dubletten: 0,
      konflikte: konflikte.length,
      ergaenzt: 0,
      verdacht: 0,
      nichtVerarbeitet: 0,
    },
  };
}

async function aufbau(konflikte = [konflikt()]) {
  const bestand = new InMemoryConflictRepository();
  const dienst = new ConflictService(bestand);
  const faelle = await dienst.ausBericht(bericht(konflikte), {
    tenantId: 'default',
    laufId: 'lauf1',
    benutzer: ANNA,
    jetzt: new Date('2026-08-01T10:00:00.000Z'),
  });

  return { bestand, dienst, faelle };
}

/* ---------- Entstehen ---------- */

test('aus einem Bericht werden Konfliktfälle mit eigener UUID', () => {
  return aufbau().then(async ({ dienst, faelle }) => {
    assert.equal(faelle.length, 1);
    assert.match(faelle[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(faelle[0].status, 'OFFEN');

    const ansicht = await dienst.ansicht(faelle[0].id, 'anna');

    assert.equal(ansicht?.historie[0].art, 'ENTSTANDEN');
    assert.equal(ansicht?.historie[0].nummer, 1);
  });
});

test('die konkurrierenden Werte stehen dem Benutzer gegenüber', async () => {
  // SPEC-07, Abschnitt 4: „Bei konkurrierenden Werten müssen diese
  // vergleichbar gegenübergestellt werden."
  const { faelle } = await aufbau();

  assert.deepEqual(
    faelle[0].felder[0].angebote.map((angebot) => `${angebot.quelle}=${angebot.wert}`),
    ['CRM.csv=Bonn', 'ERP.csv=Köln']
  );
});

test('die Kritikalität richtet sich nach der Konfliktart', async () => {
  const { faelle } = await aufbau([
    konflikt({ art: 'FEHLENDER_HAUPTSATZ' }),
    konflikt({ art: 'DUBLETTE_VERMUTET' }),
    konflikt({ art: 'REFERENZ_FEHLT' }),
  ]);

  assert.deepEqual(
    faelle.map((fall) => fall.kritikalitaet),
    ['KRITISCH', 'PRUEFFALL', 'WARNUNG']
  );
});

/* ---------- Vorschau und Entscheidung ---------- */

test('die Vorschau zeigt das Ergebnis, ohne es herbeizuführen', async () => {
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  const vorschau = await dienst.vorschau(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }] },
    OPTIONEN
  );

  assert.equal(vorschau.werte.ort, 'Köln');
  assert.equal(vorschau.status, 'BEREINIGT');

  const danach = await dienst.ansicht(id, 'anna');

  assert.equal(danach?.fall.status, 'OFFEN', 'gespeichert wurde nichts');
  assert.equal(danach?.fall.fassung, 1);
  assert.equal(danach?.historie.length, 1);
});

test('eine Entscheidung hebt die Fassung und schreibt Historie', async () => {
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  const { fall } = await dienst.entscheide(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }] },
    ANNA,
    { ...OPTIONEN, fassung: 1 }
  );

  assert.equal(fall.status, 'BEREINIGT');
  assert.equal(fall.fassung, 2);
  assert.equal(fall.ergebnis?.ort, 'Köln');

  const ansicht = await dienst.ansicht(id, 'anna');
  const schritt = ansicht?.historie[1];

  assert.equal(schritt?.art, 'ENTSCHIEDEN');
  assert.equal(schritt?.vonStatus, 'OFFEN');
  assert.equal(schritt?.nachStatus, 'BEREINIGT');
  assert.equal(schritt?.nachher?.ort, 'Köln');
  assert.equal(schritt?.benutzerName, 'Anna Meier');
});

test('eine Entscheidung auf überholter Fassung wird abgewiesen', async () => {
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;
  const wahl = { art: 'BEREINIGEN' as const, felder: [{ feld: 'ort', wahl: { art: 'QUELLE' as const, quelle: 'CRM.csv' } }] };

  await dienst.entscheide(id, wahl, ANNA, { ...OPTIONEN, fassung: 1 });

  await assert.rejects(
    () => dienst.entscheide(id, wahl, BERND, { ...OPTIONEN, fassung: 1 }),
    (fehler: KonfliktFehler) => fehler.status === 409 && /Jemand anderes war schneller/.test(fehler.message)
  );
});

test('eine Entscheidung gegen die Fachregeln wird nicht übernommen', async () => {
  const { bestand, dienst, faelle } = await aufbau();
  const fall = faelle[0];

  await bestand.save({ ...fall, felder: [{ feld: 'ort', typ: 'INTEGER', angebote: fall.felder[0].angebote }] });

  await assert.rejects(
    () =>
      dienst.entscheide(
        fall.id,
        { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'EINGABE', wert: 'Bonn' } }] },
        ANNA,
        OPTIONEN
      ),
    (fehler: KonfliktFehler) => fehler.status === 422 && /keine Zahl/.test(fehler.message)
  );

  const danach = await dienst.ansicht(fall.id, 'anna');

  assert.equal(danach?.fall.status, 'OFFEN', 'der Fall bleibt unverändert');
});

test('eine Korrektur löscht die frühere Entscheidung nicht', async () => {
  // SPEC-07, Abschnitt 12: Sie ist ein neuer Bearbeitungsschritt.
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  await dienst.entscheide(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'CRM.csv' } }] },
    ANNA,
    OPTIONEN
  );

  await dienst.entscheide(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }], bemerkung: 'Rücksprache' },
    BERND,
    OPTIONEN
  );

  const ansicht = await dienst.ansicht(id, 'anna');

  assert.equal(ansicht?.historie.length, 3, 'entstanden, entschieden, korrigiert');
  assert.equal(ansicht?.historie[1].nachher?.ort, 'Bonn', 'die erste Entscheidung steht noch da');
  assert.equal(ansicht?.historie[2].vorher?.ort, 'Bonn');
  assert.equal(ansicht?.historie[2].nachher?.ort, 'Köln');
  assert.equal(ansicht?.fall.ergebnis?.ort, 'Köln');
});

/* ---------- Sperren ---------- */

test('ein gesperrter Fall lässt keinen zweiten Bearbeiter zu', async () => {
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  await dienst.sperren(id, ANNA);

  await assert.rejects(
    () => dienst.sperren(id, BERND),
    (fehler: KonfliktFehler) => fehler.status === 409 && /Anna Meier hat diesen Fall/.test(fehler.message)
  );

  const ansicht = await dienst.ansicht(id, 'bernd');

  assert.equal(ansicht?.bearbeitbar, false);
  assert.equal(ansicht?.fall.sperre?.benutzerName, 'Anna Meier');
});

test('nach dem Entscheiden ist der Fall wieder frei', async () => {
  // Die Sperre weiter zu halten sperrte den nächsten Bearbeiter aus einem
  // Fall aus, an dem niemand mehr sitzt.
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  await dienst.sperren(id, ANNA);
  await dienst.entscheide(id, { art: 'ZURUECKSTELLEN' }, ANNA, OPTIONEN);

  const ansicht = await dienst.ansicht(id, 'bernd');

  assert.equal(ansicht?.fall.sperre, undefined);
  assert.equal(ansicht?.bearbeitbar, true);
});

/* ---------- Mehrere gemeinsam (SPEC-07, Abschnitt 8) ---------- */

test('die Massenvorschau zeigt Umfang und Auswirkung vor der Ausführung', async () => {
  const { dienst, faelle } = await aufbau([konflikt({ schluessel: '1' }), konflikt({ schluessel: '2' })]);

  const vorschau = await dienst.massenvorschau(
    faelle.map((fall) => fall.id),
    { art: 'AKZEPTIEREN' },
    OPTIONEN
  );

  assert.equal(vorschau.betroffen.length, 2);
  assert.equal(vorschau.moeglich, 2);

  const ansicht = await dienst.ansicht(faelle[0].id, 'anna');

  assert.equal(ansicht?.fall.status, 'OFFEN', 'die Vorschau ändert nichts');
});

test('jede Massenentscheidung trägt ihre Vorgangskennung an jedem Fall', async () => {
  const { dienst, faelle } = await aufbau([konflikt({ schluessel: '1' }), konflikt({ schluessel: '2' })]);

  const ergebnis = await dienst.massenentscheidung(
    faelle.map((fall) => fall.id),
    { art: 'AKZEPTIEREN', bemerkung: 'fachlich hinnehmbar' },
    ANNA,
    OPTIONEN
  );

  assert.equal(ergebnis.uebernommen.length, 2);

  for (const id of ergebnis.uebernommen) {
    const ansicht = await dienst.ansicht(id, 'anna');

    assert.equal(ansicht?.historie[1].vorgang, ergebnis.vorgang);
    assert.equal(ansicht?.fall.status, 'AKZEPTIERT');
  }
});

test('eine Massenentscheidung überfährt keinen Fall, an dem jemand sitzt', async () => {
  const { dienst, faelle } = await aufbau([konflikt({ schluessel: '1' }), konflikt({ schluessel: '2' })]);

  await dienst.sperren(faelle[1].id, BERND);

  const ergebnis = await dienst.massenentscheidung(
    faelle.map((fall) => fall.id),
    { art: 'AKZEPTIEREN' },
    ANNA,
    OPTIONEN
  );

  assert.deepEqual(ergebnis.uebernommen, [faelle[0].id]);
  assert.equal(ergebnis.abgelehnt.length, 1);
  assert.match(ergebnis.abgelehnt[0].grund, /Bernd Schmitt hat diesen Fall/);
});

/* ---------- Freigabe (SPEC-07, Abschnitt 13) ---------- */

test('ein offener kritischer Fall verhindert die Freigabe — und wird genannt', async () => {
  const { dienst } = await aufbau([konflikt({ art: 'FEHLENDER_HAUPTSATZ' }), konflikt({ art: 'REFERENZ_FEHLT' })]);

  const stand = await dienst.freigabestand('default');

  assert.equal(stand.gesamt, 2);
  assert.equal(stand.offen, 2);
  assert.equal(stand.kritischOffen, 1);
  assert.equal(stand.freigabeMoeglich, false);
  assert.equal(stand.hindernisse.length, 1, 'die Warnung hält nichts auf');
  assert.equal(stand.hindernisse[0].kritikalitaet, 'KRITISCH');
});

test('ein Filter macht die Freigabe nicht möglich, indem er das Hindernis ausblendet', async () => {
  const { dienst, faelle } = await aufbau([konflikt({ art: 'FEHLENDER_HAUPTSATZ' })]);

  const liste = await dienst.liste('default', 'anna', { filter: { kritikalitaet: ['WARNUNG'] } });

  assert.equal(liste.faelle.length, 0, 'gefiltert ist die Liste leer');
  assert.equal(liste.stand.freigabeMoeglich, false, 'die Zahlen gelten trotzdem für den Bestand');
  assert.equal(liste.stand.hindernisse[0].id, faelle[0].id);
});

test('bereinigte Fälle gehen mit ihrer UUID in die Konfliktzieldatei', async () => {
  // „Sie übernimmt deren bestehende Konflikt-UUIDs unverändert."
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  await dienst.entscheide(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }] },
    ANNA,
    OPTIONEN
  );

  const ausleitung = await dienst.zurVerarbeitung('default', ANNA, { neuerLaufId: 'lauf2' });

  assert.deepEqual(ausleitung.felder, ['konflikt_uuid', 'ort']);
  assert.deepEqual(ausleitung.zeilen, [[id, 'Köln']]);

  const ansicht = await dienst.ansicht(id, 'anna');

  assert.equal(ansicht?.fall.status, 'ERNEUT_VERARBEITET');
  assert.equal(ansicht?.historie.at(-1)?.art, 'ERNEUT_VERARBEITET');
});

test('erfolgreich verarbeitet ist ein Fall erst nach dem Lauf', async () => {
  const { dienst, faelle } = await aufbau();
  const id = faelle[0].id;

  await dienst.entscheide(
    id,
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }] },
    ANNA,
    OPTIONEN
  );

  assert.equal(await dienst.abschliessen([id], ANNA, { laufId: 'lauf2' }), 0, 'noch nicht ausgeleitet');

  await dienst.zurVerarbeitung('default', ANNA, { neuerLaufId: 'lauf2' });

  assert.equal(await dienst.abschliessen([id], ANNA, { laufId: 'lauf2' }), 1);

  const ansicht = await dienst.ansicht(id, 'anna');

  assert.equal(ansicht?.fall.status, 'ERFOLGREICH_VERARBEITET');
});

test('ein Folgekonflikt ist ein neuer Fall mit einem Faden zum alten', async () => {
  const { dienst, faelle } = await aufbau();
  const alt = faelle[0].id;

  const neu = await dienst.folgekonflikt(alt, konflikt({ art: 'WERTEKONFLIKT', ursache: 'wieder strittig' }), {
    laufId: 'lauf2',
    benutzer: ANNA,
  });

  assert.notEqual(neu.id, alt);
  assert.equal(neu.entstandenAus, alt);
  assert.equal(neu.status, 'OFFEN');

  const alterFall = await dienst.ansicht(alt, 'anna');

  assert.equal(alterFall?.historie.length, 1, 'der alte Fall bleibt unberührt');
});

/* ---------- Bearbeitungsstand (SPEC-07, Abschnitt 10) ---------- */

test('der Bearbeitungsstand überlebt und führt zurück', async () => {
  const { dienst, faelle } = await aufbau([konflikt({ schluessel: '1' }), konflikt({ schluessel: '2' })]);

  await dienst.standSpeichern({
    benutzer: 'anna',
    tenantId: 'default',
    zuletzt: faelle[1].id,
    position: 1,
    gespeichert: '2026-08-01T11:00:00.000Z',
  });

  const liste = await dienst.liste('default', 'anna');

  assert.equal(liste.einstieg.gilt, true);
  assert.equal(liste.einstieg.gilt === true ? liste.einstieg.fallId : '', faelle[1].id);
});

test('jeder Benutzer hat seinen eigenen Stand', async () => {
  const { dienst, faelle } = await aufbau();

  await dienst.standSpeichern({
    benutzer: 'anna',
    tenantId: 'default',
    zuletzt: faelle[0].id,
    gespeichert: 'x',
  });

  assert.equal((await dienst.liste('default', 'bernd')).einstieg.gilt, false);
});

/* ---------- Der Rückweg läuft gegen die Regeln des Schemas ---------- */

/** Ein Fall aus einem Schema, mit einem leeren Pflichtfeld. */
function regelfall(profil?: string): Konfliktfall {
  return {
    id: 'f-regel',
    tenantId: 'default',
    laufId: 'lauf1',
    profil,
    datensatz: '„Kunden.csv", Zeile 2',
    art: 'REGELVERSTOSS',
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: '„kdnr" ist leer',
    erwartet: 'Kundennummer darf nicht leer sein',
    vorgefunden: 'kdnr: (leer)',
    naechsteSchritte: '„kdnr" prüfen',
    quellen: ['Kunden.csv'],
    felder: [{ feld: 'kdnr', angebote: [{ quelle: 'Kunden.csv', wert: '' }] }],
    entstanden: '2026-08-25T10:00:00.000Z',
    geaendert: '2026-08-25T10:00:00.000Z',
    fassung: 1,
  };
}

async function mitSchema(profilAmFall?: string) {
  const bestand = new InMemoryConflictRepository();
  const profile = new InMemoryProfilRepository();

  await profile.save(
    neuesProfil({
      id: 'p1',
      tenantId: 'default',
      name: 'Kundenliste',
      vorgabe: { verbindlichkeit: 'HINWEIS', columns: 1, spalten: [{ position: 1, name: 'kdnr', type: 'STRING' }] },
      regeln: [
        {
          id: 'kdnr-pflicht',
          name: 'Kundennummer darf nicht leer sein',
          feld: 'kdnr',
          pruefung: { art: 'PFLICHT' },
          schwere: 'FEHLER',
        },
      ],
    })
  );

  await bestand.save(regelfall(profilAmFall));

  return { bestand, dienst: new ConflictService(bestand, undefined, undefined, profile) };
}

/** Den Fall mit einem leeren Wert „bereinigen" — das darf nicht durchgehen. */
const LEER_BEREINIGEN = {
  art: 'BEREINIGEN' as const,
  felder: [{ feld: 'kdnr', wahl: { art: 'LEER' as const } }],
};

test('ein leeres Pflichtfeld lässt sich nicht durch ein leeres Pflichtfeld bereinigen', async () => {
  /*
   * Ohne die Regeln des Schemas gälten beim Bereinigen nur die vier
   * ausgelieferten — und der Fall wäre danach „bereinigt", ohne dass sich
   * etwas geändert hätte.
   */
  const { dienst } = await mitSchema('p1');
  const anwendung = await dienst.vorschau('f-regel', LEER_BEREINIGEN, { region: DEFAULT_REGION });

  assert.equal(anwendung.zulaessig, false);
  assert.match(anwendung.befunde.map((befund) => befund.ursache).join(' '), /„kdnr" ist leer/);
});

test('ein richtiger Wert geht durch', async () => {
  const { dienst } = await mitSchema('p1');
  const anwendung = await dienst.vorschau(
    'f-regel',
    { art: 'BEREINIGEN', felder: [{ feld: 'kdnr', wahl: { art: 'EINGABE', wert: '4712' } }] },
    { region: DEFAULT_REGION }
  );

  assert.equal(anwendung.zulaessig, true);
});

test('die Prüfung schlägt auch beim Bestätigen zu, nicht nur in der Vorschau', async () => {
  // Sonst zeigte die Vorschau eine Absage und das Bestätigen nähme es trotzdem.
  const { dienst } = await mitSchema('p1');

  await assert.rejects(
    () => dienst.entscheide('f-regel', LEER_BEREINIGEN, ANNA, { region: DEFAULT_REGION }),
    (fehler: unknown) => fehler instanceof KonfliktFehler && fehler.status === 422
  );
});

test('ein Fall ohne Schema wird geprüft wie zuvor', async () => {
  /*
   * Ein Wertekonflikt aus der Zusammenführung stammt aus keinem Schema. Er hat
   * kein Profil, und das ist kein Mangel.
   */
  const { dienst } = await mitSchema(undefined);
  const anwendung = await dienst.vorschau('f-regel', LEER_BEREINIGEN, { region: DEFAULT_REGION });

  assert.equal(anwendung.zulaessig, true);
});

test('ohne Zugriff auf die Schemata bleibt es beim Stand von vorher', async () => {
  const bestand = new InMemoryConflictRepository();

  await bestand.save(regelfall('p1'));

  const anwendung = await new ConflictService(bestand).vorschau('f-regel', LEER_BEREINIGEN, {
    region: DEFAULT_REGION,
  });

  assert.equal(anwendung.zulaessig, true);
});

test('die Regel des Schemas schlägt die ausgelieferte gleichen Namens', async () => {
  // Sie ist die genauere, und der Kunde hat sie ausdrücklich angelegt.
  const { dienst } = await mitSchema('p1');
  const anwendung = await dienst.vorschau('f-regel', LEER_BEREINIGEN, {
    region: DEFAULT_REGION,
    qualitaet: [
      {
        id: 'kdnr-pflicht',
        name: 'Alles erlaubt',
        feld: 'kdnr',
        pruefung: { art: 'BEREICH' },
        schwere: 'INFO',
      },
    ],
  });

  assert.equal(anwendung.zulaessig, false);
});
