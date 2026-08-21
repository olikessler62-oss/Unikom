import assert from 'node:assert/strict';
import test from 'node:test';

import { abstand, aehnlichkeit, naheliegende, verdaechtigePaare } from './Aehnlichkeit.js';
import type { Datensatz } from './Quellen.js';

function satz(quelle: string, zeile: number, werte: Record<string, string>): Datensatz {
  return { quelle, zeile, werte: new Map(Object.entries(werte)) };
}

const NAMEN = { felder: ['nachname', 'vorname'] };

/* ---------- Der Abstand ---------- */

test('gleiche Zeichenketten haben den Abstand null', () => {
  assert.equal(abstand('Müller', 'Müller'), 0);
  assert.equal(abstand('', ''), 0);
});

test('jede einzelne Änderung zählt einmal', () => {
  assert.equal(abstand('Meier', 'Maier'), 1, 'ersetzt');
  assert.equal(abstand('Meier', 'Meiers'), 1, 'angehängt');
  assert.equal(abstand('Meier', 'Meir'), 1, 'fehlt');
});

test('ein Buchstabendreher ist eine Änderung und nicht zwei', () => {
  // Der häufigste Tippfehler überhaupt. Ohne die Umstellung fiele „Mülelr"
  // unter die Schwelle, während ein beliebiger anderer Fehler sie hielte.
  assert.equal(abstand('Müller', 'Mülelr'), 1);
  assert.equal(abstand('Bonn', 'Bnon'), 1);
});

test('nicht benachbarte Vertauschungen sind zwei Änderungen', () => {
  assert.equal(abstand('abcd', 'dbca'), 2);
});

test('die Abbruchgrenze ändert das Ergebnis nicht, solange es darunter liegt', () => {
  /*
   * Die Grenze ist eine Beschleunigung und keine zweite Rechenart. Geprüft
   * wird das über viele erzeugte Paare — ein einzelnes Beispiel würde eine
   * Abweichung finden, die nur bei bestimmten Längen auftritt, nur zufällig.
   */
  let same = 12345;
  const zufall = (): number => {
    same = (same * 1103515245 + 12345) % 2147483648;

    return same / 2147483648;
  };

  const zeichen = 'abcdefgh';
  const wort = (): string =>
    Array.from({ length: 1 + Math.floor(zufall() * 9) }, () => zeichen[Math.floor(zufall() * zeichen.length)]).join('');

  for (let versuch = 0; versuch < 400; versuch += 1) {
    const links = wort();
    const rechts = wort();
    const genau = abstand(links, rechts);

    for (const grenze of [0, 1, 2, 3, 5]) {
      const begrenzt = abstand(links, rechts, grenze);

      if (genau <= grenze) {
        assert.equal(begrenzt, genau, `„${links}" gegen „${rechts}" mit Grenze ${grenze}`);
      } else {
        assert.ok(begrenzt > grenze, `„${links}" gegen „${rechts}" mit Grenze ${grenze}: ${begrenzt}`);
      }
    }
  }
});

test('die Ähnlichkeit steht zwischen null und eins', () => {
  assert.equal(aehnlichkeit('Müller', 'Müller'), 1);
  assert.equal(aehnlichkeit('Meier', 'Maier').toFixed(2), '0.80');
  assert.equal(aehnlichkeit('Meier', 'Schmidt').toFixed(2), '0.14');
});

test('mit Schwelle wird abgekürzt, ohne Schwelle genau gerechnet', () => {
  // Zwei Betriebsarten derselben Funktion: Wer eine Schwelle nennt, will nur
  // wissen, ob sie gehalten wird — alles darunter ist gleich uninteressant und
  // kommt als 0 zurück, ohne zu Ende gerechnet zu werden.
  assert.equal(aehnlichkeit('Meier', 'Schmidt', 0.75), 0);
  assert.ok(aehnlichkeit('Meier', 'Schmidt') > 0);
});

/* ---------- Verdächtige Paare ---------- */

test('zwei fast gleiche Datensätze werden zur Frage', () => {
  const ergebnis = verdaechtigePaare(
    [
      satz('a', 1, { nachname: 'Meier', vorname: 'Hans' }),
      satz('a', 2, { nachname: 'Maier', vorname: 'Hans' }),
    ],
    { ...NAMEN, schwelle: 0.75 }
  );

  assert.equal(ergebnis.paare.length, 1);
  assert.deepEqual([ergebnis.paare[0].links, ergebnis.paare[0].rechts], [0, 1]);
  assert.equal(ergebnis.paare[0].wert.toFixed(1), '0.8');
});

test('das schwächste Feld entscheidet und nicht der Durchschnitt', () => {
  // Zwei Personen mit demselben Namen und verschiedenem Geburtsdatum sind
  // zwei Personen. Ein Durchschnitt machte daraus eine.
  const ergebnis = verdaechtigePaare(
    [
      satz('a', 1, { nachname: 'Meier', vorname: 'Hans', geburt: '1970-03-04' }),
      satz('a', 2, { nachname: 'Meier', vorname: 'Hans', geburt: '1988-11-27' }),
    ],
    { felder: ['nachname', 'vorname', 'geburt'], schwelle: 0.6 }
  );

  assert.equal(ergebnis.paare.length, 0);
});

test('ein fehlendes Merkmal ist kein Beleg für Gleichheit', () => {
  // Zwei leere Felder sind wörtlich gleich. Zählte man sie mit, wären alle
  // unvollständigen Datensätze einander verdächtig ähnlich.
  const ergebnis = verdaechtigePaare(
    [
      satz('a', 1, { nachname: 'Meier', vorname: '' }),
      satz('a', 2, { nachname: 'Meier', vorname: '' }),
    ],
    NAMEN
  );

  assert.equal(ergebnis.paare.length, 0);
});

test('unter der Schwelle wird nicht gefragt', () => {
  const ergebnis = verdaechtigePaare(
    [
      satz('a', 1, { nachname: 'Meier', vorname: 'Hans' }),
      satz('a', 2, { nachname: 'Schmidt', vorname: 'Erna' }),
    ],
    NAMEN
  );

  assert.equal(ergebnis.paare.length, 0);
});

test('die Längenvorauswahl übersieht kein Paar', () => {
  /*
   * Die innere Schleife bricht ab, sobald das erste Feld zu lang wird. Das ist
   * eine gültige Abkürzung und keine Näherung — geprüft gegen die vollständige
   * Rechnung ohne Vorauswahl.
   */
  const worte = ['Meier', 'Maier', 'Mayer', 'Meyer', 'Meiers', 'Schmidt', 'Schmitt', 'Schmied', 'Bonn', 'Bnon', 'Köln'];
  const saetze = worte.map((wort, stelle) => satz('a', stelle + 1, { nachname: wort }));
  const schwelle = 0.75;

  const erwartet: string[] = [];

  for (let i = 0; i < saetze.length; i += 1) {
    for (let j = i + 1; j < saetze.length; j += 1) {
      if (aehnlichkeit(worte[i].toLocaleLowerCase('de-DE'), worte[j].toLocaleLowerCase('de-DE')) >= schwelle) {
        erwartet.push(`${i}-${j}`);
      }
    }
  }

  const gefunden = verdaechtigePaare(saetze, { felder: ['nachname'], schwelle }).paare.map(
    (paar) => `${paar.links}-${paar.rechts}`
  );

  assert.deepEqual([...gefunden].sort(), erwartet.sort());
  assert.ok(erwartet.length >= 4, 'der Fall muss überhaupt Paare enthalten, sonst prüft er nichts');
});

test('bei zu vielen Datensätzen wird abgebrochen und gesagt, warum', () => {
  const viele = Array.from({ length: 11 }, (unbenutzt, stelle) =>
    satz('a', stelle + 1, { nachname: `Meier${stelle}` })
  );

  const ergebnis = verdaechtigePaare(viele, { felder: ['nachname'], hoechstens: 10 });

  assert.equal(ergebnis.paare.length, 0);
  assert.match(ergebnis.abgebrochen ?? '', /jeden Datensatz mit jedem/);
  assert.equal(ergebnis.vergleiche, 0);
});

test('gemeldet werden Paare und keine Gruppen', () => {
  // Aus „A ähnelt B" und „B ähnelt C" folgt nicht „A ähnelt C". Wer daraus
  // eine Dreiergruppe macht, hält Ähnlichkeit für übertragbar.
  const ergebnis = verdaechtigePaare(
    [
      satz('a', 1, { nachname: 'Meier' }),
      satz('a', 2, { nachname: 'Maier' }),
      satz('a', 3, { nachname: 'Mayer' }),
    ],
    { felder: ['nachname'], schwelle: 0.75 }
  );

  // Meier↔Maier und Maier↔Mayer halten die Schwelle, Meier↔Mayer nicht: zwei
  // Änderungen auf fünf Zeichen sind 0,6.
  assert.deepEqual(
    ergebnis.paare.map((paar) => `${paar.links}-${paar.rechts}`),
    ['0-1', '1-2']
  );
});

/* ---------- Naheliegende Einträge ---------- */

test('kurze Kennungen brauchen eine tiefere Schwelle', () => {
  /*
   * Eine Postleitzahl mit einem Tippfehler ist zu 80 % ähnlich — unter der
   * Voreinstellung von 0,85. Bei fünf Zeichen lässt diese Schwelle **null**
   * Änderungen zu; die Ähnlichkeitssuche fände dort nur, was ohnehin exakt
   * gleich ist. Deshalb ist die Schwelle je Regel einstellbar.
   */
  assert.deepEqual(naheliegende('53112', [{ zeile: 1, wert: '53111' }]), []);

  const treffer = naheliegende('53112', [
    { zeile: 1, wert: '53111' },
    { zeile: 2, wert: '50667' },
  ], 0.8);

  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].wert, '53111');
  assert.equal(treffer[0].zeile, 1);
});

test('die naheliegenden stehen nach Ähnlichkeit und sind gedeckelt', () => {
  const treffer = naheliegende(
    'Meier',
    [
      { zeile: 1, wert: 'Maier' },
      { zeile: 2, wert: 'Meier' },
      { zeile: 3, wert: 'Meyer' },
      { zeile: 4, wert: 'Meiers' },
    ],
    0.7,
    2
  );

  assert.equal(treffer.length, 2);
  assert.equal(treffer[0].wert, 'Meier');
  assert.ok(treffer[0].aehnlichkeit >= treffer[1].aehnlichkeit);
});
