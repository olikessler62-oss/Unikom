import { pruefeGegenSchema, type Schemapruefung } from '../../domain/quality/JsonSchema.js';
import type { Dateiablage } from './Dateiablage.js';

/**
 * Die Prüfung einer Eingangsdatei gegen ein JSON Schema (SPEC-03 §7; SPEC-08 §2).
 *
 * ## Vor der Verarbeitung, nicht danach
 *
 * „Kritische Fehler, die eine sichere Verarbeitung verhindern, müssen **vor
 * Beginn** der Verarbeitung erkannt und dem Benutzer verständlich angezeigt
 * werden." Eine Prüfung hinterher sagt, dass ein Ergebnis auf schlechten Daten
 * beruht — da liegt es aber schon im Zielverzeichnis.
 *
 * ## Geprüft wird das Dokument, nicht die Zeilen
 *
 * Ein JSON Schema beschreibt die Struktur der Datei: verschachtelte Objekte,
 * Listen, Pflichtfelder. Der Leser macht daraus flache Zeilen — was danach
 * geprüft würde, wäre nicht mehr das, was das Schema beschreibt. Deshalb liest
 * dieser Prüfer die Datei selbst, bevor der Leser sie zerlegt.
 *
 * ## Nur JSON
 *
 * Eine CSV gegen ein JSON Schema zu prüfen ergäbe keinen Sinn, und es
 * stillschweigend zu übergehen wäre schlimmer: Wer ein Schema einstellt und
 * eine CSV liefert, soll erfahren, dass nichts geprüft wurde.
 */
export type BeiVerstoss = 'WARNEN' | 'ABBRECHEN';

export interface Schemaregel {
  /** Der Pfad der Schemadatei. */
  datei: string;
  /**
   * Was geschieht, wenn eine Datei dem Schema nicht genügt.
   *
   * Voreingestellt `ABBRECHEN`: Wer sich die Mühe macht, ein Schema zu
   * hinterlegen, will nicht, dass eine verletzende Datei trotzdem verarbeitet
   * wird. Die verarbeitete Datei ließe sich nicht mehr zurückholen; ein
   * ausgelassener Lauf schon.
   */
  bei?: BeiVerstoss;
}

export interface Schemabefund {
  datei: string;
  /** Ob die Datei weiterverarbeitet werden darf. */
  brauchbar: boolean;
  /** Was zu sagen ist — in Sätzen, die ein Mensch prüfen kann. */
  hinweise: string[];
}

/** Wie viele Verstöße einzeln genannt werden, bevor gezählt wird. */
export const ZEIGE_VERSTOESSE = 20;

export class Schemapruefer {
  private geladen?: { schema: unknown; fehler?: string };

  constructor(
    private readonly ablage: Dateiablage,
    private readonly regel: Schemaregel
  ) {}

  /**
   * Prüft eine Eingangsdatei.
   *
   * Der Rückgabewert sagt nur, ob weiterverarbeitet werden darf; **was** dagegen
   * spricht, steht in den Hinweisen. Ein `false` ohne Begründung wäre ein
   * abgebrochener Nachtlauf, dessen Grund niemand kennt.
   */
  async pruefe(datei: { name: string; bytes: Uint8Array }): Promise<Schemabefund> {
    if (!datei.name.toLowerCase().endsWith('.json')) {
      return {
        datei: datei.name,
        brauchbar: true,
        hinweise: [
          `„${datei.name}" wurde nicht gegen das Schema geprüft: Ein JSON Schema gilt für JSON-Dateien`,
        ],
      };
    }

    const schema = await this.schema();

    if (schema.fehler) {
      /*
       * Ein Schema, das sich nicht laden lässt, ist ein Mangel der Einstellung
       * und kein Befund über die Daten. Die Datei deshalb auszulassen hieße,
       * einen Konfigurationsfehler in einen Datenausfall zu verwandeln.
       */
      return { datei: datei.name, brauchbar: true, hinweise: [schema.fehler] };
    }

    let inhalt: unknown;

    try {
      inhalt = JSON.parse(new TextDecoder().decode(datei.bytes));
    } catch (fehler) {
      return {
        datei: datei.name,
        brauchbar: false,
        hinweise: [
          `„${datei.name}" ist kein gültiges JSON: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
        ],
      };
    }

    const urteil = pruefeGegenSchema(inhalt, schema.schema);

    return {
      datei: datei.name,
      brauchbar: urteil.gueltig || (this.regel.bei ?? 'ABBRECHEN') === 'WARNEN',
      hinweise: saetze(datei.name, urteil, this.regel.bei ?? 'ABBRECHEN'),
    };
  }

  /** Das Schema wird einmal je Lauf gelesen und nicht je Datei. */
  private async schema(): Promise<{ schema: unknown; fehler?: string }> {
    if (this.geladen) {
      return this.geladen;
    }

    try {
      this.geladen = { schema: JSON.parse(new TextDecoder().decode(await this.ablage.lies(this.regel.datei))) };
    } catch (fehler) {
      this.geladen = {
        schema: undefined,
        fehler:
          `Das Schema „${this.regel.datei}" ließ sich nicht lesen: ` +
          `${fehler instanceof Error ? fehler.message : String(fehler)}. Es wurde nicht geprüft`,
      };
    }

    return this.geladen;
  }
}

function saetze(name: string, urteil: Schemapruefung, bei: BeiVerstoss): string[] {
  const hinweise: string[] = [];

  for (const verstoss of urteil.verstoesse.slice(0, ZEIGE_VERSTOESSE)) {
    hinweise.push(`„${name}" verletzt das Schema bei ${verstoss.pfad}: ${verstoss.hinweis}`);
  }

  if (urteil.verstoesse.length > ZEIGE_VERSTOESSE) {
    hinweise.push(
      `„${name}": ${urteil.verstoesse.length} Verstöße gegen das Schema; die ersten ${ZEIGE_VERSTOESSE} stehen oben`
    );
  }

  if (urteil.verstoesse.length > 0) {
    hinweise.push(
      bei === 'ABBRECHEN'
        ? `„${name}" wird nicht verarbeitet - so eingestellt`
        : `„${name}" wird trotzdem verarbeitet - so eingestellt`
    );
  }

  /*
   * Was die Prüfung nicht verstanden hat, gehört ins Protokoll, auch wenn nichts
   * zu beanstanden war. Sonst liest jemand „keine Verstöße" und hält das für
   * „das Schema ist erfüllt" — obwohl der halbe Teil davon nie angesehen wurde.
   */
  if (urteil.ungeprueft.length > 0) {
    hinweise.push(
      `Am Schema wurde nicht alles geprüft: ${urteil.ungeprueft.join(', ')}. ` +
        'Diese Schlüsselwörter kennt Unikom nicht'
    );
  }

  return hinweise;
}
