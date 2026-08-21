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

  async verschiebe(von: string, nach: string): Promise<void> {
    await fs.mkdir(path.dirname(nach), { recursive: true });

    /*
     * Ein belegter Name wird nicht überschrieben, sondern ergänzt: `_2`, `_3`.
     * Im Verzeichnis „Gescheitert" landet über Wochen dieselbe Datei aus
     * derselben Quelle, und die Fassung von gestern ist genau die, die man
     * ansehen will, wenn heute wieder etwas schiefgeht.
     */
    let ziel = nach;

    for (let zaehler = 2; await liegtDa(ziel); zaehler += 1) {
      const endung = path.extname(nach);
      ziel = path.join(path.dirname(nach), path.basename(nach, endung) + '_' + zaehler + endung);
    }

    try {
      await fs.rename(von, ziel);
    } catch (fehler) {
      /*
       * Über Laufwerksgrenzen kann Windows nicht umbenennen (EXDEV). Dann
       * kopieren und löschen — in dieser Reihenfolge: Bricht es dazwischen ab,
       * liegt die Datei zweimal da und nicht keinmal.
       */
      if ((fehler as { code?: string }).code !== 'EXDEV') {
        throw fehler;
      }

      await fs.copyFile(von, ziel);
      await fs.rm(von, { force: true });
    }
  }

  pfad(verzeichnis: string, name: string): string {
    return path.join(verzeichnis, name);
  }
}

/** Ob dort schon etwas liegt. */
async function liegtDa(pfad: string): Promise<boolean> {
  try {
    await fs.stat(pfad);
    return true;
  } catch {
    return false;
  }
}
