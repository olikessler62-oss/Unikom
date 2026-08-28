import { FEATURE_LABELS, type Feature } from '../licensing/Feature.js';
import type { Ergebnisstand } from './Ergebnisstand.js';
import { istGueltig } from './Ergebnisstand.js';

/**
 * Die Übergabe an Modul 3 — die einzige Tür aus der Konsolidierung heraus.
 *
 * ## Die Grenze
 *
 * ```text
 * Modul 1  Transfer            holt Dateien, legt Dateien ab
 * Modul 2  Konsolidierung      liest, prüft, führt zusammen  →  Ergebnisstand
 * Modul 3  Export / Import     schreibt in Zieldatenbanken, exportiert endgültig
 * ```
 *
 * **In fremde Datenbanken schreibt ausschließlich Modul 3**, und der endgültige
 * Export ebenso. Innerhalb der Konsolidierung ist eine Datenbank ausschließlich
 * Quelle (SPEC-03, Abschnitt 9); Modul 2 schreibt nur seinen eigenen
 * Ergebnisbestand (SPEC-10, Abschnitt 1).
 *
 * Das ist keine Zuständigkeitsfrage, sondern eine Sicherung. Ein Modul, das
 * mitten in der Verarbeitung schon in die Zieldatenbank schreiben **könnte**,
 * schreibt irgendwann bei einem halben Ergebnis hinein — und dann steht dort
 * ein Bestand, den niemand freigegeben hat und den niemand zurücknehmen kann.
 *
 * ## Warum die Tür verschlossen ist, solange nichts freigegeben ist
 *
 * „Ein nicht freigegebenes Ergebnis ist kein gültiges Ergebnis. Es darf von
 * Modul 3 nicht übernommen werden" (SPEC-08, Abschnitt 13; SPEC-02,
 * Abschnitt 38).
 *
 * Diese Funktion ist die Stelle, an der dieser Satz wirkt. Sie steht bewusst
 * **hier** und nicht in Modul 3: Wer die Zusage von der Seite abhängig macht,
 * die sie einhalten soll, hat keine Zusage. Modul 3 bekommt entweder eine
 * Übergabe oder eine Begründung — einen Weg an der Prüfung vorbei gibt es
 * nicht.
 *
 * ## Und die Tür geht nur auf, wenn dahinter jemand steht
 *
 * ```text
 * Unikom-intern           Einstellungen, Regeln, Bedingungen,
 * (Verarbeitungsablauf)   Profile, Zuordnungen, Konfliktentscheidungen
 *                         →  immer und überall schreibbar
 *
 * Migration und Export    Daten verlassen das Haus
 *                         →  nur, wenn Modul 3 gekauft **und** angehakt ist
 * ```
 *
 * Die Trennung ist die zwischen **Verwalten** und **Ausliefern**. Wer keine
 * Auslieferung gekauft hat, soll trotzdem einrichten, prüfen und entscheiden
 * können — sonst wäre eine Installation ohne Modul 3 nicht bedienbar, obwohl
 * die Konsolidierung, die sie gekauft hat, vollständig arbeitet. Was er nicht
 * kann, ist die Daten hinausgeben; und dafür genügt es nicht, das Modul zu
 * besitzen — es muss im Ablauf auch eingeschaltet sein. Ein gekauftes, aber
 * abgeschaltetes Modul ist ein Modul, das der Benutzer für diesen Lauf
 * ausdrücklich nicht wollte.
 */

/**
 * Die beiden Hälften von Modul 3 (SPEC-10).
 *
 * Getrennt gekauft und getrennt angehakt: Eine Datei in einem anderen Format zu
 * schreiben und Datensätze in Tabellen zu laden unterscheidet sich weit mehr,
 * als ein gemeinsamer Name vermuten ließe. Für die Übergabe genügt **eine** von
 * beiden — es geht darum, ob überhaupt jemand da ist, der die Daten annimmt.
 */
export const MODUL_DREI: readonly Feature[] = ['DATA_IMPORT', 'CONVERSION'];

export interface Modulzugang {
  /** Ob das Modul in dieser Installation enthalten ist. */
  gekauft(feature: Feature): boolean;
  /**
   * Ob es im Ablauf eingeschaltet ist.
   *
   * Fehlt die Angabe, gibt es keinen Workflow-Bezug — dann wird nur die Lizenz
   * geprüft, und die Antwort sagt das auch. Stillschweigend „ja" anzunehmen
   * hieße, eine Bedingung wegzulassen und trotzdem zu behaupten, sie sei
   * geprüft worden.
   */
  angehakt?(feature: Feature): boolean;
}

export interface Uebergabe {
  /** Der Ergebnisstand, aus dem übergeben wird. */
  ergebnisId: string;
  tenantId: string;
  laufId: string;
  felder: string[];
  zeilen: string[][];
  /** Wann und wie freigegeben wurde — Modul 3 führt es in seinem Protokoll mit. */
  freigegeben: string;
  freigabeart: 'AUTOMATISCH' | 'MANUELL';
  freigegebenVon?: string;
  /**
   * Woher der Stand kommt.
   *
   * Damit lässt sich von der Zieldatenbank aus zurückgehen bis zu dem Lauf,
   * der die Daten erzeugt hat — und von dort bis zu den Eingangsdateien.
   */
  herkunft: { ausLauf?: string; wiederhergestelltAus?: string };
  datensaetze: number;
}

export type Uebergabepruefung =
  | { ok: true; uebergabe: Uebergabe; geprueft: string[] }
  | { ok: false; grund: string };

/**
 * Ob überhaupt jemand da ist, der die Daten annehmen dürfte.
 *
 * Geprüft wird beides, wie festgelegt: gekauft **und** angehakt. Fehlt der
 * Workflow-Bezug, wird nur das erste geprüft — und die Übergabe sagt in
 * `geprueft`, was sie geprüft hat.
 */
function modulDreiBereit(zugang: Modulzugang): { bereit: boolean; grund?: string; geprueft: string[] } {
  const gekauft = MODUL_DREI.filter((feature) => zugang.gekauft(feature));

  if (gekauft.length === 0) {
    return {
      bereit: false,
      geprueft: [],
      grund:
        'Diese Installation enthält keines der Module, die Daten hinausgeben: ' +
        `${MODUL_DREI.map((feature) => `„${FEATURE_LABELS[feature]}"`).join(' oder ')}. ` +
        'Einrichten, prüfen und entscheiden geht ohne sie - die Daten ausliefern nicht',
    };
  }

  if (!zugang.angehakt) {
    return { bereit: true, geprueft: [`gekauft: ${gekauft.map((feature) => FEATURE_LABELS[feature]).join(', ')}`] };
  }

  const angehakt = gekauft.filter((feature) => zugang.angehakt?.(feature));

  if (angehakt.length === 0) {
    return {
      bereit: false,
      geprueft: [],
      grund:
        `${gekauft.map((feature) => `„${FEATURE_LABELS[feature]}"`).join(' und ')} ist zwar vorhanden, ` +
        'aber in diesem Ablauf nicht eingeschaltet. Ein abgeschaltetes Modul ist eines, das für diesen Lauf ' +
        'ausdrücklich nicht gewollt war',
    };
  }

  return {
    bereit: true,
    geprueft: [
      `gekauft: ${gekauft.map((feature) => FEATURE_LABELS[feature]).join(', ')}`,
      `angehakt: ${angehakt.map((feature) => FEATURE_LABELS[feature]).join(', ')}`,
    ],
  };
}

export function zurUebergabe(stand: Ergebnisstand, zugang: Modulzugang): Uebergabepruefung {
  const modul = modulDreiBereit(zugang);

  if (!modul.bereit) {
    return { ok: false, grund: modul.grund as string };
  }

  if (!istGueltig(stand)) {
    return {
      ok: false,
      grund:
        stand.freigabe === undefined
          ? `Der Ergebnisstand ${stand.id} ist nicht freigegeben (Status ${stand.status}) und darf deshalb nicht ` +
            'übernommen werden. Erst die Freigabe macht aus einem Verarbeitungsergebnis ein gültiges Ergebnis'
          : `Der Ergebnisstand ${stand.id} steht auf ${stand.status} und gilt damit nicht als abgeschlossen`,
    };
  }

  const freigabe = stand.freigabe as NonNullable<Ergebnisstand['freigabe']>;

  return {
    ok: true,
    geprueft: modul.geprueft,
    uebergabe: {
      ergebnisId: stand.id,
      tenantId: stand.tenantId,
      laufId: stand.laufId,
      felder: [...stand.felder],
      zeilen: stand.zeilen.map((zeile) => [...zeile]),
      freigegeben: freigabe.zeitpunkt,
      freigabeart: freigabe.art,
      freigegebenVon: freigabe.benutzerName ?? freigabe.benutzer,
      herkunft: { ausLauf: stand.ausLauf, wiederhergestelltAus: stand.wiederhergestelltAus },
      datensaetze: stand.zeilen.length,
    },
  };
}
