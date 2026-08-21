import assert from 'node:assert/strict';
import test from 'node:test';

import type { LogEntry, Logger } from '../../domain/logging/LogEntry.js';
import { ausgeblieben, type Versaeumnis } from '../../domain/scheduling/Ausbleiben.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import {
  InMemoryHeartbeatRepository,
  InMemoryNotificationRepository,
} from '../../infrastructure/persistence/InMemoryBackgroundRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { JobRuntimeService } from '../runtime/JobRuntimeService.js';
import { BackgroundService } from './BackgroundService.js';

const JETZT = new Date('2026-08-20T08:00:00.000Z');

function versaeumt(teile: Partial<Versaeumnis> = {}): Versaeumnis {
  return {
    jobId: 'nachtlauf',
    tenantId: 'default',
    name: 'Nachtlauf',
    erwartet: '2026-08-20T02:00:00.000Z',
    erwartetLokal: '20.08.26, 04:00 (Europe/Berlin)',
    ueberfaellig: '6 Stunden',
    kennung: 'nachtlauf@2026-08-20T02:00:00.000Z',
    ...teile,
  };
}

function dienst(protokoll: LogEntry[] = []): {
  hintergrund: BackgroundService;
  meldungen: InMemoryNotificationRepository;
} {
  const meldungen = new InMemoryNotificationRepository();
  const logger: Logger = { log: (eintrag) => protokoll.push(eintrag) };

  return {
    meldungen,
    hintergrund: new BackgroundService(
      new InMemoryHeartbeatRepository(),
      meldungen,
      new InMemoryTransferRunRepository(),
      logger
    ),
  };
}

test('eine ausgebliebene Verarbeitung ist ein kritisches Ereignis', async () => {
  /*
   * SPEC-01, Abschnitt 21: „erwartete Verarbeitung nicht erfolgt →
   * Kritisches Ereignis". Sie geht damit auch als Blase und als E-Mail hinaus —
   * denn wer sie nur im Center fände, fände sie erst, wenn er ohnehin nachsieht.
   */
  const { hintergrund, meldungen } = dienst();

  await hintergrund.meldeAusbleiben([versaeumt()], JETZT);

  const [meldung] = await meldungen.list('default', true);

  assert.equal(meldung.anlass, 'VERARBEITUNG_AUSGEBLIEBEN');
  assert.equal(meldung.stufe, 'KRITISCH');
  assert.match(meldung.titel, /Nachtlauf/);
  assert.match(meldung.text, /6 Stunden überfällig/);
});

test('die Meldung nennt die naheliegenden Ursachen', async () => {
  // Sie kommt nachts an einen, der nicht am Rechner sitzt. Bis er nachsieht,
  // hat er sonst nichts als „ist nicht gelaufen".
  const { hintergrund, meldungen } = dienst();

  await hintergrund.meldeAusbleiben([versaeumt()], JETZT);

  assert.match((await meldungen.list('default', true))[0].text, /Worker, der nicht läuft/);
});

test('derselbe Termin meldet sich nur einmal', async () => {
  /*
   * Solange etwas das Nachholen verhindert — eine abgelaufene Lizenz —, sieht
   * jeder Tick denselben versäumten Termin. Zwölf gleiche Meldungen pro Stunde
   * sind der Grund, warum jemand die Glocke nicht mehr ansieht.
   */
  const { hintergrund, meldungen } = dienst();

  assert.equal((await hintergrund.meldeAusbleiben([versaeumt()], JETZT)).length, 1);
  assert.equal((await hintergrund.meldeAusbleiben([versaeumt()], JETZT)).length, 0);
  assert.equal((await meldungen.list('default', true)).length, 1);
});

test('der nächste Termin desselben Workflows meldet sich wieder', async () => {
  const { hintergrund } = dienst();

  await hintergrund.meldeAusbleiben([versaeumt()], JETZT);

  const morgen = versaeumt({
    erwartet: '2026-08-21T02:00:00.000Z',
    kennung: 'nachtlauf@2026-08-21T02:00:00.000Z',
  });

  assert.equal((await hintergrund.meldeAusbleiben([morgen], JETZT)).length, 1);
});

test('zwei Workflows zur selben Zeit sind zwei Meldungen', async () => {
  const { hintergrund } = dienst();

  const gemeldet = await hintergrund.meldeAusbleiben(
    [versaeumt(), versaeumt({ jobId: 'zweiter', name: 'Zweiter', kennung: 'zweiter@2026-08-20T02:00:00.000Z' })],
    JETZT
  );

  assert.equal(gemeldet.length, 2);
});

test('die Meldung steht auch im Protokoll, nicht nur in der Glocke', async () => {
  // Ferndiagnose ohne Systemzugang: Was in der Glocke steht, sieht nur, wer
  // angemeldet ist.
  const protokoll: LogEntry[] = [];
  const { hintergrund } = dienst(protokoll);

  await hintergrund.meldeAusbleiben([versaeumt()], JETZT);

  const eintrag = protokoll.find((zeile) => zeile.level === 'ERROR');

  assert.ok(eintrag, protokoll.map((zeile) => zeile.message).join(' | '));
  assert.equal(eintrag.jobId, 'nachtlauf');
  assert.match(eintrag.message, /Erwartete Verarbeitung nicht erfolgt/);
});

/* ---------- Im Lauf ---------- */

function nachtlauf(teile: Partial<TransferJob> = {}): TransferJob {
  return createTransferJob({
    id: 'nachtlauf',
    name: 'Nachtlauf',
    tenantId: 'default',
    enabled: true,
    executionMode: 'AUTOMATIC',
    schedule: { type: 'DAILY', executionTime: '02:00', timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
    nextExecutionAt: new Date('2026-08-20T02:00:00.000Z'),
    transfer: { enabled: false },
    ...teile,
  });
}

test('der Tick sieht zuerst nach, was er verpasst hat', async () => {
  /*
   * In dieser Reihenfolge, weil der Tick den versäumten Termin gleich darauf
   * nachholt und weiterstellt. Danach wäre die Spur fort, und ein Ausfall der
   * ganzen Nacht sähe aus wie ein Lauf, der ein bisschen spät war.
   */
  const jobs = new InMemoryTransferJobRepository();

  await jobs.save(nachtlauf());

  const gesehen: Versaeumnis[][] = [];

  const laufzeit = new JobRuntimeService(jobs, {
    terminwache: async (liste) => {
      gesehen.push(liste);
    },
  });

  await laufzeit.runOnce(JETZT);

  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0][0].jobId, 'nachtlauf');

  // Und danach steht der Termin weiter — der Lauf ist nachgeholt.
  assert.ok((await jobs.getById('nachtlauf'))!.nextExecutionAt!.getTime() > JETZT.getTime());
});

test('ohne Versäumnis wird die Wache nicht behelligt', async () => {
  const jobs = new InMemoryTransferJobRepository();

  await jobs.save(nachtlauf({ nextExecutionAt: new Date('2026-08-21T02:00:00.000Z') }));

  let gerufen = 0;

  await new JobRuntimeService(jobs, {
    terminwache: async () => {
      gerufen += 1;
    },
  }).runOnce(JETZT);

  assert.equal(gerufen, 0);
});

test('eine Wache, die scheitert, hält den Zeitplan nicht auf', async () => {
  /*
   * Eine Meldung über einen ausgebliebenen Lauf ist wichtig; sie zum Anlass zu
   * nehmen, auch die übrigen Läufe ausfallen zu lassen, wäre grotesk.
   */
  const jobs = new InMemoryTransferJobRepository();

  await jobs.save(nachtlauf());

  const ergebnis = await new JobRuntimeService(jobs, {
    terminwache: async () => {
      throw new Error('Datenbank gesperrt');
    },
  }).runOnce(JETZT);

  assert.equal(ergebnis.started, 1);
});

test('was der Lauf findet, ist dasselbe, was die Fachlichkeit findet', () => {
  // Zwei Rechnungen nebeneinander laufen irgendwann auseinander.
  assert.equal(ausgeblieben([nachtlauf()], JETZT).length, 1);
});
