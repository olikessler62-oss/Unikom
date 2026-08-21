import assert from 'node:assert/strict';
import test from 'node:test';

import { AUFBEWAHRUNG_TAGE, konfliktdatei, type Ausleitung } from '../../domain/conflicts/Ausleitung.js';
import type { Konfliktfall } from '../../domain/conflicts/Konfliktfall.js';
import type { LogEntry } from '../../domain/logging/LogEntry.js';
import { InMemoryAusleitungsRepository } from '../../infrastructure/persistence/InMemoryAusleitungsRepository.js';
import { InMemoryConflictRepository } from '../../infrastructure/persistence/InMemoryConflictRepository.js';
import type { Dateiablage, Verzeichniseintrag } from '../workflow/Dateiablage.js';
import { Ausleitungsdienst } from './Ausleitungsdienst.js';

class Ablage implements Dateiablage {
  readonly dateien = new Map<string, Uint8Array>();
  readonly verschoben: string[] = [];
  /** Pfade, an denen das Löschen scheitern soll. */
  readonly stur = new Set<string>();

  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    return [...this.dateien.keys()]
      .filter((pfad) => pfad.startsWith(verzeichnis + '/'))
      .map((pfad) => ({ name: pfad.slice(verzeichnis.length + 1) }));
  }

  async lies(pfad: string): Promise<Uint8Array> {
    const inhalt = this.dateien.get(pfad);

    if (!inhalt) {
      throw new Error(`Es gibt keine Datei ${pfad}`);
    }

    return inhalt;
  }

  async schreibe(pfad: string, inhalt: Uint8Array): Promise<void> {
    this.dateien.set(pfad, inhalt);
  }

  async entferne(pfad: string): Promise<void> {
    if (this.stur.has(pfad)) {
      throw new Error('Zugriff verweigert');
    }

    this.dateien.delete(pfad);
  }

  async verschiebe(von: string, nach: string): Promise<void> {
    const inhalt = this.dateien.get(von);

    if (!inhalt) {
      throw new Error(`Es gibt keine Datei ${von}`);
    }

    this.dateien.set(nach, inhalt);
    this.dateien.delete(von);
    this.verschoben.push(`${von} -> ${nach}`);
  }

  pfad(verzeichnis: string, name: string): string {
    return `${verzeichnis}/${name}`;
  }

  text(pfad: string): string {
    return new TextDecoder().decode(this.dateien.get(pfad) ?? new Uint8Array());
  }
}

function fall(teil: Partial<Konfliktfall> = {}): Konfliktfall {
  return {
    id: 'k1',
    tenantId: 't1',
    laufId: 'lauf-1',
    datensatz: 'Kunde 4711',
    art: 'WERTKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: 'Zwei Quellen nennen verschiedene Werte',
    erwartet: 'ein Wert',
    vorgefunden: 'zwei Werte',
    naechsteSchritte: 'Einen Wert wählen',
    quellen: ['a.csv', 'b.csv'],
    felder: [
      {
        feld: 'nachname',
        angebote: [
          { quelle: 'a.csv', wert: 'Meier' },
          { quelle: 'b.csv', wert: 'Meyer' },
        ],
      },
    ],
    entstanden: '2026-01-01T08:00:00.000Z',
    geaendert: '2026-01-01T08:00:00.000Z',
    fassung: 1,
    ...teil,
  };
}

function werkbank(laeufe?: Record<string, boolean>) {
  const ablage = new Ablage();
  const bestand = new InMemoryConflictRepository();
  const ausleitungen = new InMemoryAusleitungsRepository();
  const protokoll: LogEntry[] = [];

  const dienst = new Ausleitungsdienst(
    bestand,
    ausleitungen,
    ablage,
    { log: (eintrag) => protokoll.push(eintrag) },
    laeufe ? { abgeschlossen: async (laufId) => laeufe[laufId] === true } : undefined
  );

  return { ablage, bestand, ausleitungen, protokoll, dienst };
}

const JETZT = new Date('2026-02-01T10:00:00.000Z');

/* ---------- Die Konfliktdatei (SPEC-01 §23) ---------- */

test('die Konfliktdatei trägt die UUID und die konkurrierenden Werte', async () => {
  /*
   * Eine Ausleitung, die nur „Wertkonflikt in Zeile 412" sagt, ist zum
   * Weitergeben unbrauchbar: Der Empfänger muss zurückfragen, was denn nun in
   * Streit steht.
   */
  const { dienst, bestand, ablage } = werkbank();

  await bestand.save(fall());

  const ausleitung = await dienst.leiteKonflikteAus({ tenantId: 't1', verzeichnis: '/aus', jetzt: JETZT });
  const inhalt = ablage.text(ausleitung.pfad);

  assert.equal(ausleitung.faelle, 1);
  assert.match(inhalt, /konflikt_uuid/);
  assert.match(inhalt, /nachname/);
  assert.match(inhalt, /Meier \(a\.csv\) \| Meyer \(b\.csv\)/);
  assert.match(inhalt, /k1/);
});

test('ein Fall bleibt eine Zeile, auch wenn mehrere Felder in Streit stehen', () => {
  // Sonst zählt der Empfänger doppelt so viele Konflikte, wie es gibt.
  const datei = konfliktdatei([
    fall({
      felder: [
        { feld: 'nachname', angebote: [{ quelle: 'a.csv', wert: 'Meier' }] },
        { feld: 'ort', angebote: [{ quelle: 'b.csv', wert: 'Bonn' }] },
      ],
    }),
  ]);

  assert.equal(datei.zeilen.length, 1);
  assert.ok(datei.felder.includes('nachname'));
  assert.ok(datei.felder.includes('ort'));
});

test('nur der genannte Lauf wird ausgeleitet', async () => {
  const { dienst, bestand, ablage } = werkbank();

  await bestand.save(fall({ id: 'k1', laufId: 'lauf-1' }));
  await bestand.save(fall({ id: 'k2', laufId: 'lauf-2' }));

  const ausleitung = await dienst.leiteKonflikteAus({
    tenantId: 't1',
    verzeichnis: '/aus',
    laufId: 'lauf-2',
    jetzt: JETZT,
  });

  assert.equal(ausleitung.faelle, 1);
  assert.match(ablage.text(ausleitung.pfad), /k2/);
  assert.doesNotMatch(ablage.text(ausleitung.pfad), /k1/);
});

test('zwei Ausleitungen desselben Laufs überschreiben sich nicht', async () => {
  // Die erste wäre weg, und niemand hätte es gesehen.
  const { dienst, bestand, ablage } = werkbank();

  await bestand.save(fall());

  const erste = await dienst.leiteKonflikteAus({ tenantId: 't1', verzeichnis: '/aus', jetzt: JETZT });
  const zweite = await dienst.leiteKonflikteAus({
    tenantId: 't1',
    verzeichnis: '/aus',
    jetzt: new Date(JETZT.getTime() + 1000),
  });

  assert.notEqual(erste.pfad, zweite.pfad);
  assert.equal(ablage.dateien.size, 2);
});

test('die Ausleitung steht im Protokoll', async () => {
  const { dienst, bestand, protokoll } = werkbank();

  await bestand.save(fall());
  await dienst.leiteKonflikteAus({
    tenantId: 't1',
    verzeichnis: '/aus',
    jetzt: JETZT,
    wer: { id: 'u1', name: 'Anna' },
  });

  assert.ok(
    protokoll.some((eintrag) => /Konfliktdatei geschrieben/.test(eintrag.message) && eintrag.username === 'Anna'),
    protokoll.map((eintrag) => eintrag.message).join(' | ')
  );
});

/* ---------- Die Konfliktzieldatei ---------- */

test('die Konfliktzieldatei nimmt die Zeilen, wie sie kommen', async () => {
  /*
   * Sie entsteht dort, wo der Statuswechsel protokolliert wird. Dieser Dienst
   * schreibt nur — fasste er den Bestand an, wüsste niemand mehr, ob ein Fall
   * den Status wechselte, weil jemand entschieden hat oder weil jemand eine
   * Datei wollte.
   */
  const { dienst, ablage, bestand } = werkbank();

  await bestand.save(fall());

  const ausleitung = await dienst.leiteZielAus(
    { felder: ['konflikt_uuid', 'nachname'], zeilen: [['k1', 'Meier']] },
    { tenantId: 't1', verzeichnis: '/aus', laufId: 'lauf-9', jetzt: JETZT }
  );

  assert.equal(ausleitung.art, 'ZIEL');
  assert.match(ausleitung.name, /^konfliktziel_lauf-9_/);
  assert.match(ablage.text(ausleitung.pfad), /k1/);
  assert.equal(
    (await bestand.list('t1'))[0].status,
    'OFFEN',
    'der Bestand bleibt unberührt — den Status wechselt der ConflictService'
  );
});

/* ---------- Die Bereinigung (SPEC-07 §5) ---------- */

async function mitAusleitung(
  dienst: Ausleitungsdienst,
  ausleitungen: InMemoryAusleitungsRepository,
  ablage: Ablage,
  teil: Partial<Ausleitung>
): Promise<Ausleitung> {
  const ausleitung: Ausleitung = {
    id: teil.id ?? 'a1',
    tenantId: 't1',
    art: 'KONFLIKTE',
    laufId: 'lauf-1',
    pfad: '/aus/konflikte.csv',
    name: 'konflikte.csv',
    faelle: 1,
    erstellt: '2026-01-01T08:00:00.000Z',
    ...teil,
  };

  await ausleitungen.save(ausleitung);
  await ablage.schreibe(ausleitung.pfad, new Uint8Array([1]));
  void dienst;

  return ausleitung;
}

test('nach Ablauf der Frist wird die Datei fortgeräumt, der Eintrag bleibt', async () => {
  const { dienst, ausleitungen, ablage } = werkbank({ 'lauf-1': true });

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});

  const ergebnis = await dienst.bereinige({ jetzt: JETZT });

  assert.equal(ergebnis.entfernt, 1);
  assert.equal(ablage.dateien.has(ausleitung.pfad), false, 'die Datei ist fort');

  const [eintrag] = await ausleitungen.list();

  assert.ok(eintrag.entferntAm, 'der Eintrag bleibt und trägt den Zeitpunkt');
  assert.equal(eintrag.faelle, 1);
});

test('vor Ablauf der Frist bleibt alles liegen', async () => {
  const { dienst, ausleitungen, ablage } = werkbank({ 'lauf-1': true });

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {
    erstellt: new Date(JETZT.getTime() - (AUFBEWAHRUNG_TAGE - 1) * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0);
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('ein Lauf, der nicht durch ist, behält seine Unterlagen', async () => {
  /*
   * „Für nicht erfolgreich abgeschlossene oder noch in Bearbeitung befindliche
   * Läufe dürfen für Fortsetzung, Konfliktbearbeitung, Fehleranalyse oder
   * Wiederherstellung erforderliche Dateien nicht vorzeitig gelöscht werden."
   * Eine Aufräumung, die nur auf das Datum sieht, nimmt genau dem die
   * Unterlagen weg, der gerade einen misslungenen Lauf untersucht.
   */
  const { dienst, ausleitungen, ablage } = werkbank({ 'lauf-1': false });

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});
  const ergebnis = await dienst.bereinige({ jetzt: JETZT });

  assert.equal(ergebnis.entfernt, 0);
  assert.equal(ergebnis.geschuetzt, 1);
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('ein unbekannter Lauf zählt als nicht abgeschlossen', async () => {
  // Eine Frist, die im Zweifel löscht, löscht irgendwann das, was jemand
  // gebraucht hätte.
  const { dienst, ausleitungen, ablage } = werkbank({});

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0);
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('eine Ausleitung ohne Lauf hängt nur an der Frist', async () => {
  const { dienst, ausleitungen, ablage } = werkbank({});

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, { laufId: undefined });

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 1);
  assert.equal(ablage.dateien.has(ausleitung.pfad), false);
});

test('eine Frist von null Tagen räumt nichts fort', async () => {
  // Abschalten und „sofort löschen" dürfen nicht dieselbe Eingabe sein.
  const { dienst, ausleitungen, ablage } = werkbank({ 'lauf-1': true });

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});

  assert.equal((await dienst.bereinige({ tage: 0, jetzt: JETZT })).entfernt, 0);
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('was sich nicht löschen lässt, wird gemeldet und nicht als fortgeräumt verbucht', async () => {
  // Sonst hielte der Eintrag die Datei für fort, und sie läge noch jahrelang da.
  const { dienst, ausleitungen, ablage, protokoll } = werkbank({ 'lauf-1': true });

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});

  ablage.stur.add(ausleitung.pfad);

  const ergebnis = await dienst.bereinige({ jetzt: JETZT });

  assert.equal(ergebnis.entfernt, 0);
  assert.equal(ergebnis.fehler.length, 1);
  assert.equal((await ausleitungen.list())[0].entferntAm, undefined);
  assert.ok(protokoll.some((eintrag) => eintrag.level === 'WARNING'));
});

test('zweimal bereinigen räumt nicht zweimal fort', async () => {
  const { dienst, ausleitungen, ablage } = werkbank({ 'lauf-1': true });

  await mitAusleitung(dienst, ausleitungen, ablage, {});

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 1);
  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0);
});

test('die Bereinigung fasst den Konfliktbestand nicht an', async () => {
  /*
   * „Die Bereinigung trifft ausschließlich Dateien. Konfliktfall, UUID,
   * Entscheidungen und Bearbeitungshistorie liegen in der Datenbank und bleiben
   * davon unberührt."
   */
  const { dienst, bestand, ausleitungen, ablage } = werkbank({ 'lauf-1': true });

  await bestand.save(fall());
  await mitAusleitung(dienst, ausleitungen, ablage, {});
  await dienst.bereinige({ jetzt: JETZT });

  const faelle = await bestand.list('t1');

  assert.equal(faelle.length, 1);
  assert.equal(faelle[0].id, 'k1');
  assert.equal(faelle[0].status, 'OFFEN');
});

test('ohne Auskunft über die Läufe wird nichts fortgeräumt, was zu einem Lauf gehört', async () => {
  /*
   * Der Dienst kann ohne diese Auskunft gebaut werden — dann weiß er nicht, ob
   * ein Lauf durch ist, und darf folglich nicht aufräumen. Die bequeme Annahme
   * „wird schon fertig sein" nähme genau dem die Unterlagen weg, der einen
   * misslungenen Lauf untersucht.
   */
  const { dienst, ausleitungen, ablage } = werkbank();

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {});

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0);
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('die Frist des Mandanten schlägt die Voreinstellung', async () => {
  /*
   * Der eine Kunde gibt Konfliktdateien an seinen Lieferanten weiter und
   * braucht sie wochenlang, der nächste will sie nach drei Tagen fort haben.
   * Eine Zahl für alle wäre für niemanden die richtige.
   */
  const ablage = new Ablage();
  const ausleitungen = new InMemoryAusleitungsRepository();

  const dienst = new Ausleitungsdienst(
    new InMemoryConflictRepository(),
    ausleitungen,
    ablage,
    { log: () => undefined },
    { abgeschlossen: async () => true },
    { tage: async (tenantId) => (tenantId === 't1' ? 3 : undefined) }
  );

  // Vier Tage alt: unter der Voreinstellung von 30 Tagen bliebe sie liegen.
  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {
    erstellt: new Date(JETZT.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 1);
  assert.equal(ablage.dateien.has(ausleitung.pfad), false);
});

test('ohne Frist am Mandanten gilt die Voreinstellung', async () => {
  const ablage = new Ablage();
  const ausleitungen = new InMemoryAusleitungsRepository();

  const dienst = new Ausleitungsdienst(
    new InMemoryConflictRepository(),
    ausleitungen,
    ablage,
    { log: () => undefined },
    { abgeschlossen: async () => true },
    { tage: async () => undefined }
  );

  const ausleitung = await mitAusleitung(dienst, ausleitungen, ablage, {
    erstellt: new Date(JETZT.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0, '30 Tage sind noch nicht um');
  assert.equal(ablage.dateien.has(ausleitung.pfad), true);
});

test('eine Frist von null Tagen am Mandanten schaltet ab', async () => {
  // Abschalten und „sofort forträumen" dürfen nicht dieselbe Eingabe sein.
  const ablage = new Ablage();
  const ausleitungen = new InMemoryAusleitungsRepository();

  const dienst = new Ausleitungsdienst(
    new InMemoryConflictRepository(),
    ausleitungen,
    ablage,
    { log: () => undefined },
    { abgeschlossen: async () => true },
    { tage: async () => 0 }
  );

  await mitAusleitung(dienst, ausleitungen, ablage, {});

  assert.equal((await dienst.bereinige({ jetzt: JETZT })).entfernt, 0);
});
