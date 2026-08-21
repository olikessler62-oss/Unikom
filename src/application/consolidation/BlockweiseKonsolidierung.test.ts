import assert from 'node:assert/strict';
import test from 'node:test';

import type { Quelle } from '../../domain/consolidation/Quellen.js';
import { fortschritt, offeneBloecke, type Zwischenstand } from '../../domain/consolidation/Zwischenstand.js';
import { InMemoryZwischenstandRepository } from '../../infrastructure/persistence/InMemoryZwischenstandRepository.js';
import {
  BlockweiseKonsolidierung,
  fasseZusammen,
  type Blocklauf,
} from './BlockweiseKonsolidierung.js';
import {
  ConsolidationService,
  type Konsolidierungsauftrag,
  type Konsolidierungsbericht,
} from './ConsolidationService.js';

function quelle(id: string, von: number, bis: number, ort = 'Bonn'): Quelle {
  const zeilen: string[][] = [];

  for (let nummer = von; nummer <= bis; nummer += 1) {
    zeilen.push([String(nummer), `Kunde ${nummer}`, ort]);
  }

  return { id, name: id, felder: ['kdnr', 'name', 'ort'], zeilen };
}

function auftrag(quellen: Quelle[]): Konsolidierungsauftrag {
  return { quellen, betriebsart: 'SAMMELN', art: 'MERGE', schluessel: { felder: ['kdnr'] } };
}

function werkbank(): {
  laeufer: BlockweiseKonsolidierung;
  bestand: InMemoryZwischenstandRepository<Konsolidierungsbericht>;
} {
  const bestand = new InMemoryZwischenstandRepository<Konsolidierungsbericht>();

  return { laeufer: new BlockweiseKonsolidierung(new ConsolidationService(), bestand), bestand };
}

const KLEIN: Blocklauf = { laufId: 'TR-1', optionen: { jeBlock: 10 } };

/* ---------- Der Normalfall bleibt der Normalfall ---------- */

test('eine gewöhnliche Menge läuft in einem Schritt und legt nichts ab', async () => {
  /*
   * Blockweise Verarbeitung bei fünftausend Datensätzen kostet Zwischenstände,
   * Schreibvorgänge und Erklärungen für einen Gewinn, den es dort nicht gibt.
   */
  const { laeufer, bestand } = werkbank();

  const bericht = await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 20)]), { laufId: 'TR-1' });

  assert.equal(bericht.zeilen.length, 20);
  assert.deepEqual(await bestand.auskunft('TR-1'), []);
});

test('der Plan lässt sich vorher erfragen', async () => {
  // „die Anzahl geplanter Schritte" steht in SPEC-06 §15 unter dem, worüber der
  // Benutzer transparent informiert wird — vorher, nicht hinterher.
  const { laeufer } = werkbank();

  assert.equal(laeufer.plane(auftrag([quelle('A.csv', 1, 100)]), { jeBlock: 10 }).bloecke, 10);
});

/* ---------- Blockweise ---------- */

test('das Ergebnis ist dasselbe, ob in einem Zug oder in Schritten', async () => {
  /*
   * Die eigentliche Zusage. Ein zweiter Weg durch dieselbe Rechnung, der ein
   * anderes Ergebnis liefert, wäre schlimmer als gar keine Aufteilung.
   */
  const quellen = [quelle('A.csv', 1, 60), quelle('B.csv', 30, 90, 'Köln')];

  const { laeufer } = werkbank();
  const inSchritten = await laeufer.konsolidiere(auftrag(quellen), KLEIN);
  const inEinemZug = new ConsolidationService().konsolidiere(auftrag(quellen));

  const schluessel = (bericht: Konsolidierungsbericht): string[] =>
    bericht.zeilen.map((zeile) => zeile.schluessel ?? '').sort();

  assert.deepEqual(schluessel(inSchritten), schluessel(inEinemZug));
  assert.equal(inSchritten.zusammenfassung.gelesen, inEinemZug.zusammenfassung.gelesen);
  assert.equal(inSchritten.zusammenfassung.ergebnis, inEinemZug.zusammenfassung.ergebnis);
  assert.equal(inSchritten.konflikte.length, inEinemZug.konflikte.length);
});

test('die Herkunft zeigt auf die Zeile in der Datei, nicht auf die im Block', async () => {
  /*
   * Die böseste Falle der Aufteilung: Ein Block enthält nur einen Teil der
   * Zeilen, und ohne die ursprünglichen Nummern zeigte jede Herkunftsangabe auf
   * die falsche Zeile — plausibel aussehend und falsch.
   */
  const { laeufer } = werkbank();
  const bericht = await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), KLEIN);

  for (const zeile of bericht.zeilen) {
    const [herkunft] = zeile.herkunft;
    // Kundennummer 7 stand in Zeile 7 der Datei.
    assert.equal(String(Number(zeile.werte[0])), zeile.werte[0]);
    assert.equal(herkunft.zeile, Number(zeile.werte[0]), `Schlüssel ${zeile.schluessel}`);
  }
});

test('alle Sätze eines Schlüssels liegen im selben Schritt', async () => {
  /*
   * Sonst würde ein Kunde zweimal verarbeitet und käme zweimal ins Ergebnis.
   * Sichtbar wird es daran, dass die Zusammenführung stattfindet: 60 gelesene
   * Sätze aus zwei Quellen mit Überschneidung ergeben weniger als 60 Zeilen.
   */
  const { laeufer } = werkbank();

  const bericht = await laeufer.konsolidiere(
    auftrag([quelle('A.csv', 1, 40), quelle('B.csv', 21, 60, 'Köln')]),
    KLEIN
  );

  assert.equal(bericht.zusammenfassung.gelesen, 80);
  assert.equal(bericht.zeilen.length, 60, 'die 20 überschneidenden müssen verschmolzen sein');
  assert.ok(bericht.zusammenfassung.zusammengefuehrt > 0);
});

test('der Bericht sagt, dass er in Schritten entstand — und was das kostet', async () => {
  /*
   * Ergänzung und Ähnlichkeitssuche sehen nur den eigenen Schritt. Das
   * stillschweigend hinzunehmen hieße, ein Ergebnis auszuliefern, dem niemand
   * ansieht, dass etwas fehlt.
   */
  const { laeufer } = werkbank();
  const bericht = await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), KLEIN);

  assert.ok(
    bericht.hinweise.some((hinweis) => /nur den eigenen Schritt/.test(hinweis)),
    bericht.hinweise.join(' | ')
  );
});

/* ---------- Fortschritt ---------- */

test('nach jedem Schritt wird gemeldet, wie weit es ist', async () => {
  const { laeufer } = werkbank();
  const gemeldet: string[] = [];

  await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), {
    ...KLEIN,
    melde: (stand) => gemeldet.push(stand.text),
  });

  assert.equal(gemeldet.length, 4, gemeldet.join(' | '));
  assert.match(gemeldet[0], /Schritt 1 von 4/);
  assert.match(gemeldet[3], /0 verbleiben/);
});

test('die verbleibende Menge zählt herunter', async () => {
  const { laeufer } = werkbank();
  const verbleibend: number[] = [];

  await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), {
    ...KLEIN,
    melde: (stand) => verbleibend.push(stand.verbleibend),
  });

  assert.deepEqual(
    [...verbleibend].sort((links, rechts) => rechts - links),
    verbleibend,
    `nicht absteigend: ${verbleibend.join(', ')}`
  );
  assert.equal(verbleibend[verbleibend.length - 1], 0);
});

/* ---------- Fortsetzen ---------- */

test('ein fortgesetzter Lauf wiederholt keinen fertigen Schritt', async () => {
  /*
   * „Soweit technisch möglich, soll eine unterbrochene Verarbeitung fortgesetzt
   * werden können, ohne bereits erfolgreich verarbeitete Eingangsdaten zu
   * verändern" (SPEC-06, Abschnitt 15).
   */
  const bestand = new InMemoryZwischenstandRepository<Konsolidierungsbericht>();
  let gerufen = 0;

  const zaehlend = new (class extends ConsolidationService {
    konsolidiere(eingabe: Konsolidierungsauftrag): Konsolidierungsbericht {
      gerufen += 1;

      return super.konsolidiere(eingabe);
    }
  })();

  const laeufer = new BlockweiseKonsolidierung(zaehlend, bestand);
  const eingabe = auftrag([quelle('A.csv', 1, 40)]);

  await laeufer.konsolidiere(eingabe, KLEIN);

  const ersteRunde = gerufen;

  assert.equal(ersteRunde, 4);

  /* Ein zweiter Lauf, bei dem zwei Schritte schon vorliegen. */
  gerufen = 0;

  const halb = new InMemoryZwischenstandRepository<Konsolidierungsbericht>();
  const laeufer2 = new BlockweiseKonsolidierung(zaehlend, halb);

  await halb.speichere({
    laufId: 'TR-2',
    block: 0,
    bloecke: 4,
    datensaetze: 10,
    teilbericht: leererBericht(),
    fertig: '2026-08-20T00:00:00.000Z',
  });
  await halb.speichere({
    laufId: 'TR-2',
    block: 1,
    bloecke: 4,
    datensaetze: 10,
    teilbericht: leererBericht(),
    fertig: '2026-08-20T00:00:00.000Z',
  });

  await laeufer2.konsolidiere(eingabe, { laufId: 'TR-2', optionen: { jeBlock: 10 } });

  assert.equal(gerufen, 2, 'nur die beiden offenen Schritte');
});

test('eine geänderte Aufteilung wird im Protokoll benannt', async () => {
  /*
   * Die alte Aufteilung fällt ohnehin durch alle Filter — aber ein Lauf, der
   * ohne ein Wort von vorn beginnt, sieht im Protokoll aus wie einer, der
   * seine Zwischenstände nicht gefunden hat. Der Unterschied gehört benannt.
   */
  const bestand = new InMemoryZwischenstandRepository<Konsolidierungsbericht>();
  const protokoll: string[] = [];

  await bestand.speichere({
    laufId: 'TR-9',
    block: 0,
    bloecke: 99,
    datensaetze: 1,
    teilbericht: leererBericht(),
    fertig: '2026-08-20T00:00:00.000Z',
  });

  const laeufer = new BlockweiseKonsolidierung(new ConsolidationService(), bestand, {
    log: (eintrag) => protokoll.push(`${eintrag.level}: ${eintrag.message}`),
  });

  await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), { laufId: 'TR-9', optionen: { jeBlock: 10 } });

  assert.ok(
    protokoll.some((zeile) => /WARNING.*anderen Aufteilung/.test(zeile)),
    protokoll.join(' | ')
  );
});

test('eine geänderte Aufteilung macht die Zwischenstände wertlos', async () => {
  /*
   * Ein Block 2 von damals enthält nicht dieselben Datensätze wie ein Block 2
   * von heute. Ein Lauf aus zwei Aufteilungen ergäbe ein Ergebnis, in dem
   * manche Datensätze zweimal und andere gar nicht stehen.
   */
  const { laeufer, bestand } = werkbank();

  await bestand.speichere({
    laufId: 'TR-3',
    block: 0,
    bloecke: 99,
    datensaetze: 1,
    teilbericht: leererBericht(),
    fertig: '2026-08-20T00:00:00.000Z',
  });

  const bericht = await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), {
    laufId: 'TR-3',
    optionen: { jeBlock: 10 },
  });

  assert.equal(bericht.zeilen.length, 40, 'nichts darf aus der alten Aufteilung übrigbleiben');
});

test('nach dem Abschluss bleiben keine Zwischenstände liegen', async () => {
  // Der vollständige Bericht steht dann anderswo; die Teile wären nur noch
  // Ballast, den niemand mehr aufräumt.
  const { laeufer, bestand } = werkbank();

  await laeufer.konsolidiere(auftrag([quelle('A.csv', 1, 40)]), KLEIN);

  assert.deepEqual(await bestand.auskunft('TR-1'), []);
});

test('offene Schritte sind die, für die nichts vorliegt', () => {
  const staende: Zwischenstand[] = [
    { laufId: 'x', block: 0, bloecke: 4, datensaetze: 1, teilbericht: {}, fertig: '' },
    { laufId: 'x', block: 2, bloecke: 4, datensaetze: 1, teilbericht: {}, fertig: '' },
  ];

  assert.deepEqual(offeneBloecke(4, staende), [1, 3]);
});

/* ---------- Zusammenfassen ---------- */

function leererBericht(teile: Partial<Konsolidierungsbericht> = {}): Konsolidierungsbericht {
  return {
    quellen: [],
    felder: [],
    zeilen: [],
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
      quellen: 0,
      gelesen: 0,
      ergebnis: 0,
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

test('dieselbe Datei steht am Ende einmal in der Quellenliste', () => {
  /*
   * Sie berührt so viele Blöcke, wie es Blöcke gibt. Sie so oft aufzuführen
   * ergäbe einen Bericht, der zwölf Quellen nennt, wo zwei waren.
   */
  const zusammen = fasseZusammen([
    leererBericht({
      quellen: [{ id: 'A.csv', name: 'A.csv', datensaetze: 10 }],
      zusammenfassung: { ...leererBericht().zusammenfassung, quellen: 1, gelesen: 10 },
    }),
    leererBericht({
      quellen: [{ id: 'A.csv', name: 'A.csv', datensaetze: 15 }],
      zusammenfassung: { ...leererBericht().zusammenfassung, quellen: 1, gelesen: 15 },
    }),
  ]);

  assert.equal(zusammen.quellen.length, 1);
  assert.equal(zusammen.quellen[0].datensaetze, 25, 'aber die Datensätze werden gezählt');
  assert.equal(zusammen.zusammenfassung.quellen, 1);
  assert.equal(zusammen.zusammenfassung.gelesen, 25);
});

test('die Felder sind die Vereinigung aller Schritte', () => {
  // Ein Feld, das nur in Block 3 vorkam, gehört ins Ergebnis.
  const zusammen = fasseZusammen([
    leererBericht({ felder: ['kdnr', 'ort'] }),
    leererBericht({ felder: ['kdnr', 'telefon'] }),
  ]);

  assert.deepEqual(zusammen.felder, ['kdnr', 'ort', 'telefon']);
});

test('derselbe Hinweis aus zwölf Blöcken bleibt ein Hinweis', () => {
  const zusammen = fasseZusammen([
    leererBericht({ hinweise: ['Zwei Blätter gefunden'] }),
    leererBericht({ hinweise: ['Zwei Blätter gefunden'] }),
  ]);

  assert.deepEqual(zusammen.hinweise, ['Zwei Blätter gefunden']);
});

test('ein Referenzbestand wird über die Schritte zusammengezählt', () => {
  const zusammen = fasseZusammen([
    leererBericht({ referenzen: [{ bestand: 'Kunden', treffer: 3, ohneTreffer: 1, mehrdeutig: 0, uebernahmen: 3 }] }),
    leererBericht({ referenzen: [{ bestand: 'Kunden', treffer: 5, ohneTreffer: 2, mehrdeutig: 1, uebernahmen: 5 }] }),
  ]);

  assert.equal(zusammen.referenzen.length, 1);
  assert.deepEqual(zusammen.referenzen[0], {
    bestand: 'Kunden',
    treffer: 8,
    ohneTreffer: 3,
    mehrdeutig: 1,
    uebernahmen: 8,
  });
});

test('ohne Teile entsteht ein leerer Bericht und kein Fehler', () => {
  assert.deepEqual(fasseZusammen([]).zeilen, []);
  assert.equal(fasseZusammen([]).zusammenfassung.gelesen, 0);
});

test('die verbleibende Menge wird nie negativ', () => {
  /*
   * Ein fortgesetzter Lauf zählt die Datensätze der fertigen Schritte mit, wie
   * sie damals gespeichert wurden. Steht dort eine Zahl aus einer größeren
   * Lieferung, käme „−7 verbleiben" auf den Bildschirm — und das liest sich wie
   * ein Fehler im Erzeugnis, nicht wie eine harmlose Verschiebung.
   */
  assert.equal(fortschritt(3, 3, 120, 100).verbleibend, 0);
  assert.match(fortschritt(3, 3, 120, 100).text, /0 verbleiben/);
});
