import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUncPath,
  serverOf,
  shareOf,
  ShareConnectionError,
  ShareConnectionService,
} from './ShareConnectionService.js';

/**
 * Die Verbindungsverwaltung, ohne wirklich `net use` aufzurufen.
 *
 * Der Aufruf selbst ist eine Zeile; das Verhalten darum herum ist die Arbeit —
 * anstellen, aufräumen, und beides auch dann, wenn etwas schiefgeht. Genau das
 * lässt sich hier prüfen, und zwar schnell und ohne Windows.
 */

interface Aufzeichnung {
  args: string[];
  input?: string;
}

function dienst(ergebnisse: (args: string[]) => { code: number; output: string } = () => ({ code: 0, output: '' })) {
  const aufrufe: Aufzeichnung[] = [];

  const service = new ShareConnectionService(async (args, input) => {
    aufrufe.push({ args, input });
    return ergebnisse(args);
  });

  return { service, aufrufe };
}

const ZUGANG = { username: 'KundeA', password: 'geheim' };
const PFAD = '\\\\SERVER01\\Austausch\\Eingang';

test('ein Pfad ohne Anmeldedaten wird nicht angefasst', async () => {
  // Der häufige Fall: Die Freigabe steht dem Dienstkonto ohnehin offen. Eine
  // Verbindung aufzumachen, die niemand verlangt hat, hinterließe eine Sitzung,
  // die niemand erwartet.
  const { service, aufrufe } = dienst();

  const ergebnis = await service.withConnection(PFAD, undefined, undefined, async () => 'fertig');

  assert.equal(ergebnis, 'fertig');
  assert.deepEqual(aufrufe, []);
});

test('ein lokaler Pfad wird nicht verbunden, auch mit Anmeldedaten', async () => {
  // `D:\Daten` ist keine Freigabe. Ein `net use` darauf wäre sinnlos und
  // scheiterte mit einer Meldung, die niemand deuten kann.
  const { service, aufrufe } = dienst();

  await service.withConnection('D:\\Daten\\eingang', ZUGANG, undefined, async () => undefined);

  assert.deepEqual(aufrufe, []);
});

test('verbinden, arbeiten, wieder lösen — in dieser Reihenfolge', { skip: process.platform !== 'win32' }, async () => {
  const { service, aufrufe } = dienst();
  const reihenfolge: string[] = [];

  await service.withConnection(PFAD, ZUGANG, undefined, async () => {
    reihenfolge.push('gearbeitet');
  });

  assert.deepEqual(
    aufrufe.map((aufruf) => aufruf.args.join(' ')),
    [
      // Erst lösen, was von einem abgebrochenen Lauf übrig sein könnte.
      'use \\\\SERVER01\\Austausch /delete /y',
      'use \\\\SERVER01\\Austausch /user:KundeA *',
      'use \\\\SERVER01\\Austausch /delete /y',
    ]
  );
  assert.deepEqual(reihenfolge, ['gearbeitet']);
});

test('das Kennwort geht über die Eingabe, nie über die Befehlszeile', { skip: process.platform !== 'win32' }, async () => {
  // Was in der Befehlszeile steht, kann jeder Prozess auf dem Rechner mitlesen.
  const { service, aufrufe } = dienst();

  await service.withConnection(PFAD, ZUGANG, undefined, async () => undefined);

  const verbinden = aufrufe.find((aufruf) => aufruf.args.includes('/user:KundeA'));
  assert.ok(verbinden);
  assert.equal(verbinden.args.some((arg) => arg.includes('geheim')), false, 'das Kennwort steht in der Befehlszeile');
  assert.equal(verbinden.input, 'geheim\n');
});

test('nach einem Fehler in der Arbeit wird trotzdem gelöst', { skip: process.platform !== 'win32' }, async () => {
  // Sonst bliebe die Sitzung stehen, und der nächste Lauf mit anderen
  // Anmeldedaten würde von Windows abgewiesen — mit einem Fehler, der auf den
  // Lauf von vorgestern zeigt.
  const { service, aufrufe } = dienst();

  await assert.rejects(() =>
    service.withConnection(PFAD, ZUGANG, undefined, async () => {
      throw new Error('die Übertragung ging schief');
    })
  );

  assert.equal(aufrufe.filter((aufruf) => aufruf.args.includes('/delete')).length, 2);
});

test('scheitert das Verbinden, wird die Arbeit gar nicht erst begonnen', { skip: process.platform !== 'win32' }, async () => {
  const { service } = dienst((args) =>
    args.includes('/user:KundeA')
      ? { code: 2, output: 'Systemfehler 1326: Benutzername oder Kennwort falsch' }
      : { code: 0, output: '' }
  );

  let gearbeitet = false;

  await assert.rejects(
    () =>
      service.withConnection(PFAD, ZUGANG, undefined, async () => {
        gearbeitet = true;
      }),
    ShareConnectionError
  );

  assert.equal(gearbeitet, false, 'ohne Verbindung darf nichts geschrieben werden');
});

test('zwei Läufe zum selben Server warten aufeinander', { skip: process.platform !== 'win32' }, async () => {
  /*
   * Der eigentliche Zweck dieser Klasse. Windows kennt die Sitzung zum Server,
   * nicht zur Freigabe: Zwei verschiedene Zugänge zu demselben Server können
   * nicht gleichzeitig bestehen. Liefen beide parallel, zöge einer dem anderen
   * die Verbindung unter den Füßen weg — und zwar mitten in einer Übertragung.
   */
  const { service } = dienst();
  const verlauf: string[] = [];
  let ersterFertig!: () => void;
  const wartet = new Promise<void>((resolve) => (ersterFertig = resolve));

  const erster = service.withConnection(PFAD, ZUGANG, undefined, async () => {
    verlauf.push('erster beginnt');
    await wartet;
    verlauf.push('erster endet');
  });

  const zweiter = service.withConnection(
    '\\\\SERVER01\\Andere\\Ordner',
    { username: 'KundeB', password: 'anders' },
    undefined,
    async () => {
      verlauf.push('zweiter beginnt');
    }
  );

  // Dem zweiten Gelegenheit geben, sich vorzudrängeln — er darf es nicht.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(verlauf, ['erster beginnt'], 'der zweite hat sich vorgedrängelt');

  ersterFertig();
  await Promise.all([erster, zweiter]);

  assert.deepEqual(verlauf, ['erster beginnt', 'erster endet', 'zweiter beginnt']);
});

test('ein gescheiterter Lauf reißt den nächsten nicht mit', { skip: process.platform !== 'win32' }, async () => {
  const { service } = dienst();

  const gescheitert = service.withConnection(PFAD, ZUGANG, undefined, async () => {
    throw new Error('kaputt');
  });

  await assert.rejects(() => gescheitert);

  const danach = await service.withConnection(PFAD, ZUGANG, undefined, async () => 'geht doch');
  assert.equal(danach, 'geht doch');
});

test('zwei Läufe zu verschiedenen Servern warten nicht aufeinander', { skip: process.platform !== 'win32' }, async () => {
  // Die Sperre gilt je Server. Alle Freigaben in eine Reihe zu zwingen wäre
  // vorsichtig bis zur Nutzlosigkeit: Ein Haus mit zehn Servern überträgt dann
  // nur noch nacheinander.
  const { service } = dienst();
  const verlauf: string[] = [];
  let ersterFertig!: () => void;
  const wartet = new Promise<void>((resolve) => (ersterFertig = resolve));

  const erster = service.withConnection(PFAD, ZUGANG, undefined, async () => {
    verlauf.push('erster');
    await wartet;
  });

  const zweiter = service.withConnection('\\\\SERVER02\\Austausch\\Eingang', ZUGANG, undefined, async () => {
    verlauf.push('zweiter');
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(verlauf, ['erster', 'zweiter'], 'der zweite Server musste unnötig warten');

  ersterFertig();
  await Promise.all([erster, zweiter]);
});

test('Server und Freigabe werden aus dem Pfad gelesen, nicht geraten', () => {
  assert.equal(serverOf('\\\\SERVER01\\Austausch\\Eingang'), 'server01');
  assert.equal(shareOf('\\\\SERVER01\\Austausch\\Eingang\\tief'), '\\\\SERVER01\\Austausch');
  // Zwei Freigaben desselben Servers teilen sich die Sitzung — deshalb ist der
  // Server der Schlüssel und nicht die Freigabe.
  assert.equal(serverOf('\\\\server01\\Andere'), serverOf('\\\\SERVER01\\Austausch'));

  assert.equal(isUncPath('\\\\SERVER01\\Austausch'), true);
  assert.equal(isUncPath('D:\\Daten'), false);
  assert.equal(isUncPath('/exports/orders'), false);
});
