import type { Strukturvorgabe } from '../discovery/Expectation.js';
import {
  effektiveEinstellungen,
  EINSTELLUNGEN,
  type Ebene,
  type Einstellungen,
  type Einstellungsname,
  type WirksameEinstellungen,
} from './Einstellungen.js';
import type { Feststellungen } from './Feststellungen.js';
import { aktuelleVersion, einfrieren, versionOf, type Profil } from './Profil.js';

/**
 * Der Konfigurations-Schnappschuss (SPEC-01, Abschnitt 10; SPEC-02, Abschnitt 43).
 *
 * Zu Beginn eines Verarbeitungslaufs wird festgehalten, was gerade gilt. Der
 * Lauf arbeitet **ausschließlich** damit. Eine Änderung an Profil, Mapping,
 * Region oder Regeln darf einen laufenden oder abgeschlossenen Lauf nicht
 * nachträglich verändern.
 *
 * ```text
 * Konfiguration V1 ──► Verarbeitung 001
 * Konfiguration V2 ──► Verarbeitung 002
 * ```
 *
 * ## Warum der Schnappschuss die Werte trägt und nicht die Verweise
 *
 * Ein Schnappschuss, der nur `profilId` und `mandantId` merkt und beim Lesen
 * nachschlägt, ist kein Schnappschuss — er ist ein Zeiger auf den heutigen
 * Stand. Die Profilversion wäre noch da, die Mandanteneinstellung aber nicht:
 * Wer am Mandanten die Region ändert, änderte damit rückwirkend die Lesart
 * jedes vergangenen Laufs, und das Protokoll behauptete etwas anderes als das
 * Ergebnis daneben.
 *
 * Deshalb stehen hier die **Werte**. Die Kennungen stehen daneben, damit man
 * hinfindet — nicht, damit man nachschlägt.
 */
export interface Schnappschuss {
  id: string;
  tenantId: string;
  /** Der Lauf, zu dem er gehört. Fehlt bei einer Analyse ohne Lauf. */
  runId?: string;
  erstellt: Date;

  /** Wohin man findet, wenn man es genauer wissen will. */
  profilId?: string;
  profilName?: string;
  profilVersion?: number;

  /** Die Struktur, mit der gelesen wurde. */
  vorgabe?: Strukturvorgabe;
  /** Jede Einstellung mit einem Wert — nichts bleibt offen. */
  einstellungen: WirksameEinstellungen;
  /** Von welcher Ebene jeder Wert stammt (SPEC-02, Abschnitt 41). */
  herkunft: Record<Einstellungsname, Ebene>;
  /** Was an der gelesenen Datei festgestellt wurde. */
  feststellungen?: Feststellungen;
}

export interface SchnappschussRepository {
  save(schnappschuss: Schnappschuss): Promise<Schnappschuss>;
  getById(id: string): Promise<Schnappschuss | undefined>;
  /** Der Schnappschuss eines Laufs — die Frage „womit lief das damals". */
  findByRun(runId: string): Promise<Schnappschuss | undefined>;
}

export interface Schnappschussentwurf {
  id: string;
  tenantId: string;
  runId?: string;
  /** Die Einstellungen des Mandanten — die Ebene, die immer gewinnt. */
  mandant?: Einstellungen;
  /** Das Profil, aus dem gelesen wird. Ohne Profil gilt Mandant über Allgemein. */
  profil?: Profil;
  /** Welche Version gemeint ist; ohne Angabe die aktuelle. */
  version?: number;
  /** Was der Leser an der Datei festgestellt hat. */
  feststellungen?: Feststellungen;
  jetzt?: Date;
}

/**
 * Friert die geltende Konfiguration ein.
 *
 * Wird eine Version verlangt, die es nicht gibt, ist das ein Fehler und kein
 * Anlass, die aktuelle zu nehmen: Ein Lauf, der glaubt, mit Version 3 zu
 * arbeiten, und in Wahrheit Version 5 benutzt, ist schlimmer als einer, der
 * gar nicht erst startet.
 */
export function schnappschussVon(entwurf: Schnappschussentwurf): Schnappschuss {
  const version =
    entwurf.profil === undefined
      ? undefined
      : entwurf.version === undefined
        ? aktuelleVersion(entwurf.profil)
        : versionOf(entwurf.profil, entwurf.version);

  if (entwurf.profil && !version) {
    throw new Error(
      `Das Profil „${entwurf.profil.name}“ hat keine Version ${entwurf.version}. ` +
        'Ein Lauf, der eine Version festhält, die es nicht gibt, ist nicht nachvollziehbar'
    );
  }

  const effektiv = effektiveEinstellungen(entwurf.mandant, version?.einstellungen);
  const einstellungen = {} as Record<string, unknown>;
  const herkunft = {} as Record<string, Ebene>;

  for (const name of EINSTELLUNGEN) {
    einstellungen[name] = effektiv[name].wert;
    herkunft[name] = effektiv[name].ebene;
  }

  return einfrieren({
    id: entwurf.id,
    tenantId: entwurf.tenantId,
    runId: entwurf.runId,
    erstellt: entwurf.jetzt ?? new Date(),
    profilId: entwurf.profil?.id,
    profilName: entwurf.profil?.name,
    profilVersion: version?.version,
    vorgabe: version?.vorgabe,
    einstellungen: einstellungen as WirksameEinstellungen,
    herkunft: herkunft as Record<Einstellungsname, Ebene>,
    // Was der Leser gefunden hat, gewinnt vor dem, was das Profil sich gemerkt
    // hat: Eine Feststellung beschreibt die Datei, die gerade vorliegt.
    feststellungen: entwurf.feststellungen ?? version?.feststellungen,
  });
}
