/**
 * Die Regionen zur Auswahl und die Zeitzonen dazu.
 *
 * Eine Auswahl und kein Textfeld: Eine falsch getippte Kennung lehnt der Server
 * ab, eine wohlgeformte falsche — `en-US` statt `en-GB` — nicht. Und die liest
 * jedes Datum verkehrt herum, ohne dass irgendwo ein Fehler entsteht.
 *
 * ## Die Liste steht nicht hier, sondern kommt aus dem System
 *
 * Hier standen einmal achtzehn Länder, alle aus Europa. Ein Kunde mit einer
 * Lieferung aus Brasilien oder Japan war damit nicht einzustellen — und wer
 * seine Kennung von Hand nachtrug, hatte keine Rückmeldung, ob sie stimmt.
 *
 * Jetzt fragt die Liste dieselbe Datenbank, aus der auch die Datumsformate
 * kommen: `Intl.DisplayNames` kennt jede Region, die der Browser kennt, und
 * `Intl.Locale.maximize` sagt, welche Sprache dort üblich ist. Eine gepflegte
 * Liste wäre nach dem nächsten Staat, der sich umbenennt, die veraltete.
 *
 * Die Liste bleibt eine Abkürzung, keine Schranke: Was am Mandanten steht,
 * kommt mit in die Auswahl, auch wenn es hier nicht aufgeführt ist.
 */

/**
 * Was keine Region ist, auch wenn das System einen Namen dafür kennt.
 *
 * Zusammenschlüsse und Platzhalter — „Europäische Union", „Eurozone",
 * „Unbekannte Region", die beiden Pseudo-Sprachen zum Testen. Sie ergeben keine
 * Kennung, nach der sich ein Datum lesen ließe.
 */
const KEINE_REGION = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']);

/**
 * Wo ein Land mehr als eine gebräuchliche Sprache hat.
 *
 * `maximize` nennt nur die häufigste — für die Schweiz also Deutsch. Wer aus
 * Genf liefert, schreibt Zahlen aber anders als Zürich (`1 234,56` gegen
 * `1’234.56`), und beim Lesen entscheidet das über den Betrag.
 *
 * Kurz gehalten: nur, wo die zweite Sprache verbreitet ist **und** sich Zahlen
 * oder Datum davon unterscheiden.
 */
const WEITERE_SPRACHEN: readonly string[] = [
  'fr-CH',
  'it-CH',
  'fr-BE',
  'fr-CA',
  'en-CA',
  'es-US',
  'en-IN',
  'fr-LU',
  'af-ZA',
  'zh-HK',
  'en-SG',
  'fr-MA',
];

/**
 * Wenn das System nichts hergibt.
 *
 * Zwei Einträge und nicht zwanzig: Eine zweite Liste, die nur im Notfall greift,
 * merkt niemand, wenn sie veraltet — und dann steht dort etwas Falsches statt
 * gar nichts. Was am Mandanten hinterlegt ist, bleibt ohnehin wählbar.
 */
const NOTNAGEL: { value: string; label: string }[] = [
  { value: 'de-DE', label: 'Deutschland (de-DE)' },
  { value: 'en-US', label: 'Vereinigte Staaten (en-US)' },
];

function anzeiger(art: 'region' | 'language'): Intl.DisplayNames | undefined {
  try {
    return new Intl.DisplayNames(['de'], { type: art });
  } catch {
    return undefined;
  }
}

/**
 * Jede Region, die das System benennen kann.
 *
 * Alle zweibuchstabigen Kombinationen durchgehen und behalten, was einen Namen
 * bekommt: Für einen unbekannten Code gibt `of` den Code selbst zurück. 676
 * Versuche beim Laden — das kostet nichts und erspart eine Liste von 280
 * Einträgen, die jemand pflegen müsste.
 */
function regionen(laender: Intl.DisplayNames): string[] {
  const gefunden: string[] = [];

  for (let erster = 65; erster <= 90; erster += 1) {
    for (let zweiter = 65; zweiter <= 90; zweiter += 1) {
      const code = String.fromCharCode(erster) + String.fromCharCode(zweiter);

      if (KEINE_REGION.has(code)) {
        continue;
      }

      try {
        if (laender.of(code) !== code) {
          gefunden.push(code);
        }
      } catch {
        // Ein Code, den das System nicht einmal als Form annimmt, ist keiner.
      }
    }
  }

  return gefunden;
}

/** Die dort übliche Sprache — aus derselben Datenbank wie die Datumsformate. */
function hauptsprache(code: string): string | undefined {
  try {
    const sprache = new Intl.Locale(`und-${code}`).maximize().language;

    return sprache && sprache !== 'und' ? sprache : undefined;
  } catch {
    return undefined;
  }
}

function baueLocales(): { value: string; label: string }[] {
  const laender = anzeiger('region');
  const sprachen = anzeiger('language');

  if (!laender || !sprachen) {
    return NOTNAGEL;
  }

  /* Landescode → seine Kennungen. Meist eine, in mehrsprachigen Ländern zwei. */
  const kennungen = new Map<string, string[]>();

  for (const code of regionen(laender)) {
    const sprache = hauptsprache(code);

    if (sprache) {
      kennungen.set(code, [`${sprache}-${code}`]);
    }
  }

  for (const kennung of WEITERE_SPRACHEN) {
    const code = kennung.slice(kennung.indexOf('-') + 1);
    const vorhanden = kennungen.get(code);

    /*
     * Nur ergänzen, nie anlegen: Ein Eintrag für ein Land, das das System nicht
     * kennt, stünde ohne Namen in der Liste.
     */
    if (vorhanden && !vorhanden.includes(kennung)) {
      vorhanden.push(kennung);
    }
  }

  const liste = [...kennungen].flatMap(([code, alle]) =>
    alle.map((value) => ({
      value,
      /*
       * Die Sprache steht nur dabei, wo sie unterscheidet. „Japan, Japanisch"
       * wäre eine Angabe, die nichts trennt — und in einer Liste mit
       * zweihundert Einträgen ist jedes überflüssige Wort eines zu viel.
       */
      label:
        alle.length > 1
          ? `${laender.of(code)}, ${sprachen.of(value.slice(0, value.indexOf('-')))} (${value})`
          : `${laender.of(code)} (${value})`,
    }))
  );

  return liste.sort((eine, andere) => eine.label.localeCompare(andere.label, 'de'));
}

/**
 * Einmal gebaut und danach gehalten.
 *
 * 676 Aufrufe von `of` sind schnell, aber nicht umsonst — und dieser Bildschirm
 * baut seine Auswahl bei jedem Tastendruck im Namensfeld neu auf.
 */
export const LOCALES: { value: string; label: string }[] = baueLocales();

/** Die Zeitzonen kennt der Browser selbst — dieselbe Liste, die der Server prüft. */
export function timeZones(): string[] {
  const alle = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return alle.length > 0 ? alle : ['Europe/Berlin', 'UTC'];
}

export const DATE_ORDER_LABELS: Record<'DAY_FIRST' | 'MONTH_FIRST' | 'YEAR_FIRST', string> = {
  DAY_FIRST: 'Tag zuerst',
  MONTH_FIRST: 'Monat zuerst',
  YEAR_FIRST: 'Jahr zuerst',
};

/**
 * Wie dieser Mandant den 3. April 2026 schreibt — im Browser gerechnet, aber
 * nur für die Vorschau *während* der Auswahl.
 *
 * Was gilt, sagt der Server: `dateSample` am Mandanten kommt aus derselben
 * Datumsformatierung, die der Lauf benutzt. Hier geht es um die Angabe, die
 * noch nicht gespeichert ist — dafür gibt es keine Antwort vom Server, und ein
 * Feld, das seine Wirkung erst nach dem Speichern zeigt, ist eine Zumutung.
 */
export function previewOf(locale: string, timeZone: string): { sample: string; order: string } {
  try {
    const sample = new Intl.DateTimeFormat(locale, { timeZone }).format(new Date(Date.UTC(2026, 3, 3, 12)));
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(Date.UTC(2026, 3, 3)));
    const erste = parts.find((part) => part.type === 'day' || part.type === 'month' || part.type === 'year');
    const order =
      erste?.type === 'day' ? 'DAY_FIRST' : erste?.type === 'month' ? 'MONTH_FIRST' : 'YEAR_FIRST';

    return { sample, order: DATE_ORDER_LABELS[order] };
  } catch {
    return { sample: '-', order: 'unbekannt' };
  }
}
