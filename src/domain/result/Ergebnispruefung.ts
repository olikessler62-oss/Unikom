import { konvertiere } from '../quality/Konvertierung.js';
import { pruefe, type Befund, type Qualitaetsregel, type Schwere } from '../quality/Regeln.js';
import type { FieldType } from '../consolidation/Recognition.js';
import { gruppiere, type Schluessel } from '../consolidation/Schluessel.js';
import type { Datensatz } from '../consolidation/Quellen.js';
import type { Region } from '../tenants/Region.js';

/**
 * Die Validierung des Verarbeitungsergebnisses (SPEC-08, Abschnitt 10).
 *
 * ## Der Satz, um den es geht
 *
 * „Ein Ergebnis darf **nicht allein aufgrund eines fehlerfreien technischen
 * Ablaufs** als fachlich korrekt gelten."
 *
 * Ein Lauf ohne Ausnahme ist keine Aussage über die Daten. Er sagt, dass kein
 * Programm abgestürzt ist — und genau so sieht ein Lauf aus, der eine ganze
 * Spalte verloren hat, weil eine Zuordnung nicht mehr passte.
 *
 * ## Die neun Prüfungen
 *
 * ```text
 * VOLLSTAENDIGKEIT  jeder gelesene Datensatz hat einen Verbleib
 * ANZAHL            das Ergebnis ist nicht unerklärlich kleiner
 * DUPLIKATE         im Ergebnis steht kein Schlüssel zweimal
 * PFLICHTWERTE      was gefüllt sein muss, ist gefüllt
 * DATENTYPEN        jeder Wert passt zu seinem Zieltyp
 * ZIELSTRUKTUR      die Felder sind die vereinbarten
 * REFERENZEN        die Nachschlagewerke haben getroffen
 * ABHAENGIGKEITEN   die feldübergreifenden Regeln halten
 * ABWEICHUNG        kein Feld ist plötzlich leer, das voll war
 * ```
 *
 * Die letzte ist die, um derentwillen der Abschnitt existiert. „Auffällige
 * Abweichungen zwischen Ausgangs-, Arbeits- und Ergebnisbestand müssen erkannt
 * und verständlich angezeigt werden": Ein Feld, das im Eingang zu 98 % gefüllt
 * war und im Ergebnis zu 12 %, ist der Fehler, den keine Typprüfung findet —
 * denn die zwölf Prozent sind alle richtig.
 */
export type Pruefart =
  | 'VOLLSTAENDIGKEIT'
  | 'ANZAHL'
  | 'DUPLIKATE'
  | 'PFLICHTWERTE'
  | 'DATENTYPEN'
  | 'ZIELSTRUKTUR'
  | 'REFERENZEN'
  | 'ABHAENGIGKEITEN'
  | 'ABWEICHUNG';

export interface Pruefbefund {
  art: Pruefart;
  schwere: Schwere;
  feld?: string;
  ursache: string;
  auswirkung: string;
  /** Zahlen, die der Benutzer nachrechnen kann. */
  zahlen?: Record<string, number>;
  /** Ein paar Beispiele — nicht alle; ein Bericht mit zehntausend Zeilen wird nicht gelesen. */
  beispiele?: string[];
}

export interface Zielfeld {
  name: string;
  typ?: FieldType;
  pflicht?: boolean;
}

export interface Bestandsangabe {
  felder: readonly string[];
  zeilen: readonly (readonly string[])[];
}

/**
 * Wie sehr sich ein Ergebnis vom Eingang unterscheiden darf, bevor es auffällt.
 *
 * Voreinstellungen, keine Wahrheiten: Ein Merge von drei Quellen auf einen
 * Bestand **soll** weniger Zeilen haben. Deshalb ist die Zahl einstellbar und
 * ihr Unterschreiten eine Warnung, kein Fehler — die Prüfung sagt „sieh hin",
 * nicht „das ist falsch".
 */
export interface Pruefmassstaebe {
  /** Ab welchem Rückgang der Datensatzzahl gewarnt wird. */
  anzahlToleranz?: number;
  /** Ab welchem Rückgang des Füllgrads eines Feldes gewarnt wird. */
  fuellgradToleranz?: number;
  /** Wie viele Beispiele ein Befund höchstens nennt. */
  beispiele?: number;
}

export const ANZAHL_TOLERANZ = 0.2;
export const FUELLGRAD_TOLERANZ = 0.2;
export const BEISPIELE = 5;

export interface Pruefauftrag {
  eingang: Bestandsangabe;
  ergebnis: Bestandsangabe;
  /** Die vereinbarte Zielstruktur, falls es eine gibt. */
  zielstruktur?: readonly Zielfeld[];
  /** Woran im Ergebnis ein Duplikat zu erkennen wäre. */
  schluessel?: Schluessel;
  /**
   * Die Verbleibsrechnung des Laufs: Wie viele Datensätze zurückgetreten oder
   * gar nicht verarbeitet wurden.
   */
  verbleib?: { zurueckgestellt: number; nichtVerarbeitet: number; herkuenfte: number };
  /** Was die Nachschlagewerke gemeldet haben. */
  referenzen?: readonly { bestand: string; ohneTreffer: number; mehrdeutig: number }[];
  qualitaet?: readonly Qualitaetsregel[];
  region: Region;
  nullWerte?: readonly string[];
  jahrhundertGrenze?: number;
  massstaebe?: Pruefmassstaebe;
  jetzt?: Date;
}

export interface Ergebnispruefung {
  befunde: Pruefbefund[];
  /** Die Zahlen, auf die ein Mensch zuerst sieht. */
  zahlen: {
    eingang: number;
    ergebnis: number;
    felder: number;
    zurueckgestellt: number;
    nichtVerarbeitet: number;
  };
  zusammenfassung: Record<Schwere, number>;
  /** Ob ein Fehler die Freigabe unmöglich macht. */
  blockiert: boolean;
  /** Ohne einen einzigen Befund: die kompakte Zusammenfassung aus Abschnitt 12. */
  sauber: boolean;
}

function anteilGefuellt(bestand: Bestandsangabe, feld: string): number {
  const spalte = bestand.felder.indexOf(feld);

  if (spalte < 0 || bestand.zeilen.length === 0) {
    return 0;
  }

  const gefuellt = bestand.zeilen.filter((zeile) => (zeile[spalte] ?? '').trim() !== '').length;

  return gefuellt / bestand.zeilen.length;
}

function prozent(wert: number): string {
  return `${(wert * 100).toFixed(1)} %`;
}

export function pruefeErgebnis(auftrag: Pruefauftrag): Ergebnispruefung {
  const massstaebe = auftrag.massstaebe ?? {};
  const anzahlToleranz = massstaebe.anzahlToleranz ?? ANZAHL_TOLERANZ;
  const fuellgradToleranz = massstaebe.fuellgradToleranz ?? FUELLGRAD_TOLERANZ;
  const grenze = massstaebe.beispiele ?? BEISPIELE;
  const befunde: Pruefbefund[] = [];

  const eingang = auftrag.eingang.zeilen.length;
  const ergebnis = auftrag.ergebnis.zeilen.length;

  /* ---------- 1. Vollständigkeit ---------- */

  if (auftrag.verbleib) {
    const { herkuenfte, zurueckgestellt, nichtVerarbeitet } = auftrag.verbleib;
    const erfasst = herkuenfte + zurueckgestellt + nichtVerarbeitet;

    if (erfasst !== eingang) {
      /*
       * Die härteste Prüfung von allen, und die einzige, die ein FEHLER ist:
       * Wenn die Rechnung nicht aufgeht, sind Datensätze verschwunden, ohne
       * dass irgendwo steht, wohin. Alles andere lässt sich ansehen und
       * entscheiden — das hier nicht, denn niemand weiß, was fehlt.
       */
      befunde.push({
        art: 'VOLLSTAENDIGKEIT',
        schwere: 'FEHLER',
        ursache:
          `${eingang} Datensätze wurden gelesen, aber nur ${erfasst} haben einen Verbleib: ` +
          `${herkuenfte} im Ergebnis, ${zurueckgestellt} zurückgetreten, ${nichtVerarbeitet} nicht verarbeitet`,
        auswirkung:
          `${Math.abs(eingang - erfasst)} Datensätze lassen sich nicht zuordnen. ` +
          'Das Ergebnis ist nicht belastbar, solange nicht feststeht, wo sie geblieben sind',
        zahlen: { eingang, erfasst, herkuenfte, zurueckgestellt, nichtVerarbeitet },
      });
    }
  }

  /* ---------- 2. Datensatzanzahl ---------- */

  if (eingang > 0 && ergebnis < eingang * (1 - anzahlToleranz)) {
    befunde.push({
      art: 'ANZAHL',
      schwere: 'WARNUNG',
      ursache: `Aus ${eingang} Datensätzen sind ${ergebnis} geworden - ein Rückgang um ${prozent(1 - ergebnis / eingang)}`,
      auswirkung:
        'Bei einer Zusammenführung ist das zu erwarten; bei einem reinen Aneinanderhängen nicht. ' +
        `Gewarnt wird ab ${prozent(anzahlToleranz)}`,
      zahlen: { eingang, ergebnis },
    });
  }

  /* ---------- 3. Duplikate im Ergebnis ---------- */

  if (auftrag.schluessel && auftrag.schluessel.felder.length > 0) {
    const saetze: Datensatz[] = auftrag.ergebnis.zeilen.map((zeile, stelle) => ({
      quelle: 'ergebnis',
      zeile: stelle + 1,
      werte: new Map(auftrag.ergebnis.felder.map((feld, spalte) => [feld, zeile[spalte] ?? ''])),
    }));

    const gruppen = gruppiere(saetze, auftrag.schluessel);
    const doppelt = [...gruppen.gruppen.entries()].filter(([, gruppe]) => gruppe.length > 1);

    if (doppelt.length > 0) {
      befunde.push({
        art: 'DUPLIKATE',
        schwere: 'KONFLIKT',
        ursache: `${doppelt.length} Schlüssel kommen im Ergebnis mehr als einmal vor`,
        auswirkung:
          'Nach einer Konsolidierung soll jeder Schlüssel genau einmal dastehen. ' +
          'Entweder ist die Dublettenregel zu lasch, oder der Schlüssel ist der falsche',
        zahlen: { schluessel: doppelt.length },
        beispiele: doppelt
          .slice(0, grenze)
          .map(([wert, gruppe]) => `${gruppen.klartext.get(wert) ?? wert} (${gruppe.length}×)`),
      });
    }
  }

  /* ---------- 4. bis 6. Zielstruktur, Pflichtwerte, Datentypen ---------- */

  for (const feld of auftrag.zielstruktur ?? []) {
    if (!auftrag.ergebnis.felder.includes(feld.name)) {
      befunde.push({
        art: 'ZIELSTRUKTUR',
        schwere: 'FEHLER',
        feld: feld.name,
        ursache: `Das vereinbarte Zielfeld „${feld.name}" kommt im Ergebnis nicht vor`,
        auswirkung:
          'Die Zieldatei hätte eine andere Struktur als vereinbart. Was sie liest, erwartet dieses Feld',
      });

      continue;
    }

    const spalte = auftrag.ergebnis.felder.indexOf(feld.name);
    const werte = auftrag.ergebnis.zeilen.map((zeile) => zeile[spalte] ?? '');

    if (feld.pflicht) {
      const leer = werte
        .map((wert, stelle) => ({ wert, zeile: stelle + 1 }))
        .filter((eintrag) => eintrag.wert.trim() === '');

      if (leer.length > 0) {
        befunde.push({
          art: 'PFLICHTWERTE',
          schwere: 'KONFLIKT',
          feld: feld.name,
          ursache: `„${feld.name}" ist ein Pflichtfeld und in ${leer.length} von ${werte.length} Zeilen leer`,
          auswirkung: 'Diese Datensätze sind ohne den Wert nicht eindeutig zu verarbeiten',
          zahlen: { leer: leer.length, gesamt: werte.length },
          beispiele: leer.slice(0, grenze).map((eintrag) => `Zeile ${eintrag.zeile}`),
        });
      }
    }

    if (feld.typ && feld.typ !== 'STRING') {
      const daneben: string[] = [];

      werte.forEach((wert, stelle) => {
        if (wert.trim() === '') {
          return;
        }

        const ergebnisWert = konvertiere(wert, feld.typ as FieldType, {
          region: auftrag.region,
          nullWerte: auftrag.nullWerte,
          jahrhundertGrenze: auftrag.jahrhundertGrenze,
        });

        if (!ergebnisWert.ok) {
          daneben.push(`Zeile ${stelle + 1}: „${wert}"`);
        }
      });

      if (daneben.length > 0) {
        befunde.push({
          art: 'DATENTYPEN',
          schwere: 'KONFLIKT',
          feld: feld.name,
          ursache: `${daneben.length} Werte in „${feld.name}" passen nicht zum Zieltyp ${feld.typ}`,
          auswirkung:
            'Das Ziel würde sie ablehnen oder still umdeuten. Beides fällt erst auf, wenn die Daten dort liegen',
          zahlen: { daneben: daneben.length, gesamt: werte.length },
          beispiele: daneben.slice(0, grenze),
        });
      }
    }
  }

  /*
   * Felder, die im Ergebnis stehen und nirgends vereinbart sind. Kein Fehler —
   * eine Zielstruktur muss nicht vollständig sein —, aber es gehört gesagt:
   * Meist ist es ein Feld, das jemand im Mapping vergessen hat.
   */
  if (auftrag.zielstruktur && auftrag.zielstruktur.length > 0) {
    const vereinbart = new Set(auftrag.zielstruktur.map((feld) => feld.name));
    const zusaetzlich = auftrag.ergebnis.felder.filter((feld) => !vereinbart.has(feld));

    if (zusaetzlich.length > 0) {
      befunde.push({
        art: 'ZIELSTRUKTUR',
        schwere: 'INFO',
        ursache: `Das Ergebnis führt ${zusaetzlich.length} Feld(er), die in der Zielstruktur nicht stehen`,
        auswirkung: `Betroffen: ${zusaetzlich.join(', ')}. Sie gehen mit hinaus, sofern das Ziel sie annimmt`,
        beispiele: zusaetzlich.slice(0, grenze),
      });
    }
  }

  /* ---------- 7. Referenzen ---------- */

  for (const referenz of auftrag.referenzen ?? []) {
    if (referenz.mehrdeutig > 0 || referenz.ohneTreffer > 0) {
      befunde.push({
        art: 'REFERENZEN',
        schwere: referenz.mehrdeutig > 0 ? 'KONFLIKT' : 'WARNUNG',
        ursache:
          `Der Abgleich gegen „${referenz.bestand}" ist ${referenz.ohneTreffer}× ohne Treffer geblieben` +
          (referenz.mehrdeutig > 0 ? ` und ${referenz.mehrdeutig}× mehrdeutig` : ''),
        auswirkung:
          referenz.mehrdeutig > 0
            ? 'Mehrdeutige Treffer sind nicht automatisch entscheidbar; diese Datensätze warten'
            : 'Die Datensätze laufen weiter; ob die Werte richtig sind, sagt die Referenz nicht',
        zahlen: { ohneTreffer: referenz.ohneTreffer, mehrdeutig: referenz.mehrdeutig },
      });
    }
  }

  /* ---------- 8. Abhängigkeiten ---------- */

  if (auftrag.qualitaet && auftrag.qualitaet.length > 0) {
    const vorhanden = new Set(auftrag.ergebnis.felder);
    const anwendbar = auftrag.qualitaet.filter((regel) => vorhanden.has(regel.feld));
    const gefunden: Befund[] = [];

    auftrag.ergebnis.zeilen.forEach((zeile, stelle) => {
      const datensatz = new Map(auftrag.ergebnis.felder.map((feld, spalte) => [feld, zeile[spalte] ?? '']));

      gefunden.push(
        ...pruefe(datensatz, stelle + 1, anwendbar, {
          region: auftrag.region,
          nullWerte: auftrag.nullWerte,
          jetzt: auftrag.jetzt,
        })
      );
    });

    /*
     * Zusammengefasst je Regel und nicht je Zeile. Zehntausend Zeilen mit
     * derselben Ursache sind ein Befund und nicht zehntausend — SPEC-08,
     * Abschnitt 12: „Für erfolgreich validierte Daten soll eine kompakte
     * Zusammenfassung ausreichen."
     */
    const jeRegel = new Map<string, Befund[]>();

    for (const befund of gefunden) {
      const schluessel = befund.regel ?? befund.ursache;
      jeRegel.set(schluessel, [...(jeRegel.get(schluessel) ?? []), befund]);
    }

    for (const [regel, treffer] of jeRegel) {
      befunde.push({
        art: 'ABHAENGIGKEITEN',
        schwere: treffer[0].schwere,
        feld: treffer[0].feld,
        ursache: `${regel}: in ${treffer.length} Zeile(n) nicht erfüllt`,
        auswirkung: treffer[0].auswirkung,
        zahlen: { zeilen: treffer.length },
        beispiele: treffer.slice(0, grenze).map((befund) => `Zeile ${befund.zeile}: ${befund.ursache}`),
      });
    }
  }

  /* ---------- 9. Auffällige Abweichung ---------- */

  for (const feld of auftrag.eingang.felder) {
    if (!auftrag.ergebnis.felder.includes(feld)) {
      continue;
    }

    const vorher = anteilGefuellt(auftrag.eingang, feld);
    const nachher = anteilGefuellt(auftrag.ergebnis, feld);

    if (vorher > 0 && nachher < vorher - fuellgradToleranz) {
      befunde.push({
        art: 'ABWEICHUNG',
        schwere: 'WARNUNG',
        feld,
        ursache: `„${feld}" war im Eingang zu ${prozent(vorher)} gefüllt, im Ergebnis nur noch zu ${prozent(nachher)}`,
        auswirkung:
          'Kein einzelner Wert muss falsch sein - die Werte, die da sind, können alle stimmen. ' +
          'Verloren gegangen ist etwas trotzdem: meist eine Zuordnung, die nicht mehr passt',
        zahlen: { vorher, nachher },
      });
    }
  }

  const zusammenfassung: Record<Schwere, number> = { INFO: 0, WARNUNG: 0, KONFLIKT: 0, FEHLER: 0 };

  for (const befund of befunde) {
    zusammenfassung[befund.schwere] += 1;
  }

  return {
    befunde,
    zahlen: {
      eingang,
      ergebnis,
      felder: auftrag.ergebnis.felder.length,
      zurueckgestellt: auftrag.verbleib?.zurueckgestellt ?? 0,
      nichtVerarbeitet: auftrag.verbleib?.nichtVerarbeitet ?? 0,
    },
    zusammenfassung,
    blockiert: zusammenfassung.FEHLER > 0,
    sauber: befunde.length === 0,
  };
}
