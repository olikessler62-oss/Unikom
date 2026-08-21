import assert from 'node:assert/strict';
import test from 'node:test';

import { AUSGELIEFERTE_REGELN } from '../quality/Regeln.js';
import { DEFAULT_REGION } from '../tenants/Region.js';
import { pruefeErgebnis, type Pruefauftrag } from './Ergebnispruefung.js';
import { istGueltig, type Ergebnisstand } from './Ergebnisstand.js';
import { beurteileFreigabe, darfManuellFreigeben } from './Freigabe.js';

const EINGANG = {
  felder: ['kdnr', 'ort', 'telefon'],
  zeilen: [
    ['4711', 'Bonn', '069 1'],
    ['4712', 'Köln', '069 2'],
    ['4713', 'Kiel', '069 3'],
  ],
};

function auftrag(teile: Partial<Pruefauftrag> = {}): Pruefauftrag {
  return {
    eingang: EINGANG,
    ergebnis: EINGANG,
    region: DEFAULT_REGION,
    verbleib: { herkuenfte: 3, zurueckgestellt: 0, nichtVerarbeitet: 0 },
    ...teile,
  };
}

/* ---------- Vollständigkeit ---------- */

test('ein sauberes Ergebnis braucht keinen Befund', () => {
  // SPEC-08, Abschnitt 12: „Für erfolgreich validierte Daten soll eine
  // kompakte Zusammenfassung ausreichen."
  const pruefung = pruefeErgebnis(auftrag());

  assert.equal(pruefung.sauber, true);
  assert.deepEqual(pruefung.befunde, []);
  assert.equal(pruefung.blockiert, false);
});

test('verschwundene Datensätze sind ein Fehler und keine Warnung', () => {
  /*
   * Die einzige Prüfung, die blockiert. Alles andere lässt sich ansehen und
   * entscheiden; hier nicht, denn niemand weiß, was fehlt.
   */
  const pruefung = pruefeErgebnis(
    auftrag({ verbleib: { herkuenfte: 2, zurueckgestellt: 0, nichtVerarbeitet: 0 } })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'VOLLSTAENDIGKEIT');

  assert.equal(befund?.schwere, 'FEHLER');
  assert.equal(pruefung.blockiert, true);
  assert.match(befund?.auswirkung ?? '', /1 Datensätze lassen sich nicht zuordnen/);
});

test('ein erklärter Verbleib geht auf', () => {
  const pruefung = pruefeErgebnis(
    auftrag({ verbleib: { herkuenfte: 1, zurueckgestellt: 1, nichtVerarbeitet: 1 } })
  );

  assert.equal(pruefung.befunde.some((befund) => befund.art === 'VOLLSTAENDIGKEIT'), false);
});

/* ---------- Anzahl und Abweichung ---------- */

test('ein starker Rückgang der Datensatzzahl fällt auf', () => {
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: { felder: EINGANG.felder, zeilen: [EINGANG.zeilen[0]] },
      verbleib: { herkuenfte: 3, zurueckgestellt: 0, nichtVerarbeitet: 0 },
    })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'ANZAHL');

  assert.equal(befund?.schwere, 'WARNUNG');
  assert.match(befund?.ursache ?? '', /Rückgang um 66\.7 %/);
});

test('ein Feld, das plötzlich leer ist, wird gemeldet — auch wenn alles darin stimmt', () => {
  /*
   * Der Fall, um dessentwillen SPEC-08, Abschnitt 10, den Vergleich verlangt:
   * Keine Typprüfung findet ihn, denn die verbliebenen Werte sind alle richtig.
   */
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: {
        felder: EINGANG.felder,
        zeilen: [
          ['4711', 'Bonn', ''],
          ['4712', 'Köln', ''],
          ['4713', 'Kiel', '069 3'],
        ],
      },
    })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'ABWEICHUNG');

  assert.equal(befund?.feld, 'telefon');
  assert.match(befund?.ursache ?? '', /zu 100\.0 % gefüllt, im Ergebnis nur noch zu 33\.3 %/);
  assert.match(befund?.auswirkung ?? '', /Kein einzelner Wert muss falsch sein/);
});

test('ein gleichbleibender Füllgrad ist kein Befund', () => {
  assert.equal(pruefeErgebnis(auftrag()).befunde.some((befund) => befund.art === 'ABWEICHUNG'), false);
});

/* ---------- Duplikate ---------- */

test('ein Schlüssel, der im Ergebnis zweimal steht, ist ein Konflikt', () => {
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: {
        felder: EINGANG.felder,
        zeilen: [
          ['4711', 'Bonn', '069 1'],
          ['4711', 'Bonn', '069 9'],
          ['4713', 'Kiel', '069 3'],
        ],
      },
      schluessel: { felder: ['kdnr'] },
    })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'DUPLIKATE');

  assert.equal(befund?.schwere, 'KONFLIKT');
  assert.deepEqual(befund?.beispiele, ['4711 (2×)']);
});

/* ---------- Zielstruktur, Pflichtwerte, Datentypen ---------- */

test('ein fehlendes Zielfeld ist ein Fehler', () => {
  const pruefung = pruefeErgebnis(auftrag({ zielstruktur: [{ name: 'iban' }] }));
  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'ZIELSTRUKTUR');

  assert.equal(befund?.schwere, 'FEHLER');
  assert.equal(pruefung.blockiert, true);
});

test('ein zusätzliches Feld wird gesagt, aber hält nichts auf', () => {
  const pruefung = pruefeErgebnis(auftrag({ zielstruktur: [{ name: 'kdnr' }] }));
  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'ZIELSTRUKTUR');

  assert.equal(befund?.schwere, 'INFO');
  assert.deepEqual(befund?.beispiele, ['ort', 'telefon']);
  assert.equal(pruefung.blockiert, false);
});

test('ein leeres Pflichtfeld im Ergebnis wird gezählt und beispielhaft genannt', () => {
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: {
        felder: EINGANG.felder,
        zeilen: [
          ['4711', '', '069 1'],
          ['', 'Köln', '069 2'],
          ['4713', 'Kiel', '069 3'],
        ],
      },
      zielstruktur: [{ name: 'kdnr', pflicht: true }],
    })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'PFLICHTWERTE');

  assert.equal(befund?.schwere, 'KONFLIKT');
  assert.deepEqual(befund?.zahlen, { leer: 1, gesamt: 3 });
  assert.deepEqual(befund?.beispiele, ['Zeile 2']);
});

test('ein Wert, der nicht zum Zieltyp passt, wird gefunden', () => {
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: { felder: ['menge'], zeilen: [['5'], ['1.234,56'], ['keine Zahl']] },
      zielstruktur: [{ name: 'menge', typ: 'INTEGER' }],
      verbleib: undefined,
    })
  );

  const befund = pruefung.befunde.find((eintrag) => eintrag.art === 'DATENTYPEN');

  assert.equal(befund?.zahlen?.daneben, 2);
  assert.deepEqual(befund?.beispiele, ['Zeile 2: „1.234,56"', 'Zeile 3: „keine Zahl"']);
});

/* ---------- Referenzen und Abhängigkeiten ---------- */

test('ein mehrdeutiger Referenztreffer wiegt schwerer als ein fehlender', () => {
  const ohne = pruefeErgebnis(auftrag({ referenzen: [{ bestand: 'PLZ', ohneTreffer: 3, mehrdeutig: 0 }] }));
  const mehrdeutig = pruefeErgebnis(auftrag({ referenzen: [{ bestand: 'PLZ', ohneTreffer: 0, mehrdeutig: 1 }] }));

  assert.equal(ohne.befunde[0].schwere, 'WARNUNG');
  assert.equal(mehrdeutig.befunde[0].schwere, 'KONFLIKT');
});

test('eine Regel, die in tausend Zeilen bricht, ist ein Befund und nicht tausend', () => {
  // Ein Bericht mit tausend gleichen Zeilen wird nicht gelesen.
  const pruefung = pruefeErgebnis(
    auftrag({
      ergebnis: {
        felder: ['email'],
        zeilen: Array.from({ length: 1000 }, () => ['kein-mail']),
      },
      qualitaet: AUSGELIEFERTE_REGELN,
      verbleib: undefined,
    })
  );

  const befunde = pruefung.befunde.filter((eintrag) => eintrag.art === 'ABHAENGIGKEITEN');

  assert.equal(befunde.length, 1);
  assert.equal(befunde[0].zahlen?.zeilen, 1000);
  assert.equal(befunde[0].beispiele?.length, 5, 'ein paar Beispiele, nicht alle');
});

/* ---------- Freigabe (SPEC-08, Abschnitt 13) ---------- */

const SAUBER = pruefeErgebnis(auftrag());

test('spricht nichts dagegen, gibt Unikom selbst frei', () => {
  // Ein Nachtlauf hat keinen Benutzer, der freigeben könnte.
  const urteil = beurteileFreigabe({ pruefung: SAUBER });

  assert.equal(urteil.frei, true);
  assert.equal(urteil.status, 'COMPLETED');
  assert.deepEqual(urteil.hindernisse, []);
});

test('die tragenden Bedingungen stehen im Urteil, nicht nur ein Häkchen', () => {
  // „einschließlich der Bedingungen, die die Freigabe getragen haben."
  const urteil = beurteileFreigabe({ pruefung: SAUBER });

  assert.ok(urteil.bedingungen.length >= 3);
  assert.ok(urteil.bedingungen.every((bedingung) => bedingung.erfuellt && bedingung.aussage.length > 0));
});

test('ein offener kritischer Konflikt hält das Ergebnis zurück', () => {
  const urteil = beurteileFreigabe({ pruefung: SAUBER, konflikte: { offen: 2, kritischOffen: 1 } });

  assert.equal(urteil.frei, false);
  assert.equal(urteil.status, 'WAITING_FOR_RELEASE');
  assert.match(urteil.hindernisse.join(' '), /1 kritische Fälle sind offen/);
});

test('Warnungen halten nichts auf, solange es niemand einstellt', () => {
  const mitWarnung = pruefeErgebnis(
    auftrag({ ergebnis: { felder: EINGANG.felder, zeilen: [EINGANG.zeilen[0]] } })
  );

  assert.equal(beurteileFreigabe({ pruefung: mitWarnung }).frei, true);
  assert.equal(beurteileFreigabe({ pruefung: mitWarnung }).status, 'COMPLETED_WITH_WARNINGS');
  assert.equal(beurteileFreigabe({ pruefung: mitWarnung, bedingungen: { warnungenBlockieren: true } }).frei, false);
});

test('wer jede Freigabe von Hand will, bekommt sie von Hand', () => {
  const urteil = beurteileFreigabe({ pruefung: SAUBER, bedingungen: { immerManuell: true } });

  assert.equal(urteil.frei, false);
  assert.match(urteil.hindernisse[0], /jedes Ergebnis ein Mensch freigibt/);
});

test('eine Mindestmenge lässt sich verlangen', () => {
  assert.equal(beurteileFreigabe({ pruefung: SAUBER, bedingungen: { mindestens: 3 } }).frei, true);
  assert.equal(beurteileFreigabe({ pruefung: SAUBER, bedingungen: { mindestens: 100 } }).frei, false);
});

test('ein Mensch darf über offene Punkte hinweggehen — mit Begründung', () => {
  const urteil = beurteileFreigabe({ pruefung: SAUBER, konflikte: { offen: 1, kritischOffen: 0 } });
  const erlaubt = darfManuellFreigeben(urteil, SAUBER);

  assert.equal(erlaubt.erlaubt, true);
  assert.equal(erlaubt.erlaubt === true && erlaubt.begruendungNoetig, true);
});

test('über einen blockierenden Fehler geht auch ein Mensch nicht hinweg', () => {
  // Dort ist unbekannt, was fehlt — eine Begründung wäre eine Behauptung über
  // etwas, das niemand gesehen hat.
  const kaputt = pruefeErgebnis(auftrag({ verbleib: { herkuenfte: 1, zurueckgestellt: 0, nichtVerarbeitet: 0 } }));
  const erlaubt = darfManuellFreigeben(beurteileFreigabe({ pruefung: kaputt }), kaputt);

  assert.equal(erlaubt.erlaubt, false);
  assert.match(erlaubt.erlaubt === false ? erlaubt.grund : '', /niemand sagen kann, was genau freigegeben würde/);
});

/* ---------- Gültigkeit ---------- */

test('ein Ergebnis ohne Freigabe ist kein gültiges Ergebnis', () => {
  const stand = (teile: Partial<Ergebnisstand>): Ergebnisstand => ({
    id: 'e1',
    tenantId: 'default',
    laufId: 'lauf1',
    jobId: 'job1',
    felder: [],
    zeilen: [],
    pruefung: SAUBER,
    status: 'COMPLETED',
    entstanden: 'x',
    ...teile,
  });

  assert.equal(istGueltig(stand({})), false, 'ohne Vermerk gilt es nicht');
  assert.equal(
    istGueltig(stand({ freigabe: { zeitpunkt: 'x', art: 'AUTOMATISCH', bedingungen: [], pruefstand: {} } })),
    true
  );
  assert.equal(
    istGueltig(
      stand({
        status: 'WAITING_FOR_RELEASE',
        freigabe: { zeitpunkt: 'x', art: 'AUTOMATISCH', bedingungen: [], pruefstand: {} },
      })
    ),
    false
  );
});
