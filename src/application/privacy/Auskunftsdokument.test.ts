import assert from 'node:assert/strict';
import test from 'node:test';

import type { Bestandsauskunft } from '../../domain/privacy/DataStore.js';
import {
  auskunftsdateiname,
  auskunftsdokument,
  loeschbelegDateiname,
  loeschbelegDokument,
} from './Auskunftsdokument.js';
import type { Auskunft, Loeschbericht } from './PrivacyService.js';

const ERSTELLT = new Date(2026, 7, 19, 14, 5, 0);

function bestand(teil: Partial<Bestandsauskunft>): Bestandsauskunft {
  return { key: 'k', name: 'Laufprotokoll', treffer: 0, behandlung: 'SCHWAERZEN', funde: [], ...teil };
}

function auskunft(teil: Partial<Auskunft> = {}): Auskunft {
  return { begriff: 'Mustermann', bestaende: [], treffer: 0, nurAnzeige: [], ...teil };
}

test('die Auskunft führt auch die Bestände auf, in denen nichts gefunden wurde', () => {
  // Eine Auskunft, die leere Bestände weglässt, gewöhnt den Leser daran, dass
  // die Liste unvollständig sein darf.
  const text = auskunftsdokument(
    auskunft({
      bestaende: [bestand({ name: 'Laufprotokoll' }), bestand({ key: 'x', name: 'Konfliktbestand' })],
    }),
    { erstellt: ERSTELLT }
  );

  assert.match(text, /Laufprotokoll — 0 Fundstelle/);
  assert.match(text, /Konfliktbestand — 0 Fundstelle/);
  assert.match(text, /Keine Fundstelle/);
});

test('die Auskunft sagt es, wenn sie nicht alles aufführt', () => {
  // Der Satz, der diese Datei brauchbar macht: Ohne ihn bestätigt jemand einer
  // betroffenen Person eine Vollständigkeit, die er nicht hat.
  const text = auskunftsdokument(
    auskunft({
      treffer: 900,
      bestaende: [bestand({ treffer: 900, funde: [{ wo: 'Protokollzeile', auszug: 'eine von 900' }] })],
    }),
    { erstellt: ERSTELLT }
  );

  assert.match(text, /Von 900 Fundstellen sind hier 1 aufgeführt/);
});

test('eine vollständige Auskunft schweigt über Grenzen, die nicht gegriffen haben', () => {
  const text = auskunftsdokument(
    auskunft({
      treffer: 2,
      bestaende: [
        bestand({
          treffer: 2,
          funde: [
            { wo: 'Protokollzeile', auszug: 'erste' },
            { wo: 'Protokollzeile', auszug: 'zweite' },
          ],
        }),
      ],
    }),
    { erstellt: ERSTELLT }
  );

  assert.doesNotMatch(text, /aufgeführt/);
});

test('die Auskunft nennt die Ziele, über die Unikom nichts weiß', () => {
  const text = auskunftsdokument(auskunft(), { erstellt: ERSTELLT });

  assert.match(text, /fremde/);
  assert.match(text, /gesondert nachzufassen/);
});

test('der Kopf trägt Begriff, Mandant, Zeitpunkt und Urheber', () => {
  const text = auskunftsdokument(auskunft(), {
    erstellt: ERSTELLT,
    mandant: 'Kunde Nord',
    veranlasser: 'anna',
  });

  assert.match(text, /Suchbegriff\s+Mustermann/);
  assert.match(text, /Mandant\s+Kunde Nord/);
  assert.match(text, /Erstellt\s+19\.08\.2026 14:05:00/);
  assert.match(text, /Durch\s+anna/);
});

test('ohne Mandant steht dort nicht „undefined", sondern was gilt', () => {
  const text = auskunftsdokument(auskunft(), { erstellt: ERSTELLT });

  assert.match(text, /Mandant\s+alle Mandanten dieser Installation/);
  assert.doesNotMatch(text, /undefined/);
});

test('der Dateiname übersteht einen Begriff, der keiner ist', () => {
  // Ein Suchbegriff darf Schrägstriche und Doppelpunkte enthalten; ein
  // Dateiname nicht.
  assert.equal(
    auskunftsdateiname('C:\\daten\\müller*?', ERSTELLT),
    'Unikom_Auskunft_C-daten-müller_2026-08-19_1405.txt'
  );
  assert.equal(auskunftsdateiname('***', ERSTELLT), 'Unikom_Auskunft_Suche_2026-08-19_1405.txt');
});

function bericht(teil: Partial<Loeschbericht> = {}): Loeschbericht {
  return {
    begriff: 'Mustermann',
    entfernt: [{ key: 'laufprotokoll', name: 'Laufprotokoll', behandlung: 'SCHWAERZEN', stellen: 3 }],
    offen: [],
    zeitpunkt: ERSTELLT,
    ...teil,
  };
}

test('der Löschbeleg sagt, was entfernt wurde und in welcher Art', () => {
  const text = loeschbelegDokument(bericht({ veranlasser: 'anna' }), {});

  assert.match(text, /Umfang\s+3 Stelle/);
  assert.match(text, /Laufprotokoll: 3 Stelle\(n\) unkenntlich gemacht/);
  assert.match(text, /Durch\s+anna/);
});

test('der Löschbeleg verschweigt nicht, was liegen bleibt', () => {
  const text = loeschbelegDokument(
    bericht({
      offen: [
        {
          key: 'dateien-mandant',
          name: 'Dateien in den Mandantenverzeichnissen',
          treffer: 2,
          behandlung: 'ANZEIGEN',
          funde: [{ wo: 'C:/daten/kunde/ergebnis.csv', auszug: '…' }],
          hinweis: 'was darin zu geschehen hat, entscheidet der Mandant',
        },
      ],
    }),
    {}
  );

  assert.match(text, /von Hand zu prüfen/);
  assert.match(text, /ergebnis\.csv/);
  assert.match(text, /entscheidet der Mandant/);
});

test('der Löschbeleg heißt anders als die Auskunft', () => {
  // Beide landen im selben Ordner des Datenschutzbeauftragten. Zwei Dateien,
  // die gleich heißen, sind eine Datei.
  assert.notEqual(loeschbelegDateiname('Mustermann', ERSTELLT), auskunftsdateiname('Mustermann', ERSTELLT));
  assert.match(loeschbelegDateiname('Mustermann', ERSTELLT), /Loeschbeleg/);
});
