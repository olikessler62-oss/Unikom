import type { Feature } from '../licensing/Feature.js';
import type { Dateiwahl, Konsolidierungsregeln, Umformungsplan } from './Konsolidierungsschritt.js';


/**
 * The links a workflow can be built from.
 *
 * None of them is a foundation the others rest on. They are separate
 * capabilities, bought separately and combined freely: moving files, cleaning up
 * records, writing them out in another format, loading them into tables. A
 * customer may own only consolidation, and their whole job is then "consolidate
 * the file that already lies in directory X" — no transfer, no output, and that
 * is a complete piece of work, not a fragment.
 *
 * That is why every link says for itself where it reads and where it writes,
 * instead of inheriting it from a neighbour that may not exist. And why the only
 * rule about combinations is that at least one link has to be switched on.
 *
 * **Links carry names, not numbers.** A number cannot mean both "which module is
 * this" and "where does it run": somebody who owns consolidation and conversion
 * runs them first and second, whatever position they hold in a full chain. So
 * the name is the identity, and the number is handed out per workflow — see
 * `numberedStages`.
 *
 * Where links do chain, the connection is a reference and not a copied path. A
 * directory filled in from the transfer step is correct until somebody edits
 * that step, and from then on it is quietly wrong — pointing at a place nothing
 * writes to any more, on a schedule nobody watches.
 */

/** Where a stage reads. */
export type StageInput =
  | { from: 'PRECEDING' }
  | {
      from: 'DIRECTORY';
      directory: string;
      /**
       * Örtliches Verzeichnis oder Windows-Freigabe. Fehlt heißt örtlich —
       * genau das, was jeder Schritt aus der Zeit vor dieser Angabe war.
       *
       * Weiter geht die Auswahl bewusst nicht: Die Konsolidierung liest auf dem
       * Dateisystem dieses Rechners, und ein UNC-Pfad ist ein Pfad im
       * Dateisystem — nur einer, der über das Netz führt. SFTP und FTPS wären
       * eine Abholung, und die gehört dem Übertragen.
       */
      art?: 'LOCAL' | 'SHARE';
      /**
       * Der Zugang zur Freigabe.
       *
       * Ohne ihn wird sie mit dem Konto erreicht, unter dem der Dienst läuft —
       * und das ist beim Kunden selten das richtige.
       */
      credentialId?: string;
    };

/** Where a stage writes. */
export type StageOutput =
  | { to: 'FOLLOWING' }
  | { to: 'DIRECTORY'; directory: string };

/**
 * The transfer link. Its source and destination are the job's own fields — they
 * carry hosts, credentials and host key fingerprints and are far too rich to
 * fold into `StageInput`.
 *
 * Absent means switched on. Every job that existed before the link became
 * switchable did exactly this and nothing else.
 */
export interface TransferStageConfig {
  enabled: boolean;
}

/**
 * Every other link. One shape for all of them: they differ in what they do to
 * the records, not in how they are wired into the chain.
 */
export interface StageConfig {
  enabled: boolean;
  input: StageInput;
  /** Absent where the link writes somewhere that is not a directory. */
  output?: StageOutput;
}

/**
 * Das zweite Glied: **Daten konsolidieren**.
 *
 * Es trägt seine Regeln mit sich. Ein Schritt, der nur `enabled: true` sagt,
 * lässt sich anzeigen und nicht ausführen — und genau das war er, solange die
 * Konsolidierung ausschließlich über die Schnittstelle lief. Ohne Regeln läuft
 * er als reines Zusammenlegen gleichartiger Quellen (`STANDARDREGELN`), und das
 * ist eine Festlegung und keine Vermutung: Einen Schlüssel zu erraten ist
 * ausdrücklich untersagt (SPEC-04, Abschnitt 7).
 */
/**
 * Ein Durchgang der Konsolidierung.
 *
 * Mehrere davon ergeben eine Folge (SPEC-06, Abschnitt 7): erst die
 * Filialdateien zusammenlegen, dann das Ergebnis gegen die Kundenliste
 * anreichern. Jeder Durchgang sagt wie jedes Glied für sich, wo er liest und
 * wo er schreibt — sonst hätte der zweite keine Quelle als die Vermutung, der
 * erste habe schon irgendwohin geschrieben.
 */
/**
 * In welchem Format die Ergebnisdatei geschrieben wird.
 *
 * `FESTBREITEN` braucht eine Feldbeschreibung — ohne sie weiß niemand, welches
 * Feld an welcher Stelle steht, und geraten wird sie nicht: Eine falsch geratene
 * Breite fällt erst dem Empfänger auf, und dort als Datenfehler.
 */
export type Ergebnisformat = 'CSV' | 'FESTBREITEN';

/**
 * Ein Feld fester Breite in der Ausgabe.
 *
 * Hier beschrieben und nicht aus dem Schreiber geholt: Die Domäne sagt, was ein
 * Workflow einstellen kann; wie es auf die Platte kommt, ist Sache der
 * Infrastruktur. Die beiden Beschreibungen passen zueinander, weil sie
 * dieselben Felder tragen — nicht, weil eine die andere kennt.
 */
export interface Festbreitenfeld {
  name: string;
  /** Erste Stelle, ab 1 gezählt — so, wie ein Mensch eine Feldbeschreibung liest. */
  start: number;
  laenge: number;
  ausrichtung?: 'LINKS' | 'RECHTS';
  /** Womit aufgefüllt wird; ohne Angabe das Leerzeichen. */
  fuellzeichen?: string;
  /** Ob ein zu langer Wert gekürzt werden darf. Ohne Angabe nicht. */
  kuerzen?: boolean;
}

export interface Festbreitenausgabe {
  felder: readonly Festbreitenfeld[];
  kopfzeile?: boolean;
}

/**
 * Die optionale Prüfung der Eingangsdateien (SPEC-03 §7; SPEC-08 §2).
 *
 * Geprüft wird **vor** der Verarbeitung: Eine Prüfung hinterher sagt, dass ein
 * Ergebnis auf schlechten Daten beruht — da liegt es aber schon im
 * Zielverzeichnis.
 *
 * ## Zwei Wege, und der zweite ist der alte
 *
 * `profil` verweist auf ein **Schema des Mandanten**: benannt, versioniert,
 * mit Spalten, Typen und Regeln, und in einer Fläche bearbeitbar. Das ist der
 * Weg.
 *
 * `datei` ist eine JSON-Schema-Datei, die jemand von Hand geschrieben hat. Sie
 * steht noch hier, weil sie verdrahtet und getestet ist — ein Ersatz, der erst
 * hinterher gebaut wird, ist kein Ersatz. Sie fällt fort, sobald der Lauf die
 * Regeln des Schemas auswertet.
 *
 * Beides zugleich ist keine Einstellung, sondern eine Unklarheit: Es steht
 * genau eines da.
 */
export interface Schemapruefungsregel {
  /** Die Kennung des Eingangsprofils, gegen das geprüft wird. */
  profil?: string;
  /** Der Pfad einer JSON-Schema-Datei — der alte Weg. */
  datei?: string;
  /**
   * Was mit einer Datei geschieht, die dem Schema nicht genügt. Ohne Angabe
   * wird sie nicht verarbeitet: Wer ein Schema hinterlegt, will nicht, dass
   * eine verletzende Datei trotzdem durchläuft.
   */
  bei?: 'WARNEN' | 'ABBRECHEN';
}

export interface Konsolidierungsdurchgang {
  /** Wie die Ergebnisdatei geschrieben wird; ohne Angabe als CSV. */
  format?: Ergebnisformat;
  festbreiten?: Festbreitenausgabe;
  /** Prüfung der Eingangsdateien vor der Verarbeitung (SPEC-03 §7). */
  schema?: Schemapruefungsregel;
  /** Wie er einem Menschen gegenüber heißt; er steht so in jeder Meldung. */
  name?: string;
  input: StageInput;
  output?: StageOutput;
  regeln?: Konsolidierungsregeln;
  dateien?: Dateiwahl;
  umformung?: Umformungsplan;
}

export interface KonsolidierungConfig extends StageConfig {
  name?: string;
  format?: Ergebnisformat;
  festbreiten?: Festbreitenausgabe;
  schema?: Schemapruefungsregel;
  regeln?: Konsolidierungsregeln;
  dateien?: Dateiwahl;
  /**
   * Weitere Durchgänge hinter diesem (SPEC-06, Abschnitt 7).
   *
   * Der Schritt selbst ist der erste; diese Liste ist seine Fortsetzung. Das
   * Glied bleibt eines — wie oft es rechnet, ist seine eigene Sache und keine
   * Frage an die Nummerierung des Workflows oder an die Lizenz.
   */
  weitere?: Konsolidierungsdurchgang[];
  /**
   * Was **vor** dem Konsolidieren mit den Feldern geschieht (SPEC-09 §8, §9).
   *
   * Trimmen, Schreibweise, Datums- und Zahlenformat, Felder zusammenführen und
   * aufteilen. Vorher und nicht nachher: Ein Schlüssel über „ Meier" und
   * „Meier" fände zwei Kunden, wo einer ist — und die Zusammenführung, die das
   * hätte heilen sollen, findet dann gar nicht erst statt.
   */
  umformung?: Umformungsplan;
}

/**
 * Die Durchgänge als eine Liste — der erste eingeschlossen.
 *
 * Damit gibt es im Ausführer keinen Sonderfall „der erste". Ein Sonderfall wäre
 * die Stelle, an der eine Regel für den ersten Durchgang gilt und für die
 * übrigen vergessen wird.
 */
export function durchgaenge(schritt: KonsolidierungConfig | undefined): Konsolidierungsdurchgang[] {
  if (!schritt) {
    return [];
  }

  return [
    {
      name: schritt.name,
      format: schritt.format,
      festbreiten: schritt.festbreiten,
      schema: schritt.schema,
      input: schritt.input,
      output: schritt.output,
      regeln: schritt.regeln,
      dateien: schritt.dateien,
      umformung: schritt.umformung,
    },
    ...(schritt.weitere ?? []),
  ];
}

/**
 * Wie ein Durchgang einem Menschen gegenüber heißt — im Protokoll, in einer
 * Meldung und in der Fehlermeldung beim Speichern.
 *
 * An **einer** Stelle, weil es dieselbe Sache ist: Wer im Protokoll
 * „Durchgang 2 von 3 (Anreichern)" liest, soll denselben Durchgang meinen wie
 * der, den die Oberfläche beim Speichern benannt hat.
 *
 * Bei einem einzigen bleibt es bei „Konsolidierung" — eine Nummer, wo es nichts
 * zu nummerieren gibt, sieht nach einem Fehler aus.
 */
export function durchgangsname(
  durchgang: Pick<Konsolidierungsdurchgang, 'name'>,
  stelle: number,
  von: number
): string {
  if (von <= 1) {
    return 'Konsolidierung';
  }

  const eigen = durchgang.name?.trim();

  return `Durchgang ${stelle + 1} von ${von}${eigen ? ` (${eigen})` : ''}`;
}

export type StageId = 'TRANSFER' | 'CONSOLIDATE' | 'DELIVER';

/**
 * Wohin das Ergebnis geht — die Verzweigung im dritten Glied.
 *
 * Entweder in eine Datenbank oder als Datei hinaus. **Nicht beides:** Ein
 * Schritt, der zugleich in Tabellen schreibt und eine Datei ablegt, wäre zwei
 * Schritte, und dann müsste geklärt werden, was gilt, wenn einer davon
 * misslingt. Wer beides braucht, baut zwei Workflows.
 */
export type Lieferziel = 'DATENBANK' | 'DATEI';

/** Die Dateiformate, in die geschrieben werden kann. */
export const LIEFERFORMATE = ['CSV', 'JSON', 'XML'] as const;

export type Lieferformat = (typeof LIEFERFORMATE)[number];

/**
 * Das dritte Glied: **Daten exportieren/importieren** (SPEC-01, Abschnitt 32).
 *
 * ```text
 * Daten exportieren/importieren
 *   ├─ in eine Datenbank importieren        Lizenz „Daten importieren"
 *   └─ exportieren                          Ergebnis-Verzeichnis
 *        └─ optional: vorher konvertieren   Lizenz „Daten konvertieren"
 * ```
 *
 * Es war einmal in zwei Glieder zerlegt — „Daten importieren" und „Daten
 * konvertieren" —, und das war falsch. Die beiden sind keine aufeinander
 * folgenden Schritte: Wer in eine Datenbank importiert, konvertiert davor keine
 * Datei, und wer eine Datei ausliefert, importiert nichts. Nebeneinander in
 * einer Kette gestellt, las das Konvertieren aus dem Import — der Tabellen
 * füllt und keine Datei hinterlässt.
 *
 * Das Konvertieren ist deshalb kein Glied, sondern ein **Häkchen am Export**.
 */
export interface DeliverConfig extends StageConfig {
  ziel: Lieferziel;
  /**
   * Vor dem Export in ein anderes Format bringen. Fehlt: Das Ergebnis geht
   * hinaus, wie es entstanden ist.
   */
  konvertieren?: { format: Lieferformat };
}

/** The shape of a workflow: which links it is built from. */
export interface WorkflowShape {
  transfer?: TransferStageConfig;
  consolidation?: KonsolidierungConfig;
  /** Daten exportieren/importieren. */
  delivery?: DeliverConfig;
}

/**
 * The order data runs through, and the order the links are shown in. It is
 * fixed — a workflow chooses which links it uses, not in which order they run,
 * because "convert, then consolidate" would mean consolidating a format the
 * consolidation no longer recognises.
 */
export const STAGE_ORDER: StageId[] = ['TRANSFER', 'CONSOLIDATE', 'DELIVER'];

/** What each link is called. The name is the identity; the number is not. */
export const STAGE_LABELS: Record<StageId, string> = {
  TRANSFER: 'Daten übertragen',
  CONSOLIDATE: 'Daten konsolidieren',
  DELIVER: 'Daten exportieren',
};

/**
 * Which module a link needs. All four are bought separately — the transfer used
 * to be free, which only held while everything else was an addition to it. Once
 * a customer can buy consolidation alone, handing them the transfer for nothing
 * would give away the module that carries the others.
 */
export const STAGE_FEATURES: Record<StageId, Feature | undefined> = {
  TRANSFER: 'TRANSFER',
  CONSOLIDATE: 'CONSOLIDATION',
  // Das dritte Glied hat keine feste Lizenz — sie hängt am gewählten Ziel.
  DELIVER: undefined,
};

/** Die beiden Lizenzen, aus denen das dritte Glied besteht. */
export const LIEFERMODULE: readonly Feature[] = ['DATA_IMPORT', 'CONVERSION'];

/**
 * Welche Module ein Glied braucht — beim Ausliefern abhängig vom Zweig.
 *
 * ```text
 * in eine Datenbank        →  „Daten importieren"
 * exportieren, konvertiert →  „Daten konvertieren"
 * exportieren, unverändert →  eines von beiden
 * ```
 *
 * Die letzte Zeile ist eine Festlegung und keine Ableitung: Ein unveränderter
 * Export ist selbst keine Konvertierung und kein Datenbankimport. Ohne diese
 * Regel könnte aber jemand ganz ohne Modul 3 Dateien hinausschreiben — und das
 * widerspräche der Grenze, die genau das verhindern soll.
 */
export function stageFeatures(stage: StageId, shape: WorkflowShape): Feature[] {
  if (stage !== 'DELIVER') {
    const feature = STAGE_FEATURES[stage];

    return feature ? [feature] : [];
  }

  const delivery = shape.delivery;

  if (!delivery) {
    return [];
  }

  if (delivery.ziel === 'DATENBANK') {
    return ['DATA_IMPORT'];
  }

  return delivery.konvertieren ? ['CONVERSION'] : [...LIEFERMODULE];
}

/**
 * Ob eines der Liefermodule genügt oder alle gebraucht werden.
 *
 * Nur beim unveränderten Export reicht **eines**: Dort steht die Liste für
 * „irgendeine Hälfte von Modul 3", nicht für „beide".
 */
export function eineGenuegt(stage: StageId, shape: WorkflowShape): boolean {
  return stage === 'DELIVER' && shape.delivery?.ziel === 'DATEI' && !shape.delivery.konvertieren;
}

/** The configuration of one link, whichever it is. */
export function stageConfig(shape: WorkflowShape, stage: StageId): StageConfig | undefined {
  switch (stage) {
    case 'CONSOLIDATE':
      return shape.consolidation;
    case 'DELIVER':
      return shape.delivery;
    default:
      return undefined;
  }
}

/**
 * Ob dieses Glied eine Datei ablegt.
 *
 * Der Datenbankimport tut es nicht — er schreibt in Tabellen. Alles andere
 * braucht ein Verzeichnis, in das das Ergebnis kommt.
 */
export function schreibtDatei(shape: WorkflowShape, stage: StageId): boolean {
  return stage !== 'DELIVER' || shape.delivery?.ziel !== 'DATENBANK';
}

/**
 * Whether the transfer link runs. Absent counts as on, so a job stored before
 * the link became switchable keeps doing what it did.
 */
export function transfers(shape: WorkflowShape): boolean {
  return shape.transfer?.enabled !== false;
}

export function stageIsActive(shape: WorkflowShape, stage: StageId): boolean {
  return stage === 'TRANSFER' ? transfers(shape) : stageConfig(shape, stage)?.enabled === true;
}

/** The links that actually run, in order. Any of them may be missing. */
export function activeStages(shape: WorkflowShape): StageId[] {
  return STAGE_ORDER.filter((stage) => stageIsActive(shape, stage));
}

/**
 * The numbers as this workflow shows them: 1, 2, 3 … over the links it actually
 * uses. A workflow of one link gets no number at all — there is no sequence to
 * mark, and a lone "1" would only suggest a missing "2".
 */
export function numberedStages(shape: WorkflowShape): Map<StageId, number> {
  const active = activeStages(shape);
  const numbers = new Map<StageId, number>();

  if (active.length < 2) {
    return numbers;
  }

  active.forEach((stage, index) => numbers.set(stage, index + 1));

  return numbers;
}

/**
 * Which link a stage reads from when it says "the preceding one" — and
 * `undefined` when there is none, which is the normal case for a workflow that
 * does not start with the transfer. Such a step has to be told a directory
 * instead; there is nothing to inherit.
 *
 * A switched-off link in the middle is closed over rather than broken at.
 */
export function precedingStage(stage: StageId, shape: WorkflowShape): StageId | undefined {
  const active = activeStages(shape);
  const position = active.indexOf(stage);

  return position > 0 ? active[position - 1] : undefined;
}

/** The counterpart: which link picks up what this one hands on. */
export function followingStage(stage: StageId, shape: WorkflowShape): StageId | undefined {
  const active = activeStages(shape);
  const position = active.indexOf(stage);

  return position >= 0 ? active[position + 1] : undefined;
}

/** Where the active links put their results — the directories that are ours. */
export function outputDirectories(shape: WorkflowShape): { stage: StageId; directory: string }[] {
  const directories: { stage: StageId; directory: string }[] = [];

  for (const stage of activeStages(shape)) {
    const output = stageConfig(shape, stage)?.output;

    if (output?.to === 'DIRECTORY') {
      directories.push({ stage, directory: output.directory });
    }
  }

  return directories;
}

