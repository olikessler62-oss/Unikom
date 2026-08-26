import assert from 'node:assert/strict';
import test from 'node:test';

import type { Quelle } from '../../domain/consolidation/Quellen.js';
import { ConsolidationService, type Konsolidierungsauftrag } from './ConsolidationService.js';

const dienst = new ConsolidationService();

const KUNDEN: Quelle = {
  id: 'kunden',
  name: 'Kunden.csv',
  felder: ['kdnr', 'name'],
  zeilen: [
    ['4711', 'Müller GmbH'],
    ['4712', 'Meier KG'],
  ],
};

const ADRESSEN: Quelle = {
  id: 'adressen',
  name: 'Adressen.csv',
  felder: ['kdnr', 'ort'],
  zeilen: [
    ['4711', 'Bonn'],
    ['4713', 'Köln'],
  ],
};

const SCHLUESSEL = { felder: ['kdnr'] };

function auftrag(teile: Partial<Konsolidierungsauftrag>): Konsolidierungsauftrag {
  return {
    quellen: [KUNDEN, ADRESSEN],
    betriebsart: 'ANREICHERN',
    art: 'MERGE',
    fuehrend: 'kunden',
    schluessel: SCHLUESSEL,
    ...teile,
  };
}

function werte(bericht: ReturnType<ConsolidationService['konsolidiere']>, schluessel: string, feld: string): string {
  const zeile = bericht.zeilen.find((eintrag) => eintrag.schluessel === schluessel);

  return zeile ? (zeile.werte[bericht.felder.indexOf(feld)] ?? '') : '';
}

/* ---------- Anreichern und Sammeln (SPEC-02, Abschnitt 30; SPEC-06, Abschnitt 4) ---------- */

test('beim Anreichern ist ein Datensatz ohne Hauptsatz ein Konflikt', () => {
  const bericht = dienst.konsolidiere(auftrag({}));
  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'FEHLENDER_HAUPTSATZ');

  assert.ok(konflikt, 'Kunde 4713 steht nur in den Adressen');
  assert.equal(konflikt.schluessel, '4713');
  assert.equal(konflikt.quelle, 'Adressen.csv');
  assert.equal(bericht.zeilen.some((zeile) => zeile.schluessel === '4713'), false);
});

test('beim Sammeln ist derselbe Datensatz kein Konflikt', () => {
  // Es gibt keine Hauptdatei, auf die er sich beziehen müsste.
  const bericht = dienst.konsolidiere(auftrag({ betriebsart: 'SAMMELN', fuehrend: undefined }));

  assert.equal(bericht.konflikte.length, 0);
  assert.equal(werte(bericht, '4713', 'ort'), 'Köln');
});

test('ein fehlender Hauptsatz darf ausdrücklich zugelassen werden', () => {
  const bericht = dienst.konsolidiere(auftrag({ ohneHauptsatz: 'UEBERNEHMEN' }));

  assert.equal(bericht.konflikte.length, 0);
  assert.equal(werte(bericht, '4713', 'ort'), 'Köln');
});

test('ein fehlender Hauptsatz darf auch übersprungen werden — dann aber lautlos', () => {
  const bericht = dienst.konsolidiere(auftrag({ ohneHauptsatz: 'UEBERSPRINGEN' }));

  assert.equal(bericht.konflikte.length, 0);
  assert.equal(bericht.zeilen.length, 2, '4711 und 4712');
});

test('ohne eingetragene Hauptdatei wird sie nicht erraten', () => {
  const bericht = dienst.konsolidiere(auftrag({ fuehrend: undefined }));
  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'STRUKTUR');

  assert.match(konflikt?.ursache ?? '', /darf nicht erraten werden/);
});

/* ---------- Mehrfachtreffer (SPEC-02, Abschnitt 29) ---------- */

const ZWEI_ADRESSEN: Quelle = {
  id: 'adressen',
  name: 'Adressen.csv',
  felder: ['kdnr', 'ort', 'stand'],
  zeilen: [
    ['4711', 'Bonn', '2020'],
    ['4711', 'Köln', '2026'],
  ],
};

test('mehrere Treffer sind standardmäßig ein Konflikt', () => {
  const bericht = dienst.konsolidiere(auftrag({ quellen: [KUNDEN, ZWEI_ADRESSEN] }));
  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'MEHRFACHTREFFER');

  assert.ok(konflikt);
  assert.equal(konflikt.erwartet, 'Genau ein Treffer je Hauptdatensatz');
  assert.match(konflikt.vorgefunden, /2 Datensätze/);
  assert.equal(bericht.zeilen.some((zeile) => zeile.schluessel === '4711'), false);
});

test('alle Treffer zu übernehmen vervielfacht den Hauptdatensatz', () => {
  const bericht = dienst.konsolidiere(
    auftrag({ quellen: [KUNDEN, ZWEI_ADRESSEN], mehrfachtreffer: { regel: 'ALLE' } })
  );

  const zeilen = bericht.zeilen.filter((zeile) => zeile.schluessel === '4711');

  assert.equal(zeilen.length, 2);
  assert.deepEqual(
    zeilen.map((zeile) => zeile.werte[bericht.felder.indexOf('ort')]).sort(),
    ['Bonn', 'Köln']
  );
});

test('ein Feld der Zusatzdatei darf unter den Treffern entscheiden', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [KUNDEN, ZWEI_ADRESSEN],
      mehrfachtreffer: { regel: 'FELD', feld: 'stand', nimm: 'GROESSTER' },
    })
  );

  assert.equal(werte(bericht, '4711', 'ort'), 'Köln');
  assert.equal(bericht.konflikte.length, 0);
});

/* ---------- Schlüssel ---------- */

test('ein Merge ohne Schlüssel wird nicht heimlich zu einem Append', () => {
  const bericht = dienst.konsolidiere(
    auftrag({ betriebsart: 'SAMMELN', fuehrend: undefined, schluessel: undefined })
  );

  assert.ok(bericht.konflikte.some((konflikt) => konflikt.art === 'KEIN_SCHLUESSEL'));
});

test('ein Append ohne Schlüssel hängt einfach aneinander', () => {
  const bericht = dienst.konsolidiere(
    auftrag({ betriebsart: 'SAMMELN', fuehrend: undefined, art: 'APPEND', schluessel: undefined })
  );

  assert.equal(bericht.konflikte.length, 0);
  assert.equal(bericht.zeilen.length, 4);
});

test('ein Datensatz ohne Schlüsselwert fällt nicht heraus, sondern wird gemeldet', () => {
  const luecke: Quelle = { id: 'adressen', name: 'Adressen.csv', felder: ['kdnr', 'ort'], zeilen: [['', 'Bonn']] };
  const bericht = dienst.konsolidiere(auftrag({ quellen: [KUNDEN, luecke] }));
  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'OHNE_SCHLUESSELWERT');

  assert.equal(konflikt?.zeile, 1);
  assert.equal(konflikt?.feld, 'kdnr');
});

/* ---------- Werte, die sich widersprechen ---------- */

const ORT_A: Quelle = { id: 'crm', name: 'CRM.csv', felder: ['kdnr', 'ort'], zeilen: [['4711', 'Bonn']] };
const ORT_B: Quelle = { id: 'erp', name: 'ERP.csv', felder: ['kdnr', 'ort'], zeilen: [['4711', 'Köln']] };

test('ein Wertekonflikt nennt alles, was zum Entscheiden nötig ist', () => {
  // SPEC-06, Abschnitt 10: Quelle, Feld, erwarteter und vorgefundener Zustand,
  // Ursache und mögliche nächste Schritte.
  const bericht = dienst.konsolidiere(
    auftrag({ quellen: [ORT_A, ORT_B], betriebsart: 'SAMMELN', fuehrend: undefined })
  );

  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'WERTEKONFLIKT');

  assert.ok(konflikt);
  assert.equal(konflikt.feld, 'ort');
  assert.match(konflikt.quelle ?? '', /CRM\.csv/);
  assert.match(konflikt.vorgefunden, /Bonn/);
  assert.match(konflikt.vorgefunden, /Köln/);
  assert.ok(konflikt.ursache && konflikt.naechsteSchritte);
  assert.equal(werte(bericht, '4711', 'ort'), '', 'der strittige Wert bleibt leer');
});

test('eine Entscheidung aus der Konfliktbearbeitung löst ihn ebenfalls', () => {
  /*
   * Der Korrekturlauf rechnet auf **derselben** Lieferung. Ohne diese Vorgabe
   * entstünde hier genau derselbe Konflikt noch einmal — und der Lauf endete,
   * wo der erste endete.
   */
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      vorentscheidungen: [
        { datensatz: '4711', werte: { ort: 'Hamburg' }, herkunft: 'Konfliktfall 3f2a, entschieden von OKE' },
      ],
    })
  );

  assert.equal(werte(bericht, '4711', 'ort'), 'Hamburg');
  assert.equal(
    bericht.konflikte.filter((eintrag) => eintrag.art === 'WERTEKONFLIKT').length,
    0,
    'und er wird nicht noch einmal vorgelegt'
  );
});

test('die Entscheidung steht mit ihrer Herkunft im Ergebnis', () => {
  // Ein Ergebnis, in dem nicht mehr zu sehen ist, welche Werte von Hand gesetzt
  // wurden, wäre genau das, was die Nachvollziehbarkeit verhindern soll.
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      vorentscheidungen: [
        { datensatz: '4711', werte: { ort: 'Hamburg' }, herkunft: 'Konfliktfall 3f2a, entschieden von OKE' },
      ],
    })
  );

  const zeile = bericht.zeilen.find((eintrag) => eintrag.schluessel === '4711');
  const feld = zeile?.entscheidungen.find((eintrag) => eintrag.feld === 'ort');

  assert.equal(feld?.grund, 'KONFLIKTBEARBEITUNG');
  assert.match(feld?.begruendung ?? '', /Konfliktfall 3f2a/);
});

test('eine Entscheidung für einen anderen Datensatz lässt den Konflikt stehen', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      vorentscheidungen: [{ datensatz: '9999', werte: { ort: 'Hamburg' }, herkunft: 'anderer Fall' }],
    })
  );

  assert.equal(bericht.konflikte.filter((eintrag) => eintrag.art === 'WERTEKONFLIKT').length, 1);
});

test('eine Quellenpriorität löst denselben Fall ohne Konflikt', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      entscheidung: { quellen: ['erp', 'crm'] },
    })
  );

  assert.equal(bericht.konflikte.length, 0);
  assert.equal(werte(bericht, '4711', 'ort'), 'Köln');

  const zeile = bericht.zeilen.find((eintrag) => eintrag.schluessel === '4711');
  const entscheidung = zeile?.entscheidungen.find((eintrag) => eintrag.feld === 'ort');

  assert.equal(entscheidung?.grund, 'QUELLENPRIORITAET');
  assert.ok(entscheidung?.begruendung, 'ohne festgehaltene Begründung wäre es keine zulässige Entscheidung');
});

test('spricht der Datenstand gegen die Priorität, gilt sie — und es entsteht ein Prüffall', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [
        { ...ORT_A, stand: { geaendert: '2020-01-01T00:00:00Z' } },
        { ...ORT_B, stand: { geaendert: '2026-08-01T00:00:00Z' } },
      ],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      entscheidung: { quellen: ['crm', 'erp'] },
    })
  );

  assert.equal(werte(bericht, '4711', 'ort'), 'Bonn', 'die eingestellte Priorität wirkt');
  assert.equal(bericht.konflikte.length, 1);
  assert.match(bericht.konflikte[0].vorgefunden, /jüngeren Datenstand/);
});

/* ---------- Reihenfolge (SPEC-06, Abschnitt 7) ---------- */

test('hängt das Ergebnis an der Ladereihenfolge, wird das gesagt', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      art: 'APPEND',
      dubletten: { auswahl: 'ERSTER' },
    })
  );

  assert.ok(bericht.hinweise.some((hinweis) => /Reihenfolge, in der die Quellen gelesen wurden/.test(hinweis)));
});

test('mit Quellenpriorität ist die Reihenfolge eine fachliche Entscheidung', () => {
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [ORT_A, ORT_B],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      art: 'APPEND',
      dubletten: { auswahl: 'ERSTER' },
      entscheidung: { quellen: ['erp', 'crm'] },
    })
  );

  assert.equal(bericht.hinweise.some((hinweis) => /Ladereihenfolge|gelesen wurden/.test(hinweis)), false);
});

/* ---------- Quellen ---------- */

test('zwei Quellen mit derselben Kennung sind ein Strukturfehler', () => {
  const bericht = dienst.konsolidiere(auftrag({ quellen: [KUNDEN, { ...ADRESSEN, id: 'kunden' }] }));

  assert.ok(bericht.konflikte.some((konflikt) => /kommt zweimal vor/.test(konflikt.vorgefunden)));
});

test('jede Ergebniszeile weiß, woraus sie entstanden ist', () => {
  const bericht = dienst.konsolidiere(auftrag({}));
  const zeile = bericht.zeilen.find((eintrag) => eintrag.schluessel === '4711');

  assert.deepEqual(zeile?.herkunft, [
    { quelle: 'kunden', zeile: 1 },
    { quelle: 'adressen', zeile: 1 },
  ]);
});

/* ---------- Referenzdaten ---------- */

const PLZ = {
  id: 'plz',
  name: 'Postleitzahlen',
  version: '2026-01',
  felder: ['plz', 'ort'],
  zeilen: [['53111', 'Bonn']],
};

test('eine Referenz ergänzt einen fehlenden Wert und nennt ihren Stand', () => {
  const quelle: Quelle = { id: 'q', name: 'Q.csv', felder: ['kdnr', 'plz', 'ort'], zeilen: [['1', '53111', '']] };
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [quelle],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      referenzen: [{ bestand: PLZ, regel: { felder: ['plz'], uebernehmen: [{ feld: 'ort', aus: 'ort' }] } }],
    })
  );

  assert.equal(werte(bericht, '1', 'ort'), 'Bonn');
  assert.deepEqual(bericht.referenzen, [
    { bestand: 'Postleitzahlen', version: '2026-01', treffer: 1, ohneTreffer: 0, mehrdeutig: 0, uebernahmen: 1 },
  ]);
});

test('eine Referenz korrigiert keinen vorhandenen Wert', () => {
  const quelle: Quelle = { id: 'q', name: 'Q.csv', felder: ['kdnr', 'plz', 'ort'], zeilen: [['1', '53111', 'Bönn']] };
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [quelle],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      referenzen: [{ bestand: PLZ, regel: { felder: ['plz'], uebernehmen: [{ feld: 'ort', aus: 'ort' }] } }],
    })
  );

  assert.equal(werte(bericht, '1', 'ort'), 'Bönn', 'was in den Daten steht, bleibt stehen');
  assert.equal(bericht.konflikte.length, 1);
  assert.match(bericht.konflikte[0].ursache, /ergänzt fehlende Werte und korrigiert keine vorhandenen/);
});

/* ---------- Ergänzung ---------- */

test('ein Schlüsselfeld wird nicht aus vergleichbaren Datensätzen ergänzt', () => {
  // Ein ergänzter Schlüssel schöbe den Datensatz still in eine andere Gruppe.
  // Geprüft wird deshalb nicht nur, dass es dasteht, sondern dass es gilt.
  const quelle: Quelle = {
    id: 'q',
    name: 'Q.csv',
    felder: ['kdnr', 'ort'],
    zeilen: [
      ['4711', 'Bonn'],
      ['4711', 'Bonn'],
      ['', 'Bonn'],
    ],
  };

  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [quelle],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      art: 'APPEND',
      ergaenzung: { vergleichbarAn: ['ort'], felder: ['kdnr'] },
    })
  );

  assert.ok(bericht.hinweise.some((hinweis) => /gehört zum Konsolidierungsschlüssel/.test(hinweis)));
  assert.deepEqual(bericht.ergaenzungen, [], 'die Kundennummer bleibt leer');
  assert.ok(
    bericht.konflikte.some((konflikt) => konflikt.art === 'OHNE_SCHLUESSELWERT'),
    'der Datensatz bleibt ohne Schlüssel und wird als solcher gemeldet'
  );
});

/* ---------- Was eine Dublette ist und was nicht ---------- */

test('Haupt- und Zusatzdatensatz sind keine Dublette, sondern der Zweck', () => {
  // Sonst wäre der Normalfall ein Befund, und nach zehn Läufen liest den
  // Bericht niemand mehr.
  const bericht = dienst.konsolidiere(auftrag({}));

  assert.equal(bericht.dubletten.length, 0);
  assert.equal(werte(bericht, '4711', 'ort'), 'Bonn', 'zusammengeführt wurde trotzdem');
});

test('zwei Datensätze der Hauptdatei mit demselben Schlüssel sind eine Dublette', () => {
  const doppelt: Quelle = {
    id: 'kunden',
    name: 'Kunden.csv',
    felder: ['kdnr', 'name'],
    zeilen: [
      ['4711', 'Müller GmbH'],
      ['4711', 'Mueller GmbH'],
    ],
  };

  const bericht = dienst.konsolidiere(auftrag({ quellen: [doppelt, ADRESSEN] }));

  assert.equal(bericht.dubletten.length, 1);
  assert.equal(bericht.dubletten[0].art, 'INNERHALB');
  assert.equal(bericht.dubletten[0].exakt, false);
});

test('beim Sammeln ist jeder zweite Datensatz der Gruppe eine Dublette', () => {
  const bericht = dienst.konsolidiere(
    auftrag({ quellen: [ORT_A, ORT_B], betriebsart: 'SAMMELN', fuehrend: undefined })
  );

  assert.equal(bericht.dubletten.length, 1);
  assert.equal(bericht.dubletten[0].art, 'UEBERGREIFEND');
});

test('die Zusammenfassung zählt, was geschehen ist', () => {
  const bericht = dienst.konsolidiere(auftrag({}));

  assert.deepEqual(bericht.zusammenfassung, {
    quellen: 2,
    gelesen: 4,
    ergebnis: 2,
    zusammengefuehrt: 1,
    dubletten: 0,
    konflikte: 1,
    ergaenzt: 0,
    verdacht: 0,
    nichtVerarbeitet: 1,
  });
});

test('kein Datensatz verschwindet unbemerkt', () => {
  /*
   * Die Verbleibsrechnung: Jeder gelesene Datensatz steht entweder in einer
   * Ergebniszeile, ist zurückgetreten oder ist als nicht verarbeitet vermerkt.
   * Ohne diese Zusage wäre „gelesen minus Ergebnis" eine Zahl, die niemand
   * erklären kann — und die Ergebnisprüfung aus Etappe 7 hinge in der Luft.
   */
  const bericht = dienst.konsolidiere(auftrag({}));
  const verbleib = new Set<string>();

  for (const zeile of bericht.zeilen) {
    for (const herkunft of zeile.herkunft) {
      verbleib.add(`${herkunft.quelle}:${herkunft.zeile}`);
    }
  }

  assert.equal(bericht.nichtVerarbeitet.length, 1, 'Kunde 4713 steht nur in den Adressen');
  assert.match(bericht.nichtVerarbeitet[0].grund, /Kein Hauptdatensatz/);
  assert.equal(
    verbleib.size + bericht.zurueckgestellt.length + bericht.nichtVerarbeitet.length,
    bericht.zusammenfassung.gelesen,
    'die Rechnung geht auf'
  );
});

/* ---------- Fuzzy Matching (SPEC-04, Abschnitt 6 und 7) ---------- */

const MEIER: Quelle = {
  id: 'nord',
  name: 'Filiale-Nord.csv',
  felder: ['kdnr', 'nachname', 'ort'],
  zeilen: [['1', 'Meier', 'Bonn']],
};

const MAIER: Quelle = {
  id: 'sued',
  name: 'Filiale-Süd.csv',
  felder: ['kdnr', 'nachname', 'ort'],
  zeilen: [['2', 'Maier', 'Bonn']],
};

test('ohne Einstellung wird nicht nach Ähnlichkeit gesucht', () => {
  const bericht = dienst.konsolidiere(
    auftrag({ quellen: [MEIER, MAIER], betriebsart: 'SAMMELN', fuehrend: undefined })
  );

  assert.deepEqual(bericht.verdacht, []);
  assert.equal(bericht.zusammenfassung.verdacht, 0);
});

test('ähnliche Datensätze werden gefragt und nicht zusammengeführt', () => {
  // „Ähnlichkeit allein berechtigt nicht zu einer automatischen
  // Zusammenführung." Beide Zeilen bleiben stehen.
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [MEIER, MAIER],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      aehnlichkeit: { felder: ['nachname', 'ort'], schwelle: 0.75 },
    })
  );

  assert.equal(bericht.zeilen.length, 2, 'beide Datensätze bleiben im Ergebnis');
  assert.equal(bericht.verdacht.length, 1);
  assert.deepEqual(bericht.verdacht[0].links, { quelle: 'nord', zeile: 1 });
  assert.deepEqual(bericht.verdacht[0].rechts, { quelle: 'sued', zeile: 1 });

  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'DUBLETTE_VERMUTET');

  assert.match(konflikt?.vorgefunden ?? '', /Meier/);
  assert.match(konflikt?.vorgefunden ?? '', /Maier/);
  assert.match(konflikt?.ursache ?? '', /berechtigt nicht dazu/);
});

test('was der Schlüssel schon zusammengebracht hat, wird nicht noch vermutet', () => {
  // Zweimal dieselbe Auskunft ist eine zu viel.
  const doppelt: Quelle = {
    id: 'nord',
    name: 'Filiale-Nord.csv',
    felder: ['kdnr', 'nachname'],
    zeilen: [
      ['1', 'Meier'],
      ['1', 'Maier'],
    ],
  };

  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [doppelt],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      aehnlichkeit: { felder: ['nachname'], schwelle: 0.75 },
    })
  );

  assert.deepEqual(bericht.verdacht, [], 'sie stehen bereits unter demselben Schlüssel');
  assert.equal(bericht.dubletten.length, 1, 'als Dublette aber sehr wohl');
});

test('bei zu vielen Datensätzen wird die Suche abgebrochen und gemeldet', () => {
  const viele: Quelle = {
    id: 'q',
    name: 'Q.csv',
    felder: ['kdnr', 'nachname'],
    zeilen: Array.from({ length: 6 }, (unbenutzt, stelle) => [String(stelle), `Meier${stelle}`]),
  };

  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [viele],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      aehnlichkeit: { felder: ['nachname'], hoechstens: 5 },
    })
  );

  assert.ok(bericht.hinweise.some((hinweis) => /jeden Datensatz mit jedem/.test(hinweis)));
  assert.deepEqual(bericht.verdacht, []);
});

test('eine Referenz nennt den naheliegenden Eintrag, übernimmt ihn aber nicht', () => {
  const quelle: Quelle = { id: 'q', name: 'Q.csv', felder: ['kdnr', 'plz', 'ort'], zeilen: [['1', '53112', '']] };
  const bericht = dienst.konsolidiere(
    auftrag({
      quellen: [quelle],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      referenzen: [
        {
          bestand: PLZ,
          regel: {
            felder: ['plz'],
            uebernehmen: [{ feld: 'ort', aus: 'ort' }],
            ohneTreffer: 'KONFLIKT',
            aehnlich: { schwelle: 0.8 },
          },
        },
      ],
    })
  );

  assert.equal(werte(bericht, '1', 'ort'), '', 'nichts übernommen');
  assert.equal(bericht.referenzen[0].uebernahmen, 0);

  const konflikt = bericht.konflikte.find((eintrag) => eintrag.art === 'REFERENZ_FEHLT');

  assert.match(konflikt?.ursache ?? '', /Am nächsten liegt/);
  assert.match(konflikt?.ursache ?? '', /53111/);
  assert.match(konflikt?.ursache ?? '', /Ähnlichkeit ist keine Gleichheit/);
});

/*
 * Ein langer Wert, damit die Voreinstellung von 0,85 überhaupt greifen kann:
 * „Frankfurt am Mian" ist ein Buchstabendreher auf siebzehn Zeichen und damit
 * zu 94 % ähnlich. Bei einer fünfstelligen Postleitzahl ließe dieselbe Schwelle
 * keine einzige Änderung zu — dort prüfte der Test nichts, und die Einstellung
 * ließe sich entfernen, ohne dass er anschlägt.
 */
const STAEDTE = {
  id: 'staedte',
  name: 'Städteverzeichnis',
  version: '2026-01',
  felder: ['stadt', 'land'],
  zeilen: [['Frankfurt am Main', 'Hessen']],
};

function stadtlauf(aehnlich: boolean) {
  const quelle: Quelle = { id: 'q', name: 'Q.csv', felder: ['kdnr', 'stadt'], zeilen: [['1', 'Frankfurt am Mian']] };

  return dienst.konsolidiere(
    auftrag({
      quellen: [quelle],
      betriebsart: 'SAMMELN',
      fuehrend: undefined,
      referenzen: [{ bestand: STAEDTE, regel: { felder: ['stadt'], ohneTreffer: 'KONFLIKT', aehnlich } }],
    })
  );
}

test('mit der Einstellung nennt die Referenz den naheliegenden Eintrag', () => {
  const konflikt = stadtlauf(true).konflikte.find((eintrag) => eintrag.art === 'REFERENZ_FEHLT');

  assert.match(konflikt?.ursache ?? '', /Am nächsten liegt „Frankfurt am Main"/);
});

test('ohne die Einstellung schweigt die Referenz über Ähnliches', () => {
  const konflikt = stadtlauf(false).konflikte.find((eintrag) => eintrag.art === 'REFERENZ_FEHLT');

  assert.ok(konflikt, 'der Fehltreffer wird weiterhin gemeldet');
  assert.doesNotMatch(konflikt.ursache, /Am nächsten/);
});
