import type { Datensatz } from './Quellen.js';
import { STANDARDVERGLEICH, TRENNER, vergleichswert, type Vergleich } from './Schluessel.js';

/**
 * Fehlende Werte aus vergleichbaren Datensätzen ergänzen (SPEC-08, Abschnitt 5).
 *
 * ```text
 * Kundennummer  Ort       PLZ
 * 4711          Bonn      53111
 * 4711          Bonn      53111
 * 4711          (leer)    53111     ←  wird zu „Bonn"
 * 4712          Köln      50667
 * 4712          Koeln     50667
 * 4712          (leer)    50667     ←  bleibt leer: die Vergleichbaren
 *                                      schreiben es verschieden
 * ```
 *
 * „Ist ein relevanter Wert bei vergleichbaren Datensätzen konsistent vorhanden
 * und lässt sich seine Übernahme eindeutig begründen, darf UniCom den fehlenden
 * Wert automatisch ergänzen." Die zweite Zeile des Beispiels zeigt, wo das
 * aufhört: **konsistent** heißt einig, nicht mehrheitlich.
 *
 * ## Warum mindestens zwei
 *
 * Ein einziger vergleichbarer Datensatz ist keine Konsistenz, sondern ein
 * Einzelfall. Er würde jeden Tippfehler in der Nachbarzeile zur Regel für die
 * eigene machen. Die Untergrenze ist einstellbar, aber nicht unter zwei.
 *
 * ## Was hier nicht geschieht
 *
 * Der Wert wird nicht erraten und nicht aus dem Feldnamen abgeleitet. Es gibt
 * genau eine Quelle für die Ergänzung: andere Datensätze desselben Laufs, die
 * in den vereinbarten Feldern übereinstimmen. Alles Weitere — Referenzdaten,
 * historische Stände — hat seinen eigenen Ort und seine eigene Begründung.
 */
export interface Ergaenzungsregel {
  /** Woran sich „vergleichbar" bemisst. */
  vergleichbarAn: readonly string[];
  /** Welche Felder ergänzt werden dürfen. */
  felder: readonly string[];
  /** Wie viele vergleichbare Datensätze den Wert mindestens tragen müssen. */
  mindestens?: number;
  vergleich?: Vergleich;
}

/** Unter zwei vergleichbaren Datensätzen ist es kein Muster, sondern ein Zufall. */
export const MINDESTENS = 2;

export interface Ergaenzt {
  /** Die Stelle des Datensatzes in der übergebenen Liste, ab 1. */
  stelle: number;
  quelle: string;
  zeile: number;
  feld: string;
  wert: string;
  /** Wie viele vergleichbare Datensätze den Wert tragen. */
  belege: number;
  begruendung: string;
}

export interface Ergaenzungsluecke {
  stelle: number;
  quelle: string;
  zeile: number;
  feld: string;
  begruendung: string;
  /** Was die vergleichbaren Datensätze sagten — verschiedene Werte. */
  werte: string[];
}

export interface Ergaenzungsergebnis {
  /** Die Datensätze mit den ergänzten Werten; die übergebenen bleiben unberührt. */
  datensaetze: Datensatz[];
  ergaenzungen: Ergaenzt[];
  /** Wo nicht ergänzt wurde, obwohl etwas fehlte — Prüffälle. */
  luecken: Ergaenzungsluecke[];
}

function vergleichsschluessel(
  datensatz: Datensatz,
  felder: readonly string[],
  vergleich: Vergleich
): string | undefined {
  const teile: string[] = [];

  for (const feld of felder) {
    const wert = datensatz.werte.get(feld) ?? '';

    if (wert.trim() === '') {
      // Ohne vollständige Vergleichsmerkmale ist der Datensatz mit niemandem
      // vergleichbar. Er nimmt an der Ergänzung weder gebend noch nehmend teil.
      return undefined;
    }

    teile.push(vergleichswert(wert, vergleich));
  }

  return teile.join(TRENNER);
}

export function ergaenze(datensaetze: readonly Datensatz[], regel: Ergaenzungsregel): Ergaenzungsergebnis {
  const vergleich = regel.vergleich ?? STANDARDVERGLEICH;
  const mindestens = Math.max(regel.mindestens ?? MINDESTENS, MINDESTENS);
  const gruppen = new Map<string, number[]>();

  datensaetze.forEach((datensatz, stelle) => {
    const schluessel = vergleichsschluessel(datensatz, regel.vergleichbarAn, vergleich);

    if (schluessel !== undefined) {
      gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), stelle]);
    }
  });

  const ergaenzungen: Ergaenzt[] = [];
  const luecken: Ergaenzungsluecke[] = [];

  /*
   * Es wird auf eine Kopie geschrieben. Die Eingangsdatensätze bleiben, wie sie
   * waren — sonst hinge das Ergebnis davon ab, in welcher Reihenfolge die
   * Ergänzung durch die Liste läuft, und ein ergänzter Wert würde selbst zum
   * Beleg für den nächsten.
   */
  const kopien = datensaetze.map((datensatz) => ({ ...datensatz, werte: new Map(datensatz.werte) }));

  datensaetze.forEach((datensatz, stelle) => {
    const schluessel = vergleichsschluessel(datensatz, regel.vergleichbarAn, vergleich);

    if (schluessel === undefined) {
      return;
    }

    const vergleichbare = (gruppen.get(schluessel) ?? []).filter((andere) => andere !== stelle);

    for (const feld of regel.felder) {
      if ((datensatz.werte.get(feld) ?? '').trim() !== '') {
        continue;
      }

      const belege = vergleichbare
        .map((andere) => datensaetze[andere].werte.get(feld) ?? '')
        .filter((wert) => wert.trim() !== '');

      if (belege.length === 0) {
        continue;
      }

      const verschiedene = [...new Set(belege.map((wert) => vergleichswert(wert, vergleich)))];
      const merkmale = regel.vergleichbarAn.map((name) => `${name} = „${datensatz.werte.get(name)}"`).join(', ');

      if (verschiedene.length > 1) {
        luecken.push({
          stelle: stelle + 1,
          quelle: datensatz.quelle,
          zeile: datensatz.zeile,
          feld,
          werte: [...new Set(belege)],
          begruendung:
            `„${feld}" fehlt. Die vergleichbaren Datensätze (${merkmale}) tragen dafür ` +
            `${verschiedene.length} verschiedene Werte: ${[...new Set(belege)].map((wert) => `„${wert}"`).join(', ')}. ` +
            'Einen davon zu nehmen wäre eine willkürliche Auswahl',
        });
        continue;
      }

      if (belege.length < mindestens) {
        luecken.push({
          stelle: stelle + 1,
          quelle: datensatz.quelle,
          zeile: datensatz.zeile,
          feld,
          werte: [...new Set(belege)],
          begruendung:
            `„${feld}" fehlt. Nur ${belege.length} vergleichbarer Datensatz (${merkmale}) trägt „${belege[0]}" — ` +
            `ergänzt wird ab ${mindestens}. Ein Einzelfall ist keine Konsistenz`,
        });
        continue;
      }

      kopien[stelle].werte.set(feld, belege[0]);
      ergaenzungen.push({
        stelle: stelle + 1,
        quelle: datensatz.quelle,
        zeile: datensatz.zeile,
        feld,
        wert: belege[0],
        belege: belege.length,
        begruendung:
          `„${feld}" war leer. Alle ${belege.length} vergleichbaren Datensätze (${merkmale}) tragen ` +
          `denselben Wert „${belege[0]}"`,
      });
    }
  });

  return { datensaetze: kopien, ergaenzungen, luecken };
}
