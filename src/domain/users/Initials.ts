/**
 * Das dreistellige Kürzel eines Benutzers.
 *
 * Die Regel: erster Buchstabe des Vornamens, erster Buchstabe des Nachnamens,
 * letzter Buchstabe des Nachnamens — „Anna Berger" wird zu ABR. Ist das Kürzel
 * schon vergeben, wandert die dritte Stelle durch die weiteren Buchstaben des
 * Vornamens und danach durch die des Nachnamens, bis eines frei ist.
 *
 * Die ersten beiden Stellen bleiben dabei stehen. Sie tragen die Wiedererkennung
 * — wer ABR liest, denkt an Anna Berger —, und ein Kürzel, das sich an der
 * ersten Stelle unterscheidet, gehört gefühlt zu einem anderen Menschen.
 */
export const INITIALS_LENGTH = 3;

/** Reihenfolge mit Bedacht: 0 und 1 sehen im Kürzel aus wie O und I. */
const DIGITS = '23456789';

/**
 * Nur Grundbuchstaben. Umlaute fallen auf ihren Grundbuchstaben zurück, ß auf
 * S: ein Kürzel steht später in Dateinamen und Tabellenspalten, und dort ist
 * „MÜL" nicht überall dieselbe Folge von Zeichen wie hier.
 */
function letters(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Alle Kürzel, die für diesen Namen in Frage kommen — das nach der Regel
 * gebildete zuerst, danach die Ausweichmöglichkeiten in der Reihenfolge, in der
 * sie vergeben werden.
 *
 * Leer nur dann, wenn der Name keinen einzigen Buchstaben enthält.
 */
export function initialsCandidates(firstName: string, lastName: string): string[] {
  const first = letters(firstName);
  const last = letters(lastName);

  if (!first && !last) {
    return [];
  }

  // Fehlt eine Hälfte des Namens, rückt die andere nach. Das trifft Konten aus
  // der Zeit vor diesen Feldern, nicht neu angelegte: dort sind beide Pflicht.
  const one = first[0] ?? last[0];
  const two = last[0] ?? first[1] ?? first[0];
  const tail = (last || first).at(-1) as string;

  const thirds = [tail, ...first.slice(1), ...last.slice(1), ...DIGITS];
  const candidates: string[] = [];

  for (const third of thirds) {
    const candidate = `${one}${two}${third}`;

    // Doppelte Buchstaben im Namen ergeben dasselbe Kürzel zweimal; ein zweites
    // Mal anzubieten hilft niemandem.
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Das freie Kürzel für diesen Namen.
 *
 * `taken` sind die Kürzel aller **anderen** Benutzer. `keep` ist das bisherige
 * Kürzel dieses Benutzers: passt es noch zum Namen, bleibt es stehen. Sonst
 * bekäme jemand, der nur seinen Vornamen von „Anna" auf „Anne" berichtigt, ein
 * neues Kürzel — und Kürzel sind dazu da, dass man sie wiedererkennt.
 */
export function chooseInitials(
  name: { firstName: string; lastName: string },
  taken: Iterable<string>,
  keep?: string
): string {
  const vergeben = new Set([...taken].map((entry) => entry.toUpperCase()));
  const candidates = initialsCandidates(name.firstName, name.lastName);

  if (candidates.length === 0) {
    throw new Error('Aus diesem Namen lässt sich kein Kürzel bilden - er enthält keinen einzigen Buchstaben');
  }

  const bisher = keep?.toUpperCase();

  if (bisher && candidates.includes(bisher) && !vergeben.has(bisher)) {
    return bisher;
  }

  const frei = candidates.find((candidate) => !vergeben.has(candidate));

  if (!frei) {
    throw new Error(
      `Für „${name.firstName} ${name.lastName}" ist kein dreistelliges Kürzel mehr frei. ` +
        'Bitte den Namen anders schreiben oder einen bestehenden Benutzer entfernen'
    );
  }

  return frei;
}
