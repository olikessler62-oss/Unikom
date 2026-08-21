import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pruefeStapel,
  stapelgruppen,
  stapelmeldung,
  type Stapelbedingung,
  type Stapeldatei,
} from './Stapel.js';

const DREI: Stapelbedingung = {
  plaetze: [
    { name: 'Filiale Nord', muster: 'Filiale_Nord_*.csv' },
    { name: 'Filiale Süd', muster: 'Filiale_Sued_*.csv' },
    { name: 'Filiale West', muster: 'Filiale_West_*.csv' },
  ],
};

const JETZT = new Date('2026-08-21T06:00:00.000Z');

function datei(name: string, teile: Partial<Stapeldatei> = {}): Stapeldatei {
  return { name, geaendert: new Date('2026-08-21T05:00:00.000Z'), ...teile };
}

/* ---------- Der Regelfall ---------- */

test('drei Plätze, drei Dateien — vollständig', () => {
  const stand = pruefeStapel(
    [datei('Filiale_Nord_0821.csv'), datei('Filiale_Sued_0821.csv'), datei('Filiale_West_0821.csv')],
    DREI,
    JETZT
  );

  assert.equal(stand.vollstaendig, true);
  assert.equal(stand.stapel.length, 3);
  assert.equal(stand.abgelaufen, false);
});

test('solange einer fehlt, wird nicht begonnen', () => {
  const stand = pruefeStapel([datei('Filiale_Nord_0821.csv'), datei('Filiale_West_0821.csv')], DREI, JETZT);

  assert.equal(stand.vollstaendig, false);
  assert.deepEqual(
    stand.fehlend.map((platz) => platz.name),
    ['Filiale Süd']
  );
  // Der Stapel bleibt leer: Es gibt nichts zu holen, was halb wäre.
  assert.deepEqual(stand.stapel, []);
});

/* ---------- Wofür die beiden Bedingungen je einzeln da sind ---------- */

test('zweimal Nord und kein Süd sind nicht drei Dateien', () => {
  /*
   * Der Fall, an dem eine reine Anzahl scheitert: Es liegen drei Dateien da,
   * der Zähler wäre zufrieden — und eine Filiale fehlt im Ergebnis, das
   * vollständig aussieht.
   */
  const stand = pruefeStapel(
    [datei('Filiale_Nord_0821.csv'), datei('Filiale_Nord_0821b.csv'), datei('Filiale_West_0821.csv')],
    DREI,
    JETZT
  );

  assert.equal(stand.vollstaendig, false);
  assert.deepEqual(
    stand.fehlend.map((platz) => platz.name),
    ['Filiale Süd']
  );
});

test('eine Lieferung zu viel hält den Stapel ebenso auf', () => {
  /*
   * Der umgekehrte Fall, an dem reine Plätze scheitern: Jeder Platz ist
   * besetzt, aber Nord hat zweimal geliefert. Ob Dublette oder unerwartete
   * Teillieferung — beides gehört gemeldet und nicht verrechnet.
   */
  const stand = pruefeStapel(
    [
      datei('Filiale_Nord_0821.csv'),
      datei('Filiale_Nord_0821b.csv'),
      datei('Filiale_Sued_0821.csv'),
      datei('Filiale_West_0821.csv'),
    ],
    DREI,
    JETZT
  );

  assert.equal(stand.vollstaendig, false);
  assert.deepEqual(stand.fehlend, []);
  assert.deepEqual(
    stand.doppelt.map((platz) => platz.name),
    ['Filiale Nord']
  );
});

test('wer mehrere liefern darf, sagt es über die Anzahl', () => {
  const stand = pruefeStapel(
    [
      datei('Filiale_Nord_0821.csv'),
      datei('Filiale_Nord_0821b.csv'),
      datei('Filiale_Sued_0821.csv'),
      datei('Filiale_West_0821.csv'),
    ],
    { ...DREI, anzahl: 4 },
    JETZT
  );

  assert.equal(stand.vollstaendig, true);
  assert.equal(stand.stapel.length, 4);
});

/* ---------- Was nicht mitzählt ---------- */

test('eine Datei, die noch geschrieben wird, macht den Stapel nicht voll', () => {
  /*
   * Wer 400 MB hineinkopiert, legt den endgültigen Namen sofort an. Zählte sie
   * mit, konsolidierte der Lauf ein abgeschnittenes Stück — und das Ergebnis
   * sähe vollständig aus.
   */
  const stand = pruefeStapel(
    [
      datei('Filiale_Nord_0821.csv'),
      datei('Filiale_Sued_0821.csv'),
      datei('Filiale_West_0821.csv', { fertig: false }),
    ],
    DREI,
    JETZT
  );

  assert.equal(stand.vollstaendig, false);
  assert.deepEqual(
    stand.fehlend.map((platz) => platz.name),
    ['Filiale West']
  );
  assert.deepEqual(stand.unfertig, ['Filiale_West_0821.csv']);
});

test('eine Datei ohne Platz gehört nicht in den Stapel', () => {
  // Sie ist kein Grund zu warten und keiner abzubrechen — sie gehört nicht dazu.
  const stand = pruefeStapel(
    [
      datei('Filiale_Nord_0821.csv'),
      datei('Filiale_Sued_0821.csv'),
      datei('Filiale_West_0821.csv'),
      datei('Notizen.csv'),
    ],
    DREI,
    JETZT
  );

  assert.equal(stand.vollstaendig, true);
  assert.deepEqual(stand.stapel.length, 3);
  assert.deepEqual(stand.fremd, ['Notizen.csv']);
});

test('überlappende Muster zählen eine Datei nur einmal', () => {
  // Sonst stimmte die Anzahl nicht mehr, und niemand sähe warum.
  const stand = pruefeStapel([datei('Filiale_Nord_0821.csv')], {
    plaetze: [
      { name: 'Erster', muster: 'Filiale_*.csv' },
      { name: 'Zweiter', muster: '*_0821.csv' },
    ],
  }, JETZT);

  assert.equal(stand.vollstaendig, false);
  assert.deepEqual(
    stand.fehlend.map((platz) => platz.name),
    ['Zweiter']
  );
});

/* ---------- Die Frist ---------- */

test('die Frist läuft ab der ersten Datei, nicht ab einer Uhrzeit', () => {
  const dateien = [
    datei('Filiale_Nord_0821.csv', { geaendert: new Date('2026-08-21T05:00:00.000Z') }),
    datei('Filiale_Sued_0821.csv', { geaendert: new Date('2026-08-21T05:50:00.000Z') }),
  ];

  // Eine Stunde nach der ersten: 30 Minuten Frist sind vorbei.
  assert.equal(pruefeStapel(dateien, { ...DREI, fristSekunden: 1800 }, JETZT).abgelaufen, true);
  // Zwei Stunden Frist: noch nicht.
  assert.equal(pruefeStapel(dateien, { ...DREI, fristSekunden: 7200 }, JETZT).abgelaufen, false);
});

test('ohne Frist wird unbegrenzt gewartet', () => {
  const alt = [datei('Filiale_Nord_0821.csv', { geaendert: new Date('2020-01-01T00:00:00.000Z') })];

  assert.equal(pruefeStapel(alt, DREI, JETZT).abgelaufen, false);
  assert.equal(pruefeStapel(alt, { ...DREI, fristSekunden: 0 }, JETZT).abgelaufen, false);
});

test('ein vollständiger Stapel ist nie abgelaufen', () => {
  // Sonst würfe eine knappe Frist einen Stapel fort, der gerade fertig wurde.
  const spaet = [
    datei('Filiale_Nord_0821.csv', { geaendert: new Date('2020-01-01T00:00:00.000Z') }),
    datei('Filiale_Sued_0821.csv'),
    datei('Filiale_West_0821.csv'),
  ];

  const stand = pruefeStapel(spaet, { ...DREI, fristSekunden: 60 }, JETZT);

  assert.equal(stand.vollstaendig, true);
  assert.equal(stand.abgelaufen, false);
});

test('eine unfertige Datei startet die Uhr nicht', () => {
  // Sonst bräuchte eine große Datei ihre eigene Frist auf, während sie kopiert wird.
  const stand = pruefeStapel(
    [datei('Filiale_Nord_0821.csv', { geaendert: new Date('2020-01-01T00:00:00.000Z'), fertig: false })],
    { ...DREI, fristSekunden: 60 },
    JETZT
  );

  assert.equal(stand.abgelaufen, false);
});

/* ---------- Was ein Mensch davon liest ---------- */

test('die Meldung nennt den Namen des Beteiligten, nicht eine Zahl', () => {
  // „2 von 3" beantwortet die Frage um sieben Uhr morgens nicht: welche fehlt.
  const stand = pruefeStapel([datei('Filiale_Nord_0821.csv')], DREI, JETZT);

  assert.match(stapelmeldung(stand), /Filiale Süd/);
  assert.match(stapelmeldung(stand), /Filiale West/);
});
/* ---------- Der Schlüssel: zwei Stapel im selben Verzeichnis ---------- */

/*
 * Der Fall, für den es den Schlüssel gibt: Die verspätete Lieferung von gestern
 * liegt neben der heutigen. Ohne ihn wären die Plätze besetzt, die Anzahl
 * stimmte womöglich auch — und das Ergebnis enthielte zwei Tage.
 */

const MIT_SCHLUESSEL: Stapelbedingung = { ...DREI, schluesselfeld: 'lieferdatum' };

function mit(name: string, schluessel: string, minute: number): Stapeldatei {
  return {
    name,
    schluessel,
    geaendert: new Date(`2026-08-21T05:${String(minute).padStart(2, '0')}:00.000Z`),
  };
}

test('ohne Schlüsselfeld gibt es genau eine Gruppe', () => {
  const aufteilung = stapelgruppen([datei('Filiale_Nord_0821.csv')], DREI, JETZT);

  assert.equal(aufteilung.gruppen.length, 1);
  assert.equal(aufteilung.gruppen[0].schluessel, undefined);
  assert.deepEqual(aufteilung.ohneSchluessel, []);
});

test('zwei Lieferdaten ergeben zwei Stapel', () => {
  const aufteilung = stapelgruppen(
    [
      mit('Filiale_Nord_0820.csv', '2026-08-20', 10),
      mit('Filiale_Sued_0820.csv', '2026-08-20', 11),
      mit('Filiale_Nord_0821.csv', '2026-08-21', 30),
      mit('Filiale_Sued_0821.csv', '2026-08-21', 31),
      mit('Filiale_West_0821.csv', '2026-08-21', 32),
    ],
    MIT_SCHLUESSEL,
    JETZT
  );

  assert.equal(aufteilung.gruppen.length, 2);

  // Der ältere zuerst — sonst drängte sich ein Stapel, der nie fertig wird,
  // immer wieder vor die fertigen.
  assert.equal(aufteilung.gruppen[0].schluessel, '2026-08-20');
  assert.equal(aufteilung.gruppen[0].stand.vollstaendig, false);

  // Und nur der vollständige ist vollständig — nicht die Summe beider.
  assert.equal(aufteilung.gruppen[1].schluessel, '2026-08-21');
  assert.equal(aufteilung.gruppen[1].stand.vollstaendig, true);
});

test('ohne Schlüssel gehört eine Datei zu keinem Stapel', () => {
  /*
   * Entweder fehlt das Feld, oder es trägt in einer Datei mehrere Werte. Der
   * zweite Fall ist der ernstere: Dann ist der Schlüssel keine Eigenschaft
   * dieser Datei — sie enthält womöglich zwei Stapel.
   */
  const aufteilung = stapelgruppen(
    [mit('Filiale_Nord_0821.csv', '2026-08-21', 30), { name: 'Filiale_Sued_0821.csv' }],
    MIT_SCHLUESSEL,
    JETZT
  );

  assert.deepEqual(aufteilung.ohneSchluessel, ['Filiale_Sued_0821.csv']);
  assert.equal(aufteilung.gruppen.length, 1);
  // Sie zählt für keinen Platz — der Stapel bleibt unvollständig.
  assert.equal(aufteilung.gruppen[0].stand.vollstaendig, false);
});

test('ein leerer Schlüssel ist kein Schlüssel', () => {
  // Sonst bildeten alle Dateien ohne Wert gemeinsam einen Stapel, den niemand
  // erwartet hat.
  const aufteilung = stapelgruppen([mit('Filiale_Nord_0821.csv', '   ', 30)], MIT_SCHLUESSEL, JETZT);

  assert.deepEqual(aufteilung.ohneSchluessel, ['Filiale_Nord_0821.csv']);
  assert.equal(aufteilung.gruppen.length, 0);
});

test('jede Gruppe hat ihre eigene Frist', () => {
  /*
   * Ab der ersten Datei **ihrer** Gruppe. Sonst risse der alte Stapel den
   * neuen mit: Seine Uhr läuft länger, und die Frist des neuen wäre schon um,
   * bevor seine dritte Datei ankommt.
   */
  const aufteilung = stapelgruppen(
    [
      { name: 'Filiale_Nord_0820.csv', schluessel: 'alt', geaendert: new Date('2026-08-21T04:00:00.000Z') },
      { name: 'Filiale_Nord_0821.csv', schluessel: 'neu', geaendert: new Date('2026-08-21T05:59:00.000Z') },
    ],
    { ...MIT_SCHLUESSEL, fristSekunden: 1800 },
    JETZT
  );

  const alt = aufteilung.gruppen.find((gruppe) => gruppe.schluessel === 'alt');
  const neu = aufteilung.gruppen.find((gruppe) => gruppe.schluessel === 'neu');

  assert.equal(alt?.stand.abgelaufen, true);
  assert.equal(neu?.stand.abgelaufen, false);
});
