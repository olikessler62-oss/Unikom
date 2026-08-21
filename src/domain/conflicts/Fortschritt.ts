import type { Gruppierungsart, Konfliktfilter, Richtung, Sortierart } from './Auswahl.js';
import type { Konfliktfall } from './Konfliktfall.js';

/**
 * Der Bearbeitungsstand des Benutzers (SPEC-07, Abschnitt 10).
 *
 * „Beim erneuten Öffnen der Konfliktbearbeitung wird der Benutzer standardmäßig
 * an die zuletzt bearbeitete Stelle zurückgeführt. […] Die Wiederaufnahme muss
 * auch am nächsten Tag oder nach einem Neustart genau an diesem
 * Bearbeitungsstand möglich sein, **sofern die zugrunde liegenden Daten und
 * Filter noch gültig sind**."
 *
 * Der letzte Halbsatz ist der interessante. Ein Fall kann inzwischen erledigt
 * sein, ein Filter kann ihn nicht mehr treffen, jemand kann ihn ganz anders
 * eingestellt haben. Dann wird **nicht** stillschweigend irgendwo anders
 * angefangen — es wird gesagt, warum der Einstiegspunkt nicht mehr gilt. Wer
 * seine Arbeit gestern an Fall 47 unterbrochen hat und heute bei Fall 3 landet,
 * ohne dass ihm jemand etwas sagt, sucht eine Viertelstunde nach Fall 47.
 *
 * Der Stand gehört **einem Benutzer**, nicht der Installation: Zwei Leute
 * arbeiten an verschiedenen Stellen derselben Liste.
 */
export interface Bearbeitungsstand {
  benutzer: string;
  tenantId: string;
  /** Der zuletzt bearbeitete Fall. */
  zuletzt?: string;
  /** Die Stelle in der Ansicht, ab 0 — für die Bildlaufposition. */
  position?: number;
  filter?: Konfliktfilter;
  gruppierung?: Gruppierungsart;
  sortierung?: Sortierart;
  richtung?: Richtung;
  gespeichert: string;
}

export type Wiedereinstieg =
  | { gilt: true; fallId: string; position: number }
  | { gilt: false; grund: string };

/**
 * Wohin der Benutzer zurückgeführt wird.
 *
 * Geprüft wird gegen die **gefilterte und sortierte** Liste, nicht gegen den
 * Gesamtbestand: Der Fall mag es noch geben, aber wenn der gespeicherte Filter
 * ihn nicht mehr durchlässt, wäre die Rückkehr eine Sprungmarke ins Leere.
 *
 * Die gespeicherte Position dient nur als Notnagel, wenn der Fall selbst nicht
 * mehr auffindbar ist — sie ist die schwächere Angabe: Ein einziger neuer Fall
 * weiter oben verschiebt sie um eins, und dann steht der Benutzer beim
 * falschen.
 */
export function wiedereinstieg(stand: Bearbeitungsstand | undefined, liste: readonly Konfliktfall[]): Wiedereinstieg {
  if (!stand?.zuletzt) {
    return { gilt: false, grund: 'Für diesen Benutzer ist kein Bearbeitungsstand gespeichert' };
  }

  const stelle = liste.findIndex((fall) => fall.id === stand.zuletzt);

  if (stelle >= 0) {
    return { gilt: true, fallId: liste[stelle].id, position: stelle };
  }

  return {
    gilt: false,
    grund:
      `Der zuletzt bearbeitete Fall ${stand.zuletzt.slice(0, 8)} steht nicht mehr in dieser Liste — ` +
      'entweder ist er inzwischen erledigt, oder der gespeicherte Filter lässt ihn nicht mehr durch. ' +
      'Die Liste beginnt deshalb oben',
  };
}
