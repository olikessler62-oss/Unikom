import assert from 'node:assert/strict';
import test from 'node:test';

import type { Meldeeinstellungen, Postausgang, Postsendung } from '../../domain/background/Postausgang.js';
import type { LogEntry, Logger } from '../../domain/logging/LogEntry.js';
import {
  InMemoryHeartbeatRepository,
  InMemoryNotificationRepository,
} from '../../infrastructure/persistence/InMemoryBackgroundRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { BackgroundService } from './BackgroundService.js';

const AUSGANG: Postausgang = {
  host: 'mail.example.com',
  port: 587,
  verschluesselung: 'STARTTLS',
  absender: 'Unikom <unikom@example.com>',
};

interface Werkbank {
  dienst: BackgroundService;
  bestand: InMemoryNotificationRepository;
  versandt: Postsendung[];
  protokoll: LogEntry[];
}

function werkbank(
  einstellungen: Meldeeinstellungen | undefined,
  scheitert?: string
): Werkbank {
  const bestand = new InMemoryNotificationRepository();
  const versandt: Postsendung[] = [];
  const protokoll: LogEntry[] = [];
  const logger: Logger = { log: (eintrag) => protokoll.push(eintrag) };

  const dienst = new BackgroundService(
    new InMemoryHeartbeatRepository(),
    bestand,
    new InMemoryTransferRunRepository(),
    logger,
    undefined,
    {
      postbote: {
        async sende(sendung) {
          if (scheitert) {
            throw new Error(scheitert);
          }

          versandt.push(sendung);
        },
      },
      einstellungen: async () => einstellungen,
    }
  );

  return { dienst, bestand, versandt, protokoll };
}

const EINGERICHTET: Meldeeinstellungen = { empfaenger: ['anna@example.com'], postausgang: AUSGANG };

test('ein kritisches Ereignis geht auch per E-Mail hinaus', async () => {
  const bank = werkbank(EINGERICHTET);

  await bank.dienst.melde('default', 'LAUF_FEHLER', { titel: 'Abbruch', text: 'Etwas ging schief' });

  assert.equal(bank.versandt.length, 1);
  assert.deepEqual(bank.versandt[0].an, ['anna@example.com']);
  assert.match(bank.versandt[0].betreff, /Abbruch/);
});

test('ein Erfolg bleibt im Center, solange ihn niemand bestellt hat', async () => {
  const bank = werkbank(EINGERICHTET);

  await bank.dienst.melde('default', 'LAUF_ERFOLGREICH', { titel: 'Fertig', text: 'Alles gut' });

  assert.deepEqual(bank.versandt, []);
  assert.equal((await bank.bestand.list('default', false)).length, 1, 'im Center steht sie trotzdem');
});

test('wer den Erfolg bestellt hat, bekommt ihn', async () => {
  const bank = werkbank({ ...EINGERICHTET, auchBeiErfolg: true });

  await bank.dienst.melde('default', 'LAUF_ERFOLGREICH', { titel: 'Fertig', text: 'Alles gut' });

  assert.equal(bank.versandt.length, 1);
});

test('ohne eingerichteten Postausgang wird nichts versandt und nichts beklagt', async () => {
  // Der Normalzustand einer Installation, in der niemand etwas eingetragen hat.
  const bank = werkbank(undefined);

  await bank.dienst.melde('default', 'LAUF_FEHLER', { titel: 'Abbruch', text: 'Etwas ging schief' });

  assert.deepEqual(bank.versandt, []);
  assert.deepEqual(
    bank.protokoll.filter((eintrag) => eintrag.level !== 'INFO'),
    []
  );
});

test('ein misslungener Versand verliert die Meldung nicht', async () => {
  /*
   * Der Bestand ist die Wahrheit; der Versand ist eine Zustellung, die
   * scheitern darf. Ginge die Meldung dabei verloren, wäre ausgerechnet der
   * Ausfall des Postfachs der Grund, warum niemand vom Abbruch erfährt.
   */
  const bank = werkbank(EINGERICHTET, 'Verbindung abgelehnt');

  const meldung = await bank.dienst.melde('default', 'LAUF_FEHLER', {
    titel: 'Abbruch',
    text: 'Etwas ging schief',
  });

  assert.equal(meldung.stufe, 'KRITISCH');
  assert.equal((await bank.bestand.list('default', true)).length, 1);
});

test('ein misslungener Versand steht mit seinem Grund im Protokoll', async () => {
  // Sonst sucht jemand tagelang, warum keine Mails ankommen.
  const bank = werkbank(EINGERICHTET, 'Verbindung abgelehnt');

  await bank.dienst.melde('default', 'LAUF_FEHLER', { titel: 'Abbruch', text: 'Etwas ging schief' });

  const klage = bank.protokoll.find((eintrag) => eintrag.level === 'WARNING');

  assert.ok(klage, bank.protokoll.map((eintrag) => eintrag.message).join(' | '));
  assert.match(klage.message, /Verbindung abgelehnt/);
  assert.match(klage.message, /steht unverändert im Benachrichtigungscenter/);
});

test('ein misslungener Versand hält die Verarbeitung nicht auf', async () => {
  const bank = werkbank(EINGERICHTET, 'Zeitüberschreitung');

  await assert.doesNotReject(
    bank.dienst.melde('default', 'KONFLIKTE_ENTSTANDEN', { titel: '17 Fälle', text: 'Bitte bearbeiten' })
  );
});
