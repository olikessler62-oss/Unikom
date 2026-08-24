import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { filtere, gruppiere, sortiere } from './Auswahl.js';
import { statusNach, wendeAn, type Entscheidung } from './Entscheidung.js';
import { wiedereinstieg } from './Fortschritt.js';
import { anfuegen } from './Historie.js';
import { darfWechseln, istErledigt, verhindertFreigabe, type Konfliktfall } from './Konfliktfall.js';
import { abgelaufen, darfBearbeiten, pruefeFassung } from './Sperre.js';

function fall(teile: Partial<Konfliktfall> = {}): Konfliktfall {
  return {
    id: 'f1',
    tenantId: 'default',
    laufId: 'lauf1',
    datensatz: '4711',
    art: 'WERTEKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: 'Zwei Quellen nennen verschiedene Orte',
    erwartet: 'Einen Wert',
    vorgefunden: 'CRM: „Bonn" · ERP: „Köln"',
    naechsteSchritte: 'Den richtigen Wert auswählen',
    quellen: ['CRM.csv', 'ERP.csv'],
    felder: [
      {
        feld: 'ort',
        angebote: [
          { quelle: 'CRM.csv', wert: 'Bonn' },
          { quelle: 'ERP.csv', wert: 'Köln' },
        ],
      },
    ],
    entstanden: '2026-08-01T10:00:00.000Z',
    geaendert: '2026-08-01T10:00:00.000Z',
    fassung: 1,
    ...teile,
  };
}

const OPTIONEN = { region: DEFAULT_REGION };

/* ---------- Was der Mandant erlaubt ---------- */

test('wo der Mandant es verbietet, wird ein Konflikt nicht hingenommen', () => {
  /*
   * Geprüft in `wendeAn` und nicht erst beim Bestätigen: Sonst zeigte die
   * Vorschau eine Vorschau auf etwas, das der Benutzer nicht tun darf.
   */
  const anwendung = wendeAn(fall(), { art: 'AKZEPTIEREN' }, { ...OPTIONEN, akzeptierenErlaubt: false });

  assert.equal(anwendung.zulaessig, false);
  assert.match(anwendung.befunde[0].ursache, /nicht zu/);
  assert.equal(anwendung.befunde[0].schwere, 'FEHLER');
});

test('das Verbot gilt dem Hinnehmen und nicht dem Bereinigen', () => {
  const anwendung = wendeAn(
    fall(),
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'CRM.csv' } }] },
    { ...OPTIONEN, akzeptierenErlaubt: false }
  );

  assert.equal(anwendung.zulaessig, true);
});

test('ohne Angabe bleibt das Hinnehmen erlaubt', () => {
  /*
   * Eine fehlende Angabe zum Verbot zu lesen hieße, jeden Aufrufer, der sie
   * noch nicht mitgibt, stillschweigend zu verriegeln.
   */
  assert.equal(wendeAn(fall(), { art: 'AKZEPTIEREN' }, OPTIONEN).zulaessig, true);
  assert.equal(wendeAn(fall(), { art: 'AKZEPTIEREN' }, { ...OPTIONEN, akzeptierenErlaubt: true }).zulaessig, true);
});

/* ---------- Lebenszyklus (SPEC-07, Abschnitt 13) ---------- */

test('der Lebenszyklus lässt nur die vorgesehenen Schritte zu', () => {
  assert.equal(darfWechseln('OFFEN', 'BEREINIGT'), true);
  assert.equal(darfWechseln('OFFEN', 'ZURUECKGESTELLT'), true);
  assert.equal(darfWechseln('ZURUECKGESTELLT', 'BEREINIGT'), true);
  assert.equal(darfWechseln('BEREINIGT', 'ERNEUT_VERARBEITET'), true);
  assert.equal(darfWechseln('ERNEUT_VERARBEITET', 'ERFOLGREICH_VERARBEITET'), true);
});

test('ein Fall wird nicht erfolgreich verarbeitet, ohne verarbeitet worden zu sein', () => {
  // „Ein bearbeiteter Konflikt gilt erst dann als erfolgreich verarbeitet,
  // wenn die anschließende Verarbeitung erfolgreich abgeschlossen wurde."
  assert.equal(darfWechseln('OFFEN', 'ERFOLGREICH_VERARBEITET'), false);
  assert.equal(darfWechseln('BEREINIGT', 'ERFOLGREICH_VERARBEITET'), false);
});

test('nach dem Abschluss geht es nicht weiter — das wäre ein neuer Fall', () => {
  assert.equal(darfWechseln('ERFOLGREICH_VERARBEITET', 'OFFEN'), false);
  assert.equal(darfWechseln('ERFOLGREICH_VERARBEITET', 'BEREINIGT'), false);
});

test('eine Korrektur einer bereinigten Entscheidung ist erlaubt', () => {
  // Sie löscht die frühere nicht, sie kommt dahinter (Abschnitt 12).
  assert.equal(darfWechseln('BEREINIGT', 'BEREINIGT'), true);
});

test('zurückgestellt heißt nicht erledigt', () => {
  assert.equal(istErledigt('ZURUECKGESTELLT'), false);
  assert.equal(istErledigt('OFFEN'), false);
  assert.equal(istErledigt('AKZEPTIERT'), true);
});

test('ein offener Hinweis verhindert die Freigabe nicht, ein kritischer schon', () => {
  assert.equal(verhindertFreigabe(fall({ kritikalitaet: 'INFORMATION' })), false);
  assert.equal(verhindertFreigabe(fall({ kritikalitaet: 'WARNUNG' })), false);
  assert.equal(verhindertFreigabe(fall({ kritikalitaet: 'KRITISCH' })), true);
  assert.equal(verhindertFreigabe(fall({ kritikalitaet: 'KRITISCH', status: 'BEREINIGT' })), false);
});

/* ---------- Historie (SPEC-07, Abschnitt 12) ---------- */

test('Schritte werden angefügt und fortlaufend nummeriert', () => {
  const eins = anfuegen([], { fallId: 'f1', art: 'ENTSTANDEN', zeitpunkt: 'a', benutzer: 'anna' });
  const zwei = anfuegen(eins, { fallId: 'f1', art: 'ENTSCHIEDEN', zeitpunkt: 'b', benutzer: 'anna' });

  assert.deepEqual(
    zwei.map((schritt) => schritt.nummer),
    [1, 2]
  );
});

test('ein festgehaltener Schritt lässt sich nicht mehr ändern', () => {
  // „Nachträgliche Korrekturen dürfen frühere Entscheidungen nicht löschen
  // oder überschreiben."
  const historie = anfuegen([], { fallId: 'f1', art: 'ENTSCHIEDEN', zeitpunkt: 'a', benutzer: 'anna' });

  assert.throws(() => {
    (historie[0] as { benutzer: string }).benutzer = 'jemand anderes';
  }, TypeError);
});

/* ---------- Entscheidung (SPEC-07, Abschnitt 6 und 7) ---------- */

test('ein vorhandener Wert wird übernommen und die Herkunft festgehalten', () => {
  const ergebnis = wendeAn(
    fall(),
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'ERP.csv' } }] },
    OPTIONEN
  );

  assert.equal(ergebnis.werte.ort, 'Köln');
  assert.equal(ergebnis.herkunft[0].quelle, 'ERP.csv');
  assert.equal(ergebnis.zulaessig, true);
  assert.equal(ergebnis.status, 'BEREINIGT');
});

test('ein von Hand eingegebener Wert ist als solcher erkennbar', () => {
  const ergebnis = wendeAn(
    fall(),
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'EINGABE', wert: 'Bad Godesberg' } }] },
    OPTIONEN
  );

  assert.equal(ergebnis.werte.ort, 'Bad Godesberg');
  assert.equal(ergebnis.herkunft[0].quelle, 'Eingabe');
});

test('die Fachregeln gelten auch für eine Eingabe von Hand', () => {
  /*
   * SPEC-07, Abschnitt 7: „Die jeweils geltenden Mapping-, Datentyp-,
   * Validierungs- und sonstigen Fachregeln bleiben auch bei manueller
   * Bearbeitung wirksam." Die manuelle Bearbeitung ist ein anderer Weg zur
   * Entscheidung und kein Weg an den Regeln vorbei.
   */
  const menge = fall({
    felder: [{ feld: 'menge', typ: 'INTEGER', angebote: [{ quelle: 'A', wert: '5' }] }],
  });

  const ergebnis = wendeAn(
    menge,
    { art: 'BEREINIGEN', felder: [{ feld: 'menge', wahl: { art: 'EINGABE', wert: '1.234,56' } }] },
    OPTIONEN
  );

  assert.equal(ergebnis.zulaessig, false);
  assert.match(ergebnis.befunde[0].auswirkung, /Datenverlust/);
});

test('ein Feld ohne Auswahl wird nicht stillschweigend gefüllt', () => {
  // Das wäre genau die automatische Entscheidung, die dieser Bildschirm
  // vermeiden soll.
  const ergebnis = wendeAn(fall(), { art: 'BEREINIGEN', felder: [] }, OPTIONEN);

  assert.equal(ergebnis.zulaessig, false);
  assert.match(ergebnis.befunde[0].ursache, /ist nichts ausgewählt/);
  assert.equal(ergebnis.werte.ort, undefined);
});

test('eine Wahl auf einen verschwundenen Wert wird abgelehnt', () => {
  const ergebnis = wendeAn(
    fall(),
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'QUELLE', quelle: 'Gibtsnicht.csv' } }] },
    OPTIONEN
  );

  assert.equal(ergebnis.zulaessig, false);
  assert.match(ergebnis.befunde[0].auswirkung, /zwischen Ansicht und Bestätigung geändert/);
});

test('ausdrücklich leer ist etwas anderes als nicht entschieden', () => {
  const ergebnis = wendeAn(
    fall(),
    { art: 'BEREINIGEN', felder: [{ feld: 'ort', wahl: { art: 'LEER' } }] },
    OPTIONEN
  );

  assert.equal(ergebnis.werte.ort, '');
  assert.equal(ergebnis.zulaessig, true);
  assert.match(ergebnis.herkunft[0].begruendung, /leer gelassen/);
});

test('Zurückstellen ist keine fachliche Entscheidung', () => {
  const zurueck: Entscheidung = { art: 'ZURUECKSTELLEN' };

  assert.equal(statusNach(zurueck), 'ZURUECKGESTELLT');
  assert.equal(istErledigt(statusNach(zurueck)), false);

  const ergebnis = wendeAn(fall(), zurueck, OPTIONEN);

  assert.equal(ergebnis.zulaessig, true, 'sie ist immer möglich');
  assert.deepEqual(ergebnis.herkunft, [], 'und legt keinen Wert fest');
});

/* ---------- Sperre und Fassung (SPEC-07, Abschnitt 11) ---------- */

const JETZT = new Date('2026-08-01T12:00:00.000Z');

test('wer selbst gesperrt hat, darf weiterarbeiten', () => {
  const gesperrt = fall({ sperre: { benutzer: 'anna', seit: '2026-08-01T11:59:00.000Z' } });

  assert.deepEqual(darfBearbeiten(gesperrt, 'anna', JETZT), { ok: true, uebernommen: false });
});

test('eine fremde Sperre hält, solange sie gilt', () => {
  const gesperrt = fall({ sperre: { benutzer: 'bernd', benutzerName: 'Bernd', seit: '2026-08-01T11:59:00.000Z' } });
  const pruefung = darfBearbeiten(gesperrt, 'anna', JETZT);

  assert.equal(pruefung.ok, false);
  assert.match(pruefung.ok === false ? pruefung.grund : '', /Bernd hat diesen Fall/);
});

test('eine abgelaufene Sperre wird übernommen — und das wird gesagt', () => {
  // Sonst blockierte ein geschlossener Browser den Fall für immer.
  const gesperrt = fall({ sperre: { benutzer: 'bernd', seit: '2026-08-01T11:00:00.000Z' } });

  assert.equal(abgelaufen(gesperrt.sperre!, JETZT), true);
  assert.deepEqual(darfBearbeiten(gesperrt, 'anna', JETZT), { ok: true, uebernommen: true });
});

test('eine Entscheidung auf einer überholten Fassung wird abgewiesen', () => {
  // „Bereits vorhandene Bearbeitungen dürfen nicht unbemerkt überschrieben
  // werden." Die Sperre allein reicht nicht: Sie läuft ab.
  const pruefung = pruefeFassung(fall({ fassung: 3 }), 2);

  assert.equal(pruefung.ok, false);
  assert.match(pruefung.ok === false ? pruefung.grund : '', /Jemand anderes war schneller/);
  assert.equal(pruefeFassung(fall({ fassung: 3 }), 3).ok, true);
  assert.equal(pruefeFassung(fall({ fassung: 3 }), undefined).ok, true, 'ohne Angabe wird nicht geprüft');
});

/* ---------- Auswahl (SPEC-07, Abschnitt 9) ---------- */

const LISTE = [
  fall({ id: 'a', kritikalitaet: 'WARNUNG', datensatz: '1', entstanden: '2026-08-01T10:00:00.000Z' }),
  fall({ id: 'b', kritikalitaet: 'KRITISCH', datensatz: '2', entstanden: '2026-08-02T10:00:00.000Z' }),
  fall({ id: 'c', kritikalitaet: 'KRITISCH', datensatz: '3', entstanden: '2026-08-01T09:00:00.000Z' }),
];

test('die Auswahl verändert den Bestand nicht', () => {
  const vorher = LISTE.map((eintrag) => eintrag.id);

  filtere(LISTE, { kritikalitaet: ['KRITISCH'] });
  sortiere(LISTE, 'ENTSTEHUNG');
  gruppiere(LISTE, 'STATUS');

  assert.deepEqual(
    LISTE.map((eintrag) => eintrag.id),
    vorher,
    'die übergebene Liste steht unverändert da'
  );
});

test('das Dringendste zuerst, bei Gleichstand das Ältere', () => {
  assert.deepEqual(
    sortiere(LISTE, 'DRINGLICHKEIT').map((eintrag) => eintrag.id),
    ['c', 'b', 'a']
  );
});

test('gefiltert wird nach Kritikalität, Status, Feld und Freitext', () => {
  assert.equal(filtere(LISTE, { kritikalitaet: ['KRITISCH'] }).length, 2);
  assert.equal(filtere(LISTE, { status: ['BEREINIGT'] }).length, 0);
  assert.equal(filtere(LISTE, { feld: 'ort' }).length, 3);
  assert.equal(filtere(LISTE, { suche: 'Köln' }).length, 3, 'die Suche greift auch auf die Werte zu');
  assert.equal(filtere(LISTE, { suche: 'Hamburg' }).length, 0);
});

test('ein Fall steht in jeder Gruppe, zu der er gehört', () => {
  // Ihn willkürlich der ersten Quelle zuzuschlagen ergäbe eine Zählung, die
  // nicht aufgeht.
  const gruppen = gruppiere(LISTE, 'QUELLE');

  assert.deepEqual([...gruppen.keys()], ['CRM.csv', 'ERP.csv']);
  assert.equal(gruppen.get('CRM.csv')?.length, 3);
  assert.equal(gruppen.get('ERP.csv')?.length, 3);
});

/* ---------- Wiedereinstieg (SPEC-07, Abschnitt 10) ---------- */

test('der Benutzer kommt an seine Stelle zurück', () => {
  const einstieg = wiedereinstieg(
    { benutzer: 'anna', tenantId: 'default', zuletzt: 'b', gespeichert: 'x' },
    LISTE
  );

  assert.deepEqual(einstieg, { gilt: true, fallId: 'b', position: 1 });
});

test('gilt der Einstiegspunkt nicht mehr, wird gesagt warum', () => {
  // Wer gestern an Fall 47 aufgehört hat und heute bei Fall 3 landet, ohne
  // dass ihm jemand etwas sagt, sucht eine Viertelstunde nach Fall 47.
  const einstieg = wiedereinstieg(
    { benutzer: 'anna', tenantId: 'default', zuletzt: 'verschwunden', gespeichert: 'x' },
    LISTE
  );

  assert.equal(einstieg.gilt, false);
  assert.match(einstieg.gilt === false ? einstieg.grund : '', /inzwischen erledigt, oder der gespeicherte Filter/);
});

test('ohne gespeicherten Stand beginnt die Liste oben', () => {
  assert.equal(wiedereinstieg(undefined, LISTE).gilt, false);
});
