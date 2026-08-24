import type { Feature, Job, KonsolidierungConfig, StageConfig, StageId } from '../../api/types.js';
import { LIEFERMODULE } from './stages.js';

/**
 * Wie ausführlich ein Workflow mitschreibt, solange niemand etwas anderes sagt.
 *
 * Jeder Schritt. Ein Protokoll wird gebraucht, wenn etwas schiefging, und dann
 * ist es zu spät, es lauter zu stellen: Der Lauf von heute Nacht kommt nicht
 * wieder. Muss mit `DEFAULT_JOB_LOG_LEVEL` in `src/domain/transfer/TransferJob.ts`
 * übereinstimmen — der Lauf richtet sich nach jenem, die Anzeige nach diesem,
 * und beide müssten dasselbe sagen.
 */
export const DEFAULT_JOB_LOG_LEVEL: NonNullable<Job['logLevel']> = 'DEBUG';

/** Die drei Ausführlichkeiten, die zur Wahl stehen. */
const JOB_LOG_LEVELS: NonNullable<Job['logLevel']>[] = ['DEBUG', 'WARNING', 'ERROR'];

/**
 * Die Angabe dieses Workflows — oder nichts, wenn er keine trägt.
 *
 * „Nichts" ist auch das, was ein älterer Workflow mit „Das Wesentliche"
 * (`INFO`) zurückbekommt: Diese Angabe gibt es nicht mehr, gelaufen wird nach
 * der Voreinstellung, und die Anzeige muss dasselbe sagen wie der Lauf.
 */
export function chosenLogLevel(job: Job): NonNullable<Job['logLevel']> | undefined {
  return JOB_LOG_LEVELS.includes(job.logLevel as NonNullable<Job['logLevel']>) ? job.logLevel : undefined;
}
import type { Language } from '../../settings/preferences.js';

/**
 * Die Schreibweise, in der ein Zeitstempel im Dateinamen landet.
 *
 * Sie wird beim Anlegen festgehalten und danach nicht mehr angefasst. Der Name
 * entsteht nachts im Lauf, wo niemand zusieht — die Sprache des Betrachters
 * kann dort nicht gelten, und ein Workflow, dessen Dateien im Januar anders
 * heißen als im Juni, wäre für jede Weiterverarbeitung ein Problem.
 */
export function notationOf(language: Language): Job['timestampNotation'] {
  return language === 'en' ? 'MONTH_FIRST' : 'DAY_FIRST';
}

/**
 * Welche Kettenglieder ein neuer Workflow einschaltet: **alle, die der Kunde
 * hat.**
 *
 * Ein Kunde, der drei Module besitzt und nur eines angehakt sieht, hält die
 * anderen leicht für nicht vorhanden. Sie stehen zwar ausgegraut in der Kette,
 * aber „ausgegraut" liest sich für viele als „gesperrt" — und dann fragt jemand
 * beim Support nach etwas, das er längst gekauft hat.
 *
 * Der Preis: Ein neuer Workflow hat mehrere Schritte, die noch kein Verzeichnis
 * kennen. Das ist der bessere Preis. Ein Feld, das sichtbar leer ist, fordert
 * zum Ausfüllen auf; ein Modul, das man nicht sieht, fordert zu gar nichts auf.
 *
 * Wer weniger will, hakt ab — und das ist die leichtere Bewegung: Man sieht,
 * was man wegnimmt.
 */
function ketteFuer(features: readonly Feature[]): Pick<Job, 'transfer' | 'consolidation' | 'delivery'> {
  const hat = (feature: Feature): boolean => features.includes(feature);

  /*
   * Die Reihenfolge der Verarbeitung — sie steht fest, gewählt wird nur, welche
   * Glieder mitlaufen. Das Ausliefern ist **ein** Glied: Wer eine der beiden
   * Hälften besitzt, bekommt es.
   */
  const liefert = LIEFERMODULE.some(hat);
  const aktiv = [
    ...(hat('TRANSFER') ? (['TRANSFER'] as const) : []),
    ...(hat('CONSOLIDATION') ? (['CONSOLIDATE'] as const) : []),
    ...(liefert ? (['DELIVER'] as const) : []),
  ];

  /**
   * Wie ein Glied verdrahtet wird.
   *
   * **Vorbestückt aus dem Schritt davor**, wo es einen gibt: Der Workflow soll
   * übernehmen, was das vorige Glied ablegt. Wo keiner davorsteht, bleibt das
   * Verzeichnis leer und wartet auf eine Angabe — geraten wird hier nichts.
   *
   * Verbindlich ist davon nichts: Jedes Glied lässt sich auf ein eigenes
   * Verzeichnis umstellen, auch wenn ein Schritt davor läuft.
   */
  const glied = (stage: StageId, mitAusgang: boolean): StageConfig | undefined => {
    const stelle = aktiv.indexOf(stage as (typeof aktiv)[number]);

    if (stelle < 0) {
      return undefined;
    }

    const davor = stelle > 0;
    const dahinter = stelle < aktiv.length - 1;

    return {
      enabled: true,
      input: davor ? { from: 'PRECEDING' } : { from: 'DIRECTORY', directory: '' },
      ...(mitAusgang
        ? { output: dahinter ? { to: 'FOLLOWING' } : { to: 'DIRECTORY', directory: '' } }
        : {}),
    };
  };

  const konsolidierung = (basis?: StageConfig): KonsolidierungConfig | undefined =>
    basis ? { ...basis, regeln: { betriebsart: 'SAMMELN', art: 'APPEND' } } : undefined;

  /**
   * Der Zweig, mit dem das Ausliefern beginnt.
   *
   * Die **Datei** ist die Voreinstellung, auch wenn beide Hälften gekauft sind:
   * Ein Export legt eine Datei ab, die man ansehen und wegwerfen kann. Ein
   * Datenbankimport berührt ein fremdes System — das soll niemand voreingestellt
   * bekommen, sondern ausdrücklich wählen.
   */
  const ziel = hat('CONVERSION') || !hat('DATA_IMPORT') ? 'DATEI' : 'DATENBANK';
  const ausliefern = glied('DELIVER', ziel === 'DATEI');

  return {
    /*
     * Ausdrücklich gesetzt und nicht weggelassen. „Fehlt" heißt beim Übertragen
     * **an** — eine Regel für Workflows aus der Zeit, als das Glied noch nicht
     * abschaltbar war. Für einen neuen Workflow wäre sie ein Fehler: Ein Kunde
     * ohne dieses Modul konnte damit gar keinen Workflow anlegen, weil das
     * Speichern ein Modul verlangte, das er nie gekauft hat.
     */
    transfer: { enabled: hat('TRANSFER') },
    /*
     * Mit Regeln, nicht ohne. Ein Schritt, der nur „eingeschaltet" sagt, ließe
     * sich speichern und nicht ausführen. „Sammeln, aneinander" ist dabei eine
     * Festlegung und keine Vermutung: Es ist das, was ohne Schlüssel überhaupt
     * möglich ist — und einen Schlüssel zu erraten ist untersagt.
     */
    consolidation: konsolidierung(glied('CONSOLIDATE', true)),
    /*
     * Ein Glied, eine Verzweigung. Beim Datenbankimport fehlt das
     * Zielverzeichnis — er schreibt in Tabellen. Konvertiert wird
     * voreingestellt **nicht**: Das Ergebnis geht hinaus, wie es entstanden
     * ist, bis jemand ein anderes Format verlangt.
     */
    delivery: ausliefern ? { ...ausliefern, ziel } : undefined,
  };
}

/**
 * A new job that is already safe rather than already convenient.
 *
 * SKIP over OVERWRITE, KEEP over DELETE, stability check on: the defaults are
 * the ones where a mistake costs nothing. Somebody who wants a file deleted at
 * the source should have to say so.
 */
export function emptyJob(tenantId: string, language: Language, features: readonly Feature[] = []): Job {
  return {
    ...ketteFuer(features),
    id: '',
    tenantId,
    name: '',
    enabled: true,

    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: '' },
    sourceDirectory: '',

    /*
     * CSV steht voreingestellt da, obwohl eine leere Liste „alle“ bedeutet.
     *
     * „Alle“ ist die weitere Einstellung, aber nicht die übliche: Was hier
     * ankommt, sind Geschäftsdaten als Text. Wer mehr braucht, tippt es dazu
     * — wer nichts ändert, holt sich nicht das Sperrfile von Excel mit.
     */
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.part', '.tmp', '.temp', '.filepart'],
    minimumFileAgeSeconds: 60,
    stabilityCheck: {
      enabled: true,
      intervalSeconds: 5,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },

    destinationDirectory: '',
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    // Ohne Angabe: Die Voreinstellung steht im Feld als Vorschlag, grau und
    // kursiv, und gilt auch so. Sie hier einzutragen sähe aus wie eine
    // Entscheidung, die niemand getroffen hat.
    timestampNotation: notationOf(language),
    encryptionConfig: { enabled: false, provider: 'NONE' },
    /*
     * Löschen als Voreinstellung, nicht Liegenlassen (FR_009, Abschnitt 4).
     *
     * Eine verarbeitete Eingangsdatei, die im Quellverzeichnis stehen bleibt,
     * ist ein Bestand, den niemand verwaltet — bei einer abgelegten E-Mail
     * einer mit Kopfzeilen, Signatur und allem, was sonst darin stand. Wer sie
     * behalten will, sagt es; das Feld steht sichtbar im Formular.
     */
    sourceSuccessAction: 'DELETE',

    detectContentDuplicates: false,

    executionMode: 'MANUAL_AND_AUTOMATIC',
    schedule: {
      type: 'INTERVAL',
      intervalMinutes: 15,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
      missedRunPolicy: 'SKIP',
    },
  };
}

/** Keeps sourceConfig.directory and sourceDirectory from drifting apart. */
export function withSourceDirectory(job: Job, directory: string): Job {
  return {
    ...job,
    sourceDirectory: directory,
    sourceConfig: { ...job.sourceConfig, directory },
  };
}

export function withSourceType(job: Job, sourceType: Job['sourceType']): Job {
  return {
    ...job,
    sourceType,
    sourceConfig: {
      ...job.sourceConfig,
      type: sourceType,
      port: sourceType === 'SFTP' ? 22 : sourceType === 'FTPS' ? 990 : undefined,
      // Certificates are validated unless somebody turns it off deliberately.
      validateCertificates: sourceType === 'FTPS' ? true : undefined,
    },
    // Ein lokales Verzeichnis hat keinen Zugang; einen stehen zu lassen wäre
    // eine Lüge. Eine Freigabe darf einen haben — muss aber nicht.
    credentialId: sourceType === 'LOCAL' ? undefined : job.credentialId,
  };
}

/**
 * Das Gegenstück für die Zielseite.
 *
 * `LOCAL` räumt die Verbindungsangaben ganz weg statt sie stehen zu lassen: Ein
 * Workflow, der ins Dateisystem schreibt und trotzdem einen Server und einen
 * Zugang mit sich trägt, sieht bei der nächsten Durchsicht so aus, als täte er
 * etwas anderes als er tut.
 */
export function withDestinationType(job: Job, destinationType: Job['sourceType']): Job {
  if (destinationType === 'LOCAL') {
    return { ...job, destinationType: 'LOCAL', destinationConfig: undefined, destinationCredentialId: undefined };
  }

  // Eine Freigabe braucht keine Verbindungsangaben — nur den Pfad und
  // womöglich einen Zugang. Server und Port stehen zu lassen hieße, Felder zu
  // füllen, die nichts tun.
  if (destinationType === 'SHARE') {
    return { ...job, destinationType: 'SHARE', destinationConfig: undefined };
  }

  return {
    ...job,
    destinationType,
    destinationConfig: {
      ...(job.destinationConfig ?? { type: destinationType, directory: job.destinationDirectory }),
      type: destinationType,
      port: destinationType === 'SFTP' ? 22 : 990,
      validateCertificates: destinationType === 'FTPS' ? true : undefined,
    },
  };
}

