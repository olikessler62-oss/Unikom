/**
 * Der Arbeitsname, unter dem eine Datei auf einem entfernten Ziel entsteht.
 *
 * Hochgeladen wird nie unter dem endgültigen Namen. Wer sein
 * Eingangsverzeichnis abfragt — und das tun Empfänger im Sekundentakt —, soll
 * nie eine Datei zu fassen bekommen, von der erst die Hälfte da ist. Erst wenn
 * alle Bytes liegen, wird umbenannt.
 *
 * **Die Lauf-Kennung gehört in den Namen.** Ohne sie hinge der Arbeitsname
 * allein am Zielpfad, und zwei Workflows, die eine gleichnamige Datei in
 * dasselbe Verzeichnis legen, schrieben gleichzeitig in dieselbe Arbeitsdatei.
 * Der erste, der fertig wird, benennt einen Mischmasch aus beiden in den
 * echten Namen um — und meldet Erfolg. Lokal gibt es das nicht: dort hat jeder
 * Lauf seinen eigenen Arbeitsbereich. Dieser gemeinsame Namensraum entsteht
 * erst mit dem entfernten Ziel, und er muss hier wieder getrennt werden.
 *
 * Der Nebennutzen: Einer liegengebliebenen Datei sieht man an, aus welchem
 * Lauf sie stammt. Dieselbe Kennung steht im Protokoll.
 */

export const WORK_FILE_SUFFIX = '.unikom-part';

/**
 * Wie lange eine liegengebliebene Arbeitsdatei stehen bleibt, bevor der
 * nächste Lauf sie wegräumt.
 *
 * Die Frist muss länger sein als die längste glaubhafte Übertragung einer
 * einzelnen Datei, sonst nähme ein Lauf einem anderen die Arbeitsdatei unter
 * den Händen weg. Ein Tag ist auch für einige Gigabyte über eine schmale
 * Leitung reichlich; was länger braucht, hat ein anderes Problem.
 */
export const STALE_WORK_FILE_AGE_MS = 24 * 60 * 60 * 1000;

export function workFilePath(targetPath: string, runId: string): string {
  return `${targetPath}.${runId}${WORK_FILE_SUFFIX}`;
}

export function isWorkFile(name: string): boolean {
  return name.endsWith(WORK_FILE_SUFFIX);
}

/**
 * Ob diese Arbeitsdatei weggeräumt werden darf.
 *
 * Ohne Änderungszeit lautet die Antwort nein. Ein Server, der keine nennt, ist
 * kein Grund, fremde Dateien zu löschen — ein Rückstand kostet Platz, eine
 * falsch gelöschte Datei kostet eine Lieferung.
 */
export function isStaleWorkFile(name: string, modifiedAt: Date | undefined, now: Date): boolean {
  if (!isWorkFile(name) || !modifiedAt) {
    return false;
  }

  return now.getTime() - modifiedAt.getTime() > STALE_WORK_FILE_AGE_MS;
}
