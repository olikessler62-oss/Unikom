import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { writeXlsx } from '../../testing/consolidation/Xlsx.js';
import { discoverEmail, quelleAlsText } from './EmailDiscovery.js';

const deutsch = { region: DEFAULT_REGION };

/** Baut eine Nachricht so, wie ein Mailprogramm sie schreibt. */
function nachricht(teile: {
  betreff?: string;
  body?: string;
  bodyEncoding?: 'plain' | 'base64' | 'quoted-printable';
  anhang?: { name: string; typ: string; inhalt: Buffer };
}): Buffer {
  const grenze = 'grenze-4711';
  const kopf = [
    'From: einkauf@mueller.example',
    'To: auftrag@unikom.example',
    `Subject: ${teile.betreff ?? 'Bestellung'}`,
    'Date: Wed, 19 Aug 2026 08:15:00 +0200',
    'MIME-Version: 1.0',
  ];

  if (!teile.anhang) {
    const kodiert =
      teile.bodyEncoding === 'base64'
        ? Buffer.from(teile.body ?? '', 'utf-8').toString('base64')
        : teile.bodyEncoding === 'quoted-printable'
          ? (teile.body ?? '').replace(/ä/g, '=C3=A4').replace(/ü/g, '=C3=BC')
          : (teile.body ?? '');

    return Buffer.from(
      [
        ...kopf,
        'Content-Type: text/plain; charset=UTF-8',
        ...(teile.bodyEncoding && teile.bodyEncoding !== 'plain'
          ? [`Content-Transfer-Encoding: ${teile.bodyEncoding}`]
          : []),
        '',
        kodiert,
      ].join('\r\n'),
      'utf-8'
    );
  }

  const stuecke = [
    ...kopf,
    `Content-Type: multipart/mixed; boundary="${grenze}"`,
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    teile.body ?? '',
    `--${grenze}`,
    `Content-Type: ${teile.anhang.typ}; name="${teile.anhang.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${teile.anhang.name}"`,
    '',
    teile.anhang.inhalt.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${grenze}--`,
    '',
  ];

  return Buffer.from(stuecke.join('\r\n'), 'binary');
}

test('die Bestellung im Text der Nachricht wird gefunden', () => {
  const mail = nachricht({
    body: [
      'Sehr geehrte Damen und Herren,',
      '',
      'hiermit bestellen wir:',
      '',
      'Artikelnummer   Bezeichnung        Menge   Preis',
      '4711            Schraube M8        500     0,12',
      '4712            Mutter M8          500     0,08',
      '',
      'Mit freundlichen Grüßen',
    ].join('\r\n'),
  });

  const { message, blocks } = discoverEmail(mail, deutsch);

  assert.equal(message.from, 'einkauf@mueller.example');
  assert.equal(message.subject, 'Bestellung');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].quelle.art, 'BODY');
  assert.equal(quelleAlsText(blocks[0].quelle), 'Text der Nachricht');
  assert.deepEqual(
    blocks[0].block.columns.map((spalte) => spalte.type),
    ['INTEGER', 'STRING', 'INTEGER', 'DECIMAL']
  );
});

test('ein kodierter Betreff wird lesbar', () => {
  // Ohne das steht im Betreff Buchstabensalat — und der Betreff ist oft das
  // Einzige, woran ein Mensch die Nachricht wiedererkennt.
  const mail = nachricht({ betreff: '=?UTF-8?Q?Bestellung_M=C3=BCller_GmbH?=', body: 'kurz' });

  assert.equal(discoverEmail(mail, deutsch).message.subject, 'Bestellung Müller GmbH');
});

test('Base64 und Quoted-Printable im Rumpf werden aufgelöst', () => {
  const daten = ['Nr;Ware;Menge', '4711;Schraube;500', '4712;Mutter;300'].join('\r\n');

  for (const kodierung of ['base64', 'quoted-printable'] as const) {
    const { blocks } = discoverEmail(nachricht({ body: daten, bodyEncoding: kodierung }), deutsch);

    assert.equal(blocks.length, 1, kodierung);
    assert.equal(blocks[0].block.rows.length, 2, kodierung);
  }
});

test('ein Anhang wird gelesen, und seine Herkunft bleibt erhalten', () => {
  const mappe = writeXlsx([
    {
      name: 'Bestellungen',
      rows: [
        ['Artikelnummer', 'Bezeichnung', 'Menge'],
        [4711, 'Schraube M8', 500],
        [4712, 'Mutter M8', 500],
      ],
    },
  ]);

  const mail = nachricht({
    body: 'Guten Tag,\r\n\r\nunsere Bestellung finden Sie im Anhang.\r\n\r\nViele Grüße',
    anhang: {
      name: 'Bestellung.xlsx',
      typ: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      inhalt: mappe,
    },
  });

  const { blocks } = discoverEmail(mail, deutsch);

  assert.equal(blocks.length, 1, 'im Text steht nichts Tabellarisches, im Anhang schon');
  assert.deepEqual(blocks[0].quelle, {
    art: 'ATTACHMENT',
    filename: 'Bestellung.xlsx',
    sheet: 'Bestellungen',
  });
  assert.equal(quelleAlsText(blocks[0].quelle), 'Anhang Bestellung.xlsx, Blatt „Bestellungen"');
  assert.equal(blocks[0].block.rows.length, 2);
});

test('Text und Anhang zusammen ergeben zwei Blöcke mit verschiedener Herkunft', () => {
  const mail = nachricht({
    body: ['Bestellung:', '', '4711;Schraube;500', '4712;Mutter;300'].join('\r\n'),
    anhang: {
      name: 'Lieferadressen.csv',
      typ: 'text/csv',
      inhalt: Buffer.from(['Nr;Ort;PLZ', '1;Köln;50667', '2;Bonn;53111'].join('\r\n'), 'utf-8'),
    },
  });

  const { blocks } = discoverEmail(mail, deutsch);

  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks.map((eintrag) => quelleAlsText(eintrag.quelle)),
    ['Text der Nachricht', 'Anhang Lieferadressen.csv']
  );
});

test('ein unlesbarer Anhang macht die Nachricht nicht wertlos', () => {
  const mail = nachricht({
    body: ['4711;Schraube;500', '4712;Mutter;300'].join('\r\n'),
    anhang: { name: 'kaputt.xlsx', typ: 'application/octet-stream', inhalt: Buffer.from('das ist kein ZIP') },
  });

  const { blocks, notes } = discoverEmail(mail, deutsch);

  assert.equal(blocks.length, 1, 'der Rumpf bleibt verwertbar');
  assert.ok(notes.some((note) => note.includes('kaputt.xlsx')), notes.join(' / '));
});

test('Bilder im Anhang werden gar nicht erst untersucht', () => {
  const mail = nachricht({
    body: ['4711;Schraube;500', '4712;Mutter;300'].join('\r\n'),
    anhang: { name: 'unterschrift.png', typ: 'image/png', inhalt: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  });

  const { blocks, notes } = discoverEmail(mail, deutsch);

  assert.equal(blocks.length, 1);
  assert.equal(notes.length, 0, 'ein Logo ist kein Fehler und keine Meldung wert');
});

test('eine Nachricht ohne Daten sagt das, statt etwas zu erfinden', () => {
  const mail = nachricht({
    body: ['Sehr geehrte Frau Berger,', '', 'vielen Dank für Ihre Nachricht.', '', 'Mit freundlichen Grüßen'].join(
      '\r\n'
    ),
  });

  const { blocks, notes } = discoverEmail(mail, deutsch);

  assert.deepEqual(blocks, []);
  assert.ok(notes.some((note) => note.includes('keine eindeutige Datenstruktur')));
});
