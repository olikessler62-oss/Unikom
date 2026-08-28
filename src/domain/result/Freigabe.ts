import type { Ergebnispruefung } from './Ergebnispruefung.js';

/**
 * Freigabe des validierten Ergebnisses (SPEC-08, Abschnitt 13; SPEC-01,
 * Abschnitt 14).
 *
 * ## Warum es überhaupt eine automatische Freigabe gibt
 *
 * „Ein geplanter Lauf um zwei Uhr nachts hat keinen Benutzer, der freigeben
 * könnte, und darf deshalb nicht auf einen warten, wenn nichts gegen die
 * Freigabe spricht."
 *
 * Ohne diesen Satz wäre jeder Nachtlauf am Morgen ein Stapel Arbeit, und nach
 * zwei Wochen klickte jemand alles ungelesen durch — die schlechteste aller
 * Freigaben.
 *
 * ```text
 * nichts spricht dagegen  →  Unikom gibt selbst frei, mit Begründung
 * sonst                   →  WAITING_FOR_RELEASE, und ein Mensch entscheidet
 * ```
 *
 * ## Ein nicht freigegebenes Ergebnis ist kein Ergebnis
 *
 * Es darf von Modul 3 nicht übernommen werden. Der Status ist deshalb keine
 * Anzeige, sondern eine Sperre — und `WAITING_FOR_RELEASE` gilt ausdrücklich
 * **nicht** als abgeschlossen.
 */
export type Verarbeitungsstatus =
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'COMPLETED_WITH_CONFLICTS'
  | 'WAITING_FOR_RELEASE'
  | 'FAILED';

export type Freigabeart = 'AUTOMATISCH' | 'MANUELL';

/**
 * Was eingestellt sein kann, damit ein Ergebnis von selbst hinausgeht.
 *
 * Die Voreinstellungen sind die vorsichtigen: Konflikte halten auf, Warnungen
 * nicht. Wer es anders will, stellt es ein — aber niemand muss etwas einstellen,
 * um sicher zu fahren.
 */
export interface Freigabebedingungen {
  /** Ob Warnungen die automatische Freigabe verhindern. Voreinstellung: nein. */
  warnungenBlockieren?: boolean;
  /** Ob Konflikte sie verhindern. Voreinstellung: ja. */
  konflikteBlockieren?: boolean;
  /** Wie viele offene kritische Konfliktfälle höchstens offen sein dürfen. */
  kritischeErlaubt?: number;
  /** Wie viele Datensätze das Ergebnis mindestens enthalten muss. */
  mindestens?: number;
  /**
   * Ob überhaupt automatisch freigegeben werden darf.
   *
   * Für Mandanten, bei denen jedes Ergebnis ein Mensch gesehen haben muss —
   * eine Einstellung und keine Notlösung.
   */
  immerManuell?: boolean;
}

export interface Freigabelage {
  pruefung: Ergebnispruefung;
  /** Offene Konfliktfälle aus SPEC-07, nach Dringlichkeit. */
  konflikte?: { offen: number; kritischOffen: number };
  bedingungen?: Freigabebedingungen;
}

/** Eine einzelne Bedingung und ob sie gehalten hat. */
export interface Bedingungsstand {
  name: string;
  erfuellt: boolean;
  /** In Worten, nachprüfbar. */
  aussage: string;
}

export interface Freigabeurteil {
  frei: boolean;
  status: Verarbeitungsstatus;
  /**
   * Alle Bedingungen mit ihrem Ausgang.
   *
   * Nicht nur die gescheiterten: SPEC-08, Abschnitt 13, verlangt für die
   * Dokumentation „die Bedingungen, die die Freigabe **getragen** haben". Wer
   * in einem Jahr fragt, warum ein Lauf durchging, findet hier die Antwort und
   * nicht nur ein Häkchen.
   */
  bedingungen: Bedingungsstand[];
  /** Was der Freigabe im Weg steht — die Teilmenge, die nicht erfüllt ist. */
  hindernisse: string[];
  /** Ein Satz für den Bildschirm. */
  erklaerung: string;
}

/**
 * Ob das Ergebnis von selbst hinausgehen darf.
 *
 * Die Funktion entscheidet nicht *ob überhaupt* freigegeben wird — das tut ein
 * Mensch, wenn sie es verneint. Sie beantwortet nur: Spricht etwas dagegen, es
 * ohne Rückfrage zu tun?
 */
export function beurteileFreigabe(lage: Freigabelage): Freigabeurteil {
  const bedingungen = lage.bedingungen ?? {};
  const zahlen = lage.pruefung.zusammenfassung;
  const konflikte = lage.konflikte ?? { offen: 0, kritischOffen: 0 };
  const stand: Bedingungsstand[] = [];

  const pruefe = (name: string, erfuellt: boolean, aussage: string): void => {
    stand.push({ name, erfuellt, aussage });
  };

  pruefe(
    'Keine blockierenden Fehler',
    zahlen.FEHLER === 0,
    zahlen.FEHLER === 0 ? 'Die Ergebnisprüfung hat keinen Fehler gefunden' : `${zahlen.FEHLER} Fehler in der Ergebnisprüfung`
  );

  const kritischErlaubt = bedingungen.kritischeErlaubt ?? 0;

  pruefe(
    'Keine offenen kritischen Konflikte',
    konflikte.kritischOffen <= kritischErlaubt,
    konflikte.kritischOffen === 0
      ? 'Es wartet kein kritischer Fall auf eine Entscheidung'
      : `${konflikte.kritischOffen} kritische Fälle sind offen (erlaubt: ${kritischErlaubt})`
  );

  if (bedingungen.konflikteBlockieren !== false) {
    pruefe(
      'Keine ungeklärten Prüffälle',
      konflikte.offen === 0 && zahlen.KONFLIKT === 0,
      konflikte.offen === 0 && zahlen.KONFLIKT === 0
        ? 'Es steht kein Prüffall mehr offen'
        : `${konflikte.offen} offene Konfliktfälle und ${zahlen.KONFLIKT} Konfliktbefunde in der Prüfung`
    );
  }

  if (bedingungen.warnungenBlockieren) {
    pruefe(
      'Keine Warnungen',
      zahlen.WARNUNG === 0,
      zahlen.WARNUNG === 0
        ? 'Die Prüfung hat nichts angemerkt'
        : `${zahlen.WARNUNG} Warnungen - für diesen Mandanten halten sie die Freigabe auf`
    );
  }

  if (bedingungen.mindestens !== undefined) {
    const genug = lage.pruefung.zahlen.ergebnis >= bedingungen.mindestens;

    pruefe(
      'Mindestmenge erreicht',
      genug,
      genug
        ? `${lage.pruefung.zahlen.ergebnis} Datensätze, verlangt sind ${bedingungen.mindestens}`
        : `Nur ${lage.pruefung.zahlen.ergebnis} Datensätze; verlangt sind ${bedingungen.mindestens}`
    );
  }

  if (bedingungen.immerManuell) {
    pruefe(
      'Automatische Freigabe zugelassen',
      false,
      'Für diesen Mandanten ist eingestellt, dass jedes Ergebnis ein Mensch freigibt'
    );
  }

  const hindernisse = stand.filter((eintrag) => !eintrag.erfuellt);
  const frei = hindernisse.length === 0;

  return {
    frei,
    status: statusFuer(frei, zahlen, konflikte),
    bedingungen: stand,
    hindernisse: hindernisse.map((eintrag) => eintrag.aussage),
    erklaerung: frei
      ? `Das Ergebnis ist freigegeben: ${stand.length} Bedingung(en) geprüft, alle erfüllt`
      : `Das Ergebnis wartet auf eine Freigabe. ${hindernisse.length} Bedingung(en) sind nicht erfüllt: ` +
        hindernisse.map((eintrag) => eintrag.aussage).join('; '),
  };
}

/**
 * Der Status des Verarbeitungslaufs (SPEC-01, Abschnitt 14).
 *
 * `COMPLETED_WITH_WARNINGS` und `COMPLETED_WITH_CONFLICTS` sind abgeschlossene
 * Läufe: Das Ergebnis gilt, es ist nur nicht makellos. `WAITING_FOR_RELEASE`
 * ist etwas anderes — dort gilt gar nichts, bis ein Mensch entschieden hat.
 */
function statusFuer(
  frei: boolean,
  zahlen: Record<string, number>,
  konflikte: { offen: number; kritischOffen: number }
): Verarbeitungsstatus {
  if (!frei) {
    return 'WAITING_FOR_RELEASE';
  }

  if (zahlen.KONFLIKT > 0 || konflikte.offen > 0) {
    return 'COMPLETED_WITH_CONFLICTS';
  }

  return zahlen.WARNUNG > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
}

/**
 * Der Vermerk über eine Freigabe (SPEC-08, Abschnitt 13).
 *
 * Sechs Angaben verlangt die Spec, und alle sechs stehen einzeln da. Besonders
 * die vorletzte: **die Bedingungen, die die Freigabe getragen haben.** Ein
 * Vermerk „automatisch freigegeben" beantwortet in einem Jahr keine einzige
 * Frage.
 */
export interface Freigabevermerk {
  zeitpunkt: string;
  art: Freigabeart;
  /** Bei manueller Freigabe: wer. Bei automatischer: niemand, und das steht da. */
  benutzer?: string;
  benutzerName?: string;
  bedingungen: Bedingungsstand[];
  /** Was die Prüfung ergeben hatte, als freigegeben wurde. */
  pruefstand: Record<string, number>;
  /** Bei einer Freigabe trotz Hindernissen: die Begründung des Menschen. */
  begruendung?: string;
}

/**
 * Ob ein Mensch trotz offener Hindernisse freigeben darf.
 *
 * Er darf — sonst wäre die manuelle Freigabe sinnlos, denn sie kommt gerade
 * dann zum Zug, wenn etwas dagegen spricht. **Aber nicht wortlos:** Wer über
 * ein Hindernis hinweggeht, sagt warum, und der Satz steht im Vermerk. Ein
 * blockierender Fehler aus der Vollständigkeitsprüfung ist davon ausgenommen —
 * dort ist unbekannt, was fehlt, und eine Begründung wäre eine Behauptung über
 * etwas, das niemand gesehen hat.
 */
export type Freigabepruefung = { erlaubt: true; begruendungNoetig: boolean } | { erlaubt: false; grund: string };

export function darfManuellFreigeben(urteil: Freigabeurteil, pruefung: Ergebnispruefung): Freigabepruefung {
  if (pruefung.blockiert) {
    return {
      erlaubt: false,
      grund:
        'Die Ergebnisprüfung hat einen blockierenden Fehler gefunden - Datensätze ohne Verbleib oder eine ' +
        'verfehlte Zielstruktur. Das lässt sich nicht mit einer Begründung freigeben, weil niemand sagen kann, ' +
        'was genau freigegeben würde',
    };
  }

  return { erlaubt: true, begruendungNoetig: !urteil.frei };
}
