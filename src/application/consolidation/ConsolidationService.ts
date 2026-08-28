import type { Aehnlichkeitsregeln, Verdacht } from '../../domain/consolidation/Aehnlichkeit.js';
import { verdaechtigePaare } from '../../domain/consolidation/Aehnlichkeit.js';
import {
  behandleDubletten,
  type Dublettenbefund,
  type Dublettenregel,
  type Dublettenverbleib,
} from '../../domain/consolidation/Dubletten.js';
import { ergaenze, type Ergaenzt, type Ergaenzungsluecke, type Ergaenzungsregel } from '../../domain/consolidation/Ergaenzung.js';
import type {
  Mehrfachtrefferregel,
  OhneHauptsatz,
} from '../../domain/consolidation/Mehrfachtreffer.js';
import { wurdeAbgewogen } from '../../domain/consolidation/Prioritaet.js';
import type { Angebot, Entscheidungsregeln } from '../../domain/consolidation/Prioritaet.js';
import {
  alleDatensaetze,
  bezeichnung,
  type Betriebsart,
  type Datensatz,
  type Konsolidierungsart,
  type Quelle,
} from '../../domain/consolidation/Quellen.js';
import {
  gleicheAb,
  referenzindex,
  type Referenzbestand,
  type Referenzindex,
  type Referenzregel,
} from '../../domain/consolidation/Referenz.js';
import { gruppiere, type Schluessel } from '../../domain/consolidation/Schluessel.js';
import { fuehreZusammen, zielfelder, type Feldergebnis } from '../../domain/consolidation/Zusammenfuehren.js';
import { nachDatensatz, type Vorentscheidung } from '../../domain/consolidation/Vorentscheidung.js';

/**
 * Mehrere Quellen zu einem Bestand (Etappe 5).
 *
 * ```text
 * Quellen  →  ergänzen  →  Referenz  →  gruppieren  →  Dubletten  →  Ergebnis
 *                                          ↓
 *                                    Anreichern: Hauptsatz da?
 *                                                Mehrfachtreffer?
 * ```
 *
 * ## Die beiden Einstellungen tun Verschiedenes
 *
 * `art` sagt, ob Datensätze einer Gruppe **ineinander** (`MERGE`) oder
 * **nebeneinander** (`APPEND`) landen. `betriebsart` sagt, ob eine Quelle
 * **führt** (`ANREICHERN`) oder alle gleichwertig sind (`SAMMELN`). Nur beim
 * Anreichern ist ein Datensatz ohne Bezug zur Hauptdatei ein Konflikt
 * (SPEC-02, Abschnitt 30) — beim Sammeln gibt es keine Datei, auf die er sich
 * beziehen müsste.
 *
 * ## Ein Prüflauf verändert nichts
 *
 * Dieser Dienst schreibt nirgendwohin. Er bekommt Quellen und gibt einen
 * Bericht zurück; die Vorschau aus SPEC-06, Abschnitt 11, ist deshalb nicht
 * eine abgespeckte Zweitfassung der Verarbeitung, sondern dieselbe Rechnung.
 * Eine Vorschau, die anders rechnet als der Lauf, ist schlimmer als keine.
 */
/*
 * Die beiden Regeln stehen jetzt in der Fachlichkeit und werden hier nur noch
 * weitergereicht: Ein Workflow speichert sie, und ein Domänentyp, den man sich
 * aus einem Anwendungsdienst holen muss, zieht die Abhängigkeit verkehrt herum.
 * Die Weitergabe bleibt, damit die bestehenden Einbindungen nicht umziehen
 * müssen.
 */
export type { Mehrfachtrefferregel, OhneHauptsatz } from '../../domain/consolidation/Mehrfachtreffer.js';

export interface Konsolidierungsauftrag {
  quellen: readonly Quelle[];
  betriebsart: Betriebsart;
  art: Konsolidierungsart;
  /** Beim Anreichern: die `id` der führenden Quelle. */
  fuehrend?: string;
  schluessel?: Schluessel;
  /** Die Zielstruktur; ohne Angabe die Vereinigung aller Quellfelder. */
  zielfelder?: readonly string[];
  entscheidung?: Entscheidungsregeln;
  dubletten?: Dublettenregel;
  mehrfachtreffer?: Mehrfachtrefferregel;
  /** Voreinstellung: `KONFLIKT` (SPEC-02, Abschnitt 30). */
  ohneHauptsatz?: OhneHauptsatz;
  referenzen?: readonly { bestand: Referenzbestand; regel: Referenzregel }[];
  ergaenzung?: Ergaenzungsregel;
  /**
   * Ähnliche Datensätze suchen (SPEC-04, Abschnitt 7).
   *
   * Ausdrücklich einzuschalten, und es verändert das Ergebnis nicht: Beide
   * Datensätze bleiben stehen, und daneben entsteht eine Frage.
   */
  aehnlichkeit?: Aehnlichkeitsregeln;
  /**
   * Was ein Mensch über einzelne Datensätze bereits entschieden hat.
   *
   * Der Korrekturlauf rechnet auf **derselben** Lieferung wie der Lauf, der die
   * Konflikte erzeugt hat. Ohne diese Vorgaben entstünden dabei genau dieselben
   * Konflikte noch einmal. Siehe `Vorentscheidung`.
   */
  vorentscheidungen?: readonly Vorentscheidung[];
}

export type Konfliktart =
  | 'KEIN_SCHLUESSEL'
  | 'OHNE_SCHLUESSELWERT'
  | 'FEHLENDER_HAUPTSATZ'
  | 'MEHRFACHTREFFER'
  | 'WERTEKONFLIKT'
  | 'DUBLETTE'
  | 'REFERENZ_FEHLT'
  | 'REFERENZ_MEHRDEUTIG'
  | 'DUBLETTE_VERMUTET'
  | 'STRUKTUR';

/**
 * Ein Konflikt, wie SPEC-06, Abschnitt 10, ihn verlangt.
 *
 * Die Felder sind nicht frei gewählt: betroffene Quelle, Tabellenblatt, Feld,
 * erwarteter Zustand, vorgefundener Zustand, Ursache, nächste Schritte. Ein
 * einzelnes Textfeld füllt sich binnen eines Jahres mit „Konsolidierungsfehler
 * in Gruppe 47", und danach weiß niemand, was zu tun ist.
 */
export interface Konsolidierungskonflikt {
  art: Konfliktart;
  /** Wie die Quelle heißt, nicht ihre `id` — der Bericht liest sich für Menschen. */
  quelle?: string;
  blatt?: string;
  zeile?: number;
  feld?: string;
  /** Der Konsolidierungsschlüssel der betroffenen Gruppe, im Klartext. */
  schluessel?: string;
  erwartet: string;
  vorgefunden: string;
  ursache: string;
  naechsteSchritte: string;
  /**
   * Die konkurrierenden Werte, einzeln und nicht als Satz.
   *
   * `vorgefunden` liest sich für einen Menschen; auswählen lässt sich daraus
   * nichts. SPEC-07, Abschnitt 4, verlangt aber, dass konkurrierende Werte
   * „vergleichbar gegenübergestellt" werden — und die Konfliktbearbeitung
   * braucht sie einzeln, um Knöpfe daraus zu machen. Den Satz aus dem
   * Fließtext zurückzugewinnen wäre Rateraten an der eigenen Ausgabe.
   */
  angebote?: { quelle: string; wert: string; hinweis?: string }[];
}

export interface Ergebniszeile {
  werte: string[];
  /** Aus welchen Datensätzen sie entstand (SPEC-06, Abschnitt 12). */
  herkunft: { quelle: string; zeile: number }[];
  /** Die Begründungen je Feld — nur, wo wirklich entschieden wurde. */
  entscheidungen: Feldergebnis[];
  schluessel?: string;
}

export interface Referenzbericht {
  bestand: string;
  version?: string;
  treffer: number;
  ohneTreffer: number;
  mehrdeutig: number;
  uebernahmen: number;
}

export interface Verdachtsfall {
  wert: number;
  links: { quelle: string; zeile: number };
  rechts: { quelle: string; zeile: number };
  felder: { feld: string; links: string; rechts: string; wert: number }[];
}

/**
 * Ein Datensatz, der es nicht ins Ergebnis geschafft hat — und warum.
 *
 * Ohne diese Liste ginge die Rechnung nicht auf: Gelesen minus Ergebnis wäre
 * eine Zahl, die niemand erklären kann. Die Ergebnisprüfung aus Etappe 7 legt
 * genau diese Rechnung vor, und dafür muss jeder Datensatz einen Verbleib
 * haben — im Ergebnis, zurückgetreten oder hier.
 */
export interface Nichtverarbeitet {
  quelle: string;
  zeile: number;
  grund: string;
}

export interface Zurueckgestellt {
  quelle: string;
  zeile: number;
  verbleib: Dublettenverbleib;
  grund: string;
  werte: string[];
}

export interface Konsolidierungsbericht {
  quellen: { id: string; name: string; blatt?: string; datensaetze: number; stand?: string }[];
  felder: string[];
  zeilen: Ergebniszeile[];
  konflikte: Konsolidierungskonflikt[];
  dubletten: Dublettenbefund[];
  zurueckgestellt: Zurueckgestellt[];
  /** Ähnliche, aber nicht gleiche Datensätze — Fragen, keine Zusammenführungen. */
  verdacht: Verdachtsfall[];
  /** Was aus der Verarbeitung fiel, mit Grund — damit die Rechnung aufgeht. */
  nichtVerarbeitet: Nichtverarbeitet[];
  ergaenzungen: Ergaenzt[];
  ergaenzungsluecken: Ergaenzungsluecke[];
  referenzen: Referenzbericht[];
  /** Was gesagt werden muss, ohne ein Konflikt zu sein. */
  hinweise: string[];
  zusammenfassung: {
    quellen: number;
    gelesen: number;
    ergebnis: number;
    zusammengefuehrt: number;
    dubletten: number;
    konflikte: number;
    ergaenzt: number;
    verdacht: number;
    nichtVerarbeitet: number;
  };
}

export class ConsolidationService {
  konsolidiere(auftrag: Konsolidierungsauftrag): Konsolidierungsbericht {
    const konflikte: Konsolidierungskonflikt[] = [];
    const hinweise: string[] = [];
    const namen = new Map(auftrag.quellen.map((quelle) => [quelle.id, quelle]));

    this.pruefeAuftrag(auftrag, konflikte, hinweise);

    /*
     * Einmal je Lauf zusammengelegt, nicht je Gruppe gesucht: Ein Datensatz mit
     * drei strittigen Feldern hat drei Fälle, und alle drei gehören zusammen.
     */
    const entschieden = nachDatensatz(auftrag.vorentscheidungen ?? []);

    /*
     * Welche davon ihren Datensatz wiedergefunden haben.
     *
     * Eine Entscheidung, die niemanden trifft, ist der stille Fall: Der
     * Korrekturlauf läuft durch, das Ergebnis sieht vollständig aus, und der
     * Konflikt steht wieder da, als hätte niemand ihn angefasst. Das kommt vor,
     * wenn der Fall keinen Konsolidierungsschlüssel trug — dann steht in
     * `datensatz` „Kunden.csv, Zeile 7", und Zeilennummern überstehen keine
     * erneute Verarbeitung. Es ist eine Grenze und keine Panne; sie gehört
     * benannt.
     */
    const angewandt = new Set<string>();

    let datensaetze = alleDatensaetze(auftrag.quellen);
    const gelesen = datensaetze.length;

    /* Referenzabgleich — vor der Gruppierung, denn er kann Werte ergänzen. */
    const referenzen = this.gleicheReferenzenAb(auftrag, datensaetze, namen, konflikte);
    datensaetze = referenzen.datensaetze;

    /* Fehlende Werte aus vergleichbaren Datensätzen (SPEC-08, Abschnitt 5). */
    const ergaenzt = this.ergaenzeFehlende(auftrag, datensaetze, hinweise);
    datensaetze = ergaenzt.datensaetze;

    const felder = zielfelder(datensaetze, auftrag.zielfelder);
    const zeilen: Ergebniszeile[] = [];
    const dubletten: Dublettenbefund[] = [];
    const zurueckgestellt: Zurueckgestellt[] = [];
    const nichtVerarbeitet: Nichtverarbeitet[] = [];
    let zusammengefuehrt = 0;

    const alsZeile = (datensatz: Datensatz, schluessel?: string): Ergebniszeile => ({
      werte: felder.map((feld) => datensatz.werte.get(feld) ?? ''),
      herkunft: [{ quelle: datensatz.quelle, zeile: datensatz.zeile }],
      entscheidungen: [],
      schluessel,
    });

    /*
     * Ohne Schlüssel gibt es keine Gruppen — und damit weder Dubletten noch
     * eine Zusammenführung. Das ist der reine Append gleichartiger Quellen, und
     * er ist zulässig: Nicht jeder Lauf hat einen Schlüssel, und einen zu
     * erraten ist ausdrücklich untersagt (SPEC-04, Abschnitt 7).
     */
    if (!auftrag.schluessel || auftrag.schluessel.felder.length === 0) {
      for (const datensatz of datensaetze) {
        zeilen.push(alsZeile(datensatz));
      }

      return this.bericht(auftrag, {
        felder,
        zeilen,
        konflikte,
        dubletten,
        zurueckgestellt,
        verdacht: this.sucheAehnliche(auftrag, datensaetze, new Map(), namen, konflikte, hinweise),
        nichtVerarbeitet,
        ergaenzungen: ergaenzt.ergaenzungen,
        ergaenzungsluecken: ergaenzt.luecken,
        referenzen: referenzen.berichte,
        hinweise,
        gelesen,
        zusammengefuehrt,
      });
    }

    const gruppierung = gruppiere(datensaetze, auftrag.schluessel);

    for (const eintrag of gruppierung.ohne) {
      const quelle = namen.get(eintrag.datensatz.quelle);

      konflikte.push({
        art: 'OHNE_SCHLUESSELWERT',
        quelle: quelle ? bezeichnung(quelle) : eintrag.datensatz.quelle,
        blatt: quelle?.blatt,
        zeile: eintrag.datensatz.zeile,
        feld: eintrag.fehlend.join(' + '),
        erwartet: `Ein Wert in ${eintrag.fehlend.map((feld) => `„${feld}"`).join(' und ')}`,
        vorgefunden: 'leer',
        ursache:
          'Ohne vollständigen Konsolidierungsschlüssel lässt sich dieser Datensatz keiner Gruppe zuordnen',
        naechsteSchritte:
          'Den Wert in der Quelle ergänzen, den Schlüssel anders zusammensetzen - oder den Datensatz einzeln entscheiden',
      });

      nichtVerarbeitet.push({
        quelle: this.quellenname(eintrag.datensatz.quelle, namen),
        zeile: eintrag.datensatz.zeile,
        grund: `Ohne Wert in ${eintrag.fehlend.map((feld) => `„${feld}"`).join(' und ')} keiner Gruppe zuzuordnen`,
      });
    }

    const dublettenregel: Dublettenregel =
      auftrag.dubletten ?? (auftrag.art === 'MERGE' ? { auswahl: 'ZUSAMMENFUEHREN' } : { auswahl: 'ALLE_BEHALTEN' });

    this.pruefeReihenfolge(auftrag, gruppierung.gruppen, dublettenregel, hinweise);

    for (const [schluessel, gruppe] of gruppierung.gruppen) {
      const klartext = gruppierung.klartext.get(schluessel) ?? schluessel;
      const geordnet = this.behandleAnreichern(auftrag, klartext, gruppe, namen, konflikte, nichtVerarbeitet);

      if (geordnet.length === 0) {
        continue;
      }

      for (const teilgruppe of geordnet) {
        /*
         * Die Dublettenfrage stellt sich nur unter **Gleichrangigen**. Beim
         * Anreichern ist ein Hauptdatensatz mit seinen Zusatzdatensätzen genau
         * das, was gewollt war; ihn als Dublette zu melden hieße, den Normalfall
         * zum Befund zu erklären, und nach zehn Läufen liest den Bericht
         * niemand mehr. Doppelt ist beim Anreichern ein **zweiter Datensatz der
         * Hauptdatei** — mehrere aus derselben Zusatzdatei sind ein
         * Mehrfachtreffer und haben ihre eigene Regel.
         *
         * Die Zusatzdatensätze reichern danach an, was übrig bleibt: Bleibt von
         * zwei doppelten Hauptdatensätzen einer stehen, bekommt dieser die
         * Ergänzungen.
         */
        const fuehrende =
          auftrag.betriebsart === 'SAMMELN'
            ? teilgruppe
            : teilgruppe.filter((datensatz) => datensatz.quelle === auftrag.fuehrend);

        /*
         * Ohne Hauptdatensatz — zugelassen über `ohneHauptsatz: UEBERNEHMEN` —
         * gibt es niemanden, den die Zusatzdatensätze anreichern könnten. Dann
         * sind sie untereinander gleichrangig, und die Dublettenfrage stellt
         * sich unter ihnen.
         */
        const gleichrangig = fuehrende.length > 0 ? fuehrende : teilgruppe;
        const ergaenzende = teilgruppe.filter((datensatz) => !gleichrangig.includes(datensatz));

        const ergebnis = behandleDubletten(
          klartext,
          gleichrangig,
          dublettenregel,
          auftrag.entscheidung?.quellen ?? []
        );

        if (ergebnis.befund) {
          dubletten.push(ergebnis.befund);
        }

        for (const beiseite of ergebnis.beiseite) {
          zurueckgestellt.push({
            quelle: namen.get(beiseite.datensatz.quelle)
              ? bezeichnung(namen.get(beiseite.datensatz.quelle) as Quelle)
              : beiseite.datensatz.quelle,
            zeile: beiseite.datensatz.zeile,
            verbleib: beiseite.verbleib,
            grund: beiseite.grund,
            werte: felder.map((feld) => beiseite.datensatz.werte.get(feld) ?? ''),
          });
        }

        if (ergebnis.behandlung.art === 'ENTSCHEIDUNG') {
          konflikte.push(
            this.dublettenkonflikt(klartext, ergebnis.behandlung.datensaetze, namen, ergebnis.befund?.behandlung)
          );

          this.vermerke(
            nichtVerarbeitet,
            teilgruppe,
            namen,
            `Die Dublettengruppe „${klartext}" geht als Ganzes an einen Menschen`
          );

          continue;
        }

        /*
         * `EINZELN` heißt: Die Gleichrangigen bleiben getrennte Zeilen. Jede
         * bekommt trotzdem ihre Ergänzungen — sonst fielen beim Anreichern
         * genau die Werte weg, um derentwillen die Zusatzdateien da sind.
         */
        const zusammenzufassen =
          ergebnis.behandlung.art === 'EINZELN'
            ? ergebnis.behandlung.datensaetze.map((datensatz) => [datensatz, ...ergaenzende])
            : [[...ergebnis.behandlung.datensaetze, ...ergaenzende]];

        for (const menge of zusammenzufassen) {
          if (menge.length === 1) {
            zeilen.push(alsZeile(menge[0], klartext));
            continue;
          }

          angewandt.add(klartext);

          const vereinigt = fuehreZusammen(
            klartext,
            menge,
            auftrag.entscheidung,
            felder,
            entschieden.get(klartext)
          );

          zusammengefuehrt += 1;

          zeilen.push({
            werte: felder.map((feld) => vereinigt.werte.get(feld) ?? ''),
            herkunft: vereinigt.herkunft,
            /*
              * Nur, wo wirklich abgewogen wurde. Der Filter stand hier schon,
              * traf aber nicht, was er meinte: Bei Einigkeit stehen die übrigen
              * Quellen mit **demselben** Wert in `uebergangen`, und damit ging
              * jede Abschrift als Entscheidung durch — 600 000 deutsche Sätze
              * für 225 000 Zeilen, gemessene 563 MB.
              */
             entscheidungen: vereinigt.felder.filter(wurdeAbgewogen),
            schluessel: klartext,
          });

          for (const konflikt of vereinigt.konflikte) {
            konflikte.push(this.wertekonflikt(klartext, konflikt.feld, konflikt.begruendung, konflikt.angebote, namen));
          }

          for (const feld of vereinigt.felder) {
            if (!feld.pruefhinweis) {
              continue;
            }

            konflikte.push({
              art: 'WERTEKONFLIKT',
              schluessel: klartext,
              feld: feld.feld,
              quelle: this.quellenname(feld.quelle, namen),
              erwartet: 'Die eingestellte Priorität und die übrigen Angaben zeigen in dieselbe Richtung',
              vorgefunden: feld.pruefhinweis,
              angebote: [
                { quelle: this.quellenname(feld.quelle, namen), wert: feld.wert, hinweis: 'von der Priorität gewählt' },
                ...feld.uebergangen.map((angebot) => ({
                  quelle: this.quellenname(angebot.quelle, namen),
                  wert: angebot.wert,
                  hinweis: angebot.stand?.geaendert ? `Datenstand ${angebot.stand.geaendert}` : undefined,
                })),
              ],
              ursache:
                'Eine ausdrücklich eingestellte Priorität ist der erklärte Wille des Benutzers und gilt. ' +
                'Sie ohne Rückfrage zu verwerfen wäre eine stille Entscheidung - sie ohne Hinweis anzuwenden auch',
              naechsteSchritte:
                'Den Wert bestätigen oder die Priorität für dieses Feld ändern. ' +
                'Der Datensatz ist bereits mit dem priorisierten Wert entstanden',
            });
          }
        }
      }
    }

    /*
     * Zum Schluss, und mit den bereits gebildeten Gruppen im Rücken: Was der
     * Schlüssel schon zusammengebracht hat, muss nicht noch als „könnte
     * dasselbe sein" gemeldet werden. Zweimal dieselbe Auskunft ist eine
     * zu viel.
     */
    const inGruppe = new Map<Datensatz, string>();

    for (const [schluessel, gruppe] of gruppierung.gruppen) {
      for (const datensatz of gruppe) {
        inGruppe.set(datensatz, schluessel);
      }
    }

    const verfehlt = [...entschieden.keys()].filter((datensatz) => !angewandt.has(datensatz));

    if (verfehlt.length > 0) {
      hinweise.push(
        `${verfehlt.length} Entscheidung(en) fanden ihren Datensatz nicht wieder ` +
          `(${verfehlt.slice(0, 5).join(', ')}${verfehlt.length > 5 ? ', …' : ''}). ` +
          'Diese Fälle werden erneut vorgelegt'
      );
    }

    return this.bericht(auftrag, {
      felder,
      zeilen,
      konflikte,
      dubletten,
      zurueckgestellt,
      verdacht: this.sucheAehnliche(auftrag, datensaetze, inGruppe, namen, konflikte, hinweise),
      nichtVerarbeitet,
      ergaenzungen: ergaenzt.ergaenzungen,
      ergaenzungsluecken: ergaenzt.luecken,
      referenzen: referenzen.berichte,
      hinweise,
      gelesen,
      zusammengefuehrt,
    });
  }

  /* ---------- Prüfungen vor dem Lauf ---------- */

  private pruefeAuftrag(
    auftrag: Konsolidierungsauftrag,
    konflikte: Konsolidierungskonflikt[],
    hinweise: string[]
  ): void {
    const gesehen = new Set<string>();

    for (const quelle of auftrag.quellen) {
      if (gesehen.has(quelle.id)) {
        konflikte.push({
          art: 'STRUKTUR',
          quelle: bezeichnung(quelle),
          erwartet: 'Jede Quelle mit einer eigenen Kennung',
          vorgefunden: `Die Kennung „${quelle.id}" kommt zweimal vor`,
          ursache:
            'Jede verwendete Quelle muss eindeutig identifizierbar und dem Lauf zuordenbar sein (SPEC-06, Abschnitt 2). ' +
            'Mit zwei gleichen Kennungen verweist jede Herkunftsangabe auf beide',
          naechsteSchritte: 'Den Quellen im Profil unterschiedliche Kennungen geben',
        });
      }

      gesehen.add(quelle.id);
    }

    if (auftrag.betriebsart === 'ANREICHERN') {
      if (!auftrag.fuehrend) {
        konflikte.push({
          art: 'STRUKTUR',
          erwartet: 'Genau eine führende Quelle',
          vorgefunden: 'keine',
          ursache:
            'Beim Anreichern liefert die Hauptdatei die Referenzdatensätze. ' +
            'Sie darf nicht erraten werden, sondern muss eingetragen sein (SPEC-02, Abschnitt 27)',
          naechsteSchritte: 'Im Profil festlegen, welche Quelle führt - oder auf „Sammeln" umstellen',
        });
      } else if (!gesehen.has(auftrag.fuehrend)) {
        konflikte.push({
          art: 'STRUKTUR',
          erwartet: `Eine Quelle mit der Kennung „${auftrag.fuehrend}"`,
          vorgefunden: `Die vorliegenden Quellen heißen: ${[...gesehen].join(', ') || 'keine'}`,
          ursache: 'Die als führend eingetragene Quelle ist in diesem Lauf nicht dabei',
          naechsteSchritte: 'Die Quelle bereitstellen oder die Einstellung berichtigen',
        });
      }

      if (!auftrag.schluessel || auftrag.schluessel.felder.length === 0) {
        konflikte.push({
          art: 'KEIN_SCHLUESSEL',
          erwartet: 'Ein Zuordnungsschlüssel zwischen Haupt- und Zusatzdateien',
          vorgefunden: 'keiner',
          ursache:
            'Ohne Schlüssel lässt sich nicht sagen, welcher Zusatzdatensatz zu welchem Hauptdatensatz gehört ' +
            '(SPEC-02, Abschnitt 28)',
          naechsteSchritte: 'Die Schlüsselfelder je Quelle im Profil eintragen',
        });
      }
    }

    if (auftrag.art === 'MERGE' && (!auftrag.schluessel || auftrag.schluessel.felder.length === 0)) {
      konflikte.push({
        art: 'KEIN_SCHLUESSEL',
        erwartet: 'Ein Konsolidierungsschlüssel',
        vorgefunden: 'keiner',
        ursache:
          'Ein Merge führt Datensätze anhand eines Schlüssels zusammen. Welche Felder ihn bilden, ' +
          'darf Unikom nicht selbst bestimmen (SPEC-04, Abschnitt 7)',
        naechsteSchritte: 'Die Schlüsselfelder eintragen - oder „Sammeln ohne Zusammenführen" wählen',
      });
    }

    if (auftrag.dubletten && (!auftrag.schluessel || auftrag.schluessel.felder.length === 0)) {
      hinweise.push(
        'Für Dubletten ist ein Verhalten eingerichtet, aber kein Schlüssel, an dem sie zu erkennen wären. ' +
          'In diesem Lauf greift die Regel nicht.'
      );
    }

    if (auftrag.quellen.length < 2) {
      hinweise.push(
        `Dieser Lauf hat ${auftrag.quellen.length === 0 ? 'keine' : 'nur eine'} Quelle. ` +
          'Konsolidiert wird trotzdem - die Regeln gelten auch innerhalb einer Datei.'
      );
    }
  }

  /**
   * Ob die Reihenfolge mitentscheidet, ohne bestimmbar zu sein (SPEC-06,
   * Abschnitt 7).
   *
   * „Ersten behalten" und „letzten behalten" hängen daran, in welcher Folge die
   * Quellen ankommen. Solange nur eine Quelle je Gruppe beiträgt, ist das
   * gleichgültig. Sobald mehrere beitragen und keine Priorität eingerichtet
   * ist, entscheidet die Ladereihenfolge — und das ist keine fachliche
   * Entscheidung, sondern ein Zufall mit ordentlichem Aussehen.
   */
  private pruefeReihenfolge(
    auftrag: Konsolidierungsauftrag,
    gruppen: ReadonlyMap<string, Datensatz[]>,
    regel: Dublettenregel,
    hinweise: string[]
  ): void {
    if (regel.auswahl !== 'ERSTER' && regel.auswahl !== 'LETZTER') {
      return;
    }

    if ((auftrag.entscheidung?.quellen ?? []).length > 0) {
      return;
    }

    const betroffen = [...gruppen.values()].filter(
      (gruppe) => new Set(gruppe.map((datensatz) => datensatz.quelle)).size > 1
    );

    if (betroffen.length > 0) {
      hinweise.push(
        `In ${betroffen.length} Gruppe(n) tragen mehrere Quellen bei, und es bleibt ` +
          `${regel.auswahl === 'ERSTER' ? 'der erste' : 'der letzte'} Datensatz. ` +
          'Welcher das ist, entscheidet damit die Reihenfolge, in der die Quellen gelesen wurden. ' +
          'Eine Quellenpriorität macht daraus eine fachliche Entscheidung.'
      );
    }
  }

  /* ---------- Anreichern ---------- */

  /**
   * Die Gruppe auf Hauptsatz und Mehrfachtreffer prüfen.
   *
   * Zurück kommen die Teilgruppen, die weiterverarbeitet werden — beim
   * Mehrfachtreffer-Verhalten `ALLE` sind es mehrere, sonst höchstens eine.
   */
  private behandleAnreichern(
    auftrag: Konsolidierungsauftrag,
    schluessel: string,
    gruppe: Datensatz[],
    namen: ReadonlyMap<string, Quelle>,
    konflikte: Konsolidierungskonflikt[],
    nichtVerarbeitet: Nichtverarbeitet[]
  ): Datensatz[][] {
    if (auftrag.betriebsart !== 'ANREICHERN' || !auftrag.fuehrend) {
      return [gruppe];
    }

    const haupt = gruppe.filter((datensatz) => datensatz.quelle === auftrag.fuehrend);

    if (haupt.length === 0) {
      const verhalten = auftrag.ohneHauptsatz ?? 'KONFLIKT';
      const fuehrende = namen.get(auftrag.fuehrend);

      if (verhalten === 'UEBERNEHMEN') {
        return [gruppe];
      }

      if (verhalten === 'KONFLIKT') {
        const erster = gruppe[0];

        konflikte.push({
          art: 'FEHLENDER_HAUPTSATZ',
          schluessel,
          quelle: this.quellenname(erster.quelle, namen),
          blatt: namen.get(erster.quelle)?.blatt,
          zeile: erster.zeile,
          erwartet: `Ein Datensatz in ${fuehrende ? bezeichnung(fuehrende) : auftrag.fuehrend} mit dem Schlüssel „${schluessel}"`,
          vorgefunden: `Nur ${gruppe.length} Datensatz/Datensätze aus ${[
            ...new Set(gruppe.map((datensatz) => this.quellenname(datensatz.quelle, namen))),
          ].join(', ')}`,
          ursache:
            'Beim Anreichern liefert die Hauptdatei die Referenzdatensätze. Aus einer Zusatzdatei einen neuen ' +
            'Hauptdatensatz zu erzeugen, ist standardmäßig nicht erlaubt (SPEC-02, Abschnitt 30)',
          naechsteSchritte:
            'Prüfen, ob der Hauptdatensatz fehlt oder der Schlüssel nicht passt. ' +
            'Sollen solche Datensätze aufgenommen werden, ist das ausdrücklich einzustellen',
        });
      }

      this.vermerke(
        nichtVerarbeitet,
        gruppe,
        namen,
        verhalten === 'KONFLIKT'
          ? `Kein Hauptdatensatz für den Schlüssel „${schluessel}" - der Fall wartet auf eine Entscheidung`
          : `Kein Hauptdatensatz für den Schlüssel „${schluessel}"; eingerichtet ist, ihn zu übergehen`
      );

      return [];
    }

    /* Mehrfachtreffer: mehrere Zusatzdatensätze auf denselben Hauptsatz. */
    const regel = auftrag.mehrfachtreffer ?? { regel: 'KONFLIKT' as const };
    const zusatz = gruppe.filter((datensatz) => datensatz.quelle !== auftrag.fuehrend);
    const jeQuelle = new Map<string, Datensatz[]>();

    for (const datensatz of zusatz) {
      jeQuelle.set(datensatz.quelle, [...(jeQuelle.get(datensatz.quelle) ?? []), datensatz]);
    }

    const mehrfach = [...jeQuelle.entries()].filter(([, saetze]) => saetze.length > 1);

    if (mehrfach.length === 0) {
      return [gruppe];
    }

    if (regel.regel === 'KONFLIKT') {
      for (const [quelle, saetze] of mehrfach) {
        konflikte.push({
          art: 'MEHRFACHTREFFER',
          schluessel,
          quelle: this.quellenname(quelle, namen),
          blatt: namen.get(quelle)?.blatt,
          zeile: saetze[0].zeile,
          erwartet: 'Genau ein Treffer je Hauptdatensatz',
          vorgefunden: `${saetze.length} Datensätze (Zeile ${saetze.map((satz) => satz.zeile).join(', ')})`,
          ursache:
            'Eingerichtet ist, dass ein Hauptdatensatz höchstens einen Zusatzdatensatz je Quelle hat ' +
            '(SPEC-02, Abschnitt 29)',
          naechsteSchritte:
            'Entweder mehrere Treffer zulassen, ein Feld bestimmen, das unter ihnen entscheidet - ' +
            'oder die Zusatzdatei prüfen',
        });
      }

      this.vermerke(nichtVerarbeitet, gruppe, namen, `Mehrfachtreffer beim Schlüssel „${schluessel}"`);

      return [];
    }

    if (regel.regel === 'FELD') {
      const gewaehlt = zusatz.filter((datensatz) => {
        const saetze = jeQuelle.get(datensatz.quelle) ?? [];

        return saetze.length === 1 || this.besterNach(saetze, regel.feld, regel.nimm) === datensatz;
      });

      return [[...haupt, ...gewaehlt]];
    }

    /*
     * `ALLE`: Aus einem Hauptdatensatz werden so viele Ergebniszeilen, wie es
     * Treffer gibt — das Verhalten eines Joins. Bei zwei Zusatzquellen mit je
     * zwei Treffern sind das vier; das Kreuzprodukt ist gewollt und wird
     * begrenzt, damit eine falsch eingerichtete Zuordnung nicht den Speicher
     * füllt, bevor irgendjemand die Meldung liest.
     */
    const mengen = [...jeQuelle.values()];
    const anzahl = mengen.reduce((menge, saetze) => menge * saetze.length, 1);

    if (anzahl > KREUZPRODUKT_GRENZE) {
      konflikte.push({
        art: 'MEHRFACHTREFFER',
        schluessel,
        quelle: this.quellenname(mehrfach[0][0], namen),
        erwartet: `Höchstens ${KREUZPRODUKT_GRENZE} Verbindungen je Hauptdatensatz`,
        vorgefunden: `${anzahl} Verbindungen aus ${mengen.map((saetze) => saetze.length).join(' × ')}`,
        ursache:
          'Alle Treffer zu übernehmen vervielfacht den Hauptdatensatz. In dieser Größenordnung ist das ' +
          'fast immer ein falsch gewählter Schlüssel und nicht die Absicht',
        naechsteSchritte: 'Den Zuordnungsschlüssel prüfen - er trifft vermutlich zu viele Datensätze',
      });

      this.vermerke(
        nichtVerarbeitet,
        gruppe,
        namen,
        `Zu viele Verbindungen beim Schlüssel „${schluessel}"; der Schlüssel trifft vermutlich zu breit`
      );

      return [];
    }

    let kombinationen: Datensatz[][] = [[]];

    for (const saetze of mengen) {
      kombinationen = kombinationen.flatMap((bisher) => saetze.map((satz) => [...bisher, satz]));
    }

    return kombinationen.map((kombination) => [...haupt, ...kombination]);
  }

  private besterNach(saetze: Datensatz[], feld: string, nimm: 'GROESSTER' | 'KLEINSTER'): Datensatz {
    return saetze.reduce((bisher, satz) => {
      const links = bisher.werte.get(feld) ?? '';
      const rechts = satz.werte.get(feld) ?? '';
      const vergleich = links.localeCompare(rechts, 'de-DE', { numeric: true });

      return nimm === 'GROESSTER' ? (vergleich >= 0 ? bisher : satz) : vergleich <= 0 ? bisher : satz;
    });
  }

  /* ---------- Referenz und Ergänzung ---------- */

  private gleicheReferenzenAb(
    auftrag: Konsolidierungsauftrag,
    datensaetze: Datensatz[],
    namen: ReadonlyMap<string, Quelle>,
    konflikte: Konsolidierungskonflikt[]
  ): { datensaetze: Datensatz[]; berichte: Referenzbericht[] } {
    if (!auftrag.referenzen || auftrag.referenzen.length === 0) {
      return { datensaetze, berichte: [] };
    }

    const indizes: Referenzindex[] = auftrag.referenzen.map((eintrag) =>
      referenzindex(eintrag.bestand, eintrag.regel)
    );
    const kopien = datensaetze.map((datensatz) => ({ ...datensatz, werte: new Map(datensatz.werte) }));
    const berichte: Referenzbericht[] = indizes.map((index) => ({
      bestand: index.bestand.name,
      version: index.bestand.version,
      treffer: 0,
      ohneTreffer: 0,
      mehrdeutig: 0,
      uebernahmen: 0,
    }));

    indizes.forEach((index, stelle) => {
      const bericht = berichte[stelle];

      kopien.forEach((datensatz) => {
        const ergebnis = gleicheAb(datensatz, index);

        if (ergebnis.art === 'TREFFER') {
          bericht.treffer += 1;

          for (const uebernahme of ergebnis.uebernahmen) {
            /*
             * Ein vorhandener Wert wird nicht überschrieben. Die Referenz
             * ergänzt; sie korrigiert nicht. Was in den Daten steht und von der
             * Referenz abweicht, ist eine Aussage über die Daten und gehört vor
             * einen Menschen, nicht unter den Teppich.
             */
            if (uebernahme.ueberschrieben !== undefined) {
              konflikte.push({
                art: 'REFERENZ_MEHRDEUTIG',
                quelle: this.quellenname(datensatz.quelle, namen),
                zeile: datensatz.zeile,
                feld: uebernahme.feld,
                erwartet: `„${uebernahme.wert}" laut „${index.bestand.name}"`,
                vorgefunden: `„${uebernahme.ueberschrieben}" in den Daten`,
                ursache:
                  'Die Referenz kennt zu diesem Schlüssel einen anderen Wert. Übernommen wird nichts: ' +
                  'Die Referenz ergänzt fehlende Werte und korrigiert keine vorhandenen',
                naechsteSchritte: 'Entscheiden, welcher Wert gilt - die Daten oder die Referenz',
              });
              continue;
            }

            datensatz.werte.set(uebernahme.feld, uebernahme.wert);
            bericht.uebernahmen += 1;
          }

          return;
        }

        if (ergebnis.art === 'MEHRDEUTIG') {
          bericht.mehrdeutig += 1;
          konflikte.push({
            art: 'REFERENZ_MEHRDEUTIG',
            quelle: this.quellenname(datensatz.quelle, namen),
            zeile: datensatz.zeile,
            feld: index.regel.felder.join(' + '),
            erwartet: `Genau einen Eintrag in „${index.bestand.name}"`,
            vorgefunden: `${ergebnis.zeilen.length} Einträge für „${ergebnis.gesucht}"`,
            ursache: ergebnis.meldung,
            naechsteSchritte: 'Die Referenz bereinigen oder den Abgleich um ein weiteres Feld erweitern',
          });

          return;
        }

        if (ergebnis.art === 'UNVOLLSTAENDIG') {
          return;
        }

        bericht.ohneTreffer += 1;

        if (ergebnis.folge === 'KONFLIKT') {
          konflikte.push({
            art: 'REFERENZ_FEHLT',
            quelle: this.quellenname(datensatz.quelle, namen),
            zeile: datensatz.zeile,
            feld: index.regel.felder.join(' + '),
            erwartet: `„${ergebnis.gesucht}" in „${index.bestand.name}"`,
            vorgefunden: 'kein Eintrag',
            ursache: ergebnis.meldung,
            naechsteSchritte: 'Den Wert berichtigen oder die Referenz um diesen Eintrag ergänzen',
          });
        }
      });
    });

    return { datensaetze: kopien, berichte };
  }

  private ergaenzeFehlende(
    auftrag: Konsolidierungsauftrag,
    datensaetze: Datensatz[],
    hinweise: string[]
  ): { datensaetze: Datensatz[]; ergaenzungen: Ergaenzt[]; luecken: Ergaenzungsluecke[] } {
    if (!auftrag.ergaenzung) {
      return { datensaetze, ergaenzungen: [], luecken: [] };
    }

    /*
     * Ein Schlüsselfeld wird nicht ergänzt. Ein ergänzter Schlüssel schöbe den
     * Datensatz still in eine andere Gruppe — und damit hinge die
     * Zusammenführung an einer Vermutung, statt an dem, was in den Daten steht.
     */
    const schluesselfelder = new Set(auftrag.schluessel?.felder ?? []);
    const felder = auftrag.ergaenzung.felder.filter((feld) => !schluesselfelder.has(feld));
    const ausgenommen = auftrag.ergaenzung.felder.filter((feld) => schluesselfelder.has(feld));

    if (ausgenommen.length > 0) {
      hinweise.push(
        `${ausgenommen.map((feld) => `„${feld}"`).join(' und ')} gehört zum Konsolidierungsschlüssel und wird ` +
          'nicht aus vergleichbaren Datensätzen ergänzt. Ein ergänzter Schlüssel würde den Datensatz einer ' +
          'anderen Gruppe zuordnen, ohne dass es jemand sieht.'
      );
    }

    if (felder.length === 0) {
      return { datensaetze, ergaenzungen: [], luecken: [] };
    }

    return ergaenze(datensaetze, { ...auftrag.ergaenzung, felder });
  }

  /* ---------- Ähnlichkeit ---------- */

  /**
   * Ähnliche, aber nicht gleiche Datensätze (SPEC-04, Abschnitt 7).
   *
   * „Ähnlichkeit allein berechtigt nicht zu einer automatischen
   * Zusammenführung." Hier geschieht deshalb nichts mit den Daten: Beide
   * Datensätze bleiben, wo sie sind, und es entsteht ein Prüffall — genau der
   * „mehrdeutige Fall", den die Spec als Benutzerentscheidung verlangt.
   */
  private sucheAehnliche(
    auftrag: Konsolidierungsauftrag,
    datensaetze: readonly Datensatz[],
    inGruppe: ReadonlyMap<Datensatz, string>,
    namen: ReadonlyMap<string, Quelle>,
    konflikte: Konsolidierungskonflikt[],
    hinweise: string[]
  ): Verdachtsfall[] {
    if (!auftrag.aehnlichkeit) {
      return [];
    }

    const ergebnis = verdaechtigePaare(datensaetze, auftrag.aehnlichkeit);

    if (ergebnis.abgebrochen) {
      hinweise.push(ergebnis.abgebrochen);
      return [];
    }

    const faelle: Verdachtsfall[] = [];

    for (const paar of ergebnis.paare) {
      const links = datensaetze[paar.links];
      const rechts = datensaetze[paar.rechts];

      const gruppeLinks = inGruppe.get(links);

      if (gruppeLinks !== undefined && gruppeLinks === inGruppe.get(rechts)) {
        continue;
      }

      faelle.push(this.verdachtsfall(paar, links, rechts));
      konflikte.push(this.verdachtskonflikt(paar, links, rechts, namen));
    }

    return faelle;
  }

  private verdachtsfall(paar: Verdacht, links: Datensatz, rechts: Datensatz): Verdachtsfall {
    return {
      wert: paar.wert,
      links: { quelle: links.quelle, zeile: links.zeile },
      rechts: { quelle: rechts.quelle, zeile: rechts.zeile },
      felder: paar.felder,
    };
  }

  private verdachtskonflikt(
    paar: Verdacht,
    links: Datensatz,
    rechts: Datensatz,
    namen: ReadonlyMap<string, Quelle>
  ): Konsolidierungskonflikt {
    const abweichend = paar.felder.filter((feld) => feld.links !== feld.rechts);

    return {
      art: 'DUBLETTE_VERMUTET',
      quelle: `${this.quellenname(links.quelle, namen)} Zeile ${links.zeile} · ${this.quellenname(rechts.quelle, namen)} Zeile ${rechts.zeile}`,
      feld: abweichend.map((feld) => feld.feld).join(', ') || paar.felder.map((feld) => feld.feld).join(', '),
      erwartet: 'Zwei Datensätze sind entweder derselbe oder nicht',
      vorgefunden:
        `${Math.round(paar.wert * 100)} % Ähnlichkeit: ` +
        (abweichend.length > 0
          ? abweichend.map((feld) => `${feld.feld} „${feld.links}" gegen „${feld.rechts}"`).join(', ')
          : 'in allen verglichenen Feldern gleich, aber unter verschiedenen Schlüsseln'),
      ursache:
        'Der Konsolidierungsschlüssel hat sie nicht zusammengebracht, die Ähnlichkeitssuche hält sie für ' +
        'möglicherweise identisch. Zusammengeführt wurde nichts - Ähnlichkeit allein berechtigt nicht dazu',
      naechsteSchritte:
        'Entscheiden, ob es dieselben sind. Wenn ja und der Fall wiederkehrt: den Schlüssel anders zusammensetzen ' +
        'oder den Vergleich so einstellen, dass er die Abweichung als Schreibweise behandelt',
    };
  }

  /* ---------- Berichtsteile ---------- */

  /** Eine ganze Gruppe als nicht verarbeitet vermerken — mit demselben Grund. */
  private vermerke(
    liste: Nichtverarbeitet[],
    gruppe: readonly Datensatz[],
    namen: ReadonlyMap<string, Quelle>,
    grund: string
  ): void {
    for (const datensatz of gruppe) {
      liste.push({ quelle: this.quellenname(datensatz.quelle, namen), zeile: datensatz.zeile, grund });
    }
  }

  private quellenname(id: string, namen: ReadonlyMap<string, Quelle>): string {
    const quelle = namen.get(id);

    return quelle ? bezeichnung(quelle) : id;
  }

  private wertekonflikt(
    schluessel: string,
    feld: string,
    begruendung: string,
    angebote: readonly Angebot[],
    namen: ReadonlyMap<string, Quelle>
  ): Konsolidierungskonflikt {
    return {
      art: 'WERTEKONFLIKT',
      schluessel,
      feld,
      quelle: [...new Set(angebote.map((angebot) => this.quellenname(angebot.quelle, namen)))].join(', '),
      erwartet: 'Einen Wert, oder eine Regel, die unter mehreren entscheidet',
      vorgefunden: angebote
        .map((angebot) => `${this.quellenname(angebot.quelle, namen)}: „${angebot.wert}"`)
        .join(' · '),
      angebote: angebote.map((angebot) => ({
        quelle: this.quellenname(angebot.quelle, namen),
        wert: angebot.wert,
        hinweis: angebot.stand?.geaendert ? `Datenstand ${angebot.stand.geaendert}` : undefined,
      })),
      ursache: begruendung,
      naechsteSchritte:
        'Den richtigen Wert auswählen - oder für dieses Feld eine Quellenpriorität einrichten, ' +
        'damit der Fall beim nächsten Lauf von selbst entschieden wird',
    };
  }

  private dublettenkonflikt(
    schluessel: string,
    gruppe: readonly Datensatz[],
    namen: ReadonlyMap<string, Quelle>,
    behandlung?: string
  ): Konsolidierungskonflikt {
    return {
      art: 'DUBLETTE',
      schluessel,
      quelle: [...new Set(gruppe.map((datensatz) => this.quellenname(datensatz.quelle, namen)))].join(', '),
      erwartet: 'Einen Datensatz je Schlüssel',
      vorgefunden: `${gruppe.length} Datensätze: ${gruppe
        .map((datensatz) => `${this.quellenname(datensatz.quelle, namen)} Zeile ${datensatz.zeile}`)
        .join(', ')}`,
      ursache: behandlung ?? 'Die Gruppe soll von einem Menschen entschieden werden',
      naechsteSchritte:
        'Zusammenführen, einen Datensatz übernehmen, einen löschen - oder alle unverändert lassen. ' +
        'Bis dahin bleiben sie unangetastet',
    };
  }

  private bericht(
    auftrag: Konsolidierungsauftrag,
    teile: {
      felder: string[];
      zeilen: Ergebniszeile[];
      konflikte: Konsolidierungskonflikt[];
      dubletten: Dublettenbefund[];
      zurueckgestellt: Zurueckgestellt[];
      verdacht: Verdachtsfall[];
      nichtVerarbeitet: Nichtverarbeitet[];
      ergaenzungen: Ergaenzt[];
      ergaenzungsluecken: Ergaenzungsluecke[];
      referenzen: Referenzbericht[];
      hinweise: string[];
      gelesen: number;
      zusammengefuehrt: number;
    }
  ): Konsolidierungsbericht {
    return {
      quellen: auftrag.quellen.map((quelle) => ({
        id: quelle.id,
        name: quelle.name,
        blatt: quelle.blatt,
        datensaetze: quelle.zeilen.length,
        stand: quelle.stand?.geaendert ?? quelle.stand?.erstellt,
      })),
      felder: teile.felder,
      zeilen: teile.zeilen,
      konflikte: teile.konflikte,
      dubletten: teile.dubletten,
      zurueckgestellt: teile.zurueckgestellt,
      verdacht: teile.verdacht,
      nichtVerarbeitet: teile.nichtVerarbeitet,
      ergaenzungen: teile.ergaenzungen,
      ergaenzungsluecken: teile.ergaenzungsluecken,
      referenzen: teile.referenzen,
      hinweise: teile.hinweise,
      zusammenfassung: {
        quellen: auftrag.quellen.length,
        gelesen: teile.gelesen,
        ergebnis: teile.zeilen.length,
        zusammengefuehrt: teile.zusammengefuehrt,
        dubletten: teile.dubletten.length,
        konflikte: teile.konflikte.length,
        ergaenzt: teile.ergaenzungen.length,
        verdacht: teile.verdacht.length,
        nichtVerarbeitet: teile.nichtVerarbeitet.length,
      },
    };
  }
}

/**
 * Wie viele Verbindungen ein einzelner Hauptdatensatz höchstens eingehen darf.
 *
 * Kein technisches Limit, sondern eine Plausibilitätsgrenze: Wer bei einem
 * Kunden tausend Zusatzdatensätze trifft, hat den Schlüssel falsch gewählt.
 */
const KREUZPRODUKT_GRENZE = 1000;
