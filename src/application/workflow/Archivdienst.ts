import type { Dateiablage } from './Dateiablage.js';
import { encryptBytes } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { packe, type Archiveintrag } from '../../infrastructure/formats/ZipSchreiben.js';

/**
 * Das Archiv der Eingangsdateien (SPEC-06; FR_006, Runde 8).
 *
 * ## Warum es das gibt
 *
 * Der Lauf nimmt die Lieferung aus dem Abholverzeichnis heraus, teilt sie
 * unterwegs auf und legt am Ende abgeleitete Dateien nach „Erledigt" und
 * „Gescheitert". Das ist nur zu verantworten, solange das **Original**
 * irgendwo unverändert liegt: Wer in drei Wochen fragt, was der Lieferant
 * eigentlich geschickt hat, bekommt sonst die Antwort „das, was wir daraus
 * gemacht haben".
 *
 * Das Archiv ist diese Antwort. Es entsteht, **bevor** eine Datei angefasst
 * wird, und es enthält die Bytes, wie sie ankamen.
 *
 * ## Ein Paket je Lauf, nicht je Datei
 *
 * Ein Stapel gehört zusammen — drei Filialdateien desselben Tages sind eine
 * Lieferung. Einzeln abgelegt ließe sich später nicht mehr sagen, welche
 * zusammengehörten, und genau danach sucht, wer einen Fehler nachvollzieht.
 *
 * ## Verschlüsselt, weil es Kundendaten sind
 *
 * Ein Archiv ist per Bauart ein Ort, an dem Daten lange liegen. Im Klartext
 * wäre es der leichteste Zugriff auf jeden Bestand, den dieser Kunde je
 * geliefert bekommen hat — bequemer als die Quelle selbst, weil alles an einer
 * Stelle steht.
 *
 * Der Schlüssel ist der **Hauptschlüssel dieser Installation** und nicht einer
 * je Ziel. Ein Ziel bekommt einen eigenen, weil der Empfänger die Datei öffnen
 * können muss; das Archiv soll niemand öffnen können außer dem Betreiber
 * selbst.
 *
 * ## Wenn es nicht klappt, wird nicht verarbeitet
 *
 * Das ist der Zweck der Übung. Ein Lauf, der die Lieferung zerlegt und das
 * Original nicht sichern konnte, hätte die Zusage gebrochen, die das Zerlegen
 * überhaupt erlaubt — und niemand sähe es, weil das Ergebnis vollständig
 * aussieht.
 */
export interface Archivauftrag {
  /** Woher die Dateien kommen — meist das Abholverzeichnis. */
  verzeichnis: string;
  namen: readonly string[];
  /** Wohin das Paket geht. */
  archiv: string;
  /** Wie das Paket heißt, ohne Endung. */
  benennung: string;
  jetzt: Date;
}

/** Die Endung: erst das Paket, dann der Umschlag — beides steht dran. */
export const ARCHIVENDUNG = '.zip.enc';

export class Archivdienst {
  constructor(
    private readonly ablage: Dateiablage,
    /**
     * Der Hauptschlüssel als Base64.
     *
     * Als Funktion und nicht als Wert: Ein Schlüssel, der in einem langlebigen
     * Objekt liegt, steht in jedem Speicherabbild — und ein Speicherabbild ist
     * genau das, was jemand mitschickt, wenn er einen Absturz meldet.
     */
    private readonly schluessel: () => string
  ) {}

  /**
   * Packt die genannten Dateien, verschlüsselt sie und legt das Paket ab.
   *
   * Gibt den geschriebenen Pfad zurück. Was schiefgeht, wirft — der Aufrufer
   * entscheidet, was das für den Lauf bedeutet, und er ist der Einzige, der
   * das kann.
   */
  async lege(auftrag: Archivauftrag): Promise<string> {
    const eintraege: Archiveintrag[] = [];

    for (const name of auftrag.namen) {
      eintraege.push({ name, inhalt: await this.ablage.lies(this.ablage.pfad(auftrag.verzeichnis, name)) });
    }

    const pfad = this.ablage.pfad(auftrag.archiv, `${auftrag.benennung}${ARCHIVENDUNG}`);

    await this.ablage.schreibe(pfad, encryptBytes(packe(eintraege, auftrag.jetzt), this.schluessel()));

    return pfad;
  }
}

/**
 * Der Name des Archivpakets.
 *
 * Workflow und Zeitpunkt, wie bei der Ergebnisdatei: Der Zeitstempel gehört
 * dazu, weil derselbe Stapel morgen wiederkommt — ohne ihn überschriebe die
 * Lieferung von morgen die von heute, und das Archiv wäre genau dort leer, wo
 * jemand nachsieht.
 */
export function archivdateiname(workflow: string, laufId: string, jetzt: Date): string {
  const zwei = (wert: number): string => String(wert).padStart(2, '0');
  const stempel =
    `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}_` +
    `${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;

  /*
   * Die Laufkennung steht mit dabei. Zwei Läufe in derselben Sekunde sind
   * selten und nicht unmöglich — und ein Archiv, das dabei eines überschreibt,
   * verlöre genau das, wofür es da ist.
   */
  return `${sauber(workflow) || 'Workflow'}_Archiv_${stempel}_${sauber(laufId) || 'Lauf'}`;
}

const VERBOTEN = new Set(['<', '>', ':', '"', '/', String.fromCharCode(92), '|', '?', '*']);

function sauber(wert: string): string {
  return [...wert]
    .map((zeichen) => (VERBOTEN.has(zeichen) || zeichen.charCodeAt(0) < 32 ? '_' : zeichen))
    .join('')
    .trim();
}
