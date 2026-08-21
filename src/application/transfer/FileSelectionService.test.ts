import test from 'node:test';
import assert from 'node:assert/strict';
import { FileSelectionService } from './FileSelectionService.js';
import type { FileSelectionCriteria, SourceFile } from '../../domain/files/SourceFile.js';

const service = new FileSelectionService();
const now = new Date('2026-08-13T06:45:00.000Z');

function file(name: string, overrides: Partial<SourceFile> = {}): SourceFile {
  return {
    name,
    fullPath: `/export/orders/${name}`,
    size: 1024,
    lastModified: new Date(now.getTime() - 90_000),
    isDirectory: false,
    ...overrides,
  };
}

function criteria(overrides: Partial<FileSelectionCriteria> = {}): FileSelectionCriteria {
  return {
    // Mit Stern, seit ein Muster ohne Stern den vollen Namen meint.
    filenamePrefix: 'ORDER_*',
    allowedExtensions: ['.csv'],
    caseSensitivePrefix: false,
    minimumFileAgeSeconds: 60,
    requireStableFile: false,
    ignoredTemporaryExtensions: ['.part', '.tmp', '.temp'],
    ...overrides,
  };
}

test('prefix comparison ignores case by default', () => {
  assert.equal(service.matches(file('Order_001.csv'), criteria(), now), true);
  assert.equal(service.matches(file('order_001.csv'), criteria(), now), true);
});

test('prefix comparison can be case sensitive', () => {
  const strict = criteria({ caseSensitivePrefix: true });
  assert.equal(service.matches(file('ORDER_001.csv'), strict, now), true);
  assert.equal(service.matches(file('order_001.csv'), strict, now), false);
});

test('prefix must appear at the start of the filename', () => {
  for (const name of ['INVOICE_ORDER_001.csv', 'TEST_ORDER_001.csv', 'MYORDER_001.csv']) {
    const result = service.evaluate(file(name), criteria(), now);
    assert.equal(result.selected, false, `${name} must not be selected`);
    assert.equal(result.reason, 'PREFIX_MISMATCH');
  }
});

test('several extensions can be allowed at once', () => {
  const multi = criteria({ allowedExtensions: ['.csv', 'xlsx', '.xml'] });
  assert.equal(service.matches(file('ORDER_001.csv'), multi, now), true);
  assert.equal(service.matches(file('ORDER_002.xlsx'), multi, now), true);
  assert.equal(service.matches(file('ORDER_003.xml'), multi, now), true);
  assert.equal(service.evaluate(file('ORDER_004.pdf'), multi, now).reason, 'EXTENSION_MISMATCH');
});

test('files below the minimum age are rejected', () => {
  const tooYoung = file('ORDER_001.csv', { lastModified: new Date(now.getTime() - 12_000) });
  const result = service.evaluate(tooYoung, criteria(), now);

  assert.equal(result.selected, false);
  assert.equal(result.reason, 'TOO_YOUNG');
});

test('files at or above the minimum age are accepted', () => {
  const exactlyOldEnough = file('ORDER_001.csv', { lastModified: new Date(now.getTime() - 60_000) });
  assert.equal(service.matches(exactlyOldEnough, criteria(), now), true);
});

test('a missing timestamp cannot satisfy a minimum age requirement', () => {
  const withoutTimestamp = file('ORDER_001.csv', { lastModified: undefined });

  assert.equal(service.evaluate(withoutTimestamp, criteria(), now).reason, 'AGE_UNKNOWN');
  assert.equal(service.matches(withoutTimestamp, criteria({ minimumFileAgeSeconds: 0 }), now), true);
});

test('temporary upload files are never picked up', () => {
  for (const name of ['ORDER_001.csv.part', 'ORDER_001.csv.tmp', 'ORDER_001.temp']) {
    const result = service.evaluate(file(name), criteria(), now);
    assert.equal(result.selected, false, `${name} must not be selected`);
    assert.equal(result.reason, 'TEMPORARY_EXTENSION');
  }

  // Section 38: once the upload is renamed to its final name it is picked up.
  assert.equal(service.matches(file('ORDER_001.csv'), criteria(), now), true);
});

test('directories are never selected', () => {
  const directory = file('ORDER_ARCHIVE', { isDirectory: true });
  assert.equal(service.evaluate(directory, criteria(), now).reason, 'DIRECTORY');
});

test('all active filters are combined with AND', () => {
  const directory = ['ORDER_001.csv', 'ORDER_002.csv', 'ORDER_003.xlsx', 'INVOICE_001.csv', 'TEST_ORDER_004.csv'];
  const selected = directory.filter((name) => service.matches(file(name), criteria(), now));

  assert.deepEqual(selected, ['ORDER_001.csv', 'ORDER_002.csv']);
});

test('ein Stern am Ende meint den Namensanfang, ohne Stern gilt der volle Name', () => {
  const service = new FileSelectionService();

  // Ohne die Duldung des Sterns suchte der Vergleich einen Stern im Dateinamen
  // und fände nichts — ein Lauf, der gelingt und keine Datei bewegt.
  assert.equal(service.matchesFilename('MeinDateiname_2026.csv', 'MeinDatei*'), true);
  assert.equal(service.matchesFilename('AndereDatei.csv', 'MeinDatei*'), false);

  // Und ohne Stern ist es der volle Name. Früher galt auch hier der Anfang,
  // und `Rechnung` nahm `Rechnungskorrektur_alt.csv` stillschweigend mit.
  assert.equal(service.matchesFilename('MeinDateiname_2026.csv', 'MeinDatei'), false);
  assert.equal(service.matchesFilename('MeinDateiname.csv', 'MeinDateiname'), true);
});

test('a star in front asks for the end of the name', () => {
  const service = new FileSelectionService();

  // Gemessen am Namen ohne Endung: Sonst könnte „endet auf" nie zutreffen, denn
  // der Name endet auf .csv und nicht auf das gesuchte Wort.
  assert.equal(service.matchesFilename('Rechnung_Export.csv', '*Export'), true);
  assert.equal(service.matchesFilename('Rechnung_Export.csv', '*Rechnung'), false);
  assert.equal(service.matchesFilename('Export', '*Export'), true);
});

test('a star on both sides asks for anywhere in the name', () => {
  const service = new FileSelectionService();

  assert.equal(service.matchesFilename('2026_ORDER_final.csv', '*ORDER*'), true);
  assert.equal(service.matchesFilename('2026_ORDER_final.csv', '*ORDER'), false);
  assert.equal(service.matchesFilename('2026_ORDER_final.csv', 'ORDER*'), false);
  assert.equal(service.matchesFilename('nichts.csv', '*ORDER*'), false);
});

test('stars alone restrict nothing, and one in the middle is just a character', () => {
  const service = new FileSelectionService();

  assert.equal(service.matchesFilename('irgendwas.csv', '*'), true);
  assert.equal(service.matchesFilename('irgendwas.csv', '**'), true);
  assert.equal(service.matchesFilename('irgendwas.csv', '   '), true);

  // Keine halbe Mustersprache, die man für eine ganze hält.
  assert.equal(service.matchesFilename('MeinDateiname.csv', 'Mein*name'), false);
});

test('the three shapes respect case sensitivity like the prefix always did', () => {
  const service = new FileSelectionService();

  assert.equal(service.matchesFilename('ORDER_1.csv', 'order*', true), false);
  assert.equal(service.matchesFilename('ORDER_1.csv', 'order*', false), true);
  assert.equal(service.matchesFilename('Rechnung_EXPORT.csv', '*export', true), false);
  assert.equal(service.matchesFilename('Rechnung_EXPORT.csv', '*export', false), true);
  assert.equal(service.matchesFilename('a_EXPORT_b.csv', '*export*', true), false);
  assert.equal(service.matchesFilename('a_EXPORT_b.csv', '*export*', false), true);
});

test('an extension typed into the pattern is understood, not taken literally', () => {
  const service = new FileSelectionService();

  // Wörtlich gelesen wäre das ein Name, der mit „ORDER_.csv" beginnt — und
  // träfe auf nichts zu. Ein Lauf, der gelingt und keine Datei holt.
  assert.equal(service.matchesFilename('ORDER_2026.csv', 'ORDER_*.csv'), true);
  assert.equal(service.matchesFilename('ORDER_2026.xml', 'ORDER_*.csv'), false);
  assert.equal(service.matchesFilename('RECHNUNG_1.csv', 'ORDER_*.csv'), false);

  // Ohne Stern meint dieselbe Schreibweise die eine Datei, die so heißt.
  assert.equal(service.matchesFilename('ORDER_.csv', 'ORDER_.csv'), true);
  assert.equal(service.matchesFilename('ORDER_2026.csv', 'ORDER_.csv'), false);

  // Auch mit Stern, in jeder der drei Formen.
  assert.equal(service.matchesFilename('MeinDatei_1.csv', 'MeinDatei*.csv'), true);
  assert.equal(service.matchesFilename('Rechnung_Export.csv', '*Export.csv'), true);
  assert.equal(service.matchesFilename('a_ORDER_b.csv', '*ORDER*.csv'), true);
});

test('the file itself decides whether the tail was an extension', () => {
  const service = new FileSelectionService();

  /*
   * Derselbe Ausdruck, zwei Lesarten — und es muss nicht geraten werden, weil
   * die Datei die Frage beantwortet. Genau deshalb steht die Regel hier und
   * nicht im Eingabefeld.
   */
  assert.equal(service.matchesFilename('Rechnung_2026.2026', 'Rechnung_2026.2026'), true);
  assert.equal(service.matchesFilename('Rechnung_2026.2026_final.csv', 'Rechnung_2026.2026*'), true);

  // Eine Versionsnummer im Namen bleibt eine Versionsnummer.
  assert.equal(service.matchesFilename('Rechnung.v1.csv', 'Rechnung.v1'), true);
  assert.equal(service.matchesFilename('Rechnung.v2.csv', 'Rechnung.v1'), false);
});

test('the extension in a pattern is compared without regard to case', () => {
  const service = new FileSelectionService();

  // Ob die Quelle .CSV oder .csv schreibt, ist ihre Angewohnheit — und keine
  // Aussage über den Namen, für den der Job auf Schreibweise achten mag.
  assert.equal(service.matchesFilename('ORDER_1.CSV', 'ORDER_1.csv', true), true);
  assert.equal(service.matchesFilename('ORDER_1.csv', 'ORDER_1.CSV', true), true);
  assert.equal(service.matchesFilename('order_1.csv', 'ORDER_1.csv', true), false);
});

test('a pattern that is only an extension asks for every file of that kind', () => {
  const service = new FileSelectionService();

  assert.equal(service.matchesFilename('irgendwas.csv', '*.csv'), true);
  assert.equal(service.matchesFilename('irgendwas.xml', '*.csv'), false);

  // Ein führender Punkt bleibt der Anfang eines Namens: `.csv` ist eine Datei,
  // die so heißt, und wer danach sucht, meint den Namen.
  assert.equal(service.matchesFilename('.csv', '.csv'), true);
  assert.equal(service.matchesFilename('bericht.csv', '.csv'), false);
});
