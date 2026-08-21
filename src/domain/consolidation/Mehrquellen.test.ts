import assert from 'node:assert/strict';
import test from 'node:test';

import { behandleDubletten, dublettenart, istExakt } from './Dubletten.js';
import { ergaenze } from './Ergaenzung.js';
import { entscheide, type Angebot } from './Prioritaet.js';
import { datensaetze, waehleBlatt, type Datensatz, type Quelle } from './Quellen.js';
import { gleicheAb, referenzindex, type Referenzbestand } from './Referenz.js';
import { gruppiere, schluesselVon, vergleichswert } from './Schluessel.js';
import { fuehreZusammen } from './Zusammenfuehren.js';

function satz(quelle: string, zeile: number, werte: Record<string, string>, stand?: Datensatz['stand']): Datensatz {
  return { quelle, zeile, werte: new Map(Object.entries(werte)), stand };
}

function quelle(id: string, felder: string[], zeilen: string[][], stand?: Quelle['stand']): Quelle {
  return { id, name: `${id}.csv`, felder, zeilen, stand };
}

/* ---------- Konsolidierungsschlüssel (SPEC-06, Abschnitt 3) ---------- */

test('ein zusammengesetzter Schlüssel braucht alle seine Teile', () => {
  // Zwei von drei Feldern ergeben keinen kürzeren Schlüssel, sondern einen
  // falschen: Er trifft auf mehr Datensätze zu, als gemeint waren.
  const ergebnis = schluesselVon(satz('a', 1, { nachname: 'Meier', vorname: '', geburt: '1970-01-01' }), {
    felder: ['nachname', 'vorname', 'geburt'],
  });

  assert.equal(ergebnis.ok, false);
  assert.deepEqual(ergebnis.ok === false ? ergebnis.fehlend : [], ['vorname']);
});

test('jede Quelle darf die Schlüsselfelder anders nennen', () => {
  const schluessel = { felder: ['kundennummer'], jeQuelle: { adressen: ['KundenID'] } };
  const links = schluesselVon(satz('kunden', 1, { kundennummer: '4711' }), schluessel);
  const rechts = schluesselVon(satz('adressen', 1, { KundenID: '4711' }), schluessel);

  assert.equal(links.ok && rechts.ok && links.wert === rechts.wert, true);
});

test('eine unvollständige Angabe je Quelle verkürzt den Schlüssel nicht', () => {
  // Sonst bestünde er in dieser Quelle aus einem Feld statt aus zweien — und
  // plötzlich gälten zwei verschiedene Kunden als einer.
  const schluessel = { felder: ['mandant', 'kundennummer'], jeQuelle: { adressen: ['Mandant'] } };
  const ergebnis = schluesselVon(satz('adressen', 1, { Mandant: 'M1', kundennummer: '4711' }), schluessel);

  assert.equal(ergebnis.ok, true);
  assert.deepEqual(ergebnis.ok === true ? ergebnis.teile : [], ['M1', '4711']);
});

test('Umlaute werden nur gefaltet, wenn es eingestellt ist', () => {
  const streng = { grossKleinEgal: true };
  const gefaltet = { grossKleinEgal: true, umlauteEgal: true };

  assert.notEqual(vergleichswert('Müller GmbH', streng), vergleichswert('Mueller GmbH', streng));
  assert.equal(vergleichswert('Müller GmbH', gefaltet), vergleichswert('Mueller GmbH', gefaltet));
  assert.equal(vergleichswert('MÜLLER GMBH', gefaltet), vergleichswert('mueller gmbh', gefaltet));
});

test('Akzente fallen mit, wenn Umlaute gefaltet werden', () => {
  assert.equal(vergleichswert('José', { grossKleinEgal: true, umlauteEgal: true }), 'jose');
});

test('zusammengesetzte Schlüssel stoßen nicht aneinander', () => {
  // „Meier" + „Hof" darf nicht derselbe Schlüssel sein wie „Meierh" + „of".
  // Ohne Trennzeichen wäre er es — und zwei Kunden wären einer.
  const schluessel = { felder: ['a', 'b'] };
  const links = schluesselVon(satz('q', 1, { a: 'Meier', b: 'Hof' }), schluessel);
  const rechts = schluesselVon(satz('q', 2, { a: 'Meierh', b: 'of' }), schluessel);

  assert.notEqual(links.ok && links.wert, rechts.ok && rechts.wert);
});

test('was keinen Schlüssel hat, fällt nicht heraus, sondern wird ausgewiesen', () => {
  const gruppierung = gruppiere(
    [satz('a', 1, { nr: '1' }), satz('a', 2, { nr: '' }), satz('b', 1, { nr: '1' })],
    { felder: ['nr'] }
  );

  assert.equal(gruppierung.gruppen.size, 1);
  assert.equal(gruppierung.ohne.length, 1);
  assert.equal(gruppierung.ohne[0].datensatz.zeile, 2);
});

/* ---------- Priorität (SPEC-04, Abschnitt 8; SPEC-06, Abschnitt 5) ---------- */

const A: Angebot = { quelle: 'crm', wert: 'Bonn' };
const B: Angebot = { quelle: 'erp', wert: 'Köln' };

test('wo alle dasselbe sagen, wird nichts entschieden', () => {
  const ergebnis = entscheide('ort', [A, { quelle: 'erp', wert: 'Bonn' }]);

  assert.equal(ergebnis.entschieden, true);
  assert.equal(ergebnis.entschieden === true ? ergebnis.grund : '', 'EINIG');
});

test('wo nur einer etwas sagt, wird ergänzt und nicht gewählt', () => {
  const ergebnis = entscheide('telefon', [
    { quelle: 'a', wert: '' },
    { quelle: 'b', wert: '069 123456' },
  ]);

  assert.equal(ergebnis.entschieden && ergebnis.wert, '069 123456');
  assert.equal(ergebnis.entschieden && ergebnis.konfidenz, 1);
});

test('die Benutzerregel schlägt die Quellenpriorität', () => {
  const ergebnis = entscheide('ort', [A, B], {
    benutzer: { ort: { quelle: 'erp' } },
    quellen: ['crm', 'erp'],
  });

  assert.equal(ergebnis.entschieden && ergebnis.grund, 'BENUTZERREGEL');
  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Köln');
});

test('die feldspezifische Priorität schlägt die allgemeine', () => {
  const ergebnis = entscheide('ort', [A, B], { jeFeld: { ort: ['erp'] }, quellen: ['crm', 'erp'] });

  assert.equal(ergebnis.entschieden && ergebnis.grund, 'FELDPRIORITAET');
  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Köln');
});

test('eine eingestellte Priorität gilt — und meldet, was dagegen spricht', () => {
  // SPEC-04, Abschnitt 8: Sie wird weder stillschweigend übergangen noch
  // stillschweigend angewendet.
  const ergebnis = entscheide(
    'ort',
    [
      { ...A, stand: { geaendert: '2020-01-01T00:00:00Z' } },
      { ...B, stand: { geaendert: '2026-08-01T00:00:00Z' } },
    ],
    { quellen: ['crm', 'erp'] }
  );

  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Bonn');
  assert.match(ergebnis.entschieden ? (ergebnis.pruefhinweis ?? '') : '', /jüngeren Datenstand/);
});

test('ohne bekannten Zeitpunkt spricht nichts gegen die Priorität', () => {
  // „Unbekannt" ist nicht „älter". Ein Prüffall aus einer fehlenden Angabe
  // wäre Lärm, der die echten Prüffälle zudeckt.
  const ergebnis = entscheide('ort', [{ ...A, stand: { geaendert: '2020-01-01T00:00:00Z' } }, B], {
    quellen: ['crm', 'erp'],
  });

  assert.equal(ergebnis.entschieden && ergebnis.pruefhinweis, undefined);
});

test('ohne eigenen Zeitpunkt lässt sich nichts dagegen halten', () => {
  // Die gewählte Quelle hat kein Datum, die übergangene schon. Auch das ist
  // kein Gegenbeweis: Ein Vergleich braucht zwei Seiten.
  const ergebnis = entscheide('ort', [A, { ...B, stand: { geaendert: '2026-08-01T00:00:00Z' } }], {
    quellen: ['crm', 'erp'],
  });

  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Bonn');
  assert.equal(ergebnis.entschieden && ergebnis.pruefhinweis, undefined);
});

test('die Aktualität entscheidet nicht, wenn einer Quelle das Datum fehlt', () => {
  const ergebnis = entscheide('ort', [{ ...A, stand: { geaendert: '2026-01-01T00:00:00Z' } }, B], {
    aktualitaet: true,
  });

  assert.equal(ergebnis.entschieden, false);
  assert.match(ergebnis.entschieden === false ? ergebnis.begruendung : '', /Vermutung und keine Regel/);
});

test('die Aktualität nimmt den jüngsten Stand', () => {
  const ergebnis = entscheide(
    'ort',
    [
      { ...A, stand: { geaendert: '2020-01-01T00:00:00Z' } },
      { ...B, stand: { geaendert: '2026-08-01T00:00:00Z' } },
    ],
    { aktualitaet: true }
  );

  assert.equal(ergebnis.entschieden && ergebnis.grund, 'AKTUALITAET');
  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Köln');
});

test('zwei gegen eine Quelle reicht nicht an die Schwelle heran', () => {
  const ergebnis = entscheide('ort', [A, { quelle: 'erp', wert: 'Bonn' }, { quelle: 'import', wert: 'Köln' }]);

  assert.equal(ergebnis.entschieden, false);
  assert.equal(ergebnis.konfidenz.toFixed(2), '0.67');
});

test('eine erdrückende Mehrheit darf entscheiden — mit festgehaltener Begründung', () => {
  const viele: Angebot[] = Array.from({ length: 40 }, (unbenutzt, stelle) => ({
    quelle: `q${stelle}`,
    wert: stelle === 0 ? 'Bon' : 'Bonn',
  }));

  const ergebnis = entscheide('ort', viele);

  assert.equal(ergebnis.entschieden && ergebnis.grund, 'MEHRHEIT');
  assert.equal(ergebnis.entschieden && ergebnis.wert, 'Bonn');
  assert.match(ergebnis.entschieden ? ergebnis.begruendung : '', /39 von 40/);
});

test('die Schwelle lässt sich heraufsetzen, aber nicht unterschreiten', () => {
  // SPEC-02, Abschnitt 5: 97 % sind eine Untergrenze.
  const viele: Angebot[] = Array.from({ length: 40 }, (unbenutzt, stelle) => ({
    quelle: `q${stelle}`,
    wert: stelle === 0 ? 'Bon' : 'Bonn',
  }));

  assert.equal(entscheide('ort', viele, { mindestKonfidenz: 0.5 }).entschieden, true);
  assert.equal(entscheide('ort', viele, { mindestKonfidenz: 0.99 }).entschieden, false);

  const drei = [A, { quelle: 'erp', wert: 'Bonn' }, { quelle: 'import', wert: 'Köln' }];

  assert.equal(entscheide('ort', drei, { mindestKonfidenz: 0.5 }).entschieden, false, '0,5 gilt nicht');
});

/* ---------- Zusammenführen (SPEC-04, Abschnitt 7) ---------- */

test('das Beispiel aus der Spec: aus zwei halben Datensätzen wird ein ganzer', () => {
  const ergebnis = fuehreZusammen('4711', [
    satz('a', 1, { name: 'Müller GmbH', telefon: '', email: 'info@mueller.de' }),
    satz('b', 1, { name: 'Mueller GmbH', telefon: '069 123456', email: '' }),
  ], { vergleich: { grossKleinEgal: true, umlauteEgal: true }, quellen: ['a', 'b'] });

  assert.equal(ergebnis.werte.get('name'), 'Müller GmbH');
  assert.equal(ergebnis.werte.get('telefon'), '069 123456');
  assert.equal(ergebnis.werte.get('email'), 'info@mueller.de');
  assert.equal(ergebnis.konflikte.length, 0);
});

test('ein Feld, das eine Quelle gar nicht hat, ist keine Stimme', () => {
  // Sonst zählte eine Quelle ohne Telefonspalte als Stimme für „kein Telefon".
  const ergebnis = fuehreZusammen('4711', [
    satz('a', 1, { name: 'Meier' }),
    satz('b', 1, { name: 'Meier', telefon: '069 1' }),
  ]);

  assert.equal(ergebnis.werte.get('telefon'), '069 1');
  assert.equal(ergebnis.konflikte.length, 0);
});

test('ein Konflikt hält den übrigen Datensatz nicht auf', () => {
  const ergebnis = fuehreZusammen('4711', [
    satz('a', 1, { name: 'Meier', ort: 'Bonn' }),
    satz('b', 1, { name: 'Meier', ort: 'Köln' }),
  ]);

  assert.equal(ergebnis.werte.get('name'), 'Meier');
  assert.equal(ergebnis.werte.get('ort'), '', 'der strittige Wert bleibt leer statt geraten');
  assert.equal(ergebnis.konflikte.length, 1);
  assert.equal(ergebnis.konflikte[0].feld, 'ort');
});

test('jedes Feld trägt seine Herkunft', () => {
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 3, { ort: 'Bonn' }), satz('b', 7, { ort: 'Köln' })],
    { quellen: ['b', 'a'] }
  );

  const ort = ergebnis.felder.find((feld) => feld.feld === 'ort');

  assert.equal(ort?.quelle, 'b');
  assert.equal(ort?.grund, 'QUELLENPRIORITAET');
  assert.deepEqual(ergebnis.herkunft, [
    { quelle: 'a', zeile: 3 },
    { quelle: 'b', zeile: 7 },
  ]);
});

/* ---------- Dubletten (SPEC-06, Abschnitt 6) ---------- */

test('wörtlich gleich und fachlich gleich sind zweierlei', () => {
  assert.equal(istExakt([satz('a', 1, { n: 'Müller' }), satz('b', 1, { n: 'Müller' })]), true);
  assert.equal(istExakt([satz('a', 1, { n: 'Müller' }), satz('b', 1, { n: 'Mueller' })]), false);
});

test('Dubletten innerhalb einer Quelle und zwischen Quellen werden unterschieden', () => {
  assert.equal(dublettenart([satz('a', 1, {}), satz('a', 2, {})]), 'INNERHALB');
  assert.equal(dublettenart([satz('a', 1, {}), satz('b', 1, {})]), 'UEBERGREIFEND');
  assert.equal(dublettenart([satz('a', 1, {}), satz('a', 2, {}), satz('b', 1, {})]), 'BEIDES');
});

test('eine zurückgetretene Dublette verschwindet nicht, sondern wird ausgewiesen', () => {
  const ergebnis = behandleDubletten(
    '4711',
    [satz('a', 1, { n: 'x' }), satz('b', 5, { n: 'y' })],
    { auswahl: 'ERSTER', verbleib: 'VERWERFEN' }
  );

  assert.equal(ergebnis.behandlung.datensaetze.length, 1);
  assert.equal(ergebnis.beiseite.length, 1);
  assert.equal(ergebnis.beiseite[0].datensatz.zeile, 5);
  assert.equal(ergebnis.beiseite[0].verbleib, 'VERWERFEN');
  assert.ok(ergebnis.beiseite[0].grund);
});

test('nach Priorität auszuwählen, ohne dass eine eingerichtet ist, entscheidet nicht', () => {
  const ergebnis = behandleDubletten('4711', [satz('a', 1, {}), satz('b', 1, {})], { auswahl: 'PRIORITAET' }, []);

  assert.equal(ergebnis.behandlung.art, 'ENTSCHEIDUNG');
  assert.match(ergebnis.befund?.behandlung ?? '', /keine der beteiligten Quellen/);
});

test('ein einzelner Datensatz ist keine Dublette', () => {
  const ergebnis = behandleDubletten('4711', [satz('a', 1, {})], { auswahl: 'ERSTER' });

  assert.equal(ergebnis.befund, undefined);
  assert.equal(ergebnis.beiseite.length, 0);
});

/* ---------- Referenzdaten (SPEC-04, Abschnitt 6) ---------- */

const ORTE: Referenzbestand = {
  id: 'plz',
  name: 'Postleitzahlen',
  version: '2026-01',
  felder: ['plz', 'ort'],
  zeilen: [
    ['53111', 'Bonn'],
    ['50667', 'Köln'],
    ['99999', 'Doppeldorf'],
    ['99999', 'Zwillingsstadt'],
  ],
};

test('genau ein Treffer darf übernommen werden', () => {
  const index = referenzindex(ORTE, { felder: ['plz'], uebernehmen: [{ feld: 'ort', aus: 'ort' }] });
  const ergebnis = gleicheAb(satz('a', 1, { plz: '53111', ort: '' }), index);

  assert.equal(ergebnis.art, 'TREFFER');
  assert.deepEqual(
    ergebnis.art === 'TREFFER' ? ergebnis.uebernahmen.map((eintrag) => eintrag.wert) : [],
    ['Bonn']
  );
  assert.match(ergebnis.art === 'TREFFER' ? ergebnis.begruendung : '', /Stand 2026-01/);
});

test('ohne ausdrückliche Übernahme wird nur geprüft', () => {
  const index = referenzindex(ORTE, { felder: ['plz'] });
  const ergebnis = gleicheAb(satz('a', 1, { plz: '53111' }), index);

  assert.equal(ergebnis.art === 'TREFFER' && ergebnis.uebernahmen.length, 0);
});

test('mehrere plausible Treffer entscheidet kein Programm', () => {
  const index = referenzindex(ORTE, { felder: ['plz'], uebernehmen: [{ feld: 'ort', aus: 'ort' }] });
  const ergebnis = gleicheAb(satz('a', 1, { plz: '99999' }), index);

  assert.equal(ergebnis.art, 'MEHRDEUTIG');
  assert.match(ergebnis.art === 'MEHRDEUTIG' ? ergebnis.meldung : '', /Reihenfolge in der Referenzdatei/);
});

test('was mit einem fehlenden Treffer geschieht, steht im Profil', () => {
  const streng = referenzindex(ORTE, { felder: ['plz'], ohneTreffer: 'KONFLIKT' });
  const milde = referenzindex(ORTE, { felder: ['plz'], ohneTreffer: 'IGNORIEREN' });

  assert.equal(
    gleicheAb(satz('a', 1, { plz: '00000' }), streng).art === 'KEIN_TREFFER' &&
      (gleicheAb(satz('a', 1, { plz: '00000' }), streng) as { folge: string }).folge,
    'KONFLIKT'
  );
  assert.equal(
    (gleicheAb(satz('a', 1, { plz: '00000' }), milde) as { folge: string }).folge,
    'IGNORIEREN'
  );
});

test('Referenzdaten lassen sich nicht verändern', () => {
  // „Eine Konsolidierung darf die Referenzdaten nicht verändern." Das steht
  // hier nicht als Vorsatz, sondern als eingefrorenes Objekt.
  const index = referenzindex({ ...ORTE }, { felder: ['plz'] });

  assert.throws(() => {
    (index.bestand as { name: string }).name = 'etwas anderes';
  }, TypeError);

  assert.throws(() => {
    (index.bestand.zeilen as string[][])[0][1] = 'Nicht-Bonn';
  }, TypeError);
});

test('ein unvollständiger Schlüssel sucht nicht irgendetwas', () => {
  const index = referenzindex(ORTE, { felder: ['plz'] });
  const ergebnis = gleicheAb(satz('a', 1, { plz: '' }), index);

  assert.equal(ergebnis.art, 'UNVOLLSTAENDIG');
});

/* ---------- Ergänzung aus vergleichbaren Datensätzen (SPEC-08, Abschnitt 5) ---------- */

const REGEL = { vergleichbarAn: ['kundennummer'], felder: ['ort'] };

test('konsistente Nachbarn ergänzen einen fehlenden Wert', () => {
  const ergebnis = ergaenze(
    [
      satz('a', 1, { kundennummer: '4711', ort: 'Bonn' }),
      satz('a', 2, { kundennummer: '4711', ort: 'Bonn' }),
      satz('a', 3, { kundennummer: '4711', ort: '' }),
    ],
    REGEL
  );

  assert.equal(ergebnis.datensaetze[2].werte.get('ort'), 'Bonn');
  assert.equal(ergebnis.ergaenzungen.length, 1);
  assert.equal(ergebnis.ergaenzungen[0].belege, 2);
  assert.match(ergebnis.ergaenzungen[0].begruendung, /kundennummer = „4711"/);
});

test('widersprüchliche Nachbarn ergänzen nichts', () => {
  const ergebnis = ergaenze(
    [
      satz('a', 1, { kundennummer: '4712', ort: 'Köln' }),
      satz('a', 2, { kundennummer: '4712', ort: 'Koeln' }),
      satz('a', 3, { kundennummer: '4712', ort: '' }),
    ],
    REGEL
  );

  assert.equal(ergebnis.datensaetze[2].werte.get('ort'), '');
  assert.equal(ergebnis.luecken.length, 1);
  assert.match(ergebnis.luecken[0].begruendung, /willkürliche Auswahl/);
});

test('ein einziger Nachbar ist keine Konsistenz', () => {
  const ergebnis = ergaenze(
    [satz('a', 1, { kundennummer: '4711', ort: 'Bonn' }), satz('a', 2, { kundennummer: '4711', ort: '' })],
    REGEL
  );

  assert.equal(ergebnis.ergaenzungen.length, 0);
  assert.equal(ergebnis.luecken.length, 1);
  assert.match(ergebnis.luecken[0].begruendung, /Einzelfall ist keine Konsistenz/);
});

test('die Eingangsdatensätze bleiben unangetastet', () => {
  const eingang = [
    satz('a', 1, { kundennummer: '4711', ort: 'Bonn' }),
    satz('a', 2, { kundennummer: '4711', ort: 'Bonn' }),
    satz('a', 3, { kundennummer: '4711', ort: '' }),
  ];

  ergaenze(eingang, REGEL);

  assert.equal(eingang[2].werte.get('ort'), '');
});

test('ein ergänzter Wert wird nicht selbst zum Beleg', () => {
  // Sonst hinge das Ergebnis daran, in welcher Reihenfolge die Liste
  // durchlaufen wird — und zwei Nachbarn machten aus einem Beleg drei.
  const ergebnis = ergaenze(
    [
      satz('a', 1, { kundennummer: '4711', ort: 'Bonn' }),
      satz('a', 2, { kundennummer: '4711', ort: '' }),
      satz('a', 3, { kundennummer: '4711', ort: '' }),
    ],
    REGEL
  );

  assert.equal(ergebnis.ergaenzungen.length, 0, 'ein Beleg reicht für keinen der beiden');
});

/* ---------- Tabellenblätter (SPEC-06, Abschnitt 8) ---------- */

test('ein Tabellenblatt lässt sich über Namen und über Position wählen', () => {
  assert.deepEqual(waehleBlatt(['Nord', 'Süd'], { name: 'Süd' }), { ok: true, name: 'Süd', position: 2 });
  assert.deepEqual(waehleBlatt(['Nord', 'Süd'], { position: 1 }), { ok: true, name: 'Nord', position: 1 });
});

test('für ein fehlendes Blatt wird kein anderes ersatzweise genommen', () => {
  const ergebnis = waehleBlatt(['Tabelle1', 'Tabelle2'], { name: 'Umsatz 2026' });

  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.ok === false ? ergebnis.meldung : '', /Umsatz 2026/);
  assert.match(ergebnis.ok === false ? ergebnis.meldung : '', /Tabelle1/);
});

/* ---------- Quellen ---------- */

test('der Datenstand der Quelle geht an jeden Datensatz mit', () => {
  const saetze = datensaetze(quelle('a', ['nr'], [['1'], ['2']], { geaendert: '2026-08-01T00:00:00Z' }));

  assert.deepEqual(
    saetze.map((eintrag) => eintrag.zeile),
    [1, 2]
  );
  assert.equal(saetze[1].stand?.geaendert, '2026-08-01T00:00:00Z');
});
