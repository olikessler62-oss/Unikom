import fs from 'node:fs/promises';
import path from 'node:path';

import type { Dateiablage, Verzeichniseintrag } from '../../application/workflow/Dateiablage.js';

/**
 * Das Dateisystem, wie es wirklich ist.
 *
 * Unterverzeichnisse werden übergangen und nicht durchsucht: Ein
 * Konsolidierungslauf, der sich durch einen Ordnerbaum gräbt, nimmt irgendwann
 * das Archiv des Vorjahres mit — und niemand sieht dem Ergebnis an, dass es
 * doppelt so viele Datensätze enthält, wie es sollte.
 */
export class NodeDateiablage implements Dateiablage {
  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    const eintraege = await fs.readdir(verzeichnis, { withFileTypes: true });
    const gefunden: Verzeichniseintrag[] = [];

    for (const eintrag of eintraege) {
      if (!eintrag.isFile()) {
        continue;
      }

      const angaben = await fs.stat(path.join(verzeichnis, eintrag.name));

      gefunden.push({
        name: eintrag.name,
        geaendert: angaben.mtime.toISOString(),
        groesse: angaben.size,
      });
    }

    // Nach Namen, damit zwei Läufe über dieselben Dateien dieselbe Reihenfolge
    // haben. Die Reihenfolge der Quellen entscheidet bei gleichrangigen Werten
    // mit — ein Ergebnis, das von der Laune des Dateisystems abhängt, ließe
    // sich nicht wiederholen.
    return gefunden.sort((links, rechts) => links.name.localeCompare(rechts.name, 'de'));
  }

  async lies(pfad: string): Promise<Uint8Array> {
    return fs.readFile(pfad);
  }

  async schreibe(pfad: string, inhalt: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(pfad), { recursive: true });
    await fs.writeFile(pfad, inhalt);
  }

  async entferne(pfad: string): Promise<void> {
    // Was schon fort ist, ist fort. Ein zweiter Aufruf soll nicht scheitern.
    await fs.rm(pfad, { force: true });
  }

  pfad(verzeichnis: string, name: string): string {
    return path.join(verzeichnis, name);
  }
}
