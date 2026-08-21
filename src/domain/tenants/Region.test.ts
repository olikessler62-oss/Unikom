import test from 'node:test';
import assert from 'node:assert/strict';

import { assertRegionIsUsable, dateOrderOf, sampleDate, DEFAULT_REGION } from './Region.js';

/**
 * Die Region entscheidet, wie ein Datum aus einer fremden Datei gelesen wird.
 *
 * Geprüft wird deshalb vor allem, was *nicht* durchgeht: eine Kennung, die
 * richtig aussieht und nicht bedient wird. Sie stünde sonst in den
 * Einstellungen, und gelesen würde nach etwas anderem — der einzige Fehler
 * dieser Art, der nie auffällt, weil beide Lesarten gelingen.
 */

test('die Reihenfolge wird der Sprachkennung abgelesen', () => {
  assert.equal(dateOrderOf('de-DE'), 'DAY_FIRST');
  assert.equal(dateOrderOf('en-GB'), 'DAY_FIRST');
  assert.equal(dateOrderOf('fr-FR'), 'DAY_FIRST');
  assert.equal(dateOrderOf('en-US'), 'MONTH_FIRST');
  // Der Fall, der eine Tabelle sofort widerlegt hätte: dasselbe Englisch,
  // andere Reihenfolge, und Ungarn schreibt das Jahr zuerst.
  assert.equal(dateOrderOf('hu-HU'), 'YEAR_FIRST');
  assert.equal(dateOrderOf('ja-JP'), 'YEAR_FIRST');
});

test('das Beispieldatum steht in der Schreibweise der Region', () => {
  assert.equal(sampleDate({ locale: 'de-DE', timeZone: 'Europe/Berlin' }), '3.4.2026');
  assert.equal(sampleDate({ locale: 'en-US', timeZone: 'America/New_York' }), '4/3/2026');
});

test('die Voreinstellung ist brauchbar', () => {
  assertRegionIsUsable(DEFAULT_REGION);
  assert.equal(dateOrderOf(DEFAULT_REGION.locale), 'DAY_FIRST');
});

test('eine Kennung, die niemand bedient, wird abgelehnt', () => {
  /*
   * `xx-XX` wirft nicht — es formatiert, und zwar nach der Einstellung des
   * Rechners. Dieselbe Installation läse damit auf einem deutschen Server den
   * Tag zuerst und auf einem amerikanischen den Monat.
   */
  assert.equal(new Intl.DateTimeFormat('xx-XX').format(new Date(Date.UTC(2026, 3, 3))).length > 0, true);
  assert.throws(() => assertRegionIsUsable({ locale: 'xx-XX', timeZone: 'Europe/Berlin' }), /nicht bedient/);
});

test('ein Zusatz, der den Kalender austauscht, wird abgelehnt', () => {
  // Gemessen: aus dem 3.4.2026 wird damit „3.4.2569 BE".
  assert.match(new Intl.DateTimeFormat('de-DE-u-ca-buddhist').format(new Date(Date.UTC(2026, 3, 3))), /2569/);
  assert.throws(
    () => assertRegionIsUsable({ locale: 'de-DE-u-ca-buddhist', timeZone: 'Europe/Berlin' }),
    /Kalender oder Ziffern/
  );
});

test('ein unbekanntes Land bei bekannter Sprache bleibt erlaubt', () => {
  // `de-XY` wird bedient und liest wie Deutsch. Das ist kein stilles Ausweichen,
  // sondern der Rückfall auf die Sprache — und der ist richtig.
  assertRegionIsUsable({ locale: 'de-XY', timeZone: 'Europe/Berlin' });
  assert.equal(dateOrderOf('de-XY'), 'DAY_FIRST');
});

test('eine unsinnige Kennung wird abgelehnt', () => {
  assert.throws(() => assertRegionIsUsable({ locale: 'Deutschland', timeZone: 'Europe/Berlin' }), /Sprachkennung/);
});

test('eine unbekannte Zeitzone wird abgelehnt', () => {
  assert.throws(() => assertRegionIsUsable({ locale: 'de-DE', timeZone: 'Europa/Berlin' }), /Zeitzone/);
});

test('leere Angaben werden abgelehnt', () => {
  assert.throws(() => assertRegionIsUsable({ locale: '  ', timeZone: 'Europe/Berlin' }), /Sprachkennung und eine Zeitzone/);
  assert.throws(() => assertRegionIsUsable({ locale: 'de-DE', timeZone: '' }), /Sprachkennung und eine Zeitzone/);
});
