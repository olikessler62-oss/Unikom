import { CONFIDENCE_THRESHOLD } from './Recognition.js';
import type { Datenstand } from './Quellen.js';
import { STANDARDVERGLEICH, vergleichswert, type Vergleich } from './Schluessel.js';

/**
 * Wer gewinnt, wenn zwei Quellen etwas Verschiedenes sagen (SPEC-04,
 * Abschnitt 8; SPEC-06, Abschnitt 5; SPEC-09, Abschnitt 6 und 7).
 *
 * ## Die Reihenfolge ist die Regel
 *
 * ```text
 * 1. alle einig                    →  nichts zu entscheiden
 * 2. nur einer hat einen Wert      →  ergänzen, nicht entscheiden
 * 3. explizite Benutzerregel
 * 4. feldspezifische Priorität
 * 5. Quellenpriorität
 * 6. Aktualitätsregel
 * 7. Mehrheit, wenn sie die Schwelle erreicht
 * 8. sonst Konflikt
 * ```
 *
 * Die ersten beiden Stufen stehen vor jeder Regel, weil dort gar keine
 * Entscheidung ansteht: Wo alle dasselbe sagen, gibt es nichts zu wählen, und
 * wo nur einer etwas sagt, wird ergänzt (SPEC-04, Abschnitt 7).
 *
 * ## Was die Schwelle hier wirklich bedeutet
 *
 * Stufe 7 ist der Fall, den SPEC-06, Abschnitt 5, seit Version 1.2 zulässt:
 * ohne konfigurierte Regel selbst entscheiden, **wenn** die Schwelle aus
 * SPEC-02, Abschnitt 5, erreicht ist und die Begründung festgehalten wird.
 *
 * Als Grundlage dient die Häufigkeit (SPEC-09, Abschnitt 7). Und die rechnet
 * sich ehrlich: Bei zwei Quellen mit zwei Werten steht es 1 : 1 — Konfidenz
 * 0,5, weit unter 0,97. Bei drei Quellen und 2 : 1 sind es 0,67. Die Stufe
 * greift also praktisch nur, wenn viele Quellen dasselbe sagen und eine
 * einzelne ausschert. Das ist kein Versehen, sondern der Zweck: Eine Schwelle,
 * die im Alltag ständig erreicht wird, ist keine.
 *
 * **Eine Entscheidung ohne festgehaltene Begründung ist keine zulässige
 * Entscheidung** (SPEC-06, Abschnitt 5). Deshalb trägt jeder erfolgreiche
 * Ausgang dieser Funktion einen Satz, den ein Mensch prüfen kann — und deshalb
 * ist `begruendung` kein optionales Feld.
 */
export type Entscheidungsgrund =
  | 'EINIG'
  | 'EINZIGER_WERT'
  | 'BENUTZERREGEL'
  | 'FELDPRIORITAET'
  | 'QUELLENPRIORITAET'
  | 'AKTUALITAET'
  | 'MEHRHEIT';

export interface Angebot {
  /** Die `id` der Quelle. */
  quelle: string;
  wert: string;
  stand?: Datenstand;
}

export interface Entscheidungsregeln {
  /**
   * Was der Benutzer für einzelne Felder ausdrücklich festgelegt hat:
   * Feldname → Quelle, die für dieses Feld gilt.
   */
  benutzer?: Readonly<Record<string, { quelle: string; grund?: string }>>;
  /** Feldspezifische Quellenreihenfolge, beste zuerst. */
  jeFeld?: Readonly<Record<string, readonly string[]>>;
  /** Die allgemeine Quellenreihenfolge, beste zuerst. */
  quellen?: readonly string[];
  /** Ob das Änderungsdatum entscheiden darf. */
  aktualitaet?: boolean;
  /** Wann zwei Werte als derselbe gelten. */
  vergleich?: Vergleich;
  /** Ab wann Unikom ohne Regel entscheiden darf; niemals unter 0,97. */
  mindestKonfidenz?: number;
}

export interface Entschieden {
  entschieden: true;
  wert: string;
  quelle: string;
  grund: Entscheidungsgrund;
  /** Der Satz, der die Entscheidung trägt. */
  begruendung: string;
  konfidenz: number;
  /** Was nicht genommen wurde — vollständig, damit man es nachsehen kann. */
  uebergangen: Angebot[];
  /**
   * Die Entscheidung gilt, aber etwas spricht dagegen (SPEC-04, Abschnitt 8).
   * Sie wird nicht stillschweigend übergangen und nicht stillschweigend
   * angewendet: Sie wirkt und erzeugt zugleich einen Prüffall.
   */
  pruefhinweis?: string;
}

export interface Offen {
  entschieden: false;
  begruendung: string;
  angebote: Angebot[];
  konfidenz: number;
}

export type Entscheidung = Entschieden | Offen;

/** Nur, was wirklich etwas sagt — ein leerer Wert ist kein Angebot. */
function gefuellt(angebote: readonly Angebot[]): Angebot[] {
  return angebote.filter((angebot) => angebot.wert.trim() !== '');
}

function nachReihenfolge(angebote: readonly Angebot[], reihenfolge: readonly string[]): Angebot | undefined {
  for (const quelle of reihenfolge) {
    const treffer = angebote.find((angebot) => angebot.quelle === quelle);

    if (treffer) {
      return treffer;
    }
  }

  return undefined;
}

function zeitpunkt(angebot: Angebot): number | undefined {
  const text = angebot.stand?.geaendert ?? angebot.stand?.erstellt;

  if (!text) {
    return undefined;
  }

  const zahl = Date.parse(text);

  return Number.isNaN(zahl) ? undefined : zahl;
}

/**
 * Ob eine verfügbare Information eindeutig gegen die gewählte Quelle spricht.
 *
 * Eindeutig heißt: Beide Zeitpunkte sind bekannt, und der übergangene ist der
 * jüngere. Ein Vergleich, bei dem eine Seite kein Datum hat, sagt nichts —
 * „unbekannt" ist nicht „älter". Genau davor warnt SPEC-04, Abschnitt 8: Es
 * darf nicht angenommen werden, dass der zuletzt eingelesene Wert der
 * aktuellste ist.
 */
function sprichtDagegen(gewaehlt: Angebot, uebrige: readonly Angebot[]): Angebot | undefined {
  const eigener = zeitpunkt(gewaehlt);

  if (eigener === undefined) {
    return undefined;
  }

  return uebrige.find((angebot) => {
    const fremder = zeitpunkt(angebot);

    return fremder !== undefined && fremder > eigener;
  });
}

function ohne(angebote: readonly Angebot[], gewaehlt: Angebot): Angebot[] {
  return angebote.filter((angebot) => angebot !== gewaehlt);
}

/**
 * Der Prüffall, wenn eine eingestellte Priorität gegen die Aktualität steht.
 *
 * Beide Wege wären falsch: Die Priorität zu verwerfen hieße, den erklärten
 * Willen des Benutzers stillschweigend zu übergehen; sie kommentarlos
 * anzuwenden hieße, eine bekannte Gegeninformation zu unterschlagen. Also
 * gilt sie — und der Fall geht zusätzlich an einen Menschen.
 */
function pruefhinweisFuer(gewaehlt: Angebot, juenger: Angebot): string {
  return (
    `Die eingestellte Priorität wählt „${gewaehlt.wert}" aus ${gewaehlt.quelle}, ` +
    `aber ${juenger.quelle} hat mit „${juenger.wert}" den jüngeren Datenstand ` +
    `(${juenger.stand?.geaendert ?? juenger.stand?.erstellt} gegenüber ${gewaehlt.stand?.geaendert ?? gewaehlt.stand?.erstellt}). ` +
    'Die Priorität gilt, weil sie ausdrücklich eingestellt ist — der Fall geht trotzdem zur Prüfung'
  );
}

export function entscheide(feld: string, angebote: readonly Angebot[], regeln: Entscheidungsregeln = {}): Entscheidung {
  const vergleich = regeln.vergleich ?? STANDARDVERGLEICH;
  const schwelle = Math.max(regeln.mindestKonfidenz ?? CONFIDENCE_THRESHOLD, CONFIDENCE_THRESHOLD);
  const werte = gefuellt(angebote);

  /* Niemand hat etwas — auch das ist ein einiges Ergebnis. */
  if (werte.length === 0) {
    return {
      entschieden: true,
      wert: '',
      quelle: angebote[0]?.quelle ?? '',
      grund: 'EINIG',
      begruendung: `Keine Quelle liefert für „${feld}" einen Wert`,
      konfidenz: 1,
      uebergangen: [],
    };
  }

  /* 1. Alle einig — es steht gar keine Entscheidung an. */
  const verschieden = new Set(werte.map((angebot) => vergleichswert(angebot.wert, vergleich)));

  if (verschieden.size === 1) {
    const gewaehlt = regeln.quellen ? (nachReihenfolge(werte, regeln.quellen) ?? werte[0]) : werte[0];

    return {
      entschieden: true,
      wert: gewaehlt.wert,
      quelle: gewaehlt.quelle,
      grund: 'EINIG',
      begruendung:
        werte.length === 1
          ? `Nur ${gewaehlt.quelle} liefert „${feld}"`
          : `Alle ${werte.length} Quellen liefern für „${feld}" denselben Wert`,
      konfidenz: 1,
      uebergangen: ohne(werte, gewaehlt),
    };
  }

  /*
   * 2. Nur eine Quelle hat überhaupt einen Wert — hier wird ergänzt und nicht
   * entschieden. Das ist der Fall aus SPEC-04, Abschnitt 7: Telefon fehlt in A
   * und steht in B, E-Mail umgekehrt. Ein Widerspruch entsteht dabei nicht,
   * denn ein leeres Feld widerspricht nichts.
   *
   * Diese Stufe kann hier nicht mehr greifen — bei einem einzigen gefüllten
   * Wert wäre die Menge oben schon eins gewesen. Sie steht trotzdem in der
   * Beschreibung, weil sie fachlich vor den Regeln kommt und nicht dahinter.
   */

  /* 3. Was der Benutzer für dieses Feld ausdrücklich bestimmt hat. */
  const benutzer = regeln.benutzer?.[feld];

  if (benutzer) {
    const gewaehlt = werte.find((angebot) => angebot.quelle === benutzer.quelle);

    if (gewaehlt) {
      const juenger = sprichtDagegen(gewaehlt, ohne(werte, gewaehlt));

      return {
        entschieden: true,
        wert: gewaehlt.wert,
        quelle: gewaehlt.quelle,
        grund: 'BENUTZERREGEL',
        begruendung:
          benutzer.grund ??
          `Für „${feld}" ist ${benutzer.quelle} ausdrücklich als maßgebliche Quelle eingetragen`,
        konfidenz: 1,
        uebergangen: ohne(werte, gewaehlt),
        pruefhinweis: juenger ? pruefhinweisFuer(gewaehlt, juenger) : undefined,
      };
    }
  }

  /* 4. und 5. Feldspezifische Priorität, sonst die allgemeine. */
  const reihen: { reihenfolge: readonly string[] | undefined; grund: Entscheidungsgrund; wie: string }[] = [
    { reihenfolge: regeln.jeFeld?.[feld], grund: 'FELDPRIORITAET', wie: `die für „${feld}" eingerichtete Reihenfolge` },
    { reihenfolge: regeln.quellen, grund: 'QUELLENPRIORITAET', wie: 'die allgemeine Quellenpriorität' },
  ];

  for (const reihe of reihen) {
    if (!reihe.reihenfolge || reihe.reihenfolge.length === 0) {
      continue;
    }

    const gewaehlt = nachReihenfolge(werte, reihe.reihenfolge);

    if (!gewaehlt) {
      continue;
    }

    const uebergangen = ohne(werte, gewaehlt);
    const juenger = sprichtDagegen(gewaehlt, uebergangen);

    return {
      entschieden: true,
      wert: gewaehlt.wert,
      quelle: gewaehlt.quelle,
      grund: reihe.grund,
      begruendung:
        `${gewaehlt.quelle} steht nach ${reihe.wie} vor ` +
        `${uebergangen.map((angebot) => angebot.quelle).join(' und ')}`,
      konfidenz: 1,
      uebergangen,
      pruefhinweis: juenger ? pruefhinweisFuer(gewaehlt, juenger) : undefined,
    };
  }

  /* 6. Aktualität — nur, wenn sie eingeschaltet ist und jeder ein Datum hat. */
  if (regeln.aktualitaet) {
    const mitZeit = werte.map((angebot) => ({ angebot, zeit: zeitpunkt(angebot) }));
    const ohneZeit = mitZeit.filter((eintrag) => eintrag.zeit === undefined);

    if (ohneZeit.length > 0) {
      return {
        entschieden: false,
        begruendung:
          `Die Aktualität soll über „${feld}" entscheiden, aber für ` +
          `${ohneZeit.map((eintrag) => eintrag.angebot.quelle).join(' und ')} ist kein Datenstand bekannt. ` +
          'Anzunehmen, der zuletzt eingelesene Wert sei der aktuellste, wäre eine Vermutung und keine Regel',
        angebote: [...werte],
        konfidenz: 0,
      };
    }

    const sortiert = [...mitZeit].sort((links, rechts) => (rechts.zeit ?? 0) - (links.zeit ?? 0));

    if (sortiert.length > 1 && sortiert[0].zeit === sortiert[1].zeit) {
      return {
        entschieden: false,
        begruendung:
          `Für „${feld}" tragen ${sortiert[0].angebot.quelle} und ${sortiert[1].angebot.quelle} ` +
          'denselben Datenstand und verschiedene Werte. Die Aktualität kann hier nichts entscheiden',
        angebote: [...werte],
        konfidenz: 0,
      };
    }

    const gewaehlt = sortiert[0].angebot;

    return {
      entschieden: true,
      wert: gewaehlt.wert,
      quelle: gewaehlt.quelle,
      grund: 'AKTUALITAET',
      begruendung:
        `${gewaehlt.quelle} trägt mit ${gewaehlt.stand?.geaendert ?? gewaehlt.stand?.erstellt} ` +
        `den jüngsten Datenstand für „${feld}"`,
      konfidenz: 1,
      uebergangen: ohne(werte, gewaehlt),
    };
  }

  /*
   * 7. Ohne Regel: die Häufigkeit. Sie darf entscheiden, wenn sie die Schwelle
   * erreicht — und sie erreicht sie selten, was der Sinn der Sache ist.
   */
  const haeufigkeit = new Map<string, Angebot[]>();

  for (const angebot of werte) {
    const schluessel = vergleichswert(angebot.wert, vergleich);
    haeufigkeit.set(schluessel, [...(haeufigkeit.get(schluessel) ?? []), angebot]);
  }

  const gruppen = [...haeufigkeit.values()].sort((links, rechts) => rechts.length - links.length);
  const anteil = gruppen[0].length / werte.length;

  if (gruppen.length > 1 && gruppen[0].length > gruppen[1].length && anteil >= schwelle) {
    const gewaehlt = gruppen[0][0];

    return {
      entschieden: true,
      wert: gewaehlt.wert,
      quelle: gewaehlt.quelle,
      grund: 'MEHRHEIT',
      begruendung:
        `${gruppen[0].length} von ${werte.length} Quellen liefern für „${feld}" denselben Wert ` +
        `(${(anteil * 100).toFixed(1)} %). Das liegt über der Schwelle von ${(schwelle * 100).toFixed(0)} %, ` +
        'ab der Unikom ohne eingerichtete Regel entscheiden darf',
      konfidenz: anteil,
      uebergangen: werte.filter((angebot) => !gruppen[0].includes(angebot)),
    };
  }

  /* 8. Konflikt — und zwar mit allem, was ein Mensch zum Entscheiden braucht. */
  return {
    entschieden: false,
    begruendung:
      `Für „${feld}" liegen ${verschieden.size} verschiedene Werte vor und keine Regel, die sie ordnet: ` +
      werte.map((angebot) => `${angebot.quelle} sagt „${angebot.wert}"`).join(', ') +
      `. Die Häufigkeit reicht mit ${(anteil * 100).toFixed(1)} % nicht an die Schwelle von ` +
      `${(schwelle * 100).toFixed(0)} % heran`,
    angebote: [...werte],
    konfidenz: anteil,
  };
}

/**
 * Ob hier wirklich etwas entschieden wurde.
 *
 * ```text
 * EINIG            alle Quellen sagen dasselbe   →  abgeschrieben
 * EINZIGER_WERT    nur eine sagt etwas           →  übernommen
 * alles andere     es lagen verschiedene Werte vor  →  entschieden
 * ```
 *
 * Der Unterschied ist keine Wortklauberei, sondern eine Mengenfrage. Ein Lauf
 * über 225 000 Ergebniszeilen erzeugte 600 000 Feldbegründungen — je einen
 * deutschen Satz —, und **fast alle** lauteten sinngemäß „alle Quellen liefern
 * denselben Wert". Gemessen waren das 563 der 793 MB des Berichts.
 *
 * Einen Wert zu nehmen, den alle anbieten, ist keine Entscheidung, sondern eine
 * Abschrift. Sie zu begründen ist so wenig nötig, wie es unmöglich ist, sie zu
 * lesen: Niemand geht 600 000 Sätze durch.
 *
 * **Was dabei nicht verlorengeht:** die Herkunft jeder Zeile (SPEC-06,
 * Abschnitt 12) bleibt vollständig, und jede Entscheidung, bei der etwas
 * übergangen wurde oder etwas dagegen sprach, steht weiterhin mit ihrem Satz da.
 */
export function wurdeAbgewogen(ergebnis: { grund: Entscheidungsgrund; pruefhinweis?: string }): boolean {
  if (ergebnis.pruefhinweis !== undefined) {
    return true;
  }

  return ergebnis.grund !== 'EINIG' && ergebnis.grund !== 'EINZIGER_WERT';
}
