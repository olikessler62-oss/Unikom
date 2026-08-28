import type { Spaltenvorgabe, Strukturvorgabe } from '../discovery/Expectation.js';

/**
 * Wie eine Spalte heißt, die sich nicht selbst benennt — und was das Schema
 * dagegen tun kann.
 *
 * ## Der Fall
 *
 * ```text
 * 4711;Meier;Bonn        eine reine Textdatei, ohne Kopfzeile
 *   ↓
 * Spalte 1;Spalte 2;Spalte 3
 * ```
 *
 * Das ist nicht falsch, aber es ist auch keine Auskunft. Und es hat eine Folge,
 * die niemand sieht: Die Qualitätsregeln eines Schemas „binden über den
 * **Feldnamen** an die Spalten der Vorgabe" (siehe `Profil`). Eine Regel für
 * `kdnr` findet in dieser Datei kein `kdnr` — sie prüft nichts, und die
 * Lieferung läuft durch, als wäre alles in Ordnung.
 *
 * Das Schema weiß, wie die Spalten heißen. Es steht in seiner Strukturvorgabe,
 * Stelle für Stelle. Es hat nur nie jemand danach gefragt.
 *
 * ## Was das Schema benennen darf
 *
 * **Nur, was die Datei selbst nicht benannt hat.** Wo eine Kopfzeile steht,
 * bleibt sie stehen — auch wenn das Schema etwas anderes sagt. Ein Programm,
 * das gelieferte Spaltennamen überschreibt, entscheidet über die Bedeutung von
 * Daten, die es nicht kennt: Kämen die Spalten eines Tages in anderer
 * Reihenfolge, hieße die dritte weiterhin „ort", und darin stünde der Umsatz.
 *
 * Widersprechen sich beide, steht das im Protokoll. Es ist der Fall, in dem
 * eine Regel stillschweigend nichts prüft, und deshalb gehört er dorthin, wo
 * man ihn liest.
 */

/** Der Name einer Spalte, die keinen hat — an genau einer Stelle gebildet. */
export function ersatzname(stelle: number): string {
  return `Spalte ${stelle + 1}`;
}

/**
 * Ob dieser Name der Ersatz für einen fehlenden ist.
 *
 * An der Stelle gemessen und nicht am Muster: „Spalte 7" ist an Position 7 ein
 * Platzhalter und an Position 2 ein Spaltenname, den jemand tatsächlich so
 * geliefert hat. Der Unterschied ist selten und real — und wer ihn übergeht,
 * benennt eine Spalte um, die schon einen Namen hatte.
 */
export function istErsatzname(name: string, stelle: number): boolean {
  return name === ersatzname(stelle);
}

export interface Benennung {
  felder: string[];
  /**
   * Ob die erste Zeile die Kopfzeile ist, die niemand erkannt hat.
   *
   * Besteht eine Datei nur aus Text, lässt sich nicht entscheiden, ob die erste
   * Zeile Überschriften trägt oder Daten — beides sieht gleich aus. Sie läuft
   * dann als Datensatz mit, und im Ergebnis steht eine Zeile, in der unter
   * „kdnr" das Wort „kdnr" steht.
   *
   * Das Schema entscheidet es: Steht dort dasselbe, was es als Spaltennamen
   * führt, ist es die Kopfzeile. Ein Datensatz, der zufällig genau die
   * Spaltennamen in genau ihrer Reihenfolge enthält, kommt nicht vor.
   */
  kopfzeile: boolean;
  hinweise: string[];
}

/**
 * Setzt die Namen des Schemas ein, wo die Datei keine mitgebracht hat.
 *
 * Ohne Vorgabe oder ohne Spaltenangaben bleibt alles, wie es ist — das ist der
 * Regelfall und keine Auffälligkeit.
 *
 * `ersteZeile` ist die erste **gelesene** Zeile. Hat der Leser eine Kopfzeile
 * erkannt, ist das bereits ein Datensatz und stimmt mit den Spaltennamen nicht
 * überein; die Frage beantwortet sich dann von selbst.
 */
export function benenneNach(
  felder: readonly string[],
  ersteZeile: readonly string[] | undefined,
  vorgabe: Strukturvorgabe | undefined
): Benennung {
  const spalten = vorgabe?.spalten ?? [];

  if (spalten.length === 0) {
    return { felder: [...felder], kopfzeile: false, hinweise: [] };
  }

  const benannt = [...felder];
  const uebernommen: string[] = [];
  const hinweise: string[] = [];

  for (const spalte of spalten) {
    const stelle = spalte.position - 1;
    const name = spalte.name?.trim();

    if (!name || stelle < 0 || stelle >= benannt.length) {
      continue;
    }

    if (istErsatzname(benannt[stelle], stelle)) {
      benannt[stelle] = name;
      uebernommen.push(name);
      continue;
    }

    if (benannt[stelle] !== name) {
      /*
       * Beide haben einen Namen, und es ist nicht derselbe. Die Datei behält
       * ihren — aber eine Regel für „${name}" prüft hier nichts, und das ist
       * genau die Art Fehlschlag, die man an einem Ergebnis nicht sieht.
       */
      hinweise.push(
        `Das Schema nennt Spalte ${spalte.position} „${name}", die Datei nennt sie „${benannt[stelle]}". ` +
          `Es gilt der Name aus der Datei - eine Regel für „${name}" greift hier nicht`
      );
    }
  }

  if (uebernommen.length > 0) {
    hinweise.unshift(
      `${uebernommen.length} Spalte(n) ohne Kopfzeile wurden aus dem Schema benannt: ${uebernommen.join(', ')}`
    );
  }

  const kopfzeile = uebernommen.length > 0 && istKopfzeile(ersteZeile, spalten);

  if (kopfzeile) {
    hinweise.push(
      'Die erste Zeile trägt genau diese Namen und ist damit die Kopfzeile. ' +
        'Sie wird nicht als Datensatz verarbeitet'
    );
  }

  return { felder: benannt, kopfzeile, hinweise };
}

/**
 * Ob diese Zeile die Spaltennamen des Schemas trägt.
 *
 * Verglichen wird ohne Rücksicht auf Großschreibung und Leerraum: Wer eine
 * Kopfzeile von Hand tippt, schreibt „KdNr" und meint „kdnr".
 *
 * **Jede** benannte Spalte muss stimmen. Eine von dreien reichte nicht — dann
 * stünde in der zweiten Spalte ein Datenwert, und die Zeile wäre ein Datensatz,
 * den man wegen einer Übereinstimmung fortwirft.
 */
function istKopfzeile(zeile: readonly string[] | undefined, spalten: readonly Spaltenvorgabe[]): boolean {
  if (!zeile) {
    return false;
  }

  const benannte = spalten.filter((spalte) => (spalte.name ?? '').trim() !== '');

  if (benannte.length === 0) {
    return false;
  }

  return benannte.every((spalte) => {
    const wert = zeile[spalte.position - 1];

    return wert !== undefined && gleich(wert, spalte.name as string);
  });
}

function gleich(eines: string, anderes: string): boolean {
  return eines.trim().toLocaleLowerCase('de-DE') === anderes.trim().toLocaleLowerCase('de-DE');
}
