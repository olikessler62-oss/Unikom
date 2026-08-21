/**
 * Wo ein Mandant zu Hause ist — als Sprachkennung und als Zeitzone.
 *
 * Am Mandanten und nicht an der Installation: Ein Dienstleister holt Daten für
 * mehrere eigene Kunden, und die sitzen in verschiedenen Ländern. Eine Angabe
 * für das ganze Haus läse die Dateien des einen Kunden nach der Regel des
 * anderen — und zwar stillschweigend, weil beide Lesarten gelingen.
 *
 * Zwei Angaben und nicht eine, weil sie zwei verschiedene Fragen beantworten
 * und in der Praxis auseinandergehen: Ein Kunde in Zürich, dessen Dateien
 * deutsch geschrieben sind, hat `de-DE` und `Europe/Zurich`.
 *
 * **Warum das überhaupt eingestellt wird.** Beim Konsolidieren werden Datums-
 * und Zeitangaben aus fremden Dateien gelesen, und die tragen ihre Bedeutung
 * meist nicht mit sich. `04/03/2026` ist der 4. März oder der 3. April — beide
 * Lesarten gelingen, keine meldet einen Fehler, und der Unterschied fällt
 * frühestens im Bericht des nächsten Monats auf. Ebenso `2026-04-03 14:00`:
 * ohne Zeitzone ist das eine Uhrzeit ohne Ort, und je nachdem, wo man sie
 * ansetzt, fällt sie auf einen anderen Tag.
 *
 * Geraten wird deshalb nichts. Die Installation sagt es einmal, und wer die
 * Angabe später ändert, ändert damit die Lesart aller künftigen Läufe — nicht
 * die der vergangenen.
 */

export type DateOrder = 'DAY_FIRST' | 'MONTH_FIRST' | 'YEAR_FIRST';

export interface Region {
  /** Sprache und Land nach BCP 47: `de-DE`, `en-US`, `fr-CH`. */
  locale: string;
  /** Zeitzone nach IANA: `Europe/Berlin`. Sommerzeit steckt darin. */
  timeZone: string;
}

/**
 * Was für einen Mandanten gilt, solange niemand etwas eingestellt hat.
 *
 * Deutsch und Berlin, weil das Erzeugnis dort entsteht und dort seine ersten
 * Kunden hat. Eine Voreinstellung „raten wir aus dem Betriebssystem" wäre
 * bequemer und schlechter: Sie änderte sich still, wenn der Dienst auf einen
 * anders eingerichteten Rechner umzieht.
 */
export const DEFAULT_REGION: Region = { locale: 'de-DE', timeZone: 'Europe/Berlin' };

/** Die Region dieses Mandanten, oder die Voreinstellung. */
export function regionOf(tenant: { region?: Region }): Region {
  return tenant.region ?? DEFAULT_REGION;
}

/**
 * Die Reihenfolge, in der diese Region ein Datum schreibt — abgelesen, nicht
 * abgeschrieben.
 *
 * Eine Tabelle „diese Länder schreiben den Tag zuerst" wäre beim ersten
 * ungewöhnlichen Land falsch und würde es niemandem sagen. Gefragt wird
 * stattdessen die Datumsformatierung selbst: Sie weiß es für jede Kennung, die
 * sie kennt, und sie ist dieselbe, die später beim Schreiben verwendet wird.
 */
export function dateOrderOf(locale: string): DateOrder {
  const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(Date.UTC(2026, 3, 3)));
  const erste = parts.find((part) => part.type === 'day' || part.type === 'month' || part.type === 'year');

  return erste?.type === 'day' ? 'DAY_FIRST' : erste?.type === 'month' ? 'MONTH_FIRST' : 'YEAR_FIRST';
}

/** Ein Beispieldatum in der Schreibweise dieser Region — für die Anzeige. */
export function sampleDate(region: Region): string {
  return new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone }).format(
    new Date(Date.UTC(2026, 3, 3, 12))
  );
}

/**
 * Nimmt die Angabe an oder lehnt sie ab — und lehnt vor allem ab, was still
 * ausweichen würde.
 *
 * Zwei Fälle, beide nachgemessen, beide gefährlich, weil sie *keinen* Fehler
 * werfen:
 *
 * — Eine Kennung, die niemand bedient (`xx-XX`), formatiert trotzdem. Sie
 *   weicht auf die Einstellung des Rechners aus. Dieselbe Installation läse
 *   damit auf einem deutschen Server den Tag zuerst und auf einem
 *   amerikanischen den Monat — dieselbe Datei, zwei Bedeutungen, nirgends eine
 *   Meldung.
 * — Eine Kennung mit Unicode-Erweiterung (`de-DE-u-ca-buddhist`) wird bedient
 *   und rechnet den Kalender um: Aus dem 3.4.2026 wird gemessen `3.4.2569 BE`.
 *   Ein solcher Zusatz kann auch die Ziffern austauschen. Beides gehört nicht
 *   in eine Angabe, die nur sagen soll, in welcher Reihenfolge ein Datum steht.
 */
export function assertRegionIsUsable(region: Region): void {
  const locale = region.locale.trim();
  const timeZone = region.timeZone.trim();

  if (locale === '' || timeZone === '') {
    throw new Error('Zur Region gehören eine Sprachkennung und eine Zeitzone.');
  }

  if (/-u-/i.test(locale)) {
    throw new Error(
      `„${locale}“ trägt einen Zusatz, der Kalender oder Ziffern austauscht. Erwartet wird nur Sprache und Land, ` +
        'etwa de-DE oder en-US.'
    );
  }

  let bedient: string[];

  try {
    bedient = Intl.DateTimeFormat.supportedLocalesOf([locale]);
  } catch {
    throw new Error(
      `„${locale}“ ist keine gültige Sprachkennung. Erwartet wird eine Angabe wie de-DE, en-US oder fr-CH.`
    );
  }

  if (bedient.length === 0) {
    throw new Error(
      `„${locale}“ ist zwar richtig geschrieben, wird von dieser Installation aber nicht bedient. Datumsangaben ` +
        'würden dann nach der Einstellung des Rechners gelesen statt nach der eingestellten Region — auf einem ' +
        'anderen Server also anders. Deshalb wird die Angabe abgelehnt.'
    );
  }

  try {
    new Intl.DateTimeFormat(locale, { timeZone }).format(new Date());
  } catch {
    throw new Error(`„${timeZone}“ ist keine bekannte Zeitzone. Erwartet wird eine Angabe wie Europe/Berlin.`);
  }
}
