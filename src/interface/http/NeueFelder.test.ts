import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createInMemoryApplication, type UnikomApplication } from '../../application/runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { ApiServer, CSRF_HEADER } from './ApiServer.js';

/**
 * Die Schnittstelle mit genau dem, was die Oberfläche schickt.
 *
 * Die Einzelteile sind je für sich geprüft; hier geht es um die Naht dazwischen.
 * Ein Feld, das die Oberfläche sendet und der Server stillschweigend fallen
 * lässt, bestünde jeden Einzeltest und wäre trotzdem das, was ein Benutzer als
 * „kaputt" erlebt: Er stellt etwas ein, speichert, und beim nächsten Öffnen
 * steht es nicht mehr da.
 */
const PASSWORT = 'ein-ordentliches-Passwort-2026';

interface Client {
  application: UnikomApplication;
  anfrage(
    method: string,
    ziel: string,
    body?: unknown
  ): Promise<{ status: number; body: any }>;
}

async function werkbank(t: TestContext): Promise<Client> {
  const application = createInMemoryApplication({
    stagingRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-naht-')),
    masterKeyProvider: new StaticMasterKeyProvider(randomBytes(32)),
  });

  await application.tenantService.ensureDefaultTenant();
  await application.userService.create({
    username: 'anna',
    firstName: 'Anna',
    lastName: 'Meier',
    role: 'ADMIN',
    password: PASSWORT,
  });

  const server = new ApiServer(application, { port: 0 });
  const { port } = await server.listen();

  t.after(async () => {
    await server.close();
    application.close();
  });

  let cookie: string | undefined;
  let csrf: string | undefined;

  const anfrage: Client['anfrage'] = async (method, ziel, body) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (cookie) {
      headers.cookie = cookie;
    }

    if (csrf) {
      headers[CSRF_HEADER] = csrf;
    }

    const antwort = await fetch(`http://127.0.0.1:${port}${ziel}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const gesetzt = antwort.headers.getSetCookie?.()[0];

    if (gesetzt) {
      cookie = gesetzt.split(';')[0];
    }

    const roh = await antwort.text();

    return { status: antwort.status, body: roh ? JSON.parse(roh) : undefined };
  };

  const anmeldung = await anfrage('POST', '/api/session', { username: 'anna', password: PASSWORT });

  csrf = anmeldung.body?.csrfToken;

  return { application, anfrage };
}

/* ---------- Die Einstellungen des Mandanten ---------- */

test('was die Oberfläche am Mandanten einstellt, kommt beim nächsten Öffnen zurück', async (t) => {
  const client = await werkbank(t);

  const gespeichert = await client.anfrage('PUT', '/api/tenants/default', {
    name: 'Standard',
    region: { locale: 'de-DE', timeZone: 'Europe/Berlin' },
    enabled: true,
    consolidation: {
      jahrhundertGrenze: '30',
      nullWerte: ['keine Angabe', 'unbekannt'],
      stichprobe: '200',
      stichprobeGrenze: '2000',
      mindestKonfidenz: '0.99',
    },
  });

  assert.equal(gespeichert.status, 200, JSON.stringify(gespeichert.body));

  const gelesen = await client.anfrage('GET', '/api/tenants');
  const mandant = gelesen.body.find((eintrag: { id: string }) => eintrag.id === 'default');

  assert.equal(mandant.consolidation.jahrhundertGrenze, 30, 'aus dem Textfeld muss eine Zahl werden');
  assert.deepEqual(mandant.consolidation.nullWerte, ['keine Angabe', 'unbekannt']);
  assert.equal(mandant.consolidation.stichprobe, 200);
  assert.equal(mandant.consolidation.mindestKonfidenz, 0.99);
});

test('der Server schickt seine Voreinstellungen mit', async (t) => {
  // Die Oberfläche zeigt sie als Vorschlag im leeren Feld. Rechnete sie sie
  // selbst aus, zeigte sie eines Tages etwas anderes, als der Lauf verwendet.
  const client = await werkbank(t);
  const gelesen = await client.anfrage('GET', '/api/tenants');

  assert.ok(gelesen.body[0].voreinstellungen, JSON.stringify(gelesen.body[0]));
  assert.ok(Array.isArray(gelesen.body[0].voreinstellungen.nullWerte));
  assert.equal(typeof gelesen.body[0].voreinstellungen.mindestKonfidenz, 'number');
});

test('leere Felder nehmen die Einstellung fort, statt Nullen zu speichern', async (t) => {
  /*
   * Im Formular heißt ein leeres Feld „hier gilt die Voreinstellung".
   * `Number('')` ergäbe ausgerechnet den Wert, der am meisten Schaden anrichtet.
   */
  const client = await werkbank(t);

  await client.anfrage('PUT', '/api/tenants/default', { consolidation: { jahrhundertGrenze: '30' } });
  await client.anfrage('PUT', '/api/tenants/default', {
    consolidation: {
      jahrhundertGrenze: '',
      nullWerte: undefined,
      stichprobe: '',
      stichprobeGrenze: '',
      mindestKonfidenz: '',
    },
  });

  const gelesen = await client.anfrage('GET', '/api/tenants');

  assert.equal(gelesen.body[0].consolidation, undefined);
});

test('eine unbrauchbare Einstellung wird mit einem lesbaren Satz abgelehnt', async (t) => {
  const client = await werkbank(t);

  const antwort = await client.anfrage('PUT', '/api/tenants/default', {
    consolidation: { stichprobe: '2' },
  });

  assert.equal(antwort.status, 400);
  assert.match(String(antwort.body?.error ?? antwort.body?.message ?? ''), /mindestens 10 Werte/);
});

/* ---------- Die Regeln am Workflow ---------- */

/** Die Felder, die jeder Workflow braucht — hier geht es um die anderen. */
const WORKFLOW = {
  tenantId: 'default',
  sourceType: 'LOCAL',
  sourceDirectory: 'C:/eingang',
  destinationDirectory: 'C:/ziel',
  allowedExtensions: ['csv'],
  conflictStrategy: 'RENAME',
  sourceSuccessAction: 'KEEP',
  encryptionConfig: { enabled: false, provider: 'NONE' },
  executionMode: 'MANUAL',
  enabled: true,
  transfer: { enabled: false },
};

test('die Konsolidierungsregeln überstehen das Speichern und Lesen', async (t) => {
  /*
   * Sie sind der Grund, warum ein Workflow nachts überhaupt konsolidieren
   * kann. Fielen sie beim Speichern heraus, liefe der Nachtlauf mit den
   * Voreinstellungen — und niemand sähe dem Ergebnis an, dass die eingestellten
   * Regeln nie galten.
   */
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-filialen',
    tenantId: 'default',
    name: 'Filialen',
    sourceType: 'LOCAL',
    sourceDirectory: 'C:/eingang',
    destinationDirectory: 'C:/ziel',
    allowedExtensions: ['csv'],
    conflictStrategy: 'RENAME',
    sourceSuccessAction: 'KEEP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    executionMode: 'MANUAL',
    enabled: true,
    transfer: { enabled: false },
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      dateien: { muster: 'Filiale_*.csv' },
      regeln: {
        betriebsart: 'ANREICHERN',
        art: 'MERGE',
        fuehrend: 'Haupt.csv',
        schluessel: { felder: ['kdnr'] },
        ohneHauptsatz: 'UEBERSPRINGEN',
        dubletten: { auswahl: 'ERSTER', verbleib: 'SEPARAT' },
        entscheidung: { quellen: ['Haupt.csv', 'Zusatz.csv'], aktualitaet: true },
        ergaenzung: { vergleichbarAn: ['plz'], felder: ['ort'], mindestens: 3 },
        aehnlichkeit: { felder: ['firma'], schwelle: 0.7 },
        mehrfachtreffer: { regel: 'FELD', feld: 'geaendert_am', nimm: 'GROESSTER' },
      },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);
  const regeln = gelesen.body.consolidation.regeln;

  assert.equal(regeln.betriebsart, 'ANREICHERN');
  assert.equal(regeln.fuehrend, 'Haupt.csv');
  assert.deepEqual(regeln.schluessel.felder, ['kdnr']);
  assert.equal(regeln.ohneHauptsatz, 'UEBERSPRINGEN');
  assert.deepEqual(regeln.dubletten, { auswahl: 'ERSTER', verbleib: 'SEPARAT' });
  assert.deepEqual(regeln.entscheidung, { quellen: ['Haupt.csv', 'Zusatz.csv'], aktualitaet: true });
  assert.deepEqual(regeln.ergaenzung, { vergleichbarAn: ['plz'], felder: ['ort'], mindestens: 3 });
  assert.deepEqual(regeln.aehnlichkeit, { felder: ['firma'], schwelle: 0.7 });
  assert.deepEqual(regeln.mehrfachtreffer, { regel: 'FELD', feld: 'geaendert_am', nimm: 'GROESSTER' });
  assert.equal(gelesen.body.consolidation.dateien.muster, 'Filiale_*.csv');
});

test('ein Workflow nur mit Konsolidierung lässt sich anlegen', async (t) => {
  /*
   * Bis vor Kurzem hielt ihn die Übertragung an: „dieser Teil der Kette ist
   * noch nicht gebaut." Diese Sperre ist gefallen — sie gilt nur noch für das
   * Ausliefern.
   */
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    ...WORKFLOW,
    id: 'job-nur-konsolidieren',
    name: 'Nur konsolidieren',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));
  assert.deepEqual(angelegt.body.missingFeatures ?? [], []);
});

test('ohne Ergebnis-Verzeichnis wird er abgelehnt, und der Satz sagt warum', async (t) => {
  /*
   * „Wenn Modul 3 nicht ausgeführt werden kann (nicht angehakt, nicht gekauft),
   * dann brauchen wir bei Modul 2 ein Ergebnis-Verzeichnis, das angegeben
   * werden muss." Ein Kunde, der nur Modul 2 hat, kommt sonst nicht an seine
   * Daten.
   */
  const client = await werkbank(t);

  const antwort = await client.anfrage('POST', '/api/jobs', {
    ...WORKFLOW,
    id: 'job-ohne-ziel',
    name: 'Ohne Ziel',
    consolidation: { enabled: true, input: { from: 'DIRECTORY', directory: 'C:/eingang' } },
  });

  assert.equal(antwort.status, 400);
  assert.match(String(antwort.body?.error ?? ''), /braucht ein Verzeichnis/);
});

/* ---------- Die Meldungen ---------- */

test('die drängenden Meldungen lassen sich abfragen, so wie das Popup es tut', async (t) => {
  const client = await werkbank(t);

  await client.application.backgroundService.melde('default', 'KONFLIKTE_ENTSTANDEN', {
    titel: '17 Fälle',
    text: 'Bitte bearbeiten',
  });

  const antwort = await client.anfrage('GET', '/api/notifications/pending?tenantId=default');

  assert.equal(antwort.status, 200);
  assert.equal(antwort.body.length, 1);
  assert.equal(antwort.body[0].titel, '17 Fälle');
});

test('das Konfliktverhalten übersteht das Speichern und Lesen', async (t) => {
  const client = await werkbank(t);

  const gespeichert = await client.anfrage('PUT', '/api/tenants/default', {
    name: 'Standard',
    enabled: true,
    konflikte: { vorlage: 'BEI_JEDEM_OEFFNEN', wiedervorlageStunden: 6, akzeptierenErlaubt: false },
  });

  assert.equal(gespeichert.status, 200, JSON.stringify(gespeichert.body));

  const gelesen = await client.anfrage('GET', '/api/tenants');
  const mandant = gelesen.body.find((eintrag: { id: string }) => eintrag.id === 'default');

  assert.equal(mandant.konflikte.vorlage, 'BEI_JEDEM_OEFFNEN');
  assert.equal(mandant.konflikte.wiedervorlageStunden, 6);
  assert.equal(mandant.konflikte.akzeptierenErlaubt, false);
  // Was gilt, solange nichts eingestellt ist — damit das Formular es als
  // Vorschlag zeigen kann, ohne es selbst zu wissen.
  assert.equal(typeof mandant.konflikteVoreinstellung.wiedervorlageStunden, 'number');
});

test('eine unbekannte Vorlageart wird abgelehnt und nicht stillschweigend zur Voreinstellung', async (t) => {
  /*
   * Wer sich vertippt, soll es erfahren — und nicht drei Wochen später merken,
   * dass die Wiedervorlage nie kam.
   */
  const client = await werkbank(t);

  const antwort = await client.anfrage('PUT', '/api/tenants/default', {
    name: 'Standard',
    enabled: true,
    konflikte: { vorlage: 'IRGENDWAS' },
  });

  assert.equal(antwort.status, 400);
  assert.match(String(antwort.body.error ?? antwort.body.message ?? ''), /Vorlage/);
});

test('eine Wiedervorlage von null Stunden wird abgelehnt', async (t) => {
  // Das wäre `BEI_JEDEM_OEFFNEN` unter anderem Namen, und die gibt es schon.
  const client = await werkbank(t);

  const antwort = await client.anfrage('PUT', '/api/tenants/default', {
    name: 'Standard',
    enabled: true,
    konflikte: { vorlage: 'WIEDERVORLAGE', wiedervorlageStunden: 0 },
  });

  assert.equal(antwort.status, 400);
});

test('wo der Mandant es verbietet, lehnt der Server das Hinnehmen ab', async (t) => {
  /*
   * Der Knopf verschwindet in der Oberfläche — aber eine Einstellung, die nur
   * der Browser durchsetzt, ist keine Einstellung, sondern eine Bitte.
   */
  const client = await werkbank(t);

  await client.anfrage('PUT', '/api/tenants/default', {
    name: 'Standard',
    enabled: true,
    konflikte: { akzeptierenErlaubt: false },
  });

  await client.application.conflictRepository.save({
    id: 'f1',
    tenantId: 'default',
    laufId: 'lauf1',
    datensatz: '4711',
    art: 'WERTEKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: 'Zwei Quellen nennen verschiedene Orte',
    erwartet: 'Einen Wert',
    vorgefunden: 'CRM: Bonn, ERP: Köln',
    naechsteSchritte: 'Den richtigen Wert wählen',
    quellen: ['CRM.csv', 'ERP.csv'],
    felder: [],
    entstanden: '2026-08-24T08:00:00.000Z',
    geaendert: '2026-08-24T08:00:00.000Z',
    fassung: 1,
  });

  const antwort = await client.anfrage('POST', '/api/conflicts/f1/decide', {
    tenantId: 'default',
    decision: { kind: 'AKZEPTIEREN' },
  });

  assert.equal(antwort.status, 422, JSON.stringify(antwort.body));
});

test('die Umformungen überstehen das Speichern und Lesen', async (t) => {
  /*
   * Sie laufen vor dem Konsolidieren und entscheiden damit, wie viele Kunden
   * der Schlüssel findet. Fielen sie beim Speichern heraus, liefe der Nachtlauf
   * über ungeputzte Werte — und niemand sähe dem Ergebnis an, dass die
   * eingestellten Regeln nie galten.
   */
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    ...WORKFLOW,
    id: 'job-umformung',
    name: 'Umformung',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      umformung: {
        felder: [{ feld: 'nachname', schritte: [{ art: 'TRIMMEN' }, { art: 'ANFANGSGROSS' }] }],
        aufteilungen: [
          {
            quelle: 'name',
            ziele: ['nachname', 'vorname'],
            trennung: { art: 'ZEICHEN', zeichen: ',' },
            ueberschuss: 'PRUEFFALL',
          },
        ],
        zusammenfuehrungen: [{ ziel: 'anschrift', quellen: ['strasse', 'ort'], trenner: ', ' }],
      },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);
  const plan = gelesen.body.consolidation.umformung;

  assert.deepEqual(plan.felder, [{ feld: 'nachname', schritte: [{ art: 'TRIMMEN' }, { art: 'ANFANGSGROSS' }] }]);
  assert.equal(plan.aufteilungen[0].quelle, 'name');
  assert.deepEqual(plan.aufteilungen[0].ziele, ['nachname', 'vorname']);
  assert.equal(plan.aufteilungen[0].ueberschuss, 'PRUEFFALL');
  assert.deepEqual(plan.zusammenfuehrungen, [{ ziel: 'anschrift', quellen: ['strasse', 'ort'], trenner: ', ' }]);
});

/* ---------- Die Vorschau (SPEC-09 §11) ---------- */

test('die Vorschau zeigt, was die Regeln mit einer echten Datei tun', async (t) => {
  /*
   * Sie liest mit demselben Leser und formt mit derselben Maschine wie der
   * nächtliche Lauf. Eine Vorschau, die anders rechnet, führt genau die
   * Entscheidungen herbei, die sie verhindern soll.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-vorschau-'));
  const NL = String.fromCharCode(13) + String.fromCharCode(10);

  await fs.writeFile(
    path.join(wurzel, 'Kunden.csv'),
    ['kdnr;name;ort', '4711;meier, anna;Bonn', '4712;SCHULZ, BERT;Köln', '4713;Bert von der Heide;Ulm'].join(NL) + NL,
    'utf-8'
  );

  const antwort = await client.anfrage('POST', '/api/consolidation/transform-preview', {
    tenantId: 'default',
    directory: wurzel,
    umformung: {
      felder: [{ feld: 'name', schritte: [{ art: 'ANFANGSGROSS' }] }],
      aufteilungen: [
        { quelle: 'name', ziele: ['nachname', 'vorname'], trennung: { art: 'ZEICHEN', zeichen: ',' } },
      ],
    },
  });

  assert.equal(antwort.status, 200, JSON.stringify(antwort.body));
  assert.equal(antwort.body.datei, 'Kunden.csv');
  assert.equal(antwort.body.datensaetze, 3);

  const nachname = antwort.body.felder.find((feld: { feld: string }) => feld.feld === 'nachname');

  assert.equal(nachname.neu, true);
  assert.equal(antwort.body.zeilen[0].vorher.name, 'meier, anna');
  assert.equal(antwort.body.zeilen[0].nachher.nachname, 'Meier');

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('ein leeres Verzeichnis nennt die Formate, die gelesen werden', async (t) => {
  // „Keine Datei gefunden" schickt jemanden auf die Suche nach dem Fehler im
  // Pfad, wo in Wahrheit eine PDF im Ordner liegt.
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-leer-'));

  const antwort = await client.anfrage('POST', '/api/consolidation/transform-preview', {
    tenantId: 'default',
    directory: wurzel,
  });

  assert.equal(antwort.status, 404);
  assert.match(String(antwort.body?.error ?? ''), /CSV, TXT, JSON, XML und XLSX/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('die Vorschau kommt nicht am Mandantenverzeichnis vorbei', async (t) => {
  /*
   * Sie liest nur — und wäre damit der bequemste Weg in den Ordner eines
   * anderen Mandanten.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-fremd-'));

  await client.application.tenantService.update('default', { rootDirectory: path.join(wurzel, 'meins') });
  await fs.mkdir(path.join(wurzel, 'meins'), { recursive: true });

  const antwort = await client.anfrage('POST', '/api/consolidation/transform-preview', {
    tenantId: 'default',
    directory: path.join(wurzel, 'fremd'),
  });

  assert.equal(antwort.status, 403);
  assert.match(String(antwort.body?.error ?? ''), /außerhalb des Verzeichnisses/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

/* ---------- Die Zuordnungsvorschau (SPEC-09 §11) ---------- */

test('die Zuordnungsvorschau sagt, welchem internen Feld eine Spalte entspricht', async (t) => {
  /*
   * Die andere Frage an dieselbe Datei: nicht was mit den Werten geschieht,
   * sondern ob „Kd-Nr." und „Kundennummer" dasselbe meinen.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-zuordnung-'));
  const NL = String.fromCharCode(13) + String.fromCharCode(10);

  await fs.writeFile(
    path.join(wurzel, 'Kunden.csv'),
    ['Kundennr;E-Mail;Bemerkung', '4711;anna@example.com;Stammkunde', '4712;bert@example.com;Neukunde'].join(NL) + NL,
    'utf-8'
  );

  const antwort = await client.anfrage('POST', '/api/consolidation/mapping-preview', {
    tenantId: 'default',
    directory: wurzel,
  });

  assert.equal(antwort.status, 200, JSON.stringify(antwort.body));
  assert.equal(antwort.body.datei, 'Kunden.csv');

  const spalten = antwort.body.spalten as { spalte: string; intern?: string; beispiele: string[] }[];

  assert.equal(spalten.find((spalte) => spalte.spalte === 'Kundennr')?.intern, 'customerId');
  assert.equal(spalten.find((spalte) => spalte.spalte === 'E-Mail')?.intern, 'email');
  assert.equal(spalten.find((spalte) => spalte.spalte === 'Bemerkung')?.intern, undefined);
  assert.ok(antwort.body.felder.length > 0, 'die internen Felder zur Auswahl stehen dabei');

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('was jemand bestätigt hat, ist beim nächsten Mal keine Vermutung mehr', async (t) => {
  /*
   * Der ganze Zweck des Bildschirms — über die Naht geprüft: Der Browser
   * schickt die Berichtigung an dieselbe Adresse, an der die Mapping-Verwaltung
   * hängt, und die nächste Vorschau muss sie kennen. Ohne diesen Weg lernt die
   * Erkennung nichts (SPEC-02, Abschnitt 15).
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-bestaetigt-'));
  const NL = String.fromCharCode(13) + String.fromCharCode(10);

  await fs.writeFile(path.join(wurzel, 'Kunden.csv'), ['Spalte 7;Bemerkung', '4711;x'].join(NL) + NL, 'utf-8');

  const vorher = await client.anfrage('POST', '/api/consolidation/mapping-preview', {
    tenantId: 'default',
    directory: wurzel,
  });

  assert.equal(vorher.body.spalten[0].intern, undefined, 'diese Spalte kennt niemand');
  assert.equal(vorher.body.spalten[0].istRegel, false);

  const bestaetigt = await client.anfrage('POST', '/api/mappings', {
    art: 'FELD',
    ebene: 'MANDANT',
    tenantId: 'default',
    von: 'Spalte 7',
    nach: 'customerId',
  });

  assert.equal(bestaetigt.status, 201, JSON.stringify(bestaetigt.body));

  const nachher = await client.anfrage('POST', '/api/consolidation/mapping-preview', {
    tenantId: 'default',
    directory: wurzel,
  });

  assert.equal(nachher.body.spalten[0].intern, 'customerId');
  assert.equal(nachher.body.spalten[0].istRegel, true);
  assert.equal(nachher.body.spalten[0].sicherheit, 'EINDEUTIG');

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('auch die Zuordnungsvorschau kommt nicht am Mandantenverzeichnis vorbei', async (t) => {
  // Beide Vorschauen gehen durch dieselbe Prüfung; ohne diesen Test wüsste
  // niemand, ob die neue Route sie auch benutzt.
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-fremd-zuordnung-'));

  await client.application.tenantService.update('default', { rootDirectory: path.join(wurzel, 'meins') });
  await fs.mkdir(path.join(wurzel, 'meins'), { recursive: true });

  const antwort = await client.anfrage('POST', '/api/consolidation/mapping-preview', {
    tenantId: 'default',
    directory: path.join(wurzel, 'fremd'),
  });

  assert.equal(antwort.status, 403);
  assert.match(String(antwort.body?.error ?? ''), /außerhalb des Verzeichnisses/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

/* ---------- Ausleitungen des Konfliktbestands (SPEC-01 §23, SPEC-07 §5) ---------- */

test('die Konfliktdatei landet im Verzeichnis des Mandanten', async (t) => {
  /*
   * Ohne Angabe eines Pfades: Wer eine Konfliktdatei weitergeben will, soll
   * sich keinen ausdenken müssen, und wer sie später sucht, soll wissen, wo sie
   * liegt.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ausleitung-'));

  await client.application.tenantService.update('default', { rootDirectory: wurzel });

  const antwort = await client.anfrage('POST', '/api/conflicts/export', { tenantId: 'default' });

  assert.equal(antwort.status, 201, JSON.stringify(antwort.body));
  assert.match(String(antwort.body.pfad), /Konfliktausleitungen/);
  assert.equal(antwort.body.art, 'KONFLIKTE');

  const geschrieben = await fs.readFile(String(antwort.body.pfad), 'utf-8');

  assert.match(geschrieben, /konflikt_uuid/, 'die Spaltenüberschriften stehen darin');

  const liste = await client.anfrage('GET', '/api/conflicts/exports?tenantId=default');

  assert.equal(liste.status, 200);
  assert.equal(liste.body.length, 1);
  assert.equal(liste.body[0].id, antwort.body.id);

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('eine Ausleitung kommt nicht am Mandantenverzeichnis vorbei', async (t) => {
  // Sie schreibt — und ist damit ein noch bequemerer Weg in den Ordner eines
  // anderen Mandanten als eine Vorschau, die nur liest.
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ausleitung-fremd-'));

  await client.application.tenantService.update('default', { rootDirectory: path.join(wurzel, 'meins') });
  await fs.mkdir(path.join(wurzel, 'meins'), { recursive: true });

  const antwort = await client.anfrage('POST', '/api/conflicts/export', {
    tenantId: 'default',
    directory: path.join(wurzel, 'fremd'),
  });

  assert.equal(antwort.status, 403);
  assert.match(String(antwort.body?.error ?? ''), /außerhalb des Verzeichnisses/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('ohne eigenes Verzeichnis sagt die Ausleitung, was fehlt', async (t) => {
  // „Fehler beim Schreiben" schickt jemanden auf die Suche nach einem
  // Plattenproblem, wo in Wahrheit eine Einstellung fehlt.
  const client = await werkbank(t);

  await client.application.tenantService.update('default', { rootDirectory: '' });

  const antwort = await client.anfrage('POST', '/api/conflicts/export', { tenantId: 'default' });

  assert.equal(antwort.status, 400);
  assert.match(String(antwort.body?.error ?? ''), /kein eigenes Verzeichnis/);
});

test('mehrere Durchgänge überstehen das Speichern und Lesen', async (t) => {
  // Die Naht: Was der Editor schickt, muss beim nächsten Öffnen zurückkommen —
  // sonst steht die Folge im Bildschirm und nicht im Lauf.
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-zweistufig',
    ...WORKFLOW,
    name: 'Zweistufig',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/arbeit' },
      weitere: [
        {
          name: 'anreichern',
          input: { from: 'PRECEDING' },
          output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
        },
      ],
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);

  const weitere = gelesen.body.consolidation.weitere;

  assert.equal(weitere.length, 1);
  assert.equal(weitere[0].name, 'anreichern');
  assert.equal(weitere[0].input.from, 'PRECEDING');
  assert.equal(weitere[0].output.directory, 'C:/ergebnis');
});

test('die Verzeichniswahl eines Durchgangs fragt den Server und bekommt eine Antwort', async (t) => {
  /*
   * Die Naht hinter dem Auswahlknopf: Was das Feld schickt — örtlich, ohne
   * Zugang, nur mit Mandant und Pfad —, muss die Route annehmen. Der Server
   * antwortet, nicht der Browser: Das Fenster soll sehen, was der Lauf später
   * findet.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-wahl-'));

  await fs.mkdir(path.join(wurzel, 'arbeit'), { recursive: true });
  await client.application.tenantService.update('default', { rootDirectory: wurzel });

  const antwort = await client.anfrage('POST', '/api/jobs/browse-local', {
    name: 'Konsolidierung',
    tenantId: 'default',
    directory: wurzel,
    known: [],
    sourceType: 'LOCAL',
  });

  assert.equal(antwort.status, 200, JSON.stringify(antwort.body));
  assert.equal(antwort.body.ok, true, antwort.body.message);
  assert.ok(
    (antwort.body.entries as { name: string }[]).some((eintrag) => eintrag.name === 'arbeit'),
    JSON.stringify(antwort.body.entries)
  );

  await fs.rm(wurzel, { recursive: true, force: true });
});

/* ---------- Referenzquellen verwalten (SPEC-04 §6, §8) ---------- */

test('eine Referenzquelle lässt sich anlegen, nachsehen und entfernen', async (t) => {
  /*
   * Der Referenzabgleich war gebaut und vom Workflow aus unerreichbar: Es gab
   * keine Stelle, an der ein Bestand steht. Das ist diese Stelle.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ref-'));
  const NL = String.fromCharCode(13) + String.fromCharCode(10);

  await fs.writeFile(path.join(wurzel, 'plz.csv'), ['plz;ort', '53111;Bonn', '50667;Köln'].join(NL) + NL, 'utf-8');
  await client.application.tenantService.update('default', { rootDirectory: wurzel });

  const angelegt = await client.anfrage('POST', '/api/reference-sources', {
    tenantId: 'default',
    name: 'PLZ-Verzeichnis',
    directory: wurzel,
    version: '2026-Q1',
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));
  assert.equal(angelegt.body.version, '2026-Q1');

  const geprueft = await client.anfrage('POST', `/api/reference-sources/${angelegt.body.id}/check`, {
    tenantId: 'default',
  });

  assert.equal(geprueft.status, 200, JSON.stringify(geprueft.body));
  assert.equal(geprueft.body.gesehen.datei, 'plz.csv');
  assert.deepEqual(geprueft.body.gesehen.felder, ['plz', 'ort']);
  assert.equal(geprueft.body.gesehen.zeilen, 2);

  const liste = await client.anfrage('GET', '/api/reference-sources?tenantId=default');

  assert.equal(liste.body.length, 1);

  const entfernt = await client.anfrage('DELETE', `/api/reference-sources/${angelegt.body.id}`);

  assert.equal(entfernt.status, 200);
  assert.equal((await client.anfrage('GET', '/api/reference-sources?tenantId=default')).body.length, 0);
  assert.equal(
    (await fs.readFile(path.join(wurzel, 'plz.csv'), 'utf-8')).length > 0,
    true,
    'die Datei bleibt liegen — der Eintrag war ein Verweis'
  );

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('eine Referenzquelle kommt nicht am Mandantenverzeichnis vorbei', async (t) => {
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ref-fremd-'));

  await client.application.tenantService.update('default', { rootDirectory: path.join(wurzel, 'meins') });
  await fs.mkdir(path.join(wurzel, 'meins'), { recursive: true });

  const antwort = await client.anfrage('POST', '/api/reference-sources', {
    tenantId: 'default',
    name: 'Fremd',
    directory: path.join(wurzel, 'fremd'),
  });

  assert.equal(antwort.status, 403);
  assert.match(String(antwort.body?.error ?? ''), /außerhalb des Verzeichnisses/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('eine Referenzquelle ohne Datei sagt beim Nachsehen, welche gemeint war', async (t) => {
  // „Kein lesbarer Inhalt" schickt jemanden in ein Verzeichnis; der Name der
  // Quelle sagt ihm zugleich, welche Einstellung dahintersteht.
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ref-leer-'));

  await client.application.tenantService.update('default', { rootDirectory: wurzel });

  const angelegt = await client.anfrage('POST', '/api/reference-sources', {
    tenantId: 'default',
    name: 'Ortsverzeichnis',
    directory: wurzel,
  });

  const geprueft = await client.anfrage('POST', `/api/reference-sources/${angelegt.body.id}/check`, {
    tenantId: 'default',
  });

  assert.equal(geprueft.status, 404);
  assert.match(String(geprueft.body?.error ?? ''), /Ortsverzeichnis/);

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('der Referenzverweis am Durchgang übersteht das Speichern und Lesen', async (t) => {
  // Die Naht: Ohne sie stünde der Abgleich im Bildschirm und nicht im Lauf.
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-referenz',
    ...WORKFLOW,
    name: 'Mit Referenz',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      regeln: {
        betriebsart: 'SAMMELN',
        art: 'APPEND',
        referenzen: [
          {
            quelleId: 'ref-1',
            felder: ['plz'],
            referenzfelder: ['postleitzahl'],
            uebernehmen: [{ feld: 'ort', aus: 'ort' }],
            ohneTreffer: 'KONFLIKT',
          },
        ],
      },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);
  const [verweis] = gelesen.body.consolidation.regeln.referenzen;

  assert.equal(verweis.quelleId, 'ref-1');
  assert.deepEqual(verweis.felder, ['plz']);
  assert.deepEqual(verweis.referenzfelder, ['postleitzahl']);
  assert.deepEqual(verweis.uebernehmen, [{ feld: 'ort', aus: 'ort' }]);
  assert.equal(verweis.ohneTreffer, 'KONFLIKT');
});

test('das Ausgabeformat mit festen Feldbreiten übersteht das Speichern und Lesen', async (t) => {
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-festbreiten',
    ...WORKFLOW,
    name: 'Hostlieferung',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      format: 'FESTBREITEN',
      festbreiten: {
        kopfzeile: true,
        felder: [
          { name: 'kdnr', start: 1, laenge: 5, ausrichtung: 'RECHTS', fuellzeichen: '0' },
          { name: 'ort', start: 6, laenge: 10, kuerzen: true },
        ],
      },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);

  assert.equal(gelesen.body.consolidation.format, 'FESTBREITEN');
  assert.equal(gelesen.body.consolidation.festbreiten.kopfzeile, true);
  assert.deepEqual(gelesen.body.consolidation.festbreiten.felder[0], {
    name: 'kdnr',
    start: 1,
    laenge: 5,
    ausrichtung: 'RECHTS',
    fuellzeichen: '0',
  });
  assert.equal(gelesen.body.consolidation.festbreiten.felder[1].kuerzen, true);
});

test('die Schemaprüfung übersteht das Speichern und Lesen', async (t) => {
  // Ohne die Naht stünde sie im Bildschirm und nicht im Lauf — genau der
  // Befund, der beim Referenzabgleich jahrelang unbemerkt blieb.
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-schema',
    ...WORKFLOW,
    name: 'Mit Schemapruefung',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      schema: { datei: 'C:/schemas/kunden.json', bei: 'WARNEN' },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);

  assert.deepEqual(gelesen.body.consolidation.schema, { datei: 'C:/schemas/kunden.json', bei: 'WARNEN' });
});

test('die Wahl eines Schemas übersteht das Speichern und Lesen', async (t) => {
  /*
   * Der Weg, der die JSON-Datei ablöst: Statt eines Pfades steht am Durchgang
   * die Kennung eines Eingangsprofils des Mandanten. Ohne diese Naht stünde die
   * Auswahl im Bildschirm und käme nie im Auftrag an.
   */
  const client = await werkbank(t);

  const angelegt = await client.anfrage('POST', '/api/jobs', {
    id: 'job-schemawahl',
    ...WORKFLOW,
    name: 'Mit Schemawahl',
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      schema: { profil: 'p-bestellung-mueller', bei: 'ABBRECHEN' },
    },
  });

  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.body));

  const gelesen = await client.anfrage('GET', `/api/jobs/${angelegt.body.id}`);

  assert.deepEqual(gelesen.body.consolidation.schema, {
    profil: 'p-bestellung-mueller',
    bei: 'ABBRECHEN',
  });
});

test('der Verzeichnisbrowser nennt auch die Dateien, nicht nur ihre Zahl', async (t) => {
  /*
   * Die Naht hinter dem Dateiwähler. Ohne die Namen bliebe für eine
   * Schemadatei nur das Abtippen — und ein Tippfehler dort meldet sich erst im
   * Nachtlauf, wenn niemand mehr hinsieht.
   */
  const client = await werkbank(t);
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-dateien-'));

  await fs.mkdir(path.join(wurzel, 'unterordner'), { recursive: true });
  await fs.writeFile(path.join(wurzel, 'kunden.json'), '{}', 'utf-8');
  await client.application.tenantService.update('default', { rootDirectory: wurzel });

  const antwort = await client.anfrage('POST', '/api/jobs/browse-local', {
    name: 'Schemaprüfung',
    tenantId: 'default',
    directory: wurzel,
    known: [],
    sourceType: 'LOCAL',
  });

  assert.equal(antwort.status, 200, JSON.stringify(antwort.body));

  const dateien = antwort.body.files as { name: string; path: string }[];
  const ordner = antwort.body.entries as { name: string }[];

  assert.deepEqual(
    dateien.map((datei) => datei.name),
    ['kunden.json']
  );
  assert.equal(dateien[0].path, path.join(wurzel, 'kunden.json'), 'der volle Pfad steht dabei');
  assert.deepEqual(
    ordner.map((eintrag) => eintrag.name),
    ['unterordner'],
    'Dateien werden nicht unter die Ordner gemischt'
  );
  assert.equal(antwort.body.filesFound, 1, 'die Zahl bleibt daneben stehen');

  await fs.rm(wurzel, { recursive: true, force: true });
});

test('die Aufbewahrungsfrist der Ausleitungen kommt am Mandanten an', async (t) => {
  // Was je Kunde verschieden sein kann, gehört nicht an die Installation.
  const client = await werkbank(t);

  const gesetzt = await client.anfrage('PUT', '/api/tenants/default', { ausleitungenTage: 3 });

  assert.equal(gesetzt.status, 200, JSON.stringify(gesetzt.body));
  assert.equal(gesetzt.body.ausleitungenTage, 3);

  // Null heißt abgeschaltet und ist etwas anderes als „nichts eingetragen".
  assert.equal((await client.anfrage('PUT', '/api/tenants/default', { ausleitungenTage: 0 })).body.ausleitungenTage, 0);
});

test('eine geleerte Frist wird wieder zur Voreinstellung', async (t) => {
  /*
   * Ohne den Unterschied zwischen „Feld fehlt" und „leer" ließe sich eine
   * einmal gesetzte Frist nie zurücknehmen: Der alte Wert bliebe stehen,
   * während im Formular nichts mehr steht.
   */
  const client = await werkbank(t);

  await client.anfrage('PUT', '/api/tenants/default', { ausleitungenTage: 3 });

  const geleert = await client.anfrage('PUT', '/api/tenants/default', { ausleitungenTage: null });

  assert.equal(geleert.status, 200, JSON.stringify(geleert.body));
  assert.equal(geleert.body.ausleitungenTage, undefined);

  // Eine Anfrage ohne das Feld fasst die Einstellung nicht an.
  await client.anfrage('PUT', '/api/tenants/default', { ausleitungenTage: 5 });

  assert.equal((await client.anfrage('PUT', '/api/tenants/default', { name: 'Standard' })).body.ausleitungenTage, 5);
});
