import type { Dateiablage } from './Dateiablage.js';
import { istLesbar } from './Eingang.js';

/**
 * Welche Datei eine Vorschau zeigt — für alle Vorschauen dieselbe.
 *
 * Es gibt zwei Vorschauen auf dieselbe Eingangsdatei: was mit den **Werten**
 * geschieht (`Umformungsvorschau`) und welchem internen Feld eine **Spalte**
 * entspricht (`Zuordnungsvorschau`). Zeigten sie verschiedene Dateien, wäre die
 * eine die Antwort auf eine Frage, die die andere nicht gestellt hat — und
 * niemand käme darauf, dass es daran liegt.
 */
export class VorschauFehler extends Error {}

export interface Dateiwunsch {
  verzeichnis: string;
  /** Der Dateiname; ohne Angabe die erste lesbare Datei des Verzeichnisses. */
  datei?: string;
}

export interface Vorschaudatei {
  name: string;
  pfad: string;
  geaendert?: string;
}

/**
 * Ohne Angabe die erste lesbare Datei.
 *
 * Sie ist die, die der Lauf auch als erste nähme. Eine Vorschau, die erst nach
 * einer Auswahl etwas zeigt, wird nicht geöffnet.
 */
export async function waehleVorschaudatei(ablage: Dateiablage, wunsch: Dateiwunsch): Promise<Vorschaudatei> {
  const eintraege = (await ablage.liste(wunsch.verzeichnis)).filter((eintrag) => istLesbar(eintrag.name));

  if (eintraege.length === 0) {
    throw new VorschauFehler(
      `In „${wunsch.verzeichnis}" liegt keine Datei, die Unikom lesen kann. Gelesen werden CSV, TXT, ` +
        'JSON, XML und XLSX'
    );
  }

  const gewaehlt = wunsch.datei ? eintraege.find((eintrag) => eintrag.name === wunsch.datei) : eintraege[0];

  if (!gewaehlt) {
    throw new VorschauFehler(`„${wunsch.datei}" liegt nicht in „${wunsch.verzeichnis}"`);
  }

  return {
    name: gewaehlt.name,
    pfad: ablage.pfad(wunsch.verzeichnis, gewaehlt.name),
    geaendert: gewaehlt.geaendert,
  };
}
