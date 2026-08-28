import type { FieldType } from '../../domain/consolidation/Recognition.js';
import { konvertiere, type Konfliktart } from '../../domain/quality/Konvertierung.js';
import { normalisiereWert, type Normalisierungsregeln } from '../../domain/quality/Normalisierung.js';
import {
  AUSGELIEFERTE_REGELN,
  blockiert,
  pruefe,
  zeilenMitKonflikt,
  type Befund,
  type Qualitaetsregel,
  type Schwere,
} from '../../domain/quality/Regeln.js';
import type { Region } from '../../domain/tenants/Region.js';

/**
 * Ein Bestand durch Normalisierung, Konvertierung und Qualitätsregeln
 * (Etappe 4).
 *
 * Die Reihenfolge ist keine Geschmacksfrage:
 *
 * ```text
 * 1. normalisieren   " 4711 " → "4711"      Schreibweise vereinheitlichen
 * 2. konvertieren    "4711"   → Integer     in den Zieltyp bringen
 * 3. prüfen          Integer  → Regeln      fachlich beurteilen
 * ```
 *
 * Andersherum liefe die Prüfung gegen Werte, die noch ein Leerzeichen tragen,
 * und meldete Fehler, die keine sind. Und konvertiert wird erst nach der
 * Normalisierung, weil `" 4711 "` sonst keine Zahl wäre.
 *
 * **Das Original bleibt unangetastet.** Was hier entsteht, steht daneben —
 * Ergebnis, Befunde und die Liste dessen, was verändert wurde. Eine
 * Verarbeitung, die die Eingangsdaten überschreibt, nimmt sich die einzige
 * Möglichkeit, hinterher nachzusehen.
 */
export interface Feldregeln {
  /** Wie der Wert vereinheitlicht wird, bevor irgendetwas anderes geschieht. */
  normalisierung?: Normalisierungsregeln;
  /** Der Zieltyp. Ohne Angabe bleibt es Text. */
  ziel?: FieldType;
  /** Ob das Feld leer sein darf. */
  leerErlaubt?: boolean;
}

export interface Qualitaetsauftrag {
  /** Die Feldnamen des Bestands, in der Reihenfolge der Spalten. */
  felder: readonly string[];
  zeilen: readonly (readonly string[])[];
  region: Region;
  /** Je Feld, was damit geschehen soll. */
  regeln?: Readonly<Record<string, Feldregeln>>;
  /** Die fachlichen Regeln; ohne Angabe die ausgelieferten. */
  qualitaet?: readonly Qualitaetsregel[];
  nullWerte?: readonly string[];
  jahrhundertGrenze?: number;
  /** Der Bezugszeitpunkt für „nicht in der Zukunft". */
  jetzt?: Date;
}

export interface Aenderung {
  zeile: number;
  feld: string;
  vorher: string;
  nachher: string;
  /** Warum — Schritt für Schritt. */
  schritte: string[];
}

export interface Qualitaetsbericht {
  felder: readonly string[];
  /** Die Werte nach Normalisierung; die Konvertierung steht in `typen`. */
  zeilen: string[][];
  /** Was je Feld herausgekommen ist. */
  typen: Record<string, FieldType | undefined>;
  /** Jede Veränderung, die die Normalisierung vorgenommen hat. */
  aenderungen: Aenderung[];
  befunde: Befund[];
  /** Zeilen, die als Prüffall an einen Menschen gehen. */
  pruefzeilen: number[];
  /** Ob die Verarbeitung anhalten muss. */
  blockiert: boolean;
  /** Die Zahlen, auf die ein Mensch zuerst sieht. */
  zusammenfassung: Record<Schwere, number>;
}

export class QualityService {
  bearbeite(auftrag: Qualitaetsauftrag): Qualitaetsbericht {
    const regeln = auftrag.regeln ?? {};
    const zeilen: string[][] = [];
    const aenderungen: Aenderung[] = [];
    const befunde: Befund[] = [];
    const typen: Record<string, FieldType | undefined> = {};
    const alleRegeln = auftrag.qualitaet ?? AUSGELIEFERTE_REGELN;

    /*
     * Eine Regel für ein Feld, das dieser Bestand überhaupt nicht hat, ist eine
     * **strukturelle** Feststellung und keine Sache jeder einzelnen Zeile.
     *
     * Sonst meldete eine Artikelliste ohne Kundennummer bei zehntausend Zeilen
     * zehntausendmal dasselbe — und der Bericht wäre unlesbar, obwohl er nur
     * eine einzige Sache sagt. Die Prüfung je Datensatz bekommt diese Regeln
     * deshalb gar nicht erst zu sehen.
     */
    const vorhandeneFelder = new Set(auftrag.felder);
    const fehlendeFelder = alleRegeln.filter((regel) => !vorhandeneFelder.has(regel.feld));
    const anwendbar = alleRegeln.filter((regel) => vorhandeneFelder.has(regel.feld));

    for (const feld of new Set(fehlendeFelder.filter((regel) => regel.pruefung.art === 'PFLICHT').map((regel) => regel.feld))) {
      befunde.push({
        zeile: 0,
        feld,
        schwere: 'WARNUNG',
        ursache: `Das Pflichtfeld „${feld}" kommt in diesem Bestand nicht vor`,
        auswirkung:
          'Entweder fehlt die Spalte in der Quelle, oder sie ist noch keinem internen Feld zugeordnet. ' +
          'Gemeldet wird es einmal und nicht je Zeile - es ist eine Frage der Struktur',
        regel: 'Pflichtfeld',
      });
    }

    auftrag.zeilen.forEach((zeile, stelle) => {
      const nummer = stelle + 1;
      const bearbeitet: string[] = [];
      const datensatz = new Map<string, string>();

      auftrag.felder.forEach((feld, spalte) => {
        const roh = zeile[spalte] ?? '';
        const feldregeln = regeln[feld] ?? {};

        /* 1. Normalisieren — und jede Veränderung ausweisen. */
        const normalisiert = normalisiereWert(roh, feldregeln.normalisierung ?? {});

        if (normalisiert.wert !== roh) {
          aenderungen.push({
            zeile: nummer,
            feld,
            vorher: roh,
            nachher: normalisiert.wert,
            schritte: normalisiert.schritte,
          });
        }

        for (const hinweis of normalisiert.hinweise) {
          befunde.push({
            zeile: nummer,
            feld,
            schwere: 'WARNUNG',
            ursache: hinweis,
            auswirkung: 'Der Wert bleibt unverändert; eine Regel dafür gehört ins Profil',
            wert: roh,
          });
        }

        /* 2. Konvertieren — was nicht eindeutig geht, wird ein Konflikt. */
        if (feldregeln.ziel && feldregeln.ziel !== 'STRING') {
          const ergebnis = konvertiere(normalisiert.wert, feldregeln.ziel, {
            region: auftrag.region,
            nullWerte: auftrag.nullWerte,
            leerErlaubt: feldregeln.leerErlaubt,
            jahrhundertGrenze: auftrag.jahrhundertGrenze,
          });

          if (ergebnis.ok) {
            typen[feld] = ergebnis.typ;

            if (ergebnis.hinweis) {
              befunde.push({
                zeile: nummer,
                feld,
                schwere: 'INFO',
                ursache: ergebnis.hinweis,
                auswirkung: 'Der Wert wurde übernommen; ein Blick darauf schadet nicht',
                wert: normalisiert.wert,
              });
            }
          } else {
            befunde.push({
              zeile: nummer,
              feld,
              schwere: schwereFuer(ergebnis.art),
              ursache: ergebnis.grund,
              auswirkung: ergebnis.auswirkung,
              wert: normalisiert.wert,
              regel: `Konvertierung nach ${feldregeln.ziel}`,
            });
          }
        } else {
          typen[feld] = typen[feld] ?? 'STRING';
        }

        bearbeitet.push(normalisiert.wert);
        datensatz.set(feld, normalisiert.wert);
      });

      zeilen.push(bearbeitet);

      /* 3. Fachlich prüfen — auf den vereinheitlichten Werten. */
      befunde.push(
        ...pruefe(datensatz, nummer, anwendbar, {
          region: auftrag.region,
          nullWerte: auftrag.nullWerte,
          jetzt: auftrag.jetzt,
        })
      );
    });

    const zusammenfassung: Record<Schwere, number> = { INFO: 0, WARNUNG: 0, KONFLIKT: 0, FEHLER: 0 };

    for (const befund of befunde) {
      zusammenfassung[befund.schwere] += 1;
    }

    return {
      felder: auftrag.felder,
      zeilen,
      typen,
      aenderungen,
      befunde,
      pruefzeilen: zeilenMitKonflikt(befunde),
      blockiert: blockiert(befunde),
      zusammenfassung,
    };
  }
}

/**
 * Wie schwer eine misslungene Konvertierung wiegt.
 *
 * Alle vier sind Konflikte und keine Fehler: Der eine Datensatz geht an einen
 * Menschen, die übrigen laufen weiter (SPEC-08, Abschnitt 8). Ein Fehler wäre
 * etwas, bei dem auch die übrigen nicht sicher zu verarbeiten sind — und das
 * ist eine Frage der Struktur, nicht eines einzelnen Wertes.
 */
function schwereFuer(art: Konfliktart): Schwere {
  return art === 'UNGUELTIG' || art === 'VERLUST' || art === 'UEBERLAUF' || art === 'MEHRDEUTIG'
    ? 'KONFLIKT'
    : 'WARNUNG';
}
