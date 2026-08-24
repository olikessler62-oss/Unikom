import assert from 'node:assert/strict';
import test from 'node:test';

import { wirksameEinstellungen } from '../../domain/consolidation/Einstellungen.js';
import type { Quelle } from '../../domain/consolidation/Quellen.js';
import type { Benachrichtigung } from '../../domain/background/Benachrichtigung.js';
import type { Feature, FeatureSet } from '../../domain/licensing/Feature.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import {
  InMemoryHeartbeatRepository,
  InMemoryNotificationRepository,
} from '../../infrastructure/persistence/InMemoryBackgroundRepository.js';
import { InMemoryConflictRepository } from '../../infrastructure/persistence/InMemoryConflictRepository.js';
import { InMemoryResultRepository } from '../../infrastructure/persistence/InMemoryResultRepository.js';
import { InMemoryTenantRepository } from '../../infrastructure/persistence/InMemoryTenantRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { BackgroundService } from '../background/BackgroundService.js';
import { ConflictService } from '../conflicts/ConflictService.js';
import { ConsolidationService } from '../consolidation/ConsolidationService.js';
import { ResultService } from '../result/ResultService.js';
import type { TransferExecutionOptions, TransferRunResult } from '../transfer/TransferExecutionService.js';
import type { JobExecutor } from '../transfer/TransferOrchestratorService.js';
import type { LogEntry } from '../../domain/logging/LogEntry.js';
import type {
  ShareConnections,
  ShareCredentials,
} from '../../infrastructure/filesystem/ShareConnectionService.js';
import type { Dateiablage, Verzeichniseintrag } from './Dateiablage.js';
import {
  alsEingang,
  auftragAus,
  mitPruefaellen,
  ergebnisdateiname,
  WorkflowExecutionService,
  type Konsolidierungsumgebung,
} from './WorkflowExecutionService.js';

/* ---------- Werkbank ---------- */

/** Ein Dateisystem im Arbeitsspeicher — kein Test legt Verzeichnisse an. */
class Ablage implements Dateiablage {
  readonly dateien = new Map<string, Uint8Array>();
  readonly verschoben: string[] = [];
  readonly geschrieben: string[] = [];

  lege(pfad: string, felder: string[], zeilen: string[][]): void {
    this.dateien.set(pfad, alsBytes(schreibeCsv(felder, zeilen)));
  }

  /** Je Datei ein eigener Zeitpunkt — sonst haben alle denselben. */
  readonly zeiten = new Map<string, string>();

  geaendertAm(pfad: string, iso: string): void {
    this.zeiten.set(pfad, iso);
  }

  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    return [...this.dateien.keys()]
      .filter((pfad) => pfad.startsWith(verzeichnis + '/'))
      .map((pfad) => ({
        name: pfad.slice(verzeichnis.length + 1),
        geaendert: this.zeiten.get(pfad) ?? '2026-08-20T02:00:00.000Z',
      }));
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
    this.geschrieben.push(pfad);
  }

  async entferne(pfad: string): Promise<void> {
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
}

function uebertragung(ergebnis: Partial<TransferRunResult> = {}): JobExecutor {
  return {
    async execute(job: TransferJob, options: TransferExecutionOptions = {}): Promise<TransferRunResult> {
      return {
        runId: options.runId ?? 'TR-1',
        jobId: job.id,
        status: TransferRunStatus.SUCCESS,
        filesFound: 0,
        filesSelected: 0,
        filesSucceeded: 0,
        filesSkipped: 0,
        filesFailed: 0,
        outcomes: [],
        message: 'Übertragung erledigt',
        ...ergebnis,
      };
    },
  };
}

const ALLES: FeatureSet = { isEnabled: () => true, enabled: () => [] };

function ohne(fehlend: Feature): FeatureSet {
  return { isEnabled: (feature) => feature !== fehlend, enabled: () => [] };
}

interface Werkbank {
  umgebung: Konsolidierungsumgebung;
  ablage: Ablage;
  meldungen: InMemoryNotificationRepository;
  ergebnisse: InMemoryResultRepository;
  konflikte: InMemoryConflictRepository;
}

function werkbank(features: FeatureSet = ALLES): Werkbank {
  const ablage = new Ablage();
  const meldungen = new InMemoryNotificationRepository();
  const ergebnisse = new InMemoryResultRepository();
  const konflikte = new InMemoryConflictRepository();

  return {
    ablage,
    meldungen,
    ergebnisse,
    konflikte,
    umgebung: {
      consolidation: new ConsolidationService(),
      conflicts: new ConflictService(konflikte),
      results: new ResultService(ergebnisse),
      tenants: new InMemoryTenantRepository(),
      ablage,
      background: new BackgroundService(
        new InMemoryHeartbeatRepository(),
        meldungen,
        new InMemoryTransferRunRepository()
      ),
      features,
    },
  };
}

function job(teile: Partial<TransferJob> = {}): TransferJob {
  return createTransferJob({
    id: 'job1',
    name: 'Nachtlauf',
    tenantId: 'default',
    transfer: { enabled: false },
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: '/eingang' },
      regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
    },
    ...teile,
  });
}

async function offeneMeldungen(bank: Werkbank): Promise<Benachrichtigung[]> {
  return bank.meldungen.list('default', false);
}

/* ---------- Der Grundfall ---------- */

test('ein Workflow ohne Konsolidierungsschritt bleibt, was er war', async () => {
  // Der Dienst liegt in jedem Lauf im Weg. Er darf keinen anfassen, der ihn
  // nicht bestellt hat.
  const bank = werkbank();
  const dienst = new WorkflowExecutionService(uebertragung(), bank.umgebung);

  const ergebnis = await dienst.execute(job({ consolidation: undefined }));

  assert.equal(ergebnis.message, 'Übertragung erledigt');
  assert.equal((await bank.ergebnisse.list('default')).length, 0);
});

test('aus zwei Dateien im Verzeichnis wird ein Ergebnisstand', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/Nord.csv',
    ['kdnr', 'ort'],
    [
      ['4711', 'Bonn'],
      ['4712', 'Köln'],
    ]
  );
  bank.ablage.lege('/eingang/Sued.csv', ['kdnr', 'ort'], [['4713', 'Ulm']]);

  const dienst = new WorkflowExecutionService(uebertragung(), bank.umgebung);
  const ergebnis = await dienst.execute(job());

  const staende = await bank.ergebnisse.list('default');

  assert.equal(staende.length, 1, 'genau ein Ergebnisstand je Lauf');
  assert.equal(staende[0].zeilen.length, 3);
  assert.equal(staende[0].laufId, 'TR-1');
  assert.equal(staende[0].jobId, 'job1', 'der Stand hängt am Workflow');
  assert.match(ergebnis.message, /konsolidiert: 3 Datensatz/);
});

test('eine erfolgreiche Verarbeitung meldet sich, und zwar als Information', async () => {
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  const meldungen = await offeneMeldungen(bank);

  assert.equal(meldungen.length, 1);
  assert.equal(meldungen[0].anlass, 'LAUF_ERFOLGREICH');
  assert.equal(meldungen[0].stufe, 'INFORMATION');
});

/* ---------- Woher die Dateien kommen ---------- */

test('am vorangehenden Schritt gelten die Dateien dieses Laufs, nicht das Verzeichnis', async () => {
  /*
   * Im Zielverzeichnis liegen auch die Dateien von gestern. Sie jede Nacht
   * mitzukonsolidieren ergäbe ein Ergebnis, das um einen Tag zu groß ist — und
   * das sähe man ihm nicht an.
   */
  const bank = werkbank();

  bank.ablage.lege('/ziel/heute.csv', ['kdnr'], [['1'], ['2']]);
  bank.ablage.lege('/ziel/gestern.csv', ['kdnr'], [['8'], ['9']]);

  const dienst = new WorkflowExecutionService(
    uebertragung({
      outcomes: [
        {
          filename: 'heute.csv',
          status: FileTransferStatus.SUCCESS,
          destinationPath: '/ziel/heute.csv',
          message: 'ok',
        },
      ],
    }),
    bank.umgebung
  );

  await dienst.execute(
    job({
      transfer: { enabled: true },
      destinationType: 'LOCAL',
      consolidation: { enabled: true, input: { from: 'PRECEDING' }, regeln: { betriebsart: 'SAMMELN', art: 'APPEND' } },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.zeilen, [['1'], ['2']]);
});

test('ein entferntes Ziel wird benannt statt still zu einem leeren Ergebnis zu führen', async () => {
  // Die Konsolidierung liest örtlich. Das ist eine Grenze und keine Panne —
  // aber eine, die dastehen muss, sonst sucht jemand den Fehler in den Daten.
  const bank = werkbank();
  const dienst = new WorkflowExecutionService(uebertragung(), bank.umgebung);

  const ergebnis = await dienst.execute(
    job({
      transfer: { enabled: true },
      destinationType: 'SFTP',
      consolidation: { enabled: true, input: { from: 'PRECEDING' } },
    })
  );

  assert.match(ergebnis.message, /entfernten Server/);
  assert.equal(ergebnis.status, TransferRunStatus.SUCCESS_NO_FILES);
});

test('das Muster entscheidet, welche Datei mitkommt', async () => {
  const bank = werkbank();

  bank.ablage.lege('/eingang/Filiale_Nord.csv', ['kdnr'], [['1'], ['2']]);
  bank.ablage.lege('/eingang/Archiv_2025.csv', ['kdnr'], [['8'], ['9']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        dateien: { muster: 'Filiale_*.csv' },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.zeilen, [['1'], ['2']]);
});

test('der Dateityp entscheidet mit, welche Datei mitkommt', async () => {
  /*
   * Beide Formate kann der Leser öffnen — `.txt` wird wie eine CSV gelesen. Die
   * Auswahl schränkt darüber hinaus ein: Wer `csv` einträgt, will die
   * Textfassung daneben nicht mitnehmen, auch wenn sie sich lesen ließe.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/Umsatz.csv', ['kdnr'], [['1'], ['2']]);
  bank.ablage.lege('/eingang/Umsatz.txt', ['kdnr'], [['8'], ['9']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        dateien: { endungen: ['csv'] },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.zeilen, [['1'], ['2']]);
});

test('kein Lauf ohne Quelle — aber auch kein Fehler daraus', async () => {
  /*
   * Ein Workflow, der jede Nacht in ein Verzeichnis sieht, findet dort oft
   * nichts. Eine kritische Meldung dafür wäre eine, die jede Nacht kommt.
   */
  const bank = werkbank();
  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.SUCCESS_NO_FILES);
  assert.deepEqual(await offeneMeldungen(bank), []);
  assert.equal((await bank.ergebnisse.list('default')).length, 0);
});

/* ---------- Was der vorige Schritt hinterlässt ---------- */

test('eine fehlgeschlagene Übertragung wird nicht konsolidiert', async () => {
  /*
   * Sonst würde der Bestand des letzten Laufs ein zweites Mal verarbeitet —
   * und das Ergebnis sähe frisch aus.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/alt.csv', ['kdnr'], [['1'], ['2']]);

  const dienst = new WorkflowExecutionService(
    uebertragung({ status: TransferRunStatus.FAILED, message: 'Verbindung abgelehnt' }),
    bank.umgebung
  );

  const ergebnis = await dienst.execute(job({ transfer: { enabled: true } }));

  assert.equal(ergebnis.status, TransferRunStatus.FAILED);
  assert.equal((await bank.ergebnisse.list('default')).length, 0);
});

test('ein Workflow ohne Übertragung wird von deren Status nicht aufgehalten', async () => {
  // Wer nur Modul 2 gekauft hat, hat keine Übertragung, die gelingen könnte.
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2']]);

  const dienst = new WorkflowExecutionService(
    uebertragung({ status: TransferRunStatus.SUCCESS_NO_FILES, message: 'nichts zu holen' }),
    bank.umgebung
  );

  await dienst.execute(job({ transfer: { enabled: false } }));

  assert.equal((await bank.ergebnisse.list('default')).length, 1);
});

test('auch am vorangehenden Schritt gilt das Muster', async () => {
  // Der Übertragungsschritt holt oft mehr, als der Konsolidierungsschritt
  // verarbeiten soll: Rechnungen und Lieferscheine liegen im selben Zielordner.
  const bank = werkbank();

  bank.ablage.lege('/ziel/Rechnung_1.csv', ['kdnr'], [['1'], ['2']]);
  bank.ablage.lege('/ziel/Lieferschein_1.csv', ['kdnr'], [['8'], ['9']]);

  const dienst = new WorkflowExecutionService(
    uebertragung({
      outcomes: [
        { filename: 'Rechnung_1.csv', status: FileTransferStatus.SUCCESS, destinationPath: '/ziel/Rechnung_1.csv', message: 'ok' },
        { filename: 'Lieferschein_1.csv', status: FileTransferStatus.SUCCESS, destinationPath: '/ziel/Lieferschein_1.csv', message: 'ok' },
      ],
    }),
    bank.umgebung
  );

  await dienst.execute(
    job({
      transfer: { enabled: true },
      destinationType: 'LOCAL',
      consolidation: { enabled: true, input: { from: 'PRECEDING' }, dateien: { muster: 'Rechnung_*.csv' } },
    })
  );

  assert.deepEqual((await bank.ergebnisse.list('default'))[0].zeilen, [['1'], ['2']]);
});

test('die führende Quelle wird über ihren Dateinamen gefunden', async () => {
  /*
   * Im Workflow steht der Dateiname, im Auftrag die Kennung der Quelle. Ginge
   * die Zuordnung verloren, würde aus einem Anreichern ein Sammeln — und das
   * Ergebnis sähe richtig aus.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/Haupt.csv', ['kdnr', 'ort'], [['1', 'Bonn'], ['2', 'Kiel']]);
  bank.ablage.lege('/eingang/Zusatz.csv', ['kdnr', 'umsatz'], [['1', '100'], ['9', '999']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        regeln: {
          betriebsart: 'ANREICHERN',
          art: 'MERGE',
          fuehrend: 'Haupt.csv',
          schluessel: { felder: ['kdnr'] },
        },
      },
    })
  );

  const faelle = await bank.konflikte.list('default');

  assert.ok(
    faelle.some((fall) => fall.art === 'FEHLENDER_HAUPTSATZ'),
    'die 9 aus der Zusatzdatei hat keinen Hauptsatz — das geht nur auf, wenn „Haupt.csv" wirklich führt: ' +
      faelle.map((fall) => fall.art).join(', ')
  );
});

/* ---------- Konflikte ---------- */

test('Konflikte werden angelegt, gemeldet — und halten die Freigabe auf', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/Nord.csv',
    ['kdnr', 'ort'],
    [
      ['4711', 'Bonn'],
      ['4712', 'Kiel'],
    ]
  );
  bank.ablage.lege(
    '/eingang/Sued.csv',
    ['kdnr', 'ort'],
    [
      ['4711', 'Köln'],
      ['4713', 'Ulm'],
    ]
  );

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        regeln: {
          betriebsart: 'SAMMELN',
          art: 'MERGE',
          schluessel: { felder: ['kdnr'] },
        },
      },
    })
  );

  const faelle = await bank.konflikte.list('default');

  assert.ok(faelle.length > 0, 'ein Wertekonflikt über „ort" muss entstehen');

  const [stand] = await bank.ergebnisse.list('default');

  assert.equal(stand.status, 'WAITING_FOR_RELEASE');
  assert.match(ergebnis.message, /wartet auf Freigabe/);
});

test('neben Konflikten meldet sich kein Erfolg', async () => {
  /*
   * „Wer jeden Erfolg als Popup bekommt, klickt auch das Konfliktfenster weg."
   * Zwei Meldungen zu einem Lauf, von denen eine sagt, alles sei gut, erziehen
   * genau dazu.
   */
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Bonn'],
      ['2', 'Kiel'],
    ]
  );
  bank.ablage.lege(
    '/eingang/b.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Köln'],
      ['3', 'Ulm'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        regeln: { betriebsart: 'SAMMELN', art: 'MERGE', schluessel: { felder: ['kdnr'] } },
      },
    })
  );

  const anlaesse = (await offeneMeldungen(bank)).map((meldung) => meldung.anlass);

  assert.ok(anlaesse.includes('KONFLIKTE_ENTSTANDEN'), anlaesse.join(', '));
  assert.equal(anlaesse.includes('LAUF_ERFOLGREICH'), false, anlaesse.join(', '));

  /*
   * Und die zweite Meldung fehlt nicht: Ein Ergebnis, das auf eine Entscheidung
   * wartet, ohne dass jemand davon erfährt, wartet bis zum nächsten Zufall.
   */
  assert.ok(anlaesse.includes('FREIGABE_ERFORDERLICH'), anlaesse.join(', '));
});

test('eine misslungene Übertragung wird nicht als Quelle gelesen', async () => {
  /*
   * Ein Abbruch mitten im Schreiben hinterlässt eine halbe Datei am Zielpfad.
   * Sie zu konsolidieren ergäbe ein Ergebnis aus abgeschnittenen Daten — und
   * dem sieht niemand an, dass es unvollständig ist.
   */
  const bank = werkbank();

  bank.ablage.lege('/ziel/halb.csv', ['kdnr'], [['1'], ['2']]);

  const dienst = new WorkflowExecutionService(
    uebertragung({
      status: TransferRunStatus.COMPLETED_WITH_ERRORS,
      outcomes: [
        { filename: 'halb.csv', status: FileTransferStatus.FAILED, destinationPath: '/ziel/halb.csv', message: 'abgebrochen' },
      ],
    }),
    bank.umgebung
  );

  const ergebnis = await dienst.execute(
    job({ transfer: { enabled: true }, destinationType: 'LOCAL', consolidation: { enabled: true, input: { from: 'PRECEDING' } } })
  );

  assert.equal((await bank.ergebnisse.list('default')).length, 0);
  assert.match(ergebnis.message, /keine lesbare Quelle/);
});

/* ---------- Die Ergebnisdatei ---------- */

test('eine Ergebnisdatei entsteht nur aus einem freigegebenen Stand', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Bonn'],
      ['2', 'Kiel'],
    ]
  );
  bank.ablage.lege(
    '/eingang/b.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Köln'],
      ['3', 'Ulm'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        regeln: { betriebsart: 'SAMMELN', art: 'MERGE', schluessel: { felder: ['kdnr'] } },
      },
    })
  );

  assert.deepEqual(
    bank.ablage.geschrieben,
    [],
    'ein Ergebnis, das auf eine Entscheidung wartet, darf nicht schon im Verzeichnis liegen'
  );
});

test('ein freigegebenes Ergebnis wird als CSV abgelegt und lässt sich wieder lesen', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Bonn'],
      ['2', 'Kiel'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
      },
    })
  );

  assert.equal(bank.ablage.geschrieben.length, 1);
  assert.match(bank.ablage.geschrieben[0], /^\/ergebnis\/Nachtlauf_Ergebnis_\d{8}_\d{6}\.csv$/);

  const inhalt = new TextDecoder().decode(await bank.ablage.lies(bank.ablage.geschrieben[0]));

  assert.match(inhalt, /kdnr;ort/);
  assert.match(inhalt, /1;Bonn/);
});

test('ohne Ergebnis-Verzeichnis wird nichts geschrieben', async () => {
  // Das Ergebnis liegt in der Datenbank. Ein Verzeichnis ist die Zugabe für
  // den, der es dort haben will — nicht der Regelfall.
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.deepEqual(bank.ablage.geschrieben, []);
});

/* ---------- Wenn etwas schiefgeht ---------- */

test('ein Fehler wird zu einem Lauf mit Begründung, nicht zu einer Ausnahme', async () => {
  /*
   * Der Orchestrator fängt Ausnahmen und macht daraus „fehlgeschlagen" ohne
   * Text. Genau diese Textlosigkeit macht Ferndiagnose unmöglich.
   */
  const bank = werkbank();

  bank.umgebung.ablage = {
    ...bank.ablage,
    liste: async () => {
      throw new Error('Zugriff verweigert');
    },
  } as unknown as typeof bank.ablage;

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.COMPLETED_WITH_ERRORS);
  assert.match(ergebnis.message, /Zugriff verweigert/);

  const meldungen = await offeneMeldungen(bank);

  assert.equal(meldungen[0].stufe, 'KRITISCH');
});

test('eine einzelne unlesbare Datei macht die übrigen nicht wertlos', async () => {
  const bank = werkbank();

  bank.ablage.lege('/eingang/gut.csv', ['kdnr'], [['1'], ['2']]);
  bank.ablage.dateien.set('/eingang/kaputt.csv', undefined as unknown as Uint8Array);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.SUCCESS);
  assert.equal((await bank.ergebnisse.list('default'))[0].zeilen.length, 2);
});

test('ohne das Modul läuft der Schritt nicht — und sagt es', async () => {
  const bank = werkbank(ohne('CONSOLIDATION'));

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.COMPLETED_WITH_ERRORS);
  assert.match(ergebnis.message, /Daten konsolidieren/);
  assert.equal((await bank.ergebnisse.list('default')).length, 0, 'kein Ergebnisstand ohne Lizenz');
});

/* ---------- Das Kleingedruckte ---------- */

test('der Eingang richtet Spalten aus, die in verschiedener Reihenfolge stehen', () => {
  /*
   * Zwei Systeme führen dieselben Felder selten in derselben Reihenfolge.
   * Einfach aneinanderzuhängen setzte den Ort in die Kundennummernspalte — und
   * die Verbleibsrechnung vergliche danach Unsinn mit Unsinn.
   */
  const quellen: Quelle[] = [
    { id: 'a', name: 'a', felder: ['kdnr', 'ort'], zeilen: [['1', 'Bonn']] },
    { id: 'b', name: 'b', felder: ['ort', 'kdnr'], zeilen: [['Kiel', '2']] },
  ];

  assert.deepEqual(alsEingang(quellen), {
    felder: ['kdnr', 'ort'],
    zeilen: [
      ['1', 'Bonn'],
      ['2', 'Kiel'],
    ],
  });
});

test('ein Feld, das nur eine Quelle kennt, bleibt bei der anderen leer', () => {
  const quellen: Quelle[] = [
    { id: 'a', name: 'a', felder: ['kdnr'], zeilen: [['1']] },
    { id: 'b', name: 'b', felder: ['kdnr', 'umsatz'], zeilen: [['2', '99']] },
  ];

  assert.deepEqual(alsEingang(quellen).zeilen, [
    ['1', ''],
    ['2', '99'],
  ]);
});

test('der Dateiname trägt den Zeitpunkt, sonst überschriebe heute gestern', () => {
  const name = ergebnisdateiname('Nachtlauf', new Date(2026, 7, 20, 3, 5, 9));

  assert.equal(name, 'Nachtlauf_Ergebnis_20260820_030509.csv');
});

test('ein Workflowname mit unzulässigen Zeichen ergibt trotzdem einen Dateinamen', () => {
  const name = ergebnisdateiname('Kunde: A/B *neu*', new Date(2026, 7, 20, 3, 5, 9));

  assert.equal(name, 'Kunde_ A_B _neu__Ergebnis_20260820_030509.csv');
});

test('ein Workflowname, von dem nichts übrig bleibt, ergibt keinen Namen aus Unterstrichen allein', () => {
  assert.match(ergebnisdateiname('   ', new Date(2026, 7, 20, 3, 5, 9)), /^Workflow_Ergebnis_/);
});

/* ---------- Dateiname und Quellenkennung ---------- */

const WIRKSAM = wirksameEinstellungen({}, undefined);

test('eine Rangfolge über Dateinamen findet die Quellen einer Arbeitsmappe', () => {
  /*
   * Im Workflow steht der Dateiname, im Auftrag die Kennung. Ohne Übersetzung
   * liefe die Rangfolge ins Leere — und zwar stillschweigend: Eine Quelle, die
   * in keiner Reihenfolge vorkommt, ist einfach die letzte.
   */
  const quellen: Quelle[] = [
    { id: 'Filialen.xlsx#Nord', name: 'Filialen.xlsx', blatt: 'Nord', felder: ['a'], zeilen: [] },
    { id: 'Stammdaten.csv', name: 'Stammdaten.csv', felder: ['a'], zeilen: [] },
  ];

  const auftrag = auftragAus(
    quellen,
    {
      betriebsart: 'SAMMELN',
      art: 'MERGE',
      entscheidung: { quellen: ['Stammdaten.csv', 'Filialen.xlsx'], jeFeld: { ort: ['Filialen.xlsx'] } },
    },
    WIRKSAM
  );

  assert.deepEqual(auftrag.entscheidung?.quellen, ['Stammdaten.csv', 'Filialen.xlsx#Nord']);
  assert.deepEqual(auftrag.entscheidung?.jeFeld, { ort: ['Filialen.xlsx#Nord'] });
});

test('ein Name, den es nicht gibt, wird unverändert weitergereicht', () => {
  // Ihn fallen zu lassen hieße, eine Rangfolge stillschweigend zu verkürzen.
  const auftrag = auftragAus(
    [{ id: 'a.csv', name: 'a.csv', felder: ['x'], zeilen: [] }],
    { betriebsart: 'SAMMELN', art: 'APPEND', entscheidung: { quellen: ['geloescht.csv'] } },
    WIRKSAM
  );

  assert.deepEqual(auftrag.entscheidung?.quellen, ['geloescht.csv']);
});

test('die Mindestkonfidenz kommt aus den Einstellungen, nicht aus den Regeln', () => {
  /*
   * Wer sie am Workflow senken dürfte, könnte sich eine automatische
   * Entscheidung bestellen, die im Prüflauf noch ein Konflikt war.
   */
  const auftrag = auftragAus([], { betriebsart: 'SAMMELN', art: 'APPEND' }, WIRKSAM);

  assert.equal(auftrag.entscheidung?.mindestKonfidenz, WIRKSAM.mindestKonfidenz);
});

test('die feineren Regeln gehen unverändert in den Auftrag', () => {
  // Sie sind am Workflow einstellbar; würden sie hier fallen, liefe der
  // Nachtlauf anders als der Prüflauf, mit dem sie erprobt wurden.
  const auftrag = auftragAus(
    [],
    {
      betriebsart: 'ANREICHERN',
      art: 'MERGE',
      ergaenzung: { vergleichbarAn: ['plz'], felder: ['ort'], mindestens: 3 },
      aehnlichkeit: { felder: ['firma'], schwelle: 0.7 },
      mehrfachtreffer: { regel: 'FELD', feld: 'geaendert_am', nimm: 'GROESSTER' },
      ohneHauptsatz: 'UEBERSPRINGEN',
    },
    WIRKSAM
  );

  assert.deepEqual(auftrag.ergaenzung, { vergleichbarAn: ['plz'], felder: ['ort'], mindestens: 3 });
  assert.deepEqual(auftrag.aehnlichkeit, { felder: ['firma'], schwelle: 0.7 });
  assert.deepEqual(auftrag.mehrfachtreffer, { regel: 'FELD', feld: 'geaendert_am', nimm: 'GROESSTER' });
  assert.equal(auftrag.ohneHauptsatz, 'UEBERSPRINGEN');
});

test('eine am Workflow eingeschmuggelte Mindestkonfidenz wird nicht angewendet', () => {
  /*
   * Der Typ verbietet sie; ein von Hand bearbeiteter oder älterer Datensatz
   * kann sie trotzdem tragen. Sie dort gelten zu lassen hieße, die Schwelle
   * für automatische Entscheidungen über einen Umweg zu senken — und genau
   * dieser Umweg soll geschlossen sein.
   */
  const geschmuggelt = {
    betriebsart: 'SAMMELN',
    art: 'APPEND',
    entscheidung: { mindestKonfidenz: 0.3 },
  } as unknown as Parameters<typeof auftragAus>[1];

  const auftrag = auftragAus([], geschmuggelt, WIRKSAM);

  assert.equal(auftrag.entscheidung?.mindestKonfidenz, WIRKSAM.mindestKonfidenz);
  assert.notEqual(auftrag.entscheidung?.mindestKonfidenz, 0.3);
});

/* ---------- Die Mengenschranke ---------- */

test('ein Lauf über zu viele Datensätze bricht ab, statt am Speicher zu sterben', async () => {
  /*
   * Ein Prozess, dem unterwegs der Speicher ausgeht, verschwindet ohne einen
   * Protokolleintrag. Erkannt wird er dann von der Herzschlagüberwachung, die
   * sagen kann, dass er fort ist, aber nicht warum.
   */
  const bank = werkbank();

  bank.umgebung.hoechstmenge = 3;
  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2'], ['3'], ['4']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.COMPLETED_WITH_ERRORS);
  assert.match(ergebnis.message, /4 Datensätze/);
  assert.equal((await bank.ergebnisse.list('default')).length, 0, 'nichts wurde verarbeitet');
});

test('der Abbruch nennt die Zahlen und den Weg heraus', async () => {
  // Eine Grenze ohne Auskunft, wie man sie verschiebt, ist eine Sackgasse.
  const bank = werkbank();

  bank.umgebung.hoechstmenge = 3;
  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2'], ['3'], ['4']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  const [meldung] = await offeneMeldungen(bank);

  assert.equal(meldung.stufe, 'KRITISCH');
  assert.match(meldung.text, /UNIKOM_HOECHSTMENGE/);
  assert.match(meldung.text, /Dateimuster/);
});

test('genau an der Grenze läuft er noch', async () => {
  const bank = werkbank();

  bank.umgebung.hoechstmenge = 4;
  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1'], ['2'], ['3'], ['4']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal((await bank.ergebnisse.list('default')).length, 1);
});

/* ---------- Umformungen im Lauf (SPEC-09 §8, §9) ---------- */

test('was am Workflow eingestellt ist, wirkt vor dem Konsolidieren', async () => {
  /*
   * Vorher und nicht nachher: Ein Schlüssel über „ 4711" und „4711" fände zwei
   * Kunden, wo einer ist — und die Zusammenführung, die das hätte heilen
   * sollen, fände dann gar nicht erst statt.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [[' 4711 ', 'Bonn'], ['4712', 'Köln']]);
  bank.ablage.lege('/eingang/b.csv', ['kdnr', 'umsatz'], [['4711', '100'], ['4713', '200']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: { felder: [{ feld: 'kdnr', schritte: [{ art: 'TRIMMEN' }] }] },
        regeln: { betriebsart: 'SAMMELN', art: 'MERGE', schluessel: { felder: ['kdnr'] } },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.equal(stand.zeilen.length, 3, 'ohne das Trimmen wären es vier');
});

test('zwei Felder lassen sich zu einem zusammenführen', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'vorname', 'nachname'],
    [
      ['1', 'Anna', 'Meier'],
      ['2', 'Bert', 'Schulz'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          zusammenfuehrungen: [{ ziel: 'name', quellen: ['vorname', 'nachname'], trenner: ' ' }],
        },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND', zielfelder: ['name'] },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.felder, ['name']);
  assert.deepEqual(stand.zeilen, [['Anna Meier'], ['Bert Schulz']]);
});

test('ein Feld lässt sich auf mehrere aufteilen', async () => {
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'name'],
    [
      ['1', 'Meier, Anna'],
      ['2', 'Schulz, Bert'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          aufteilungen: [
            {
              quelle: 'name',
              ziele: ['nachname', 'vorname'],
              trennung: { art: 'ZEICHEN', zeichen: ',' },
            },
          ],
        },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND', zielfelder: ['nachname', 'vorname'] },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.zeilen, [
    ['Meier', 'Anna'],
    ['Schulz', 'Bert'],
  ]);
});

test('was sich nicht aufteilen lässt, wird ein Konflikt und kein Nebensatz', async () => {
  /*
   * „Bei nicht eindeutig interpretierbaren Strukturen muss UniCom … den Fall
   * zur Prüfung vorlegen." Ein Prüffall, der nur im Protokoll steht, wird
   * niemandem vorgelegt.
   */
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'name'],
    [
      ['1', 'Anna Meier'],
      ['2', 'Bert von der Heide'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          aufteilungen: [
            { quelle: 'name', ziele: ['vorname', 'nachname'], trennung: { art: 'ZEICHEN', zeichen: ' ' } },
          ],
        },
      },
    })
  );

  const faelle = await bank.konflikte.list('default');

  assert.equal(faelle.length, 1, 'genau die eine Zeile, die nicht aufging');
  assert.equal(faelle[0].art, 'STRUKTUR');
  assert.match(faelle[0].vorgefunden, /von der Heide/);
  assert.match(faelle[0].naechsteSchritte, /Übernommen wurde nichts/);
});

test('ein Prüffall hält die Freigabe auf', async () => {
  // Sonst ginge ein Ergebnis hinaus, in dem ein Name fehlt.
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'name'],
    [
      ['1', 'Anna Meier'],
      ['2', 'Bert von der Heide'],
    ]
  );

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          aufteilungen: [
            { quelle: 'name', ziele: ['vorname', 'nachname'], trennung: { art: 'ZEICHEN', zeichen: ' ' } },
          ],
        },
      },
    })
  );

  assert.match(ergebnis.message, /wartet auf Freigabe/);
});

test('ohne Umformungsplan bleibt alles, wie es war', async () => {
  // Der Plan liegt in jedem Lauf im Weg; er darf keinen anfassen, der ihn nicht
  // bestellt hat.
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [[' 4711 '], ['4712']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  const [stand] = await bank.ergebnisse.list('default');

  assert.deepEqual(stand.zeilen, [[' 4711 '], ['4712']]);
});

test('eine Aufteilung greift nur dort, wo es das Quellfeld gibt', async () => {
  /*
   * Zwei Dateien, eine mit „name", eine ohne. Legte die Regel auch in der
   * zweiten leere Spalten an, stünde im Ergebnis eine Spalte, die nur aus
   * Nichts besteht — und die Vollständigkeitsprüfung fragte, wo ihre Werte
   * blieben.
   */
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/mit.csv',
    ['kdnr', 'name'],
    [
      ['1', 'Meier, Anna'],
      ['2', 'Schulz, Bert'],
    ]
  );
  bank.ablage.lege(
    '/eingang/ohne.csv',
    ['kdnr', 'ort'],
    [
      ['3', 'Bonn'],
      ['4', 'Köln'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          aufteilungen: [
            { quelle: 'name', ziele: ['nachname', 'vorname'], trennung: { art: 'ZEICHEN', zeichen: ',' } },
          ],
        },
      },
    })
  );

  const [stand] = await bank.ergebnisse.list('default');
  const spalte = stand.felder.indexOf('nachname');

  assert.ok(spalte >= 0, stand.felder.join(', '));

  // Die beiden Zeilen aus „ohne.csv" haben dort nichts — und das ist richtig.
  const gefuellt = stand.zeilen.filter((zeile) => zeile[spalte] !== '').length;

  assert.equal(gefuellt, 2);
});

test('ein Prüffall zählt in der Zusammenfassung mit', async () => {
  // Sonst nennt der Bericht eine Konfliktzahl, die kleiner ist als seine
  // eigene Konfliktliste — und niemand weiß, welcher von beiden gilt.
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'name'],
    [
      ['1', 'Anna Meier'],
      ['2', 'Bert von der Heide'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        umformung: {
          aufteilungen: [
            { quelle: 'name', ziele: ['vorname', 'nachname'], trennung: { art: 'ZEICHEN', zeichen: ' ' } },
          ],
        },
      },
    })
  );

  const faelle = await bank.konflikte.list('default');

  assert.equal(faelle.length, 1, 'der Prüffall steht in der Konfliktbearbeitung');

  /*
   * Und er hält die Freigabe auf. Ohne die Zeile, die die Konfliktzahl im
   * Bericht nachführt, nennte der Bericht eine Zahl, die kleiner ist als seine
   * eigene Konfliktliste — und das Ergebnis ginge frei, obwohl ein Fall offen
   * ist.
   */
  const [stand] = await bank.ergebnisse.list('default');

  assert.equal(stand.status, 'WAITING_FOR_RELEASE');
});

test('die Konfliktzahl im Bericht stimmt mit seiner Konfliktliste überein', () => {
  /*
   * Sonst nennt der Bericht „3 Konflikte" neben einer Liste mit vieren, und
   * niemand weiß, welche von beiden gilt — die Zahl steht auf dem Bildschirm,
   * die Liste ist die Arbeit.
   */
  const bericht = new ConsolidationService().konsolidiere({
    quellen: [{ id: 'a', name: 'a', felder: ['x'], zeilen: [['1'], ['2']] }],
    betriebsart: 'SAMMELN',
    art: 'APPEND',
  });

  const vorher = bericht.konflikte.length;

  mitPruefaellen(bericht, [
    { quelle: 'a', zeile: 1, feld: 'x', wert: 'Anna Meier', hinweis: 'zerfällt in 2 Teile' },
    { quelle: 'a', zeile: 2, feld: 'x', wert: 'Bert von der Heide', hinweis: 'zerfällt in 4 Teile' },
  ]);

  assert.equal(bericht.konflikte.length, vorher + 2);
  assert.equal(bericht.zusammenfassung.konflikte, bericht.konflikte.length);
});

/* ---------- Mehrere Durchgänge in Folge (SPEC-06 §7) ---------- */

test('ein zweiter Durchgang rechnet auf dem, was der erste geschrieben hat', async () => {
  /*
   * Erst sammeln, dann weiterverarbeiten. Läse der zweite Durchgang wieder den
   * Rohbestand, wäre die Folge keine — es liefen zwei Durchgänge nebeneinander,
   * die dasselbe tun.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['1', 'Bonn'], ['2', 'Köln']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/arbeit' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
        weitere: [
          {
            name: 'Nachlauf',
            input: { from: 'PRECEDING' },
            output: { to: 'DIRECTORY', directory: '/ergebnis' },
            regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
          },
        ],
      },
    })
  );

  const geschrieben = bank.ablage.geschrieben.map((pfad) => pfad.slice(0, pfad.lastIndexOf('/')));

  assert.deepEqual(geschrieben, ['/arbeit', '/ergebnis'], 'beide Durchgänge legen ab, in dieser Reihenfolge');
  assert.match(ergebnis.message, /Durchgang 2 von 2 \(Nachlauf\)/);

  const staende = await bank.ergebnisse.list('default');

  assert.equal(staende.length, 2, 'je Durchgang ein eigener Ergebnisstand');
});

test('eine mehrdeutige Reihenfolge steht im Protokoll, bevor gerechnet wird', async () => {
  /*
   * „Ist die Reihenfolge für ein korrektes Ergebnis relevant und nicht
   * eindeutig bestimmbar, muss UniCom dies erkennen und melden." Ein Durchgang,
   * der aus einem Verzeichnis liest, in das ein späterer erst schreibt, läuft
   * beim ersten Mal ins Leere und danach auf den Resten des Vortages.
   */
  const bank = werkbank();
  const eintraege: string[] = [];

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['1', 'Bonn']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
        weitere: [
          {
            input: { from: 'DIRECTORY', directory: '/spaeter' },
            output: { to: 'DIRECTORY', directory: '/ergebnis' },
          },
        ],
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /Reihenfolge der Konsolidierung/.test(eintrag) && /überschreibt/.test(eintrag)),
    eintraege.join(' | ')
  );
});

test('ein Durchgang, der auf Freigabe wartet, hält die Folge an', async () => {
  /*
   * Ein Ergebnis, das auf eine Entscheidung wartet, darf nicht schon der
   * Eingang des nächsten Durchgangs sein — die Freigabe wäre sonst eine
   * Formalität über etwas, das längst weiterverarbeitet ist.
   */
  const bank = werkbank();

  bank.ablage.lege(
    '/eingang/a.csv',
    ['kdnr', 'ort'],
    [
      ['1', 'Bonn'],
      ['1', 'Köln'],
    ]
  );

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/arbeit' },
        regeln: { betriebsart: 'SAMMELN', art: 'MERGE', schluessel: { felder: ['kdnr'] } },
        weitere: [{ input: { from: 'PRECEDING' }, output: { to: 'DIRECTORY', directory: '/ergebnis' } }],
      },
    })
  );

  assert.equal(
    bank.ablage.geschrieben.filter((pfad) => pfad.startsWith('/ergebnis')).length,
    0,
    'der zweite Durchgang läuft nicht'
  );
});

/* ---------- Referenzquellen im Lauf (SPEC-04 §6, §8) ---------- */

test('eine eingestellte Referenzquelle wird zum Lauf gelesen und ergänzt Werte', async () => {
  /*
   * Der Referenzabgleich war gebaut und vom Workflow aus unerreichbar: Der Lauf
   * übergab nie einen Bestand. Genau diese Lücke schließt der Verweis.
   */
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'plz'], [['1', '53111']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    referenzen: {
      fuerLauf: async () => ({
        id: 'ref1',
        name: 'PLZ-Verzeichnis',
        version: '2026-Q1',
        felder: ['plz', 'ort'],
        zeilen: [['53111', 'Bonn']],
      }),
    },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        regeln: {
          betriebsart: 'SAMMELN',
          art: 'APPEND',
          referenzen: [{ quelleId: 'ref1', felder: ['plz'], uebernehmen: [{ feld: 'ort', aus: 'ort' }] }],
        },
      },
    })
  );

  assert.match(ergebnis.message, /konsolidiert/);

  /*
   * Der Nachweis, dass die Referenz wirklich gewirkt hat: „Bonn" steht in
   * keiner Eingangsdatei. Nur zu prüfen, dass ein Ergebnisstand entstanden ist,
   * liefe auch dann durch, wenn der Abgleich stillschweigend unterbliebe.
   */
  assert.ok((await bank.ergebnisse.list('default'))[0], 'ein Ergebnisstand ist entstanden');

  const geschrieben = bank.ablage.geschrieben.find((pfad) => pfad.startsWith('/ergebnis'));

  assert.ok(geschrieben, 'eine Ergebnisdatei ist entstanden');
  assert.match(new TextDecoder().decode(bank.ablage.dateien.get(geschrieben) ?? new Uint8Array()), /Bonn/);
});

test('eine Referenzquelle, die sich nicht lesen lässt, hält den Lauf nicht an — sagt es aber', async () => {
  /*
   * Still ohne Referenz weiterzurechnen hieße, dass niemand mehr sieht, warum
   * kein einziger Wert ergänzt wurde.
   */
  const bank = werkbank();
  const eintraege: string[] = [];

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'plz'], [['1', '53111']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
    referenzen: {
      fuerLauf: async () => {
        throw new Error('Die Referenzquelle „PLZ" ließ sich nicht lesen');
      },
    },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        regeln: {
          betriebsart: 'SAMMELN',
          art: 'APPEND',
          referenzen: [{ quelleId: 'ref1', felder: ['plz'] }],
        },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /ließ sich nicht lesen/.test(eintrag) && /unterbleibt/.test(eintrag)),
    eintraege.join(' | ')
  );
});

test('ohne Referenzdienst wird nicht still ohne Abgleich gerechnet', async () => {
  const bank = werkbank();
  const eintraege: string[] = [];

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'plz'], [['1', '53111']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        regeln: {
          betriebsart: 'SAMMELN',
          art: 'APPEND',
          referenzen: [{ quelleId: 'ref1', felder: ['plz'] }],
        },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /kann sie nicht lesen/.test(eintrag)),
    eintraege.join(' | ')
  );
});

/* ---------- Feste Feldbreiten schreiben (SPEC-03 §6) ---------- */

test('das Ergebnis lässt sich mit festen Feldbreiten schreiben', async () => {
  // Weil die Gegenseite es so liest: Wer an ein Hostsystem liefert, liefert
  // keine CSV.
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['42', 'Bonn']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        format: 'FESTBREITEN',
        festbreiten: {
          felder: [
            { name: 'kdnr', start: 1, laenge: 5, ausrichtung: 'RECHTS', fuellzeichen: '0' },
            { name: 'ort', start: 6, laenge: 10 },
          ],
        },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  const pfad = bank.ablage.geschrieben.find((eintrag) => eintrag.startsWith('/ergebnis'));

  assert.ok(pfad, 'eine Ergebnisdatei ist entstanden');
  assert.match(pfad, /\.txt$/, 'feste Breiten sind keine CSV — auch nicht der Name');
  assert.match(new TextDecoder().decode(bank.ablage.dateien.get(pfad) ?? new Uint8Array()), /^00042Bonn {6}/);
});

test('ohne Feldbeschreibung wird keine Datei geschrieben und gesagt warum', async () => {
  /*
   * Auf CSV auszuweichen wäre die bequeme Antwort: Ein Empfänger, der eine
   * Datei fester Breite erwartet und eine CSV bekommt, liest sie als eine
   * einzige, sehr breite Spalte — und das sieht nach kaputten Daten aus, nicht
   * nach einer falschen Einstellung.
   */
  const bank = werkbank();
  const eintraege: string[] = [];

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['42', 'Bonn']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        format: 'FESTBREITEN',
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.equal(bank.ablage.geschrieben.filter((pfad) => pfad.startsWith('/ergebnis')).length, 0);
  assert.ok(
    eintraege.some((eintrag) => /fehlt die Feldbeschreibung/.test(eintrag)),
    eintraege.join(' | ')
  );
});

test('ein Wert, der nicht ins Feld passt, steht im Protokoll', async () => {
  // Er fehlt in der Datei und wird nicht heimlich gekürzt.
  const bank = werkbank();
  const eintraege: string[] = [];

  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['42', 'Bergisch Gladbach']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        format: 'FESTBREITEN',
        festbreiten: { felder: [{ name: 'ort', start: 1, laenge: 6 }] },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /Bergisch Gladbach/.test(eintrag) && /Das Feld bleibt leer/.test(eintrag)),
    eintraege.join(' | ')
  );
});

/* ---------- Prüfung gegen ein JSON Schema (SPEC-03 §7, SPEC-08 §2) ---------- */

function mitSchema(bank: Werkbank, schema: unknown): void {
  bank.ablage.dateien.set('/schema/kunde.json', new TextEncoder().encode(JSON.stringify(schema)));
}

function legeJson(bank: Werkbank, pfad: string, inhalt: unknown): void {
  bank.ablage.dateien.set(pfad, new TextEncoder().encode(JSON.stringify(inhalt)));
}

const KUNDENSCHEMA = {
  type: 'array',
  items: { type: 'object', required: ['kdnr', 'ort'], properties: { kdnr: { type: 'integer' } } },
};

test('eine Datei, die dem Schema nicht genügt, wird nicht verarbeitet', async () => {
  /*
   * „Kritische Fehler … müssen vor Beginn der Verarbeitung erkannt … werden."
   * Eine Prüfung hinterher sagt, dass ein Ergebnis auf schlechten Daten beruht
   * — da liegt es aber schon im Zielverzeichnis.
   */
  const bank = werkbank();
  const eintraege: string[] = [];

  mitSchema(bank, KUNDENSCHEMA);
  legeJson(bank, '/eingang/kunden.json', [{ kdnr: 1, ort: 'Bonn' }, { kdnr: 2 }]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        schema: { datei: '/schema/kunde.json' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /\[1\]\.ort/.test(eintrag) && /Pflicht/.test(eintrag)),
    eintraege.join(' | ')
  );
  assert.ok(
    eintraege.some((eintrag) => /wird nicht verarbeitet/.test(eintrag)),
    eintraege.join(' | ')
  );
  assert.equal((await bank.ergebnisse.list('default')).length, 0, 'kein Ergebnis aus verletzenden Daten');
});

test('mit WARNEN läuft sie trotzdem durch, und das steht dabei', async () => {
  const bank = werkbank();
  const eintraege: string[] = [];

  mitSchema(bank, KUNDENSCHEMA);
  legeJson(bank, '/eingang/kunden.json', [{ kdnr: 1, ort: 'Bonn' }, { kdnr: 2 }]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        schema: { datei: '/schema/kunde.json', bei: 'WARNEN' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /wird trotzdem verarbeitet/.test(eintrag)),
    eintraege.join(' | ')
  );
  assert.equal((await bank.ergebnisse.list('default')).length, 1);
});

test('eine gültige Datei läuft ohne Aufhebens durch', async () => {
  const bank = werkbank();

  mitSchema(bank, KUNDENSCHEMA);
  legeJson(bank, '/eingang/kunden.json', [{ kdnr: 1, ort: 'Bonn' }]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        schema: { datei: '/schema/kunde.json' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.equal((await bank.ergebnisse.list('default')).length, 1);
});

test('ein Schema, das sich nicht laden lässt, macht aus einer Einstellung keinen Datenausfall', async () => {
  // Die Datei deshalb auszulassen hieße, einen Konfigurationsfehler in einen
  // Datenausfall zu verwandeln.
  const bank = werkbank();
  const eintraege: string[] = [];

  legeJson(bank, '/eingang/kunden.json', [{ kdnr: 1, ort: 'Bonn' }]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        schema: { datei: '/schema/gibtesnicht.json' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /ließ sich nicht lesen/.test(eintrag) && /nicht geprüft/.test(eintrag)),
    eintraege.join(' | ')
  );
  assert.equal((await bank.ergebnisse.list('default')).length, 1, 'die Daten laufen trotzdem');
});

test('eine CSV wird nicht gegen ein JSON Schema geprüft — und es steht dabei', async () => {
  // Es stillschweigend zu übergehen wäre schlimmer: Wer ein Schema einstellt
  // und eine CSV liefert, soll erfahren, dass nichts geprüft wurde.
  const bank = werkbank();
  const eintraege: string[] = [];

  mitSchema(bank, KUNDENSCHEMA);
  bank.ablage.lege('/eingang/a.csv', ['kdnr', 'ort'], [['1', 'Bonn']]);

  await new WorkflowExecutionService(uebertragung(), {
    ...bank.umgebung,
    logger: { log: (eintrag) => eintraege.push(eintrag.message) },
  }).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/eingang' },
        output: { to: 'DIRECTORY', directory: '/ergebnis' },
        schema: { datei: '/schema/kunde.json' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => /nicht gegen das Schema geprüft/.test(eintrag)),
    eintraege.join(' | ')
  );
  assert.equal((await bank.ergebnisse.list('default')).length, 1);
});
/* ---------- Die Freigabe als Quelle ---------- */

/*
 * Eine Freigabe wird sonst mit der Identität des Dienstes erreicht. Beim Kunden
 * ist das selten das gewünschte Konto — und der Fehler zeigt sich nachts, wenn
 * niemand hinsieht. Diese Tests halten fest, dass die Sitzung aufgeht, mit
 * welchem Zugang, und **wie lange** sie steht.
 */

/** Merkt sich, wann verbunden und wann getrennt wurde. */
class Freigaben implements ShareConnections {
  zugang: ShareCredentials | undefined;
  verzeichnis?: string;

  constructor(private readonly spur: string[]) {}

  async withConnection<T>(
    directory: string,
    credentials: ShareCredentials | undefined,
    _spur: unknown,
    arbeit: () => Promise<T>
  ): Promise<T> {
    this.verzeichnis = directory;
    this.zugang = credentials;
    this.spur.push('verbunden');

    try {
      return await arbeit();
    } finally {
      this.spur.push('getrennt');
    }
  }
}

/** Dieselbe Ablage, die aber sagt, wann sie angefasst wird. */
class Gespurte extends Ablage {
  constructor(private readonly spur: string[]) {
    super();
  }

  override async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    this.spur.push('aufgelistet');

    return super.liste(verzeichnis);
  }

  override async lies(pfad: string): Promise<Uint8Array> {
    this.spur.push('gelesen');

    return super.lies(pfad);
  }
}

function anFreigabe(bank: Werkbank, teile: Partial<Konsolidierungsumgebung> = {}): Werkbank {
  return { ...bank, umgebung: { ...bank.umgebung, ...teile } };
}

function freigabejob(credentialId?: string): TransferJob {
  return job({
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: '/freigabe', art: 'SHARE', credentialId },
      regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
    },
  });
}

test('ein Durchgang an einer Freigabe wird mit dem hinterlegten Zugang verbunden', async () => {
  const spur: string[] = [];
  const ablage = new Gespurte(spur);
  const freigaben = new Freigaben(spur);

  ablage.lege('/freigabe/a.csv', ['kdnr'], [['1']]);

  const bank = anFreigabe(werkbank(), {
    ablage,
    freigaben,
    freigabezugang: {
      async forShare(_job, credentialId) {
        return credentialId === 'z1' ? { username: 'dienst', password: 'geheim' } : undefined;
      },
    },
  });

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(freigabejob('z1'));

  assert.equal(freigaben.verzeichnis, '/freigabe');
  assert.equal(freigaben.zugang?.username, 'dienst');
});

test('die Sitzung steht noch, während die Dateien gelesen werden', async () => {
  /*
   * Der eigentliche Punkt. Nur das Auflisten zu umschließen ergäbe eine Liste
   * von Dateien, die sich danach nicht mehr öffnen lassen — und der Lauf
   * scheiterte an einer Stelle, die mit der Freigabe nichts zu tun zu haben
   * scheint.
   */
  const spur: string[] = [];
  const ablage = new Gespurte(spur);

  ablage.lege('/freigabe/a.csv', ['kdnr'], [['1']]);

  const bank = anFreigabe(werkbank(), { ablage, freigaben: new Freigaben(spur) });

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(freigabejob('z1'));

  assert.equal(spur[0], 'verbunden');
  assert.equal(spur.at(-1), 'getrennt');
  assert.ok(spur.includes('gelesen'), 'es wurde überhaupt gelesen');
  assert.ok(
    spur.indexOf('gelesen') < spur.indexOf('getrennt'),
    'gelesen wurde, solange die Verbindung stand'
  );
});

test('ein örtlicher Durchgang öffnet keine Sitzung', async () => {
  // Sonst zöge jeder Lauf eine Netzverbindung auf, die keiner braucht — und je
  // Server steht nur eine gleichzeitig zur Verfügung.
  const spur: string[] = [];
  const ablage = new Gespurte(spur);

  ablage.lege('/eingang/a.csv', ['kdnr'], [['1']]);

  const bank = anFreigabe(werkbank(), { ablage, freigaben: new Freigaben(spur) });

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(spur.includes('verbunden'), false);
});

test('ohne Freigabeverwaltung läuft der Durchgang und sagt es im Protokoll', async () => {
  // Still mit dem Dienstkonto zu lesen wäre der Fehler, den niemand findet.
  const eintraege: LogEntry[] = [];
  const ablage = new Ablage();

  ablage.lege('/freigabe/a.csv', ['kdnr'], [['1']]);

  const bank = anFreigabe(werkbank(), {
    ablage,
    logger: { log: (eintrag) => eintraege.push(eintrag) },
  });

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(freigabejob('z1'));

  const warnung = eintraege.find((eintrag) => eintrag.level === 'WARNING');

  assert.ok(warnung, 'es wurde gewarnt');
  assert.match(warnung.message, /ohne eigenen Zugang/);
});

test('eine Freigabe ohne hinterlegten Zugang wird benannt', async () => {
  const eintraege: LogEntry[] = [];
  const spur: string[] = [];
  const ablage = new Ablage();

  ablage.lege('/freigabe/a.csv', ['kdnr'], [['1']]);

  const bank = anFreigabe(werkbank(), {
    ablage,
    freigaben: new Freigaben(spur),
    freigabezugang: { async forShare() { return undefined; } },
    logger: { log: (eintrag) => eintraege.push(eintrag) },
  });

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(freigabejob());

  assert.ok(
    eintraege.some((eintrag) => eintrag.level === 'WARNING' && /ohne hinterlegten Zugang/.test(eintrag.message)),
    'die fehlende Anmeldung steht im Protokoll'
  );

  // Verbunden wird trotzdem: Manche Freigaben stehen dem Dienstkonto offen.
  assert.ok(spur.includes('verbunden'));
});
/* ---------- Der Stapel: erst vollständig, dann verarbeiten ---------- */

/*
 * Der Kern: Ein Ergebnis, dem eine Lieferung fehlt, sieht vollständig aus. Es
 * wandert in die Warenwirtschaft, und der Fehler fällt beim Monatsabschluss
 * auf, wenn niemand mehr weiß, welche Nacht es war. Diese Tests halten fest,
 * dass es gar nicht entsteht.
 */

/** Dieselben drei, aber mit der Marke im Namen — fuer die Gruppierung. */
const MARKEN_PLAETZE = [
  { name: 'Nord', muster: 'Filiale_Nord_{stapel}.csv' },
  { name: 'Süd', muster: 'Filiale_Sued_{stapel}.csv' },
  { name: 'West', muster: 'Filiale_West_{stapel}.csv' },
];

const DREI_PLAETZE = {
  plaetze: [
    { name: 'Nord', muster: 'Filiale_Nord_*.csv' },
    { name: 'Süd', muster: 'Filiale_Sued_*.csv' },
    { name: 'West', muster: 'Filiale_West_*.csv' },
  ],
};

function stapeljob(teile: Record<string, unknown> = {}): TransferJob {
  return job({
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: '/abholung' },
      regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      dateien: {
        stapel: DREI_PLAETZE,
        abholung: { arbeit: '/arbeit', erledigt: '/erledigt', gescheitert: '/gescheitert' },
        ...teile,
      },
    },
  });
}

test('ein unvollständiger Stapel wird nicht angefasst', async () => {
  const bank = werkbank();

  bank.ablage.lege('/abholung/Filiale_Nord_0821.csv', ['kdnr'], [['1']]);
  bank.ablage.lege('/abholung/Filiale_West_0821.csv', ['kdnr'], [['3']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(stapeljob());

  assert.equal(ergebnis.status, TransferRunStatus.SUCCESS_NO_FILES);
  // Nichts verschoben: Der Stapel bleibt liegen, wie er ist.
  assert.deepEqual(bank.ablage.verschoben, []);
  assert.ok(bank.ablage.dateien.has('/abholung/Filiale_Nord_0821.csv'));
});

test('erst verschieben, dann lesen', async () => {
  /*
   * Das Verschieben **ist** der Zugriff. Würde aus dem Abholverzeichnis
   * gelesen, könnte eine Datei mitten im Lauf ankommen und halb mitkommen.
   */
  const bank = werkbank();

  for (const teil of ['Nord', 'Sued', 'West']) {
    bank.ablage.lege(`/abholung/Filiale_${teil}_0821.csv`, ['kdnr'], [['1']]);
  }

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(stapeljob());

  // Die drei sind aus dem Abholverzeichnis heraus …
  for (const teil of ['Nord', 'Sued', 'West']) {
    assert.equal(bank.ablage.dateien.has(`/abholung/Filiale_${teil}_0821.csv`), false);
  }

  // … über das Arbeitsverzeichnis gegangen …
  assert.ok(bank.ablage.verschoben.some((zug) => zug.includes('/arbeit/')));

  // … und liegen am Ende bei den erledigten.
  assert.ok(bank.ablage.verschoben.some((zug) => zug.endsWith('/erledigt/Filiale_Nord_0821.csv')));
});

test('eine Datei ohne Platz bleibt im Abholverzeichnis liegen', async () => {
  // Sie gehört nicht zu diesem Stapel — und darf deshalb auch nicht mit
  // weggeräumt werden. Sonst verschwände sie, ohne verarbeitet worden zu sein.
  const bank = werkbank();

  for (const teil of ['Nord', 'Sued', 'West']) {
    bank.ablage.lege(`/abholung/Filiale_${teil}_0821.csv`, ['kdnr'], [['1']]);
  }

  bank.ablage.lege('/abholung/Notizen.csv', ['text'], [['nichts']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(stapeljob());

  assert.ok(bank.ablage.dateien.has('/abholung/Notizen.csv'));
});

test('nach Ablauf der Frist wird der Stapel verworfen und gemeldet', async () => {
  /*
   * Ohne Frist würde aus einer fehlenden Datei Stille: kein Ergebnis, kein
   * Fehler, niemand merkt es. Verworfen heißt nach „Gescheitert" geräumt —
   * nicht gelöscht, und das Abholverzeichnis ist für den nächsten Stapel frei.
   */
  const bank = werkbank();

  bank.ablage.lege('/abholung/Filiale_Nord_0821.csv', ['kdnr'], [['1']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    stapeljob({ stapel: { ...DREI_PLAETZE, fristSekunden: 1 } })
  );

  assert.ok(
    bank.ablage.verschoben.some((zug) => zug.endsWith('/gescheitert/Filiale_Nord_0821.csv')),
    'die Datei liegt bei den gescheiterten'
  );

  const meldungen = await offeneMeldungen(bank);

  assert.ok(
    meldungen.some((meldung) => meldung.anlass === 'STAPEL_VERWORFEN'),
    'es wurde gemeldet'
  );
});

test('ohne Stapelbedingung bleibt alles, wie es war', async () => {
  // Ein Durchgang, der nie einen Stapel verlangt hat, soll nichts verschieben.
  const bank = werkbank();

  bank.ablage.lege('/eingang/a.csv', ['kdnr'], [['1']]);

  const ergebnis = await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(job());

  assert.equal(ergebnis.status, TransferRunStatus.SUCCESS);
  assert.deepEqual(bank.ablage.verschoben, []);
});
/* ---------- Der Stapelschlüssel im Lauf ---------- */

function schluesseljob(): TransferJob {
  return job({
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: '/abholung' },
      regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
      dateien: {
        stapel: { plaetze: MARKEN_PLAETZE },
        abholung: { arbeit: '/arbeit', erledigt: '/erledigt', gescheitert: '/gescheitert' },
      },
    },
  });
}

/** Eine Filialdatei mit ihrem Lieferdatum in jeder Zeile. */
function liefere(bank: Werkbank, teil: string, datum: string): void {
  bank.ablage.lege(`/abholung/Filiale_${teil}_${datum.replaceAll('-', '')}.csv`, ['lieferdatum', 'kdnr'], [
    [datum, '1'],
    [datum, '2'],
  ]);
}

test('zwei Stapel im Verzeichnis werden nicht verrührt', async () => {
  /*
   * Der Fall, für den es den Schlüssel gibt: Die verspätete Lieferung von
   * gestern liegt neben der heutigen. Ohne ihn wären fünf Dateien da, die
   * Plätze besetzt — und das Ergebnis enthielte zwei Tage.
   */
  const bank = werkbank();

  liefere(bank, 'Nord', '2026-08-20');
  liefere(bank, 'Sued', '2026-08-20');

  for (const teil of ['Nord', 'Sued', 'West']) {
    liefere(bank, teil, '2026-08-21');
  }

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(schluesseljob());

  // Der vollständige Stapel vom 21. ist durch …
  assert.ok(bank.ablage.verschoben.some((zug) => zug.includes('Filiale_West_20260821.csv')));

  // … der unvollständige vom 20. liegt unangetastet im Abholverzeichnis.
  assert.ok(bank.ablage.dateien.has('/abholung/Filiale_Nord_20260820.csv'));
  assert.ok(bank.ablage.dateien.has('/abholung/Filiale_Sued_20260820.csv'));
});

test('eine Lieferung mit fremdem Merkmal hält den eigenen Stapel nicht auf', () => {
  /*
   * Der Schlüssel steht im Namen. Eine Datei mit einem anderen Merkmal gehört
   * zu einem anderen Stapel — sie ist kein Grund zu warten, und sie darf den
   * eigenen nicht vollständig machen.
   */
  const bank = werkbank();

  liefere(bank, 'Nord', '2026-08-21');
  liefere(bank, 'Sued', '2026-08-21');
  // West liefert für einen anderen Tag.
  liefere(bank, 'West', '2026-08-22');

  return new WorkflowExecutionService(uebertragung(), bank.umgebung)
    .execute(schluesseljob())
    .then((ergebnis) => {
      assert.equal(ergebnis.status, TransferRunStatus.SUCCESS_NO_FILES);
      assert.deepEqual(bank.ablage.verschoben, []);
    });
});

test('ein Platz ohne Marke wird im Protokoll benannt', async () => {
  /*
   * Tragen die anderen eine Marke und dieser nicht, ist nicht zu sagen, zu
   * welchem Stapel seine Lieferung gehört. Das ist ein Einrichtungsfehler und
   * wird nicht besser, wenn jemand wartet — also eine Warnung und kein Hinweis.
   */
  const eintraege: LogEntry[] = [];
  const bank = werkbank();

  bank.umgebung.logger = { log: (eintrag) => eintraege.push(eintrag) };

  liefere(bank, 'Nord', '2026-08-21');
  bank.ablage.lege('/abholung/Filiale_Sued_0821.csv', ['kdnr'], [['2']]);

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/abholung' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
        dateien: {
          stapel: {
            plaetze: [
              { name: 'Nord', muster: 'Filiale_Nord_{stapel}.csv' },
              { name: 'Süd', muster: 'Filiale_Sued_*.csv' },
            ],
          },
          abholung: { arbeit: '/arbeit', erledigt: '/erledigt', gescheitert: '/gescheitert' },
        },
      },
    })
  );

  assert.ok(
    eintraege.some((eintrag) => eintrag.level === 'WARNING' && eintrag.message.includes('Süd')),
    'der Mangel steht als Warnung im Protokoll'
  );
});

test('verworfen wird dieser Stapel, nicht das Verzeichnis', async () => {
  /*
   * Zwei Stapel liegen da: Der alte ist über der Frist, der neue gerade
   * angekommen. Nähme das Verwerfen das ganze Verzeichnis, riss ein alter, nie
   * fertig gewordener Stapel jede Nacht einen frischen mit — und niemand käme
   * je zu einem Ergebnis.
   */
  const bank = werkbank();

  // Der alte: eine Filiale, lange her.
  bank.ablage.lege('/abholung/Filiale_Nord_20260820.csv', ['lieferdatum', 'kdnr'], [['2026-08-20', '1']]);
  bank.ablage.geaendertAm('/abholung/Filiale_Nord_20260820.csv', '2020-01-01T00:00:00.000Z');

  // Der neue: eine Filiale, eben erst.
  bank.ablage.lege('/abholung/Filiale_Sued_20260821.csv', ['lieferdatum', 'kdnr'], [['2026-08-21', '2']]);
  bank.ablage.geaendertAm('/abholung/Filiale_Sued_20260821.csv', new Date().toISOString());

  await new WorkflowExecutionService(uebertragung(), bank.umgebung).execute(
    job({
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: '/abholung' },
        regeln: { betriebsart: 'SAMMELN', art: 'APPEND' },
        dateien: {
          stapel: { plaetze: MARKEN_PLAETZE, fristSekunden: 60 },
          abholung: { arbeit: '/arbeit', erledigt: '/erledigt', gescheitert: '/gescheitert' },
        },
      },
    })
  );

  // Der alte ist fort …
  assert.ok(
    bank.ablage.verschoben.some((zug) => zug.endsWith('/gescheitert/Filiale_Nord_20260820.csv')),
    'der abgelaufene Stapel liegt bei den gescheiterten'
  );

  // … der neue liegt unangetastet.
  assert.ok(
    bank.ablage.dateien.has('/abholung/Filiale_Sued_20260821.csv'),
    'der junge Stapel bleibt im Abholverzeichnis'
  );
});
