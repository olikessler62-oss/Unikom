import assert from 'node:assert/strict';
import test from 'node:test';

import { erneutZeigen, istOffen, KANAELE, type Benachrichtigung } from '../../domain/background/Benachrichtigung.js';
import { istVerstummt, seit } from '../../domain/background/Heartbeat.js';
import { verhaltenVon } from '../../domain/conflicts/Konfliktverhalten.js';
import { TransferRunStatus, type TransferRun } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import {
  InMemoryHeartbeatRepository,
  InMemoryNotificationRepository,
} from '../../infrastructure/persistence/InMemoryBackgroundRepository.js';
import { BackgroundService, dieserProzess } from './BackgroundService.js';

const JETZT = new Date('2026-08-20T12:00:00.000Z');
const PROZESS = { id: 'rechner-1', host: 'rechner', pid: 1, gestartet: '2026-08-20T11:00:00.000Z' };

function lauf(teile: Partial<TransferRun> = {}): TransferRun {
  return {
    id: 'lauf1',
    jobId: 'job1',
    status: TransferRunStatus.RUNNING,
    startedAt: new Date('2026-08-20T11:50:00.000Z'),
    filesFound: 0,
    filesProcessed: 0,
    filesSucceeded: 0,
    filesSkipped: 0,
    filesFailed: 0,
    ...teile,
  };
}

/** Ein Laufbestand, der nur kann, was der Hintergrundbetrieb braucht. */
function laufbestand(laeufe: TransferRun[]): TransferRunRepository {
  return {
    list: async () => [...laeufe],
    listByJob: async (jobId) => laeufe.filter((eintrag) => eintrag.jobId === jobId),
    getById: async (id) => laeufe.find((eintrag) => eintrag.id === id),
    save: async (run) => {
      const stelle = laeufe.findIndex((eintrag) => eintrag.id === run.id);

      if (stelle >= 0) {
        laeufe[stelle] = run;
      } else {
        laeufe.push(run);
      }

      return run;
    },
  };
}

function dienst(laeufe: TransferRun[] = []) {
  const herzschlaege = new InMemoryHeartbeatRepository();
  const meldungen = new InMemoryNotificationRepository();

  return { herzschlaege, meldungen, service: new BackgroundService(herzschlaege, meldungen, laufbestand(laeufe)) };
}

/* ---------- Herzschlag (SPEC-01, Abschnitt 15) ---------- */

test('ein frisches Lebenszeichen heißt: der Prozess lebt', async () => {
  const { service } = dienst();

  await service.schlage(PROZESS, 'lauf1', JETZT);

  const prozesse = await service.prozesse(JETZT);

  assert.equal(prozesse.length, 1);
  assert.equal(prozesse[0].lebt, true);
  assert.equal(prozesse[0].schlag.laufId, 'lauf1');
});

test('ein altes Lebenszeichen heißt: möglicherweise unterbrochen', () => {
  const alt = { prozess: 'p', zuletzt: '2026-08-20T11:00:00.000Z', gestartet: 'x' };

  assert.equal(istVerstummt(alt, JETZT), true);
  assert.equal(istVerstummt({ ...alt, zuletzt: '2026-08-20T11:59:55.000Z' }, JETZT), false);
});

test('die Frist ist großzügig — drei Schläge dürfen ausfallen', () => {
  /*
   * Ein Worker, der gerade eine große Datei entschlüsselt, schreibt für eine
   * Weile nichts. Ihn dafür für tot zu erklären, während er weiterarbeitet,
   * wäre der schlimmere Fehler: Danach stünden zwei Wahrheiten über denselben
   * Lauf im Bestand.
   */
  const vorDreiSchlaegen = { prozess: 'p', zuletzt: '2026-08-20T11:59:15.000Z', gestartet: 'x' };

  assert.equal(istVerstummt(vorDreiSchlaegen, JETZT), false, '45 Sekunden sind noch kein Abbruch');
});

test('ein ordentliches Ende räumt sein Lebenszeichen fort', async () => {
  // Es unterscheidet den Feierabend vom Absturz.
  const { service } = dienst();

  await service.schlage(PROZESS, undefined, JETZT);
  await service.beendeHerzschlag(PROZESS);

  assert.deepEqual(await service.prozesse(JETZT), []);
});

test('wie lange her, in Worten', () => {
  assert.equal(seit({ prozess: 'p', zuletzt: '2026-08-20T11:59:30.000Z', gestartet: 'x' }, JETZT), '30 Sekunden');
  assert.equal(seit({ prozess: 'p', zuletzt: '2026-08-20T11:30:00.000Z', gestartet: 'x' }, JETZT), '30 Minuten');
  assert.equal(seit({ prozess: 'p', zuletzt: '2026-08-20T04:00:00.000Z', gestartet: 'x' }, JETZT), '8 Stunden');
});

/* ---------- Abgebrochene Läufe (SPEC-02, Abschnitt 52) ---------- */

test('ein Lauf ohne lebenden Prozess gilt als abgebrochen', async () => {
  // „Der Status darf nicht dauerhaft auf RUNNING stehen bleiben."
  const laeufe = [lauf()];
  const { service } = dienst(laeufe);

  const befunde = await service.markiereAbgebrochene('default', JETZT);

  assert.equal(befunde.length, 1);
  assert.equal(laeufe[0].status, TransferRunStatus.FAILED);
  assert.equal(laeufe[0].completedAt, JETZT);
});

test('ein Neustart lässt keinen Lauf als erfolgreich gelten', async () => {
  /*
   * Nach einem Stromausfall ist die Herzschlagtabelle leer und der Lauf steht
   * trotzdem auf RUNNING. Wer nur nach alten Lebenszeichen suchte, ließe genau
   * diese Läufe stehen.
   */
  const laeufe = [lauf()];
  const { service } = dienst(laeufe);

  await service.markiereAbgebrochene('default', JETZT);

  assert.notEqual(laeufe[0].status, TransferRunStatus.SUCCESS);
});

test('ein Lauf, an dem noch jemand arbeitet, bleibt unangetastet', async () => {
  const laeufe = [lauf()];
  const { service } = dienst(laeufe);

  await service.schlage(PROZESS, 'lauf1', JETZT);

  assert.deepEqual(await service.markiereAbgebrochene('default', JETZT), []);
  assert.equal(laeufe[0].status, TransferRunStatus.RUNNING);
});

test('ein altes Lebenszeichen für genau diesen Lauf rettet ihn nicht', async () => {
  /*
   * Der wichtigste Fall überhaupt: Der Worker ist mitten im Lauf gestorben und
   * hat sein letztes Lebenszeichen dabei stehen lassen — mit der Kennung genau
   * dieses Laufs. Wer nur nachsähe, **ob** sich jemand für den Lauf gemeldet
   * hat, fände hier eine Meldung und ließe den Lauf für immer auf RUNNING.
   */
  const laeufe = [lauf()];
  const { service, herzschlaege } = dienst(laeufe);

  await herzschlaege.melden({
    prozess: 'gestorbener-worker',
    zuletzt: '2026-08-20T11:00:00.000Z',
    laufId: 'lauf1',
    gestartet: '2026-08-20T10:00:00.000Z',
  });

  const befunde = await service.markiereAbgebrochene('default', JETZT);

  assert.equal(befunde.length, 1);
  assert.equal(laeufe[0].status, TransferRunStatus.FAILED);
});

test('ein Prozess, der an etwas anderem arbeitet, rettet den Lauf nicht', async () => {
  // Sonst hielte ein einziger beschäftigter Worker jeden verwaisten Lauf am
  // Leben, den es im Bestand gibt.
  const laeufe = [lauf()];
  const { service } = dienst(laeufe);

  await service.schlage(PROZESS, 'ein-anderer-lauf', JETZT);

  assert.equal((await service.markiereAbgebrochene('default', JETZT)).length, 1);
});

test('zweimal ausführen schadet nicht', async () => {
  // Server und Worker führen es beim Start beide aus; wer zuerst hochkommt,
  // darf keine Rolle spielen.
  const laeufe = [lauf()];
  const { service, meldungen } = dienst(laeufe);

  await service.markiereAbgebrochene('default', JETZT);
  await service.markiereAbgebrochene('default', JETZT);

  assert.equal((await meldungen.list('default')).length, 1, 'nur eine Meldung');
});

test('ein abgebrochener Lauf meldet sich als kritisches Ereignis', async () => {
  const { service } = dienst([lauf()]);

  await service.markiereAbgebrochene('default', JETZT);

  const meldung = (await service.offene('default'))[0];

  assert.equal(meldung.stufe, 'KRITISCH');
  assert.deepEqual(meldung.ziel, { art: 'LAUF', id: 'lauf1' });
  assert.match(meldung.text, /eigene Verarbeitungs-ID/);
});

/* ---------- Benachrichtigungen (SPEC-01, Abschnitt 19 bis 22) ---------- */

test('die Kanäle je Stufe stehen fest', () => {
  // SPEC-01, Abschnitt 21: „Die folgende Zuordnung ist verbindlich."
  assert.deepEqual(KANAELE.INFORMATION, {
    center: true,
    windows: false,
    popup: false,
    email: false,
    nachVorn: false,
  });

  assert.equal(KANAELE.AKTION_ERFORDERLICH.popup, true);
  assert.equal(KANAELE.KRITISCH.nachVorn, true);
});

test('ein Erfolg meldet sich im Center und sonst nirgends', async () => {
  /*
   * Wer jeden Erfolg als Popup bekommt, klickt auch das Konfliktfenster weg,
   * ohne es gelesen zu haben.
   */
  const { service } = dienst();

  const meldung = await service.melde('default', 'LAUF_ERFOLGREICH', {
    titel: 'Verarbeitung abgeschlossen',
    text: '12 Dateien verarbeitet',
  });

  assert.equal(meldung.stufe, 'INFORMATION');
  assert.equal(KANAELE[meldung.stufe].popup, false);
  assert.equal(KANAELE[meldung.stufe].nachVorn, false);
});

test('ein neuer Konfliktbestand verlangt eine Handlung', async () => {
  const { service } = dienst();

  const meldung = await service.melde('default', 'KONFLIKTE_ENTSTANDEN', {
    titel: '3 Fälle warten auf eine Entscheidung',
    text: 'Aus dem Lauf von heute Nacht',
  });

  assert.equal(meldung.stufe, 'AKTION_ERFORDERLICH');
  assert.equal(KANAELE[meldung.stufe].email, true);
});

test('gesehen und bestätigt sind zweierlei', async () => {
  /*
   * „Sie dürfen nicht verloren gehen, nur weil der Benutzer das Popup
   * schließt." Ein geschlossenes Popup ist gesehen. Erledigt ist ein Fall erst,
   * wenn jemand sagt, dass er erledigt ist.
   */
  const { service } = dienst();
  const meldung = await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'x', text: 'y' });

  await service.gesehen(meldung.id, JETZT);

  const nachDemSehen = (await service.offene('default'))[0];

  assert.ok(nachDemSehen.gesehen, 'gesehen ist vermerkt');
  assert.equal(istOffen(nachDemSehen), true, 'offen ist sie trotzdem');

  await service.bestaetigen(meldung.id, 'anna', JETZT);

  assert.deepEqual(await service.offene('default'), []);
  assert.equal((await service.alle('default'))[0].bestaetigtVon, 'anna');
});

test('der erste Bestätiger bleibt der, der im Bestand steht', async () => {
  const { service } = dienst();
  const meldung = await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'x', text: 'y' });

  await service.bestaetigen(meldung.id, 'anna', JETZT);
  await service.bestaetigen(meldung.id, 'bernd', new Date('2026-08-20T13:00:00.000Z'));

  assert.equal((await service.alle('default'))[0].bestaetigtVon, 'anna');
});

test('beim Neustart werden nur die dringenden erneut gezeigt', async () => {
  // Eine Information von vorgestern noch einmal aufzuklappen, erzieht dazu,
  // alles wegzuklicken.
  const { service } = dienst();

  await service.melde('default', 'LAUF_ERFOLGREICH', { titel: 'a', text: 'a' });
  await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'b', text: 'b' });
  await service.melde('default', 'LAUF_FEHLER', { titel: 'c', text: 'c' });

  const nachzuholen = await service.nachzuholen('default');

  assert.deepEqual(nachzuholen.map((meldung) => meldung.titel).sort(), ['b', 'c']);
});

/* ---------- Was der Mandant über Konflikte einstellt ---------- */

test('EINMAL zeigt einen Konflikt nach dem ersten Blick nicht mehr von selbst', async () => {
  const { service, meldungen } = dienst();

  await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'Konflikt', text: 'a' });
  await service.gesehen((await service.alle('default'))[0].id, JETZT);

  const nachzuholen = await service.nachzuholen(
    'default',
    verhaltenVon({ vorlage: 'EINMAL' }),
    new Date(JETZT.getTime() + 1_000_000)
  );

  assert.deepEqual(nachzuholen, []);
  // Fort ist die Meldung damit nicht — sie steht weiter in der Glocke.
  assert.equal((await meldungen.list('default', true)).length, 1);
});

test('BEI_JEDEM_OEFFNEN zeigt den Konflikt auch nach dem Blick wieder', async () => {
  const { service } = dienst();

  await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'Konflikt', text: 'a' });
  await service.gesehen((await service.alle('default'))[0].id, JETZT);

  const nachzuholen = await service.nachzuholen(
    'default',
    verhaltenVon({ vorlage: 'BEI_JEDEM_OEFFNEN' }),
    new Date(JETZT.getTime() + 1_000)
  );

  assert.deepEqual(nachzuholen.map((meldung) => meldung.titel), ['Konflikt']);
});

test('die Wiedervorlage wartet ihre Frist ab und kommt dann', async () => {
  const { service } = dienst();

  await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'Konflikt', text: 'a' });
  await service.gesehen((await service.alle('default'))[0].id, JETZT);

  const verhalten = verhaltenVon({ vorlage: 'WIEDERVORLAGE', wiedervorlageStunden: 4 });
  const frueh = await service.nachzuholen('default', verhalten, new Date(JETZT.getTime() + 3 * 3_600_000));
  const spaet = await service.nachzuholen('default', verhalten, new Date(JETZT.getTime() + 5 * 3_600_000));

  assert.deepEqual(frueh, []);
  assert.deepEqual(spaet.map((meldung) => meldung.titel), ['Konflikt']);
});

test('die Einstellung gilt Konflikten und nicht allem anderen', async () => {
  /*
   * Wer eingestellt hat, dass Konflikte ihm vor der Nase hängen, hat über
   * Konflikte entschieden — nicht darüber, wie oft ein gescheiterter Lauf
   * sich meldet. Das sind zwei Dinge und zwei Adressaten.
   */
  const { service } = dienst();

  await service.melde('default', 'LAUF_FEHLER', { titel: 'Fehler', text: 'a' });
  await service.gesehen((await service.alle('default'))[0].id, JETZT);

  const nachzuholen = await service.nachzuholen(
    'default',
    verhaltenVon({ vorlage: 'EINMAL' }),
    new Date(JETZT.getTime() + 1_000_000)
  );

  assert.deepEqual(nachzuholen.map((meldung) => meldung.titel), ['Fehler']);
});

test('ohne Angabe gilt die Voreinstellung und nichts ändert sich', async () => {
  const { service } = dienst();

  await service.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: 'Konflikt', text: 'a' });

  assert.deepEqual((await service.nachzuholen('default')).map((meldung) => meldung.titel), ['Konflikt']);
});

test('eine bestätigte Meldung kommt nicht wieder', () => {
  const meldung: Benachrichtigung = {
    id: '1',
    tenantId: 'default',
    anlass: 'LAUF_FEHLER',
    stufe: 'KRITISCH',
    titel: 'x',
    text: 'y',
    entstanden: 'z',
    bestaetigt: 'jetzt',
  };

  assert.equal(erneutZeigen(meldung), false);
});

test('das Glockensymbol trennt offen von dringend', async () => {
  const { service } = dienst();

  await service.melde('default', 'LAUF_ERFOLGREICH', { titel: 'a', text: 'a' });
  await service.melde('default', 'LAUF_FEHLER', { titel: 'b', text: 'b' });

  assert.deepEqual(await service.stand('default'), { offen: 2, draengend: 1 });
});

test('ein fremder Mandant sieht nichts', async () => {
  const { service } = dienst();

  await service.melde('default', 'LAUF_FEHLER', { titel: 'a', text: 'a' });

  assert.deepEqual(await service.offene('anderer'), []);
});

test('jeder Prozess hat eine eigene Kennung', () => {
  const angabe = dieserProzess(JETZT);

  assert.match(angabe.id, /-\d+$/, 'Rechnername und Prozessnummer');
  assert.equal(angabe.gestartet, JETZT.toISOString());
});
