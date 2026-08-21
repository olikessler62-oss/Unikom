import {
  KRITIKALITAET_RANG,
  type Konfliktfall,
  type Konfliktstatus,
  type Kritikalitaet,
} from './Konfliktfall.js';

/**
 * Suchen, Filtern, Gruppieren, Sortieren (SPEC-07, Abschnitt 9).
 *
 * „Die Funktionen dienen ausschließlich der Navigation und Auswahl und dürfen
 * den Datenbestand nicht verändern."
 *
 * Deshalb ausnahmslos reine Funktionen: Sie bekommen eine Liste und geben eine
 * neue zurück. Keine sortiert die übergebene Liste an Ort und Stelle — `sort`
 * täte das, und dann hinge die Reihenfolge im Bestand davon ab, was zuletzt
 * jemand auf dem Bildschirm eingestellt hat.
 */
export interface Konfliktfilter {
  /** Die Konflikt-UUID, ganz oder als Anfang. */
  id?: string;
  /** Woran der Datensatz zu erkennen ist. */
  datensatz?: string;
  quelle?: string;
  art?: string;
  status?: readonly Konfliktstatus[];
  kritikalitaet?: readonly Kritikalitaet[];
  /** Ein betroffenes Feld. */
  feld?: string;
  laufId?: string;
  /** Entstanden ab diesem Zeitpunkt (ISO). */
  seit?: string;
  /** Entstanden bis zu diesem Zeitpunkt (ISO). */
  bis?: string;
  /** Wer den Fall gerade in Bearbeitung hat. */
  bearbeiter?: string;
  /** Freitext über Ursache, Datensatz und Werte. */
  suche?: string;
}

export type Gruppierungsart = 'KEINE' | 'ART' | 'STATUS' | 'KRITIKALITAET' | 'QUELLE' | 'FELD' | 'LAUF';

export type Sortierart = 'DRINGLICHKEIT' | 'ENTSTEHUNG' | 'AENDERUNG' | 'ART' | 'DATENSATZ';

export type Richtung = 'AUF' | 'AB';

function enthaelt(text: string | undefined, gesucht: string): boolean {
  return (text ?? '').toLocaleLowerCase('de-DE').includes(gesucht.toLocaleLowerCase('de-DE'));
}

/** Alles, worin die Freitextsuche sucht. */
function suchtext(fall: Konfliktfall): string {
  return [
    fall.id,
    fall.datensatz,
    fall.art,
    fall.ursache,
    fall.erwartet,
    fall.vorgefunden,
    fall.regel ?? '',
    ...fall.quellen,
    ...fall.felder.flatMap((feld) => [feld.feld, ...feld.angebote.map((angebot) => angebot.wert)]),
  ].join(' ');
}

export function passt(fall: Konfliktfall, filter: Konfliktfilter): boolean {
  if (filter.id && !fall.id.toLowerCase().startsWith(filter.id.toLowerCase())) {
    return false;
  }

  if (filter.datensatz && !enthaelt(fall.datensatz, filter.datensatz)) {
    return false;
  }

  if (filter.quelle && !fall.quellen.some((quelle) => enthaelt(quelle, filter.quelle as string))) {
    return false;
  }

  if (filter.art && fall.art !== filter.art) {
    return false;
  }

  if (filter.status && filter.status.length > 0 && !filter.status.includes(fall.status)) {
    return false;
  }

  if (filter.kritikalitaet && filter.kritikalitaet.length > 0 && !filter.kritikalitaet.includes(fall.kritikalitaet)) {
    return false;
  }

  if (filter.feld && !fall.felder.some((feld) => enthaelt(feld.feld, filter.feld as string))) {
    return false;
  }

  if (filter.laufId && fall.laufId !== filter.laufId) {
    return false;
  }

  if (filter.seit && fall.entstanden < filter.seit) {
    return false;
  }

  if (filter.bis && fall.entstanden > filter.bis) {
    return false;
  }

  if (filter.bearbeiter && fall.sperre?.benutzer !== filter.bearbeiter) {
    return false;
  }

  if (filter.suche && !enthaelt(suchtext(fall), filter.suche)) {
    return false;
  }

  return true;
}

export function filtere(faelle: readonly Konfliktfall[], filter: Konfliktfilter = {}): Konfliktfall[] {
  return faelle.filter((fall) => passt(fall, filter));
}

/**
 * Die Voreinstellung: das Dringendste zuerst, bei Gleichstand das Ältere.
 *
 * Beides steht am Fall und behauptet nichts über den Betrieb des Kunden
 * (SPEC-07, Abschnitt 3). Wer eine fachliche Reihenfolge will, stellt sie ein.
 */
function schluesselFuer(fall: Konfliktfall, nach: Sortierart): string | number {
  switch (nach) {
    case 'DRINGLICHKEIT':
      return `${KRITIKALITAET_RANG[fall.kritikalitaet]}${fall.entstanden}`;

    case 'ENTSTEHUNG':
      return fall.entstanden;

    case 'AENDERUNG':
      return fall.geaendert;

    case 'ART':
      return `${fall.art}${fall.entstanden}`;

    case 'DATENSATZ':
      return `${fall.datensatz}${fall.entstanden}`;
  }
}

export function sortiere(
  faelle: readonly Konfliktfall[],
  nach: Sortierart = 'DRINGLICHKEIT',
  richtung: Richtung = 'AUF'
): Konfliktfall[] {
  // Eine Kopie — `sort` verändert sonst die übergebene Liste, und diese
  // Funktion darf am Bestand nichts ändern.
  const sortiert = [...faelle].sort((links, rechts) => {
    const a = schluesselFuer(links, nach);
    const b = schluesselFuer(rechts, nach);

    if (a === b) {
      // Ohne diesen Nachschlag hinge die Reihenfolge gleichrangiger Fälle an
      // der Laune des Sortierverfahrens — und der Wiedereinstieg landete beim
      // nächsten Öffnen woanders.
      return links.id.localeCompare(rechts.id);
    }

    return a < b ? -1 : 1;
  });

  return richtung === 'AB' ? sortiert.reverse() : sortiert;
}

/** Wonach gruppiert wird — der Wert steht dem Benutzer als Überschrift gegenüber. */
function gruppenwert(fall: Konfliktfall, nach: Gruppierungsart): string[] {
  switch (nach) {
    case 'ART':
      return [fall.art];

    case 'STATUS':
      return [fall.status];

    case 'KRITIKALITAET':
      return [fall.kritikalitaet];

    case 'QUELLE':
      return fall.quellen.length > 0 ? fall.quellen : ['ohne Quelle'];

    case 'FELD':
      return fall.felder.length > 0 ? fall.felder.map((feld) => feld.feld) : ['ohne Feld'];

    case 'LAUF':
      return [fall.laufId];

    case 'KEINE':
      return ['alle'];
  }
}

/**
 * Nach einem Merkmal gruppieren.
 *
 * Ein Fall kann in **mehreren** Gruppen stehen — er betrifft zwei Quellen und
 * drei Felder. Ihn willkürlich der ersten zuzuschlagen wäre eine Antwort, die
 * beim Zählen nicht aufgeht: Die Summe der Gruppen wäre kleiner als die Zahl
 * der Fälle, und niemand fände heraus, warum.
 */
export function gruppiere(
  faelle: readonly Konfliktfall[],
  nach: Gruppierungsart = 'KEINE'
): Map<string, Konfliktfall[]> {
  const gruppen = new Map<string, Konfliktfall[]>();

  for (const fall of faelle) {
    for (const wert of gruppenwert(fall, nach)) {
      gruppen.set(wert, [...(gruppen.get(wert) ?? []), fall]);
    }
  }

  return gruppen;
}
