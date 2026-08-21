import { useEffect, useState, type ReactNode } from 'react';

import { api } from '../../api/client.js';
import { messageOf, useResource } from '../../api/useResource.js';
import type {
  Betriebsart,
  ConnectionTestResult,
  Credential,
  DeliverConfig,
  DirectoryCheckResult,
  Dublettenauswahl,
  Feature,
  Job,
  Konsolidierungsart as Art,
  KonsolidierungConfig,
  Konsolidierungsregeln as Regeln,
  Aufteilung,
  Ueberschuss,
  Konsolidierungsdurchgang,
  Schemapruefungsregel,
  Ergebnisformat as ErgebnisformatTyp,
  Festbreitenfeld,
  Referenzquelle,
  Referenzverweis,
  Umformungsplan,
  Umformungsschritt,
  Umformungsvorschau,
  Zuordnungsvorschau,
  Spaltenvorschau,
  Zusammenfuehrung,
  Entscheidungsregeln,
  Ergaenzungsregel as ErgaenzungsregelTyp,
  Aehnlichkeitsregeln as AehnlichkeitsregelnTyp,
  Mehrfachtrefferregel,
  Lieferformat,
  Lieferziel,
  OhneHauptsatz,
  RemoteDirectoryResult,
  StageConfig,
  StageId,
  StageInput,
  StageOutput,
  Tenant,
} from '../../api/types.js';
import { CredentialForm, PublicKeyPanel } from '../../components/CredentialForm.js';
import { Dateifeld, Verzeichnisfeld, Verzeichnisfenster } from '../../components/Verzeichniswahl.js';
import {
  CheckField,
  DurationField,
  Field,
  FieldButton,
  FolderIcon,
  FolderOpenIcon,
  Klappkarte,
  listentasten,
  ListIcon,
  Hint,
  Loading,
  Modal,
  Notice,
} from '../../components/Pieces.js';
import { useLanguage } from '../../i18n/useText.js';
import {
  chosenLogLevel,
  DEFAULT_JOB_LOG_LEVEL,
  emptyJob,
  notationOf,
  parseList,
  withDestinationType,
  withSourceDirectory,
  withSourceType,
} from './emptyJob.js';

/**
 * Welches Feld gerade ein Verzeichnis sucht.
 *
 * Nicht bloß „Quelle oder Ziel": Jedes dieser Felder wird woanders gesucht.
 * Das Archiv liegt auf demselben Server wie die Quelle — es ist der Ort, an
 * den die Datei nach dem Abholen verschoben wird, und das geschieht dort.
 */
type Side = 'SOURCE' | 'ARCHIVE' | 'DESTINATION';

/**
 * Endungen zum Anklicken, statt sie aus dem Kopf zu tippen.
 *
 * Zwei getrennte Listen, weil es zwei verschiedene Fragen sind. Oben steht,
 * was übernommen werden soll — die Formate, in denen Geschäftsdaten kommen.
 * Unten steht, was gerade erst geschrieben wird und deshalb nie angefasst
 * werden darf; diese Namen sind nicht ausgedacht, sondern die, die
 * Übertragungsprogramme wirklich vergeben.
 *
 * Getippt werden darf weiterhin: Die Liste ist eine Abkürzung, keine Schranke.
 * Kein Kunde der Welt lässt sich seine Hausendung ausreden.
 */
const EXTENSION_CHOICES: Record<ExtensionField, { label: string; options: { value: string; hint: string }[] }> = {
  ALLOWED: {
    label: 'Berücksichtigte Endungen',
    options: [
      { value: 'csv', hint: 'Tabelle als Text, der häufigste Fall' },
      { value: 'xml', hint: 'strukturierte Daten' },
      { value: 'json', hint: 'strukturierte Daten' },
      { value: 'txt', hint: 'freies Textformat' },
      { value: 'xlsx', hint: 'Excel' },
      { value: 'xls', hint: 'Excel, ältere Fassung' },
      { value: 'pdf', hint: 'Belege und Rechnungen' },
      { value: 'edi', hint: 'EDIFACT und Verwandte' },
      { value: 'dat', hint: 'Ausgaben älterer Systeme' },
      { value: 'zip', hint: 'gepackte Lieferungen' },
    ],
  },
  TEMPORARY: {
    label: 'Endungen unfertiger Uploads',
    options: [
      { value: '.part', hint: 'FileZilla und viele andere' },
      { value: '.tmp', hint: 'weit verbreitet' },
      { value: '.temp', hint: 'weit verbreitet' },
      { value: '.filepart', hint: 'FileZilla' },
      { value: '.crdownload', hint: 'Chrome' },
      { value: '.partial', hint: 'Edge und Internet Explorer' },
      { value: '.opdownload', hint: 'Opera' },
      { value: '.!ut', hint: 'µTorrent' },
      { value: '.writing', hint: 'einige ERP-Ausgaben' },
      { value: '.lock', hint: 'Sperrdatei neben der eigentlichen' },
    ],
  },
};

type ExtensionField = 'ALLOWED' | 'TEMPORARY';

/** Welches Feld die Endung bekommt, wenn im Fenster etwas angehakt wird. */
function extensionsOf(job: Job, field: ExtensionField): string[] {
  return field === 'ALLOWED' ? job.allowedExtensions : job.ignoredTemporaryExtensions;
}

/**
 * Vergleicht Endungen so, wie ein Anwender sie meint.
 *
 * `csv`, `.csv` und `.CSV` sind dieselbe Endung. Ohne diesen Vergleich stünde
 * eine Endung zweimal im Feld, sobald jemand sie erst tippt und dann anhakt —
 * und das Häkchen wäre bei einer schon eingetragenen Endung nicht gesetzt.
 */
function sameExtension(left: string, right: string): boolean {
  const bare = (value: string): string => value.trim().replace(/^\.+/, '').toLowerCase();
  return bare(left) === bare(right);
}

/**
 * Die Verzeichnisse, an denen dieser Mandant schon arbeitet.
 *
 * Nur lokale: Ein Pfad auf einem SFTP-Server bedeutet auf einem anderen Server
 * etwas ganz anderes, und ihn dort zur Auswahl anzubieten führte zuverlässig
 * ins Leere. Der Workflow, der gerade bearbeitet wird, bleibt außen vor — sein
 * eigener Pfad steht ja schon im Feld daneben.
 */
function knownDirectories(jobs: Job[] | undefined, current: Job): string[] {
  return (jobs ?? [])
    .filter((entry) => entry.id !== current.id && entry.tenantId === current.tenantId)
    .flatMap((entry) => [
      (entry.destinationType ?? 'LOCAL') === 'LOCAL' ? entry.destinationDirectory : undefined,
      entry.sourceType === 'LOCAL' ? entry.sourceDirectory : undefined,
      entry.sourceType === 'LOCAL' ? entry.sourceArchiveDirectory : undefined,
    ])
    .filter((directory): directory is string => Boolean(directory?.trim()));
}

/**
 * Eine Änderung an den Verbindungsangaben des Ziels. Steht hier, weil sie in
 * jedem Feld der Zielseite gebraucht wird und der Ausdruck sonst achtmal
 * dasteht — samt der Vorbelegung für den Fall, dass es noch keine gibt.
 */
function changeTarget(
  job: Job,
  change: (patch: Partial<Job>) => void,
  patch: Partial<NonNullable<Job['destinationConfig']>>
): void {
  change({
    destinationConfig: {
      ...(job.destinationConfig ?? {
        type: job.destinationType ?? 'SFTP',
        directory: job.destinationDirectory,
      }),
      ...patch,
    },
  });
}
import {
  followingOf,
  isConfigurable,
  numbersOf,
  precedingOf,
  stageIsActive,
  stageOf,
  STAGE_DESCRIPTIONS,
  stageAvailable,
  STAGE_FIELDS,
  STAGE_LABELS,
  transfers,
  type ConfigurableStage,
} from './stages.js';
import { zugangFuerFreigabe } from './freigaben.js';
import { Stapelwahl } from './Stapelwahl.js';
import {
  ausgangStand,
  eingangStand,
  dateiwahlStand,
  nachlaufStand,
  quelleStand,
  zielStand,
} from './feldstand.js';

/**
 * Ein Workflow ist eine Kette: Daten kommen herein, es geschieht etwas mit
 * ihnen, sie gehen hinaus. Der Editor zeigt diese Kette und immer nur ein Glied
 * davon — alles gleichzeitig auszubreiten ergäbe eine Rolle, in der man das
 * Speichern nicht mehr findet.
 *
 * Die Glieder tragen Namen, keine Nummern. Eine Nummer könnte nur eines von
 * beidem bedeuten — welches Modul das ist oder wann es läuft — und beides
 * gleichzeitig geht nicht: Wer nur Konsolidieren und Konvertieren gekauft hat,
 * lässt sie als erstes und zweites laufen. Also trägt der Name die Identität,
 * und die Nummer wird pro Workflow vergeben.
 *
 * Nicht lizenzierte Glieder stehen trotzdem in der Kette: ein Modul, das man
 * nicht sieht, ist ein Modul, von dem man nicht weiß.
 */
interface Step {
  id: string;
  /** Welches Kettenglied dieser Schritt einstellt; Rahmenschritte keines. */
  stage?: StageId;
}

const STEPS: Step[] = [
  { id: 'basics' },
  { id: 'TRANSFER', stage: 'TRANSFER' },
  { id: 'CONSOLIDATE', stage: 'CONSOLIDATE' },
  { id: 'DELIVER', stage: 'DELIVER' },
  { id: 'schedule' },
];

const STEP_LABELS: Record<string, string> = { basics: 'Grunddaten', schedule: 'Zeitplan', ...STAGE_LABELS };

/** Ob die Datei schon beim Abholen verschlüsselt wird. */
function onPickup(job: Job): boolean {
  return job.encryptionConfig.onPickup === true;
}

/** Ob sie verschlüsselt hier ankommt — von der Quelle so geliefert oder von uns so geholt. */
function arrivesEncrypted(job: Job): boolean {
  return onPickup(job) || job.sourceEncryption?.enabled === true;
}

/**
 * Eine Änderung an der Verschlüsselung, mit dem Verfahren im Schlepptau.
 *
 * Das Verfahren wird nirgends gewählt — es gibt eines — aber `NONE` steht dort,
 * solange nichts verschlüsselt wird. Diese eine Stelle setzt es, damit nicht
 * jeder Haken es für sich mitführen muss und einer es vergisst.
 */
function withEncryption(job: Job, patch: Partial<Job['encryptionConfig']>): Partial<Job> {
  const next = { ...job.encryptionConfig, ...patch };

  return { encryptionConfig: { ...next, provider: next.enabled || next.onPickup ? 'AES_256_GCM' : 'NONE' } };
}

/** Derselbe Augenblick — 31.01.2026, 23:59:59 — in der Schreibweise des Jobs. */
function stampExample(job: Job): string {
  return job.timestampNotation === 'MONTH_FIRST' ? '01312026_235959' : '31012026_235959';
}

/**
 * Was fest hinter dem neuen Namen steht.
 *
 * Die Endung wird nicht getippt: Sie kommt von der Datei, die ankommt. Ist im
 * Schritt darüber genau eine Endung berücksichtigt, steht sie hier — bei
 * mehreren wäre jede angezeigte für alle anderen Dateien die falsche.
 */
function extensionLabel(job: Job): string {
  const [only, ...rest] = job.allowedExtensions;

  return only && rest.length === 0 ? `.${only.replace(/^\./, '')}` : '.Endung der Datei';
}

interface Props {
  jobId: string | 'new';
  /** Welche Module diese Installation hat; entscheidet über die Glieder. */
  features: Feature[];
  onDone(): void;
}

export function JobEditorScreen({ jobId, features, onDone }: Props) {
  const existing = useResource<Job>(jobId === 'new' ? undefined : `/api/jobs/${jobId}`);
  const tenants = useResource<Tenant[]>('/api/tenants');
  const credentials = useResource<Credential[]>('/api/credentials');
  /*
   * Die anderen Workflows — nur wegen der Verzeichnisse, die sie benutzen.
   *
   * Sie stehen im Auswahlfenster obenan, damit niemand denselben Pfad zum
   * zwanzigsten Mal durchklickt. Eine eigene Merkliste wäre der naheliegende
   * Weg und der schlechtere: Sie müsste gepflegt und mitgesichert werden, sie
   * veraltete unbemerkt, und sie hinge an diesem Browser. Was die vorhandenen
   * Workflows benutzen, ist dagegen immer aktuell und gilt für jeden.
   */
  const otherJobs = useResource<Job[]>('/api/jobs');
  /** Welches der beiden Endungsfelder gerade seine Auswahl offen hat. */
  const [picking, setPicking] = useState<ExtensionField | undefined>();

  const { language } = useLanguage();
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; result?: ConnectionTestResult; error?: string }>({ busy: false });
  /**
   * Das Urteil über das eingegebene Remote-Verzeichnis: gefunden oder nicht,
   * samt dem Pfad, auf den die Eingabe hinauslief. Es steht neben dem Feld und
   * ersetzt nie dessen Inhalt — eine Eingabe, die nicht gefunden wurde, ist
   * meist fast richtig, und wer sie überschreibt, nimmt die Korrektur weg.
   */
  const [remoteCheck, setRemoteCheck] = useState<RemoteDirectoryResult>();
  const [checking, setChecking] = useState(false);
  /**
   * Der geöffnete Verzeichnisbrowser; `at` ist der Pfad, der gerade zu sehen
   * ist, und `side`, für welches der beiden Felder das Ergebnis gilt. Ein
   * Browser für beide Seiten, weil es dieselbe Frage an denselben Servertyp
   * ist — zwei würden sich früher oder später darüber uneins, was ein
   * eingetippter Pfad bedeutet.
   */
  const [browsing, setBrowsing] = useState<{ open: boolean; side: Side; start: string }>({
    open: false,
    side: 'SOURCE',
    start: '',
  });
  /**
   * Ein Zugang oder Schlüssel wird hier angelegt, wo beim Einrichten auffällt,
   * dass er fehlt — und nur hier. Er bleibt gespeichert und steht dem nächsten
   * Workflow in der Auswahl darüber wieder offen.
   *
   * Eine Verwaltung unter Einstellungen gab es einmal und gibt es nicht mehr:
   * Beim Kunden ändert sich ein Zugang im Takt des Auftrags, nicht im Takt der
   * Installation. Eine zweite Liste an anderer Stelle wäre die, in der die alten
   * Einträge liegen bleiben.
   */
  const [adding, setAdding] = useState<'ACCESS' | 'SOURCE_KEY' | 'KEY'>();
  /** Welches Glied der Kette gerade offen ist. */
  const [step, setStep] = useState('basics');
  const [target, setTarget] = useState<{ busy: boolean; result?: DirectoryCheckResult; error?: string }>({
    busy: false,
  });
  const [archive, setArchive] = useState<{ busy: boolean; result?: DirectoryCheckResult; error?: string }>({
    busy: false,
  });
  /*
   * Was im Verzeichnisfenster getippt wird. Drei getrennte Felder, weil es drei
   * verschiedene Fragen sind: wohin springen, was in der Liste zeigen, wie der
   * neue Ordner heißen soll. Sie werden bei jedem Wechsel geleert — ein Filter,
   * der aus dem vorigen Verzeichnis stehenbleibt, versteckt hier den halben
   * Inhalt, und niemand sucht die Ursache in einem Feld weiter oben.
   */
  useEffect(() => {
    if (jobId === 'new') {
      if (tenants.data && !job) {
        // Bei genau einem Mandanten gibt es nichts zu entscheiden. Bei mehreren
        // ist es eine echte Entscheidung, und eine Voreinstellung wäre eine, die
        // jemand anders getroffen hat — der Job liefe dann für den falschen
        // Kunden, ohne dass ein Feld je angefasst wurde.
        setJob(emptyJob(tenants.data.length === 1 ? tenants.data[0].id : '', language, features));
      }
      return;
    }

    if (existing.data && !job) {
      setJob(existing.data);
    }
  }, [jobId, tenants.data, existing.data, job, language]);

  if (!job) {
    return existing.error ? <Notice kind="error">{existing.error}</Notice> : <Loading />;
  }

  const change = (patch: Partial<Job>): void => setJob({ ...job, ...patch });

  /*
   * Solange die Grunddaten fehlen, ist der Rest der Kette gesperrt.
   *
   * Der Mandant entscheidet, welche Zugänge zur Wahl stehen und wohin geliefert
   * werden darf; ohne ihn füllt man Felder aus, deren Auswahl sich hinterher
   * ändert. Und ein Workflow ohne Namen lässt sich später weder wiederfinden
   * noch in der Historie zuordnen.
   *
   * Eine Regel für neue und bestehende Workflows: Bei einem bestehenden sind
   * beide Angaben da, die Sperre greift also nie. Ein Sonderfall „ist neu" wäre
   * eine zweite Regel, die dasselbe sagt.
   */
  const basicsReady = Boolean(job.tenantId) && job.name.trim() !== '';
  const locked = 'Bitte zuerst die Grunddaten ausfüllen — Mandant und Name.';
  /*
   * Zwei Fragen, die früher eine waren.
   *
   * `remote` heißt: eine Verbindung mit Server, Port und Hostkey — SFTP oder
   * FTPS. Eine Freigabe ist etwas anderes: Sie hat einen Pfad und womöglich
   * einen Zugang, aber keinen Port. Als „alles außer lokal" gelesen blendete
   * `remote` bei einer Freigabe Felder ein, die dort nichts tun.
   */
  const remote = job.sourceType === 'SFTP' || job.sourceType === 'FTPS';
  const share = job.sourceType === 'SHARE';
  const remoteTarget = job.destinationType === 'SFTP' || job.destinationType === 'FTPS';
  const shareTarget = job.destinationType === 'SHARE';
  const tenant = tenants.data?.find((entry) => entry.id === job.tenantId);

  /** Only credentials this client may use; a shared one has no tenant. */
  const usable = (credentials.data ?? []).filter(
    (credential) => credential.tenantId === undefined || credential.tenantId === job.tenantId
  );

  async function runTest(): Promise<void> {
    setTest({ busy: true });

    try {
      const result = await api.post<ConnectionTestResult>('/api/jobs/test-connection', {
        name: job!.name || 'Neuer Job',
        tenantId: job!.tenantId,
        sourceType: job!.sourceType,
        sourceConfig: job!.sourceConfig,
        credentialId: job!.credentialId,
      });

      setTest({ busy: false, result });
    } catch (failure) {
      setTest({ busy: false, error: messageOf(failure, 'Der Verbindungstest ist fehlgeschlagen') });
    }
  }

  /**
   * Fragt den Server nach einem Verzeichnis. Ein und derselbe Aufruf für beides:
   * das Häkchen neben dem Feld und den Inhalt des Browsers — denn ein Listing,
   * das gelingt, *ist* der Nachweis, dass das Verzeichnis da ist.
   */
  async function askRemote(directory: string, side: Side = 'SOURCE'): Promise<RemoteDirectoryResult> {
    const gemeinsam = {
      name: job!.name || 'Neuer Job',
      tenantId: job!.tenantId,
      directory,
      known: knownDirectories(otherJobs.data, job!),
    };

    if (side === 'DESTINATION') {
      return api.post<RemoteDirectoryResult>('/api/jobs/browse-destination', {
        ...gemeinsam,
        destinationType: job!.destinationType ?? 'LOCAL',
        destinationConfig: job!.destinationConfig,
        destinationCredentialId: job!.destinationCredentialId,
      });
    }

    // Eine lokale Quelle wird hier gesucht — dort steht ja auch die Datei. Und
    // eine Freigabe genauso: Ein UNC-Pfad ist ein Pfad im Dateisystem, nur
    // einer, der über das Netz führt.
    if (job!.sourceType === 'LOCAL' || job!.sourceType === 'SHARE') {
      // Art und Zugang gehen mit: Eine Freigabe wird auf dem Server mit dem
      // hinterlegten Zugang verbunden, bevor sie durchgesehen wird. Ohne diese
      // beiden Angaben sähe der Browser sie mit dem Konto, unter dem Unikom
      // läuft — und zeigte damit etwas anderes, als der Lauf später findet.
      return api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
        ...gemeinsam,
        sourceType: job!.sourceType,
        credentialId: job!.credentialId,
      });
    }

    return api.post<RemoteDirectoryResult>('/api/jobs/browse-remote', {
      ...gemeinsam,
      sourceType: job!.sourceType,
      sourceConfig: job!.sourceConfig,
      credentialId: job!.credentialId,
    });
  }

  async function checkRemoteDirectory(): Promise<void> {
    setChecking(true);

    try {
      setRemoteCheck(await askRemote(job!.sourceDirectory));
    } catch (failure) {
      setRemoteCheck({
        ok: false,
        message: messageOf(failure, 'Das Verzeichnis konnte nicht geprüft werden'),
        entries: [],
      });
    } finally {
      setChecking(false);
    }
  }

  /**
   * `side` ist Pflicht an den beiden Knöpfen und wird nur beim Blättern
   * innerhalb des Fensters weitergereicht. Als Vorgabe „die zuletzt benutzte
   * Seite" wäre es eine Falle: Wer erst das Ziel durchsieht und danach die
   * Quelle öffnet, bekäme wortlos den Zielserver zu sehen.
   */
  function openBrowser(at: string, side: Side): void {
    setBrowsing({ open: true, side, start: at });
  }

  /**
   * Legt einen Ordner an, dort wo das Fenster gerade steht.
   *
   * Der häufige Fall ist das Archiv: Es gibt es beim Einrichten noch nicht,
   * also lässt es sich nicht aussuchen. Angelegt wird auf dem Server und über
   * dieselbe Verbindung wie alles andere — hier entsteht nichts auf dem
   * Rechner, an dem jemand sitzt.
   */
  async function legeOrdner(
    side: Side,
    elternPfad: string,
    name: string
  ): Promise<{ ok: boolean; path?: string; message: string }> {
    return api.post<{ ok: boolean; path?: string; message: string }>('/api/jobs/create-directory', {
      name: job!.name || 'Neuer Job',
      tenantId: job!.tenantId,
      side: side === 'DESTINATION' ? 'DESTINATION' : 'SOURCE',
      directory: elternPfad,
      folder: name,
      sourceType: job!.sourceType,
      sourceConfig: job!.sourceConfig,
      credentialId: job!.credentialId,
      destinationType: job!.destinationType ?? 'LOCAL',
      destinationConfig: job!.destinationConfig,
      destinationCredentialId: job!.destinationCredentialId,
    });
  }

  async function checkDestination(): Promise<void> {
    setTarget({ busy: true });

    try {
      const result = await api.post<DirectoryCheckResult>('/api/jobs/check-destination', {
        directory: job!.destinationDirectory,
        createDestinationDirectory: job!.createDestinationDirectory,
        tenantId: job!.tenantId,
        name: job!.name,
        // Bei einem entfernten Ziel prüft der Server über dieselbe Verbindung,
        // die der Lauf später aufmacht — sonst prüfte er das falsche Gerät.
        destinationType: job!.destinationType ?? 'LOCAL',
        destinationConfig: job!.destinationConfig,
        destinationCredentialId: job!.destinationCredentialId,
      });

      setTarget({ busy: false, result });
    } catch (failure) {
      setTarget({ busy: false, error: messageOf(failure, 'Das Zielverzeichnis konnte nicht geprüft werden') });
    }
  }

  /**
   * Das Archivverzeichnis liegt auf der Quelle, nicht hier.
   *
   * Deshalb gehen die Angaben der Quelle mit: Bei einem Server prüft der Server
   * über dieselbe Verbindung, die der Lauf später aufmacht, bei einer Freigabe
   * mit deren Zugang. Eine Prüfung im hiesigen Dateisystem meldete sonst
   * Erfolg für ein Verzeichnis, in das nie etwas verschoben wird.
   */
  async function checkArchive(): Promise<void> {
    setArchive({ busy: true });

    try {
      const result = await api.post<DirectoryCheckResult>('/api/jobs/check-archive', {
        directory: job!.sourceArchiveDirectory ?? '',
        tenantId: job!.tenantId,
        name: job!.name,
        sourceType: job!.sourceType,
        sourceConfig: job!.sourceConfig,
        credentialId: job!.credentialId,
      });

      setArchive({ busy: false, result });
    } catch (failure) {
      setArchive({ busy: false, error: messageOf(failure, 'Das Archivverzeichnis konnte nicht geprüft werden') });
    }
  }

  async function save(): Promise<void> {
    setError(undefined);
    setSaving(true);

    try {
      if (jobId === 'new') {
        await api.post('/api/jobs', { ...job, id: crypto.randomUUID() });
      } else {
        await api.put(`/api/jobs/${jobId}`, job);
      }

      onDone();
    } catch (failure) {
      // Licence and client boundaries are reported by the server with a message
      // that names what is wrong; passing it through is better than guessing.
      setError(messageOf(failure, 'Der Job konnte nicht gespeichert werden'));
      setSaving(false);
    }
  }

  /*
   * Was diese Installation nicht enthält, steht nicht in der Kette. Vorher
   * stand es dort gesperrt, mit einem Hinweis — das war als Ehrlichkeit gedacht
   * und ist als Werbefläche gelesen worden. Wer ein Modul nicht hat, soll damit
   * nicht arbeiten müssen, und wer es nicht kennt, vermisst es nicht.
   */
  const steps = STEPS.filter((entry) => !entry.stage || stageAvailable(entry.stage, features));

  const position = Math.max(
    0,
    steps.findIndex((entry) => entry.id === step)
  );

  /** Die Nummern gelten für diesen Workflow, nicht für den Produktkatalog. */
  const numbers = numbersOf(job);

  return (
    <div className="editor">
      {adding && (
        <Modal
          title={adding === 'ACCESS' ? 'Neuer Zugang' : 'Neuer Schlüssel'}
          // Das Formular bringt „Anlegen" und „Abbrechen" mit; ein „Schließen"
          // daneben wäre ein dritter Knopf für das, was der zweite schon tut.
          ownActions
          onClose={() => setAdding(undefined)}
        >
          <CredentialForm
            types={adding === 'ACCESS' ? ['USERNAME_PASSWORD', 'SSH_PRIVATE_KEY'] : ['ENCRYPTION_KEY']}
            tenantId={job.tenantId}
            tenants={tenants.data ?? []}
            onCancel={() => setAdding(undefined)}
            onCreated={(credential) => {
              // Gleich eingesetzt: wer ihn hier anlegt, will ihn hier benutzen.
              // Welches der drei Felder gemeint war, sagt der Knopf, der das
              // Fenster geöffnet hat — Quellschlüssel und Zielschlüssel sind
              // verschiedene Dinge und dürfen nicht verwechselt werden.
              change(
                adding === 'ACCESS'
                  ? { credentialId: credential.id }
                  : adding === 'SOURCE_KEY'
                    ? { sourceEncryption: { ...job.sourceEncryption, enabled: true, keyCredentialId: credential.id } }
                    : { encryptionConfig: { ...job.encryptionConfig, keyCredentialId: credential.id } }
              );
              setAdding(undefined);
              void credentials.reload();
            }}
          />
        </Modal>
      )}

      {/*
        * Der Verzeichnisbrowser. Er zeigt nicht, was wir für wahrscheinlich
        * halten, sondern was der Server auflistet — und übernimmt am Ende den
        * Pfad, den der Server genannt hat, in der Schreibweise ohne
        * Arbeitsverzeichnis, wie sie ins Feld gehört.
        */}
      {/*
        * Endungen anklicken statt tippen.
        *
        * Das Häkchen wirkt sofort auf das Feld, ohne „Übernehmen": Es gibt
        * nichts zu bestätigen — man sieht die Endung im Feld darunter
        * erscheinen und verschwinden, und ein zweites Anklicken nimmt sie
        * zurück. Ein Bestätigungsknopf wäre ein Schritt, der nichts entscheidet.
        */}
      {picking && (
        <Modal title={`${EXTENSION_CHOICES[picking].label} wählen`} onClose={() => setPicking(undefined)}>
          {/*
            * Die Pfeiltasten bewegen den Fokus, nicht die Seite.
            *
            * Eine Liste, die dreißig Zeilen hat und nur mit der Maus zu bedienen
            * ist, zwingt zum Wechseln der Hand — und wer die Tabulatortaste
            * benutzt, springt sonst durch jede einzelne Zeile bis zum
            * Schließen-Knopf. Gesucht werden die Geschwister im Baum und nicht
            * eine gemerkte Nummer: Die Liste kann sich ändern, das DOM ist die
            * Wahrheit.
            */}
          <ul className="browse pick" onKeyDown={listentasten}>
            {EXTENSION_CHOICES[picking].options.map((option) => {
              const chosen = extensionsOf(job, picking).some((entry) => sameExtension(entry, option.value));

              return (
                <li key={option.value}>
                  <button
                    type="button"
                    className={chosen ? 'pick__row pick__row--an' : 'pick__row'}
                    aria-pressed={chosen}
                    onClick={() => {
                      const current = extensionsOf(job, picking);
                      const next = chosen
                        ? current.filter((entry) => !sameExtension(entry, option.value))
                        : [...current, option.value];

                      change(
                        picking === 'ALLOWED'
                          ? { allowedExtensions: next }
                          : { ignoredTemporaryExtensions: next }
                      );
                    }}
                  >
                    <span className="pick__mark">{chosen ? '✓' : ''}</span>
                    <span className="pick__ext">{option.value}</span>
                    <span className="pick__hint">{option.hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}

      {/*
        * Der Verzeichnisbrowser. Er zeigt nicht, was wir für wahrscheinlich
        * halten, sondern was der Server auflistet — und übernimmt am Ende den
        * Pfad, den der Server genannt hat, in der Schreibweise ohne
        * Arbeitsverzeichnis, wie sie ins Feld gehört.
        *
        * Ein Fenster für alle drei Seiten, weil es dieselbe Frage an denselben
        * Servertyp ist. Welchen Server es fragt, entscheidet `askRemote` —
        * zwei Fenster würden sich früher oder später darüber uneins, was ein
        * eingetippter Pfad bedeutet.
        */}
      {browsing.open && (
        <Verzeichnisfenster
          titel={
            browsing.side === 'DESTINATION'
              ? 'Zielverzeichnis auf dem Server wählen'
              : browsing.side === 'ARCHIVE'
                ? 'Archivverzeichnis auf dem Server wählen'
                : 'Quellverzeichnis auf dem Server wählen'
          }
          start={browsing.start}
          lies={(pfad) => askRemote(pfad, browsing.side)}
          lege={(elternPfad, name) => legeOrdner(browsing.side, elternPfad, name)}
          onClose={() => setBrowsing({ ...browsing, open: false })}
          onWaehlen={(wahl, gelesen) => {
            if (browsing.side === 'DESTINATION') {
              change({ destinationDirectory: wahl.relativ });
              // Die Zielprüfung daneben zeigt sonst noch das Urteil über den
              // Pfad, der eben ersetzt wurde.
              setTarget({ busy: false });
            } else if (browsing.side === 'ARCHIVE') {
              change({ sourceArchiveDirectory: wahl.relativ });
            } else {
              setJob(withSourceDirectory(job, wahl.relativ));
              setRemoteCheck(gelesen);
            }

            setBrowsing({ ...browsing, open: false });
          }}
        />
      )}

      {/*
        * Der Kopf bleibt stehen: Name und Mandant gelten für die ganze Kette,
        * und die Kette selbst ist der Weg durch den Editor. Beides muss man
        * sehen, gleich wie weit man im aktuellen Schritt nach unten gerutscht
        * ist.
        */}
      <div className="editor__head">
        <div className="editor__title">
          <div>
            <h1>{jobId === 'new' ? 'Neuer Workflow' : (job.name || 'Workflow bearbeiten')}</h1>

            {/*
              * Der Name, während er getippt wird — aber nur beim neuen
              * Workflow. Bei einem bestehenden steht er bereits in der
              * Überschrift darüber und änderte sich dort ebenso mit; zweimal
              * dasselbe Wort untereinander wäre keine Rückmeldung, sondern ein
              * Fehler, den jemand suchen würde.
              */}
            {jobId === 'new' && job.name.trim() !== '' && (
              <div className="editor__name">{job.name}</div>
            )}
          </div>

          {/*
            * Der Mandant steht über allem: er entscheidet, welche Zugänge zur
            * Wahl stehen und wohin geliefert werden darf — nicht nur in einem
            * Schritt, sondern in jedem.
            */}
          <label className={job.tenantId ? 'editor__tenant' : 'editor__tenant editor__tenant--wanted'}>
            <span>Mandant</span>
            <select
              value={job.tenantId}
              autoFocus={!job.tenantId}
              onChange={(event) => change({ tenantId: event.target.value })}
            >
              {!job.tenantId && <option value="">— bitte wählen —</option>}
              {tenants.data?.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/*
          * Drei Zustände, nicht zwei: nicht enthalten, enthalten aber in diesem
          * Workflow ungenutzt, und mitlaufend. Die mittlere Lage gab es vorher
          * nicht — dabei ist sie die häufigste, sobald jemand mehrere Workflows
          * mit demselben Modulumfang baut.
          *
          * Die Nummer bekommt nur, was tatsächlich mitläuft, und sie zählt die
          * Reihenfolge dieses Workflows. Deshalb steht dieselbe Konvertierung
          * beim einen Kunden als 4 und beim anderen als 2.
          */}
        <nav className="chain">
          {steps.map((entry) => {
            const running = entry.stage ? stageIsActive(job, entry.stage) : undefined;
            const unused = running === false;
            const number = entry.stage ? numbers.get(entry.stage) : undefined;
            // Die Grunddaten selbst bleiben immer erreichbar — sie sind der Weg
            // aus der Sperre heraus.
            const barred = entry.id !== 'basics' && !basicsReady;

            return (
              <button
                key={entry.id}
                type="button"
                disabled={barred}
                className={[
                  'chain__step',
                  entry.id === step ? 'chain__step--active' : '',
                  unused ? 'chain__step--unused' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={barred ? locked : unused ? 'Dieses Glied läuft in diesem Workflow nicht mit' : undefined}
                onClick={() => setStep(entry.id)}
              >
                {number !== undefined && <span className="chain__number">{number}</span>}
                {STEP_LABELS[entry.id]}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="editor__body">
        {error && <Notice kind="error">{error}</Notice>}

        {/*
          * Der Grund steht sichtbar da und nicht nur im Tooltip der gesperrten
          * Kettenglieder: Wer nicht weiß, dass etwas gesperrt ist, fährt nicht
          * mit der Maus darüber, um es zu erfahren.
          */}
        {!basicsReady && (
          <div className="field__row" style={{ marginBottom: '1rem' }}>
            <span className="field__note">
              {!job.tenantId
                ? 'Bitte zuerst den Mandanten wählen.'
                : 'Bitte zuerst den Workflow-Namen vergeben.'}
            </span>
            <Hint kind="warn" title="Grunddaten zuerst">
              Der Mandant bestimmt, welche Zugänge zur Verfügung stehen und wohin geliefert werden darf. Der Name
              ist das, woran dieser Workflow später in der Liste und in der Historie zu erkennen ist. Solange
              beides fehlt, bleiben die übrigen Schritte gesperrt — man würde Felder ausfüllen, deren Auswahl
              sich danach noch ändert.
            </Hint>
          </div>
        )}

        {step === 'basics' && (
          <section className="card">
            <h2>Grunddaten</h2>

            <Field label="Workflow-Name">
              <input
                value={job.name}
                placeholder="Bestellungen Kunde A"
                onChange={(event) => change({ name: event.target.value })}
                autoFocus={Boolean(job.tenantId)}
              />
            </Field>

            <Field label="Workflow-Beschreibung">
              <input
                value={job.description ?? ''}
                placeholder="Holt nachts die Bestellungen ab und legt sie in der Warenwirtschaft ab"
                onChange={(event) => change({ description: event.target.value || undefined })}
              />
            </Field>

            <Field label="Protokollieren">
              {/*
                * Ein Auswahlfeld kennt keinen Platzhalter: Es zeigt immer einen
                * Wert, auch bevor jemand einen ausgesucht hat. Bis dahin ist
                * das ein Vorschlag und keine Eingabe — und wird wie ein
                * Beispieltext dargestellt, damit man beides auseinanderhält.
                *
                * Ein älterer Workflow mit „Das Wesentliche" steht ebenso als
                * Vorschlag da: Diese Angabe gibt es nicht mehr, gelaufen wird
                * nach der Voreinstellung, und hier soll dasselbe stehen.
                */}
              <select
                className={chosenLogLevel(job) ? undefined : 'field__preset'}
                value={chosenLogLevel(job) ?? DEFAULT_JOB_LOG_LEVEL}
                onChange={(event) => change({ logLevel: event.target.value as Job['logLevel'] })}
              >
                <option value="DEBUG">Jeder Schritt</option>
                <option value="WARNING">Nur Warnungen und Konflikte</option>
                <option value="ERROR">Nur Konflikte</option>
              </select>
            </Field>

            <CheckField
              label="Job ist aktiv"
              hint="Ein inaktiver Job wird weder eingeplant noch gestartet."
              hintInline
              checked={job.enabled}
              onChange={(enabled) => change({ enabled })}
            />
          </section>
        )}

        {step === 'TRANSFER' && (
          <>
            {/*
              * Auch das Übertragen ist zuschaltbar. Wer nur konsolidiert, holt
              * nichts ab — dann hat dieses Glied nichts zu sagen und verschwindet,
              * statt als auszufüllendes Formular stehenzubleiben.
              */}
            <Klappkarte titel={STAGE_LABELS.TRANSFER} stand={transfers(job) ? 'GUELTIG' : 'LEER'}>

              <div className="prose">
                <p>{STAGE_DESCRIPTIONS.TRANSFER}</p>
              </div>

              <CheckField
                label={`„${STAGE_LABELS.TRANSFER}" in diesem Workflow verwenden`}
                checked={transfers(job)}
                onChange={(on) => change({ transfer: { enabled: on } })}
              />
            </Klappkarte>
          </>
        )}

        {step === 'TRANSFER' && transfers(job) && (
          <>
            <Klappkarte titel="Quelle" stand={quelleStand(job)}>

              <Field label="Art">
                <select
                  value={job.sourceType}
                  onChange={(event) => setJob(withSourceType(job, event.target.value as Job['sourceType']))}
                >
                  <option value="LOCAL">Lokales Verzeichnis</option>
                  <option value="SHARE">Windows-Freigabe</option>
                  <option value="SFTP">SFTP</option>
                  <option value="FTPS">FTPS</option>
                </select>
              </Field>

              {(remote || share) && (
                <>
                  {remote && (
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 3 }}>
                      <Field label="Server">
                        <input
                          value={job.sourceConfig.host ?? ''}
                          onChange={(event) =>
                            change({ sourceConfig: { ...job.sourceConfig, host: event.target.value } })
                          }
                        />
                      </Field>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Field label="Port">
                        <input
                          type="number"
                          value={job.sourceConfig.port ?? ''}
                          onChange={(event) =>
                            change({
                              sourceConfig: { ...job.sourceConfig, port: Number(event.target.value) || undefined },
                            })
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  )}

                  <Field
                    label={share ? 'Anmeldung an der Freigabe' : 'Anmeldung am Quellserver'}
                    explain={
                      share
                        ? 'Pflicht. Ohne Zugang würde die Freigabe mit dem Konto erreicht, unter dem der Dienst läuft — und das ist nicht Ihres.'
                        : 'Nur für SFTP und FTPS nötig.'
                    }
                  >
                    <div className="field__row">
                      {/*
                        * Hervorgehoben, solange keiner gewählt ist: Eine
                        * Freigabe ohne Zugang wird beim Speichern abgewiesen,
                        * und das soll man vorher sehen und nicht erst danach.
                        */}
                      <select
                        className={share && !job.credentialId ? 'wanted' : undefined}
                        value={job.credentialId ?? ''}
                        onChange={(event) => change({ credentialId: event.target.value || undefined })}
                      >
                        <option value="">{share ? '— bitte wählen —' : '— keine —'}</option>
                        {usable
                          .filter((credential) => credential.type !== 'ENCRYPTION_KEY')
                          .map((credential) => (
                            <option key={credential.id} value={credential.id}>
                              {credential.name}
                              {credential.tenantId === undefined ? ' (übergreifend)' : ''}
                            </option>
                          ))}
                      </select>
                      <button type="button" className="secondary" onClick={() => setAdding('ACCESS')}>
                        Neu …
                      </button>
                    </div>
                  </Field>

                  {/*
                   * Der öffentliche Teil eines SSH-Zugangs, hier und nur hier.
                   * Er wird gebraucht, solange die Verbindung eingerichtet wird
                   * — und das passiert an dieser Stelle.
                   */}
                  <PublicKeyOf
                    credential={usable.find(
                      (entry) => entry.id === job.credentialId && entry.type === 'SSH_PRIVATE_KEY'
                    )}
                  />
                </>
              )}

              {job.sourceType === 'SFTP' && (
                <>
                  <Field
                    label="Fingerabdruck des Host-Keys"
                    explain="So wie OpenSSH ihn ausgibt: SHA256:… — ohne ihn wird die Verbindung abgelehnt."
                  >
                    <input
                      value={job.sourceConfig.hostKeyFingerprint ?? ''}
                      placeholder="SHA256:…"
                      onChange={(event) =>
                        change({
                          sourceConfig: { ...job.sourceConfig, hostKeyFingerprint: event.target.value || undefined },
                        })
                      }
                    />
                  </Field>

                  <CheckField
                    label="Host-Key-Prüfung bewusst abschalten"
                    explain="Nur für Testumgebungen. Damit ist nicht mehr feststellbar, ob wirklich der richtige Server antwortet."
                    checked={job.sourceConfig.allowUnknownHostKey ?? false}
                    onChange={(allowUnknownHostKey) =>
                      change({ sourceConfig: { ...job.sourceConfig, allowUnknownHostKey } })
                    }
                  />
                </>
              )}

              {job.sourceType === 'FTPS' && (
                <>
                  <CheckField
                    label="Zertifikat prüfen"
                    explain="Für ein privates oder selbst signiertes Zertifikat besser das Zertifikat hinterlegen, statt die Prüfung abzuschalten."
                    checked={job.sourceConfig.validateCertificates ?? true}
                    onChange={(validateCertificates) =>
                      change({ sourceConfig: { ...job.sourceConfig, validateCertificates } })
                    }
                  />
                  <CheckField
                    label="Implizites FTPS"
                    explain="Verschlüsselt ab dem ersten Byte, üblicherweise auf Port 990."
                    checked={job.sourceConfig.implicitFtps ?? false}
                    onChange={(implicitFtps) => change({ sourceConfig: { ...job.sourceConfig, implicitFtps } })}
                  />
                </>
              )}

              {remote && (
                <Field
                  label="Remote-Arbeitsverzeichnis"
                  explain={
                    <>
                      <p>
                        Wo diese Verbindung auf dem Server beginnt — meist das Verzeichnis des Kunden, etwa{' '}
                        <code>/customer123</code>. Leer lassen heißt: dort, wo der Server das Konto nach der Anmeldung
                        hinstellt.
                      </p>
                      <p>
                        Alles darunter wird von hier aus gelesen. Wer <code>orders/incoming</code> einträgt, meint
                        dann <code>/customer123/orders/incoming</code> — den physikalischen Pfad des Servers muss
                        niemand kennen.
                      </p>
                      <p>
                        Es ist zugleich die Grenze: Ein Pfad mit <code>..</code> kann nicht aus diesem Verzeichnis
                        herausführen. Beim Nachbarn <code>/customer1234</code> hilft ihm auch der gleiche Anfang
                        nicht — verglichen wird Verzeichnis für Verzeichnis, nicht Zeichen für Zeichen.
                      </p>
                    </>
                  }
                >
                  <input
                    value={job.sourceConfig.remoteWorkingDirectory ?? ''}
                    placeholder="/"
                    onChange={(event) =>
                      change({
                        sourceConfig: {
                          ...job.sourceConfig,
                          remoteWorkingDirectory: event.target.value || undefined,
                        },
                      })
                    }
                  />
                </Field>
              )}

              <Field
                label={remote ? 'Remote-Quellverzeichnis' : 'Quellverzeichnis'}
                action={
                  <FieldButton
                    title="Quellverzeichnis aussuchen"
                    disabled={!job.tenantId || browsing.open}
                    onClick={() => void openBrowser(job.sourceDirectory, 'SOURCE')}
                  >
                    <FolderIcon />
                  </FieldButton>
                }
                explain={
                  job.sourceType === 'LOCAL' ? (
                    'Verzeichnis auf diesem Rechner, aus dem geholt wird.'
                  ) : (
                    <>
                      <p>
                        Der Pfad zum Verzeichnis, aus dem geholt wird — gelesen vom Remote-Arbeitsverzeichnis aus.
                      </p>
                      <p>
                        Die Schreibweise ist gleichgültig. Alle diese Eingaben meinen dasselbe Verzeichnis:
                      </p>
                      <ul className="samples">
                        <li>
                          <code>orders/incoming</code>
                          <span>die gewöhnliche Schreibweise</span>
                        </li>
                        <li>
                          <code>/orders/incoming</code>
                          <span>führender Schrägstrich</span>
                        </li>
                        <li>
                          <code>\orders\incoming</code>
                          <span>Windows-Gewohnheit</span>
                        </li>
                        <li>
                          <code>orders//incoming/</code>
                          <span>doppelt und mit Schrägstrich am Ende</span>
                        </li>
                      </ul>
                      <p>
                        „Verzeichnis wählen" öffnet die Verbindung und zeigt, was wirklich auf dem Server liegt. Der
                        übernommene Pfad ist dann der des Servers, nicht ein geratener.
                      </p>
                    </>
                  )
                }
              >
                <input
                  value={job.sourceDirectory}
                  placeholder={job.sourceType === 'LOCAL' ? 'D:\\Daten\\eingang' : 'orders/incoming'}
                  onChange={(event) => {
                    setJob(withSourceDirectory(job, event.target.value));
                    // Ein Häkchen, das zu einem anderen Pfad gehört, wäre eine
                    // Zusage für etwas, das gar nicht mehr dasteht.
                    setRemoteCheck(undefined);
                  }}
                />
              </Field>

              {/*
                * Beide Knöpfe in einer Zeile unter dem Feld und nicht daneben:
                * Neben dem Feld nähmen sie ihm die Länge, und ein Pfad ist das
                * Feld, in dem man am ehesten den Anfang sehen will.
                */}
              {/*
                * Geprüft wird nur, was über eine Verbindung erreicht wird. Ein
                * lokales Verzeichnis beantwortet das Aussuchen schon: Was der
                * Browser auflistet, gibt es.
                */}
              {remote && (
                <div className="row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!job.tenantId || checking}
                    onClick={() => void checkRemoteDirectory()}
                  >
                    {checking ? 'Verzeichnis wird geprüft …' : 'Verzeichnis prüfen'}
                  </button>
                </div>
              )}

              {/*
                * Das Ergebnis steht als Zeile und nicht als Fenster: Es gehört
                * neben das Feld, dessen Inhalt es beurteilt. Und es fasst dieses
                * Feld nicht an — was jemand eingegeben hat, bleibt stehen, auch
                * wenn es nicht gefunden wurde.
                */}
              {remoteCheck && (
                <p className={remoteCheck.ok ? 'verdict verdict--good' : 'verdict verdict--bad'}>
                  {remoteCheck.ok ? '✓' : '✗'} {remoteCheck.message}
                </p>
              )}

              {/*
                * Was die Quelle liefert. Der Schlüssel hier öffnet, der unter
                * „Ziel" verschließt — es sind zwei verschiedene, denn wer die
                * Daten schickt, ist nicht, wer sie später öffnen muss.
                */}
              <CheckField
                label="Die Quelle liefert verschlüsselte Dateien"
                checked={job.sourceEncryption?.enabled ?? false}
                onChange={(enabled) =>
                  change({
                    sourceEncryption: { ...job.sourceEncryption, enabled },
                    // Beim Abholen zu verschlüsseln, was schon verschlüsselt
                    // ankommt, ergäbe eine zweite Hülle um eine geschlossene
                    // Datei. Der Server lehnt die Kombination ohnehin ab.
                    ...(enabled && onPickup(job) ? withEncryption(job, { onPickup: false }) : {}),
                  })
                }
              />

              {job.sourceEncryption?.enabled && (
                <>
                  <Field label="Schlüssel der Quelle" explain="Mit ihm hat der Absender die Dateien verschlossen.">
                    <div className="field__row">
                      <select
                        className={job.sourceEncryption.keyCredentialId ? undefined : 'wanted'}
                        value={job.sourceEncryption.keyCredentialId ?? ''}
                        onChange={(event) =>
                          change({
                            sourceEncryption: {
                              ...job.sourceEncryption,
                              enabled: true,
                              keyCredentialId: event.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">— bitte wählen —</option>
                        {usable
                          .filter((credential) => credential.type === 'ENCRYPTION_KEY')
                          .map((credential) => (
                            <option key={credential.id} value={credential.id}>
                              {credential.name}
                            </option>
                          ))}
                      </select>
                      <button type="button" className="secondary" onClick={() => setAdding('SOURCE_KEY')}>
                        Neu …
                      </button>
                    </div>
                  </Field>

                  <CheckField
                    label="Unverschlüsselte Dateien annehmen"
                    explain="Aus: Eine Datei ohne Verschlüsselung wird abgelehnt statt weitergereicht — sie sollte verschlüsselt sein, und dass sie es nicht ist, gehört gemeldet. An: nur für Quellen, die absichtlich beides liefern."
                    checked={job.sourceEncryption.acceptPlaintext ?? false}
                    onChange={(acceptPlaintext) =>
                      change({
                        sourceEncryption: { ...job.sourceEncryption, enabled: true, acceptPlaintext },
                      })
                    }
                  />
                </>
              )}

              {/*
                * Wie die Datei hereinkommt, ist eine Frage an die Quelle und
                * nicht an das Ziel: Sie entscheidet, ob es diesseits je einen
                * Klartext gibt. Was am Ende im Ziel liegt, ist die zweite,
                * davon unabhängige Frage — sie steht unten.
                *
                * Nicht angeboten, wenn die Quelle schon verschlüsselt liefert:
                * Die Datei bekäme eine zweite Hülle um eine geschlossene, und
                * der Server lehnt die Kombination ohnehin ab.
                */}
              {!job.sourceEncryption?.enabled && (
                <CheckField
                  label="Beim Abholen verschlüsseln"
                  explain={
                    <>
                      <p>
                        Die Datei wird schon beim Lesen verschlüsselt. Beim Holen entsteht keine lesbare Kopie auf
                        dieser Maschine, und die Strecke von der Quelle hierher trägt nur verschlüsselte Daten.
                      </p>
                      <p>
                        Möglich bei allen Quellen: lokales Verzeichnis, SFTP und FTPS. Was nicht geht, ist eine
                        Verschlüsselung <em>auf</em> einem fremden Server — dort läuft unsere Software nicht. Diese
                        erste Strecke schützt SSH beziehungsweise TLS.
                      </p>
                      <p>
                        Was danach im Ziel liegt, entscheidet der Haken im Panel „Ziel" — verschlüsselt, oder wieder
                        geöffnet, weil ein weiterer Schritt oder ein fremdes Programm damit arbeiten soll.
                      </p>
                    </>
                  }
                  checked={onPickup(job)}
                  onChange={(pickup) => change(withEncryption(job, { onPickup: pickup }))}
                />
              )}

              <div className="row">
                {/* Ohne Mandanten kennt der Server weder Grenze noch Zugänge; die
                    Probe liefe in einen Fehler, der nur vom leeren Feld oben kommt. */}
                <button
                  type="button"
                  className="secondary"
                  disabled={test.busy || !job.tenantId}
                  onClick={() => void runTest()}
                >
                  {test.busy ? 'Verbindung wird geprüft …' : 'Verbindung testen'}
                </button>
              </div>

              {test.error && (
                <div style={{ marginTop: '0.75rem' }}>
                  <Notice kind="error">{test.error}</Notice>
                </div>
              )}
              {test.result && (
                <div style={{ marginTop: '0.75rem' }}>
                  <Notice kind={test.result.ok ? 'info' : 'error'}>
                    {test.result.message}
                    {test.result.filesFound !== undefined && ` — ${test.result.filesFound} Datei(en) gefunden.`}
                    {/*
                      * Die Schritte in der Reihenfolge, in der sie geschahen.
                      * Eine gescheiterte Verbindung ist sonst ein Satz über
                      * einen Handshake, und man rät, welche von fünf Stellen
                      * gemeint ist: Netz, Hostkey, Konto, Passwort, Pfad.
                      */}
                    {test.result.steps && test.result.steps.length > 0 && (
                      <ol className="steps">
                        {test.result.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </Notice>
                </div>
              )}
            </Klappkarte>

            <Klappkarte titel="Welche Dateien" stand={dateiwahlStand(job)}>

              {/*
                * Der Erklärknopf steht hier von Hand in der Zeile und nicht als
                * `explain` am Feld: Der Text ist länger als ein Satz und trägt
                * eine Tabelle. Ein zweites `explain` gäbe einen zweiten Knopf
                * für dieselbe Sache.
                */}
              <Field label="Dateiname/n">
                <div className="field__row">
                  <input
                    value={job.filenamePrefix ?? ''}
                    placeholder="ORDER_"
                    onChange={(event) => change({ filenamePrefix: event.target.value || undefined })}
                  />
                  <Hint title="Dateiname/n">
                    <p>Leer lassen, wenn der Name keine Rolle spielt.</p>
                    <p>
                      Die Datei-Endung wird im Feld <strong>„Berücksichtigte Endungen"</strong> darunter festgelegt.
                    </p>
                    <p>
                      Der Name kann voll angegeben werden oder als Teil eines Dateinamens; ein Stern sagt, wo der
                      Rest stehen darf.
                    </p>
                    <p>Beispiele:</p>
                    <ul className="samples">
                      <li>
                        <code>MeinDateiname</code>
                        <span>voller Dateiname</span>
                      </li>
                      <li>
                        <code>MeinDatei*</code>
                        <span>Teil-Dateiname + Platzhalter</span>
                      </li>
                      <li>
                        <code>*Dateiname</code>
                        <span>Platzhalter + Teil-Dateiname</span>
                      </li>
                      <li>
                        <code>*Datei*</code>
                        <span>Platzhalter + Teil-Dateiname + Platzhalter</span>
                      </li>
                      <li>
                        <code>MeinDatei*.csv</code>
                        <span>Teil-Dateiname + Platzhalter + Dateiendung</span>
                      </li>
                      <li>
                        <code>*.csv</code>
                        <span>jede CSV-Datei</span>
                      </li>
                    </ul>
                  </Hint>
                </div>
              </Field>

              {/*
                * „Groß- und Kleinschreibung beachten" stand hier und ist ganz
                * fort — Feld, Vergleich und Übergabe.
                *
                * Bei Dateinamen ist die Unterscheidung keine, die jemand
                * treffen will: Windows macht sie im Dateisystem nicht, und wer
                * ein Muster schreibt, meint die Datei und nicht ihre
                * Schreibweise. Nur das Bedienelement zu nehmen und den Wert
                * stehenzulassen hieße, ein totes Feld zu hinterlassen — und am
                * Ende steht ein Sammelsurium davon, das niemand mehr zu
                * entfernen wagt.
                */}

              <Field
                label="Berücksichtigte Endungen"
                explain="Durch Komma getrennt. Leer bedeutet: alle."
                action={
                  <FieldButton title="Endungen aussuchen" onClick={() => setPicking('ALLOWED')}>
                    <ListIcon />
                  </FieldButton>
                }
              >
                <input
                  value={job.allowedExtensions.join(', ')}
                  placeholder="csv, xml"
                  onChange={(event) => change({ allowedExtensions: parseList(event.target.value) })}
                />
              </Field>

              <Field
                label="Endungen unfertiger Uploads"
                explain="Dateien mit diesen Endungen werden nie übernommen — sie werden gerade erst geschrieben."
                action={
                  <FieldButton title="Endungen aussuchen" onClick={() => setPicking('TEMPORARY')}>
                    <ListIcon />
                  </FieldButton>
                }
              >
                <input
                  value={job.ignoredTemporaryExtensions.join(', ')}
                  placeholder=".part, .tmp"
                  onChange={(event) => change({ ignoredTemporaryExtensions: parseList(event.target.value) })}
                />
              </Field>

              <Field
                label="Mindestalter"
                explain="Eine Datei muss so lange unverändert dagelegen haben, bevor sie geholt wird. Alles auf null heißt: sofort."
              >
                <DurationField
                  seconds={job.minimumFileAgeSeconds}
                  onChange={(minimumFileAgeSeconds) => change({ minimumFileAgeSeconds })}
                />
              </Field>

              <CheckField
                label="Stabilität prüfen"
                explain="Misst Größe und Änderungszeit mehrfach, damit keine Datei mitten im Schreiben geholt wird."
                checked={job.stabilityCheck.enabled}
                onChange={(enabled) => change({ stabilityCheck: { ...job.stabilityCheck, enabled } })}
              />

              <CheckField
                label="Inhaltsgleiche Dateien als Dubletten behandeln"
                explain="Voreingestellt aus. Einschalten, wenn das Quellsystem Dateien nächtlich neu schreibt, ohne etwas zu ändern."
                checked={job.detectContentDuplicates ?? false}
                onChange={(detectContentDuplicates) => change({ detectContentDuplicates })}
              />
            </Klappkarte>

            <Klappkarte titel="Ziel" stand={zielStand(job)}>

              <Field label="Art">
                <select
                  value={job.destinationType ?? 'LOCAL'}
                  onChange={(event) =>
                    setJob(withDestinationType(job, event.target.value as Job['sourceType']))
                  }
                >
                  <option value="LOCAL">Lokales Verzeichnis</option>
                  <option value="SHARE">Windows-Freigabe</option>
                  <option value="SFTP">SFTP</option>
                  <option value="FTPS">FTPS</option>
                </select>
              </Field>

              {(remoteTarget || shareTarget) && (
                <>
                  {remoteTarget && (
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 3 }}>
                      <Field label="Server">
                        <input
                          value={job.destinationConfig?.host ?? ''}
                          onChange={(event) => changeTarget(job, change, { host: event.target.value })}
                        />
                      </Field>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Field label="Port">
                        <input
                          type="number"
                          value={job.destinationConfig?.port ?? ''}
                          onChange={(event) =>
                            changeTarget(job, change, { port: Number(event.target.value) || undefined })
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  )}

                  <Field
                    label={shareTarget ? 'Anmeldung an der Freigabe' : 'Anmeldung am Zielserver'}
                    explain={
                      shareTarget
                        ? 'Pflicht — und ein eigener Zugang, auch wenn Quelle und Ziel dasselbe Haus sind. Zwei Richtungen, zwei Berechtigungen: Wer irgendwo lesen darf, soll nicht anderswo schreiben können.'
                        : 'Ein eigener Zugang, auch wenn Quelle und Ziel dasselbe Haus sind. Zwei Richtungen, zwei Berechtigungen — wer irgendwo lesen darf, soll nicht anderswo schreiben können.'
                    }
                  >
                    <div className="field__row">
                      <select
                        className={shareTarget && !job.destinationCredentialId ? 'wanted' : undefined}
                        value={job.destinationCredentialId ?? ''}
                        onChange={(event) =>
                          change({ destinationCredentialId: event.target.value || undefined })
                        }
                      >
                        <option value="">{shareTarget ? '— bitte wählen —' : '— keine —'}</option>
                        {usable
                          .filter((credential) => credential.type !== 'ENCRYPTION_KEY')
                          .map((credential) => (
                            <option key={credential.id} value={credential.id}>
                              {credential.name}
                              {credential.tenantId === undefined ? ' (übergreifend)' : ''}
                            </option>
                          ))}
                      </select>
                      <button type="button" className="secondary" onClick={() => setAdding('ACCESS')}>
                        Neu …
                      </button>
                    </div>
                  </Field>

                  <PublicKeyOf
                    credential={usable.find(
                      (entry) => entry.id === job.destinationCredentialId && entry.type === 'SSH_PRIVATE_KEY'
                    )}
                  />
                </>
              )}

              {job.destinationType === 'SFTP' && (
                <Field
                  label="Fingerabdruck des Host-Keys"
                  explain="So wie OpenSSH ihn ausgibt: SHA256:… — ohne ihn wird die Verbindung abgelehnt."
                >
                  <input
                    value={job.destinationConfig?.hostKeyFingerprint ?? ''}
                    placeholder="SHA256:…"
                    onChange={(event) =>
                      changeTarget(job, change, { hostKeyFingerprint: event.target.value || undefined })
                    }
                  />
                </Field>
              )}

              {job.destinationType === 'FTPS' && (
                <>
                  <CheckField
                    label="Zertifikat prüfen"
                    explain="Für ein privates oder selbst signiertes Zertifikat besser das Zertifikat hinterlegen, statt die Prüfung abzuschalten."
                    checked={job.destinationConfig?.validateCertificates ?? true}
                    onChange={(validateCertificates) => changeTarget(job, change, { validateCertificates })}
                  />
                  <CheckField
                    label="Implizites FTPS"
                    explain="Verschlüsselt ab dem ersten Byte, üblicherweise auf Port 990."
                    checked={job.destinationConfig?.implicitFtps ?? false}
                    onChange={(implicitFtps) => changeTarget(job, change, { implicitFtps })}
                  />
                </>
              )}

              {remoteTarget && (
                <Field
                  label="Remote-Arbeitsverzeichnis"
                  explain="Wie bei der Quelle: wo diese Verbindung auf dem Zielserver beginnt, und zugleich die Grenze, die kein Pfad verlassen darf. Leer lassen heißt: dort, wo der Server das Konto nach der Anmeldung hinstellt."
                >
                  <input
                    value={job.destinationConfig?.remoteWorkingDirectory ?? ''}
                    placeholder="/"
                    onChange={(event) =>
                      changeTarget(job, change, { remoteWorkingDirectory: event.target.value || undefined })
                    }
                  />
                </Field>
              )}

              <Field
                label="Zielverzeichnis"
                action={
                  <FieldButton
                    title="Zielverzeichnis aussuchen"
                    disabled={browsing.open || (remoteTarget && !job.destinationConfig?.host)}
                    onClick={() => void openBrowser(job.destinationDirectory, 'DESTINATION')}
                  >
                    <FolderIcon />
                  </FieldButton>
                }
                explain={
                  remoteTarget
                    ? 'Ein Pfad auf dem Zielserver, vom Remote-Arbeitsverzeichnis aus gelesen.'
                    : 'Lokaler Pfad oder Freigabe. Bei einer Freigabe braucht das Konto, unter dem Unikom läuft, dort Schreibrecht.'
                }
              >
                <input
                  value={job.destinationDirectory}
                  placeholder={remoteTarget ? 'eingang' : 'D:\\Daten\\kunde-a\\eingang'}
                  onChange={(event) => change({ destinationDirectory: event.target.value })}
                />
              </Field>

              <CheckField
                label="Zielverzeichnis anlegen, falls es fehlt"
                checked={job.createDestinationDirectory}
                onChange={(createDestinationDirectory) => change({ createDestinationDirectory })}
              />

              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  disabled={target.busy || !job.tenantId || !job.destinationDirectory}
                  onClick={() => void checkDestination()}
                >
                  {target.busy ? 'Ziel wird geprüft …' : 'Ziel prüfen'}
                </button>

              </div>

              {target.error && (
                <div style={{ marginTop: '0.75rem' }}>
                  <Notice kind="error">{target.error}</Notice>
                </div>
              )}
              {target.result && (
                <div style={{ marginTop: '0.75rem' }}>
                  <Notice kind={target.result.ok ? (target.result.wouldBeCreated ? 'warn' : 'info') : 'error'}>
                    {target.result.message}
                  </Notice>
                </div>
              )}

              <Field
                label="Wenn die Datei dort schon liegt"
                explain={
                  <>
                    <p>
                      <strong>Überspringen</strong> — die Datei bleibt in der Quelle liegen und wird im Protokoll als
                      übersprungen geführt. Nichts im Ziel wird angefasst.
                    </p>
                    <p>
                      <strong>Dateinamen mit Zeitstempel versehen</strong> — beide Dateien bleiben erhalten. Die neue
                      bekommt den Zeitpunkt ihres Laufs an den Namen gehängt:
                    </p>
                    <ul className="samples">
                      <li>
                        <code>ORDER_001.csv</code>
                        <span>liegt schon im Ziel</span>
                      </li>
                      <li>
                        <code>ORDER_001_{stampExample(job)}.csv</code>
                        <span>kommt am 31.01.2026 um 23:59:59 dazu</span>
                      </li>
                    </ul>
                    <p>
                      Die Schreibweise folgt der Sprache, in der der Workflow angelegt wurde — Tag zuerst im Deutschen
                      und Spanischen, Monat zuerst im Englischen. Sie bleibt danach, wie sie ist: Die Dateien eines
                      Workflows dürfen nicht im Januar anders heißen als im Juni.
                    </p>
                    <p>
                      <strong>Unter neuem Namen anlegen</strong> — die neue Datei bekommt den Namen, den Sie darunter
                      eintragen. Trifft dieser Name selbst auf eine Datei, wird durchnummeriert.
                    </p>
                    <p>
                      <strong>Überschreiben</strong> — die vorhandene Datei wird ersetzt. Ihr Inhalt ist danach fort.
                    </p>
                  </>
                }
              >
                <select
                  value={job.conflictStrategy}
                  onChange={(event) => change({ conflictStrategy: event.target.value as Job['conflictStrategy'] })}
                >
                  <option value="SKIP">Überspringen</option>
                  <option value="RENAME">Dateinamen mit Zeitstempel versehen</option>
                  <option value="NEW_NAME">Unter neuem Namen anlegen</option>
                  <option value="OVERWRITE">Überschreiben</option>
                </select>
              </Field>

              {/*
                * Ohne Erklärknopf: Was hier hinzukommen soll, steht schon im
                * Fenster darüber, und die Endung hinter dem Feld sagt den Rest.
                */}
              {job.conflictStrategy === 'NEW_NAME' && (
                <Field label="Neuer Name">
                  <div className="field__row">
                    <input
                      value={job.conflictFilename ?? ''}
                      placeholder="Bestellungen_zweite_Lieferung"
                      onChange={(event) => change({ conflictFilename: event.target.value || undefined })}
                    />
                    <span className="suffix">{extensionLabel(job)}</span>
                  </div>
                </Field>
              )}

              {/*
                * Eine Frage, zwei Lesarten: Was liegt am Ende im Ziel?
                *
                * Gespeichert wird beides Mal dieselbe Angabe. Nur die Richtung
                * der Frage dreht sich mit der Ankunft — bei einer Datei, die
                * im Klartext hereinkommt, ist das Verschließen die Änderung,
                * bei einer verschlüsselten das Öffnen. Ein Haken, der bei
                * gleicher Bedeutung mal „an" und mal „aus" heißt, ist kein
                * zweiter Schalter, sondern derselbe von der anderen Seite.
                */}
              {arrivesEncrypted(job) ? (
                <CheckField
                  label="Entschlüsselt ablegen"
                  explain={
                    <>
                      <p>
                        Die Datei kommt verschlüsselt hier an. <strong>An:</strong> Sie wird im Arbeitsbereich
                        geöffnet und liegt lesbar im Ziel — nötig, wenn ein weiterer Schritt oder ein fremdes
                        Programm mit den Datensätzen arbeiten soll.
                      </p>
                      <p>
                        <strong>Aus:</strong> Sie bleibt verschlossen{' '}
                        {job.sourceEncryption?.enabled
                          ? '— geöffnet und mit Ihrem Schlüssel neu verschlossen, nicht mit dem des Absenders.'
                          : '— so, wie sie beim Abholen verschlüsselt wurde.'}{' '}
                        Im Ziel liegt dann kein Klartext.
                      </p>
                      {onPickup(job) && (
                        <p>
                          Was das Öffnen kostet, offen gesagt: Auf dem Weg hierher gab es keine lesbare Kopie, und
                          beim Holen entsteht keine. Ab dem Öffnen liegt sie im Arbeitsbereich, bis sie ins Ziel
                          verschoben ist — kurz, und in unserem eigenen Verzeichnis, das nach dem Lauf geleert wird.
                        </p>
                      )}
                    </>
                  }
                  checked={!job.encryptionConfig.enabled}
                  onChange={(decrypt) => change(withEncryption(job, { enabled: !decrypt }))}
                />
              ) : (
                <CheckField
                  label="Verschlüsselt ablegen"
                  explain="Die Datei wird vor der endgültigen Ablage verschlüsselt; im Ziel liegt nie Klartext."
                  checked={job.encryptionConfig.enabled}
                  onChange={(enabled) => change(withEncryption(job, { enabled }))}
                />
              )}

              {/*
                * Was hinter dem Übertragen liegt, liest, was hier abgelegt
                * wird. Eine verschlüsselte Datei hat aber keine Datensätze,
                * sondern eine Hülle. Der Hinweis steht hier und nicht als
                * Verbot beim Speichern: Vielleicht öffnet der nächste Schritt
                * sie eines Tages selbst — dann wäre das Verbot im Weg.
                */}
              {job.encryptionConfig.enabled && followingOf(job, 'TRANSFER') && (
                // Als stehende Zeile und nicht als `Notice`: Das ist ein
                // Fenster, und eines, das beim Tippen aufspringt, ist keine
                // Warnung mehr, sondern ein Hindernis.
                <div className="notice notice--warn">
                  Hinter dem Übertragen steht „{followingOf(job, 'TRANSFER')}". Dieser Schritt liest, was hier abgelegt
                  wird — und eine verschlüsselte Datei gibt keine Datensätze her. Für die Weiterverarbeitung muss die
                  Ablage lesbar sein.
                </div>
              )}

              {(job.encryptionConfig.enabled || onPickup(job)) && (
                <Field
                  label="Schlüssel"
                  explain={
                    job.sourceEncryption?.enabled
                      ? 'Ihr eigener Schlüssel, nicht der des Absenders: Die Datei wird geöffnet und für das Ziel neu verschlossen.'
                      : 'Mit ihm wird die Datei verschlossen — und, wenn sie entschlüsselt abgelegt wird, wieder geöffnet.'
                  }
                >
                  <div className="field__row">
                    {/*
                      * Hervorgehoben, solange keiner gewählt ist: Ohne
                      * Schlüssel holt der Lauf die Dateien und scheitert erst
                      * beim Verschließen — nachts, mit geleerter Quelle.
                      */}
                    <select
                      className={job.encryptionConfig.keyCredentialId ? undefined : 'wanted'}
                      value={job.encryptionConfig.keyCredentialId ?? ''}
                      onChange={(event) =>
                        change(withEncryption(job, { keyCredentialId: event.target.value || undefined }))
                      }
                    >
                      <option value="">— bitte wählen —</option>
                      {usable
                        .filter((credential) => credential.type === 'ENCRYPTION_KEY')
                        .map((credential) => (
                          <option key={credential.id} value={credential.id}>
                            {credential.name}
                          </option>
                        ))}
                    </select>
                    <button type="button" className="secondary" onClick={() => setAdding('KEY')}>
                      Neu …
                    </button>
                  </div>
                </Field>
              )}
            </Klappkarte>

            <Klappkarte titel="Nach erfolgreicher Übernahme" stand={nachlaufStand(job)}>

              <Field
                label="Was soll mit der Quelldatei geschehen?"
                explain="Erst wenn die Datei gespeichert und registriert ist, wird die Quelle angefasst."
              >
                <select
                  value={job.sourceSuccessAction}
                  onChange={(event) => change({ sourceSuccessAction: event.target.value as Job['sourceSuccessAction'] })}
                >
                  <option value="KEEP">Nichts, sie soll dort liegen bleiben</option>
                  <option value="MOVE">In ein Archivverzeichnis verschieben</option>
                  <option value="DELETE">Löschen</option>
                </select>
              </Field>

              {job.sourceSuccessAction === 'MOVE' && (
                <>
                  <Field
                    label="Archivverzeichnis"
                    explain={
                      <>
                        <p>
                          Das Archiv liegt <strong>auf der Quelle</strong>, nicht hier und nicht beim Ziel. Die Datei
                          wird dort verschoben, wo sie liegt — sie kommt kein zweites Mal über die Leitung.
                        </p>
                        {remote ? (
                          <p>
                            Die Quelle ist ein {job.sourceType}-Server. Also ein Pfad <em>auf diesem Server</em>, am
                            besten absolut: <code>/exports/archiv</code>. Das Konto, mit dem Unikom sich dort anmeldet,
                            braucht Schreibrecht — es muss die Datei umbenennen und das Verzeichnis anlegen dürfen.
                          </p>
                        ) : (
                          <p>
                            Die Quelle ist ein lokales Verzeichnis. Also ein lokaler Pfad oder eine Freigabe:{' '}
                            <code>D:\Daten\eingang\archiv</code>. Das Konto, unter dem Unikom läuft, braucht dort
                            Schreibrecht.
                          </p>
                        )}
                        <p>Fehlt das Verzeichnis, wird es beim ersten Lauf angelegt.</p>
                        <p>
                          Es darf auch unterhalb des Quellverzeichnisses liegen: Ein Lauf liest nur das
                          Quellverzeichnis selbst, nie ein Verzeichnis darunter. Was dort abgelegt wurde, kommt
                          deshalb kein zweites Mal.
                        </p>
                      </>
                    }
                    action={
                      <FieldButton
                        title="Archivverzeichnis aussuchen"
                        disabled={!job.tenantId || browsing.open}
                        onClick={() => void openBrowser(job.sourceArchiveDirectory ?? '', 'ARCHIVE')}
                      >
                        <FolderIcon />
                      </FieldButton>
                    }
                  >
                    <input
                      value={job.sourceArchiveDirectory ?? ''}
                      placeholder={remote ? '/exports/archiv' : 'D:\\Daten\\eingang\\archiv'}
                      onChange={(event) => change({ sourceArchiveDirectory: event.target.value || undefined })}
                    />
                  </Field>

                  <div className="row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={archive.busy || !job.tenantId || !job.sourceArchiveDirectory}
                      onClick={() => void checkArchive()}
                    >
                      {archive.busy ? 'Verzeichnis wird geprüft …' : 'Verzeichnis prüfen'}
                    </button>
                  </div>

                  {archive.error && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <Notice kind="error">{archive.error}</Notice>
                    </div>
                  )}
                  {archive.result && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <Notice kind={archive.result.ok ? (archive.result.wouldBeCreated ? 'warn' : 'info') : 'error'}>
                        {archive.result.message}
                      </Notice>
                    </div>
                  )}
                </>
              )}
            </Klappkarte>
          </>
        )}

        {steps.map((entry) =>
          entry.stage && isConfigurable(entry.stage) && step === entry.id ? (
            <StageModule
              key={entry.id}
              job={job}
              stage={entry.stage}
              features={features}
              credentials={usable}
              onNeuerZugang={() => setAdding('ACCESS')}
              onChange={change}
            />
          ) : null
        )}

        {step === 'schedule' && (
          <section className="card">
            <h2>Zeitplan</h2>

            <Field label="Ausführung">
              <select
                value={job.executionMode}
                onChange={(event) => change({ executionMode: event.target.value as Job['executionMode'] })}
              >
                <option value="MANUAL_AND_AUTOMATIC">Von Hand und nach Zeitplan</option>
                <option value="AUTOMATIC">Nur nach Zeitplan</option>
                <option value="MANUAL">Nur von Hand</option>
              </select>
            </Field>

            {job.executionMode !== 'MANUAL' && job.schedule && (
              <>
                <Field label="Rhythmus">
                  <select
                    value={job.schedule.type}
                    onChange={(event) =>
                      change({ schedule: { ...job.schedule!, type: event.target.value as never } })
                    }
                  >
                    <option value="INTERVAL">Alle N Minuten</option>
                    <option value="HOURLY">Stündlich</option>
                    <option value="DAILY">Täglich</option>
                    <option value="WEEKLY">Wöchentlich</option>
                  </select>
                </Field>

                {job.schedule.type === 'INTERVAL' && (
                  <Field label="Abstand in Minuten">
                    <input
                      type="number"
                      min={1}
                      value={job.schedule.intervalMinutes ?? 15}
                      onChange={(event) =>
                        change({
                          schedule: { ...job.schedule!, intervalMinutes: Number(event.target.value) || 1 },
                        })
                      }
                    />
                  </Field>
                )}

                {(job.schedule.type === 'DAILY' || job.schedule.type === 'WEEKLY') && (
                  <Field label="Uhrzeit">
                    <input
                      type="time"
                      value={job.schedule.executionTime ?? '06:00'}
                      onChange={(event) =>
                        change({ schedule: { ...job.schedule!, executionTime: event.target.value } })
                      }
                    />
                  </Field>
                )}

                <Field label="Zeitzone" explain="Sommer- und Winterzeit werden darüber richtig berechnet.">
                  <input
                    value={job.schedule.timezone}
                    onChange={(event) => change({ schedule: { ...job.schedule!, timezone: event.target.value } })}
                  />
                </Field>
              </>
            )}
          </section>
        )}
      </div>

      {/*
        * Speichern bleibt in Reichweite. Am Ende des Inhalts wäre es je nach
        * Schritt mal nach zwei Zeilen und mal nach zwei Bildschirmen erreichbar.
        */}
      <div className="editor__foot">
        <div className="row">
          <button className="secondary" disabled={position === 0} onClick={() => setStep(steps[position - 1].id)}>
            ‹ Zurück
          </button>
          <button
            className="secondary"
            disabled={position === steps.length - 1 || !basicsReady}
            title={basicsReady ? undefined : locked}
            onClick={() => setStep(steps[position + 1].id)}
          >
            Weiter ›
          </button>
        </div>

        <div className="row">
          <button className="secondary" onClick={onDone}>
            Abbrechen
          </button>
          <button
            disabled={saving || !job.tenantId || !job.name || !job.destinationDirectory}
            onClick={() => void save()}
          >
            {saving ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ein zuschaltbares Kettenglied.
 *
 * Es trägt seinen Namen, nicht seine Nummer. Die Nummer steht in der Kette
 * oben und zählt den Ablauf dieses Workflows — hier wäre sie irreführend, weil
 * sie sich ändert, sobald jemand ein anderes Glied zu- oder abschaltet.
 *
 * Alle drei einstellbaren Glieder benutzen dieselbe Vorlage: Sie unterscheiden
 * sich darin, was sie mit den Daten tun, nicht darin, wie sie eingehängt sind.
 */
function StageModule({
  job,
  stage,
  features,
  credentials,
  onNeuerZugang,
  onChange,
}: {
  job: Job;
  stage: ConfigurableStage;
  /** Für die Verzweigung des Ausliefern-Gliedes: Was nicht gekauft ist, steht nicht zur Wahl. */
  features: Feature[];
  /** Für die Anmeldung an einer Freigabe — schon auf diesen Mandanten eingeschränkt. */
  credentials: Credential[];
  onNeuerZugang(): void;
  onChange(patch: Partial<Job>): void;
}) {
  const field = STAGE_FIELDS[stage];
  const config = stageOf(job, stage);
  const preceding = precedingOf(job, stage);
  const following = followingOf(job, stage);
  /*
   * Der Datenbankimport schreibt in Tabellen und hat deshalb kein
   * Zielverzeichnis. Alles andere legt eine Datei ab.
   */
  const lieferung = stage === 'DELIVER' ? (config as DeliverConfig | undefined) : undefined;
  const ziel = lieferung?.ziel ?? 'DATEI';
  const writesFiles = stage !== 'DELIVER' || ziel === 'DATEI';

  const patch = (next: Partial<StageConfig>): void =>
    onChange({ [field]: { ...config!, ...next } } as Partial<Job>);

  return (
    <>
      {/*
        * Zuerst das Glied selbst: wie es heißt, wozu es da ist, ob es mitläuft.
        * Als eigene Fläche und nicht als Kopf einer großen — so steht es beim
        * Übertragen, und was gleich aussieht, soll gleich gebaut sein.
        */}
      <Klappkarte titel={STAGE_LABELS[stage]} stand={config?.enabled === true ? 'GUELTIG' : 'LEER'}>

        <div className="prose">
          <p>{STAGE_DESCRIPTIONS[stage]}</p>
        </div>

        <CheckField
            label={`„${STAGE_LABELS[stage]}“ in diesem Workflow verwenden`}
            explain="Aus bedeutet: dieses Glied wird übersprungen, die Kette schließt sich darüber."
            checked={config?.enabled === true}
            onChange={(on) =>
              onChange({
                [field]: {
                  // Übernehmen nur, wenn es etwas zu übernehmen gibt. Ein Workflow,
                  // der hier anfängt, bekommt ein eigenes Verzeichnis.
                  input: preceding ? { from: 'PRECEDING' } : { from: 'DIRECTORY', directory: '' },
                  output: writesFiles ? { to: 'DIRECTORY', directory: '' } : undefined,
                  ...config,
                  enabled: on,
                },
              } as Partial<Job>)
            }
          />
      </Klappkarte>

      {/*
        * Die Quelle als eigene, zuklappbare Fläche.
        *
        * Sie steht vor der Verarbeitung, weil sie vor ihr entschieden wird —
        * und lässt sich zuklappen, weil sie danach nur noch im Weg steht.
        */}
      {config?.enabled && stage === 'CONSOLIDATE' && (
        <Konsolidierungsquelle
          value={config.input}
          preceding={preceding}
          vorbelegung={vorbelegungAus(job)}
          tenantId={job.tenantId}
          credentials={credentials}
          onNeuerZugang={onNeuerZugang}
          onChange={(input) => patch({ input })}
        />
      )}

      {config?.enabled && stage === 'CONSOLIDATE' && (
        <Stapelwahl
          wahl={(config as KonsolidierungConfig).dateien}
          eingang={config.input}
          tenantId={job.tenantId}
          onChange={(dateien) => patch({ dateien } as Partial<StageConfig>)}
        />
      )}

      {config?.enabled && (
        <Klappkarte titel={stage === 'CONSOLIDATE' ? 'Verarbeitung' : 'Einstellungen'} stand={ausgangStand(config.output)}>

          {stage === 'CONSOLIDATE' && (
            <Konsolidierungsregeln
              tenantId={job.tenantId}
              config={config as KonsolidierungConfig}
              onChange={(next) => onChange({ consolidation: { ...(config as KonsolidierungConfig), ...next } })}
            />
          )}

          {stage === 'DELIVER' && (
            <Lieferzweig
              config={lieferung}
              features={features}
              onChange={(next) => onChange({ delivery: { ...(lieferung as DeliverConfig), ...next } })}
            />
          )}

          {/*
            * Das Konsolidieren hat seine Quelle oben in eigener Fläche. Die
            * übrigen Glieder wählen sie hier, in einer Zeile.
            */}
          {stage !== 'CONSOLIDATE' && (
            <StageSource
              value={config.input}
              preceding={preceding}
              onChange={(input) => patch({ input })}
            />
          )}

          <>
              {writesFiles ? (
                <StageDestination
                  value={config.output ?? { to: 'DIRECTORY', directory: '' }}
                  following={following}
                  onChange={(output) => patch({ output })}
                />
              ) : (
                <Field label="Datenbank">
                  <div className="field__row">
                    <span className="field__note">Wird mit dem Modul eingerichtet.</span>
                    <Hint title="Datenbankverbindung">
                      Die Verbindung gehört zu diesem Modul und wird mit ihm eingerichtet — sie steht später hier,
                      nicht bei den Zugängen: eine Zieltabelle ist kein Zugang, den ein anderer Job mitbenutzt.
                    </Hint>
                  </div>
                </Field>
              )}

              {stage === 'DELIVER' && (
                <div className="field__row">
                  <span className="field__note">Verarbeitung wird noch gebaut.</span>
                  <Hint kind="warn" title="Noch nicht ausführbar">
                    Die Verkettung wird gespeichert, die Verarbeitung selbst wird noch gebaut. Ein Workflow mit
                    eingeschaltetem Glied „{STAGE_LABELS[stage]}“ startet deshalb noch nicht — er bricht mit einem
                    Hinweis ab, statt die übrigen Glieder allein auszuführen und unverarbeitete Daten weiterzugeben.
                  </Hint>
                </div>
              )}
            </>
        </Klappkarte>
      )}
    </>
  );
}
/**
 * Woher das Konsolidieren seine Dateien nimmt.
 *
 * ## Warum eine eigene Fläche und nicht zwei Zeilen
 *
 * Beim Übertragen steht die Quelle in einem eigenen Panel, und hier wird
 * dasselbe entschieden: ein Ort, eine Anmeldung, ein Verzeichnis. Was gleich
 * aussieht, soll gleich aufgebaut sein — sonst muss man an zwei Stellen
 * dasselbe neu lernen.
 *
 * ## Warum nur örtlich und Freigabe
 *
 * Die Konsolidierung liest auf dem Dateisystem dieses Rechners. Ein UNC-Pfad
 * ist ein Pfad im Dateisystem — nur einer, der über das Netz führt; SFTP und
 * FTPS wären eine Abholung, und die gehört dem Übertragen. Die beiden hier
 * anzubieten hieße, einem Kunden eine Einstellung zu geben, bei der der
 * Nachtlauf nichts findet.
 *
 * ## Warum die Übernahme ein Verweis bleibt
 *
 * „Übernimmt, was Daten übertragen ablegt" ist **die Liste dieses Laufs** und
 * nicht das, was gerade im Zielverzeichnis liegt. Dort liegen auch die Dateien
 * von gestern. Ein von dort abgeschriebener Pfad wäre außerdem so lange
 * richtig, bis jemand den Schritt davor ändert — und ab dann still falsch.
 */
/**
 * Was das Übertragen als Startwert hergibt.
 *
 * **Ein Startwert und keine Verbindung.** Übernommen wird er einmal, sichtbar
 * eingetragen und danach eigenständig. Ein dauerhaft abgeschriebener Pfad wäre
 * so lange richtig, bis jemand das Übertragen ändert — und ab dann still
 * falsch, auf einem Zeitplan, den niemand beobachtet. Wer die Verbindung will,
 * nimmt „Übernimmt, was Daten übertragen ablegt": Das ist ein Verweis und
 * wandert mit.
 *
 * Nur örtlich und Freigabe: Legt das Übertragen auf einem entfernten Server ab,
 * gibt es hier nichts vorzubelegen — die Konsolidierung liest dort nicht.
 */
function vorbelegungAus(job: Job): { art: 'LOCAL' | 'SHARE'; directory: string; credentialId?: string } | undefined {
  const art = job.destinationType ?? 'LOCAL';

  if (!transfers(job) || (art !== 'LOCAL' && art !== 'SHARE') || !job.destinationDirectory) {
    return undefined;
  }

  return {
    art,
    directory: job.destinationDirectory,
    credentialId: art === 'SHARE' ? job.destinationCredentialId : undefined,
  };
}

function Konsolidierungsquelle({
  value,
  preceding,
  vorbelegung,
  tenantId,
  credentials,
  onNeuerZugang,
  onChange,
}: {
  value: StageInput;
  /** Fehlt, wenn dieser Schritt der erste des Workflows ist. */
  preceding?: { label: string; path: string };
  /** Startwert aus dem Ziel des Übertragens — siehe `vorbelegungAus`. */
  vorbelegung?: { art: 'LOCAL' | 'SHARE'; directory: string; credentialId?: string };
  tenantId?: string;
  credentials: Credential[];
  onNeuerZugang(): void;
  onChange(next: StageInput): void;
}) {
  const eigenes = value.from === 'DIRECTORY';
  const art = eigenes ? value.art ?? 'LOCAL' : 'LOCAL';
  const freigabe = eigenes && art === 'SHARE';
  const zugang = eigenes ? value.credentialId : undefined;

  // Eine gespeicherte Übernahme, der jemand nachträglich den Vorgänger
  // abgeschaltet hat, wird benannt statt stillschweigend anders ausgelegt.
  const verwaist = !preceding && value.from === 'PRECEDING';

  const eigenesAendern = (teile: Partial<Extract<StageInput, { from: 'DIRECTORY' }>>): void =>
    onChange({
      from: 'DIRECTORY',
      directory: eigenes ? value.directory : '',
      art,
      credentialId: zugang,
      ...teile,
    });

  /*
   * Durchgesehen wird auf dem Server und mit demselben Zugang, mit dem später
   * gelesen wird. Ohne ihn sähe der Browser die Freigabe mit dem Konto, unter
   * dem Unikom läuft — und zeigte etwas anderes, als der Lauf findet.
   */
  const durchsehen = (pfad: string): Promise<RemoteDirectoryResult> =>
    api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
      name: 'Konsolidierung',
      tenantId,
      directory: pfad,
      known: [],
      sourceType: art,
      credentialId: zugang,
    });

  return (
    <Klappkarte titel="Quelle" stand={eingangStand(value)}>
      {verwaist && (
        <Notice kind="warn">
          Dieser Schritt soll übernehmen, was der Schritt davor ablegt — aber davor liegt keiner mehr. Bitte ein
          Quellverzeichnis angeben.
        </Notice>
      )}

      <Field
        label="Woher"
        explain={
          <>
            <p>
              „Übernimmt, was … ablegt" ist ein Verweis und kein abgeschriebener Pfad: Ändert jemand den Schritt
              davor, wandert diese Quelle mit.
            </p>
            {vorbelegung && (
              <p>
                „Ein eigenes Verzeichnis" bekommt beim Umschalten <strong>einmalig</strong> Verzeichnis und Zugang
                aus dem Ziel des Übertragens eingetragen — als Startwert, nicht als Verbindung. Ändert sich das
                Übertragen später, ändert sich dieser Pfad nicht mit.
              </p>
            )}
            <p>
              Übernommen wird dabei <strong>die Liste dieses Laufs</strong> — nicht alles, was gerade im
              Zielverzeichnis liegt. Sonst käme der Bestand von gestern jede Nacht wieder mit.
            </p>
          </>
        }
      >
        <select
          value={preceding ? value.from : 'DIRECTORY'}
          onChange={(event) =>
            event.target.value === 'PRECEDING'
              ? onChange({ from: 'PRECEDING' })
              : /*
                 * Beim Umschalten auf ein eigenes Verzeichnis den Startwert aus
                 * dem Übertragen — aber nur in ein **leeres** Feld. Etwas
                 * Eingetragenes zu überschreiben, weil jemand zweimal
                 * umschaltet, wäre der stille Verlust einer Angabe.
                 */
                eigenesAendern(eigenes && value.directory ? {} : vorbelegung ?? {})
          }
        >
          {preceding && <option value="PRECEDING">Übernimmt, was {preceding.label} ablegt</option>}
          <option value="DIRECTORY">Ein eigenes Verzeichnis</option>
        </select>
      </Field>

      {preceding && value.from === 'PRECEDING' ? (
        <Field
          label="Das ist zurzeit"
          explain="Nur zur Ansicht. Geändert wird es dort, wo der Schritt davor sein Ziel festlegt."
        >
          <input value={preceding.path || '— noch nicht festgelegt —'} readOnly className="input--derived" />
        </Field>
      ) : (
        <>
          <Field
            label="Art"
            explain={
              <>
                <p>Wo die zu verarbeitenden Dateien liegen.</p>
                <p>
                  SFTP und FTPS stehen hier nicht: Das Konsolidieren liest auf dem Dateisystem dieses Rechners. Wer
                  von einem fremden Server verarbeiten will, schaltet „Daten übertragen" davor — das holt ab, und
                  diese Quelle übernimmt dann, was es ablegt.
                </p>
              </>
            }
          >
            <select
              value={art}
              onChange={(event) =>
                eigenesAendern({
                  art: event.target.value as 'LOCAL' | 'SHARE',
                  // Der Zugang gehört zur Freigabe. Bleibt er beim Wechsel auf
                  // „örtlich" stehen, wird er beim nächsten Wechsel zurück
                  // stillschweigend wieder verwendet — womöglich der falsche.
                  credentialId: event.target.value === 'SHARE' ? zugang : undefined,
                })
              }
            >
              <option value="LOCAL">Lokales Verzeichnis</option>
              <option value="SHARE">Windows-Freigabe</option>
            </select>
          </Field>

          {freigabe && (
            <Field
              label="Anmeldung an der Freigabe"
              explain="Pflicht. Ohne Zugang würde die Freigabe mit dem Konto erreicht, unter dem der Dienst läuft — und das ist nicht Ihres."
            >
              <div className="field__row">
                {/*
                  * Hervorgehoben, solange keiner gewählt ist: Eine Freigabe ohne
                  * Zugang liest der Nachtlauf mit dem falschen Konto, und das
                  * soll man vorher sehen und nicht erst danach.
                  */}
                <select
                  className={!zugang ? 'wanted' : undefined}
                  value={zugang ?? ''}
                  onChange={(event) => eigenesAendern({ credentialId: event.target.value || undefined })}
                >
                  <option value="">— bitte wählen —</option>
                  {credentials
                    .filter((credential) => credential.type !== 'ENCRYPTION_KEY')
                    .map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.name}
                        {credential.tenantId === undefined ? ' (übergreifend)' : ''}
                      </option>
                    ))}
                </select>
                <button type="button" className="secondary" onClick={onNeuerZugang}>
                  Neu …
                </button>
              </div>
            </Field>
          )}

          <Verzeichnisfeld
            label="Quellverzeichnis"
            titel="Quellverzeichnis der Konsolidierung wählen"
            wert={eigenes ? value.directory : ''}
            explain={
              freigabe
                ? 'Der UNC-Pfad der Freigabe, etwa \\\\SERVER01\\Austausch\\Eingang. Durchgesehen wird mit dem Zugang darüber.'
                : 'Verzeichnis auf diesem Rechner, aus dem die zu verarbeitenden Dateien gelesen werden.'
            }
            disabled={!tenantId || (freigabe && !zugang)}
            lies={durchsehen}
            onChange={(pfad) =>
              eigenesAendern({
                directory: pfad,
                /*
                 * Der Zugang, der fuer diese Freigabe hinterlegt ist — sonst
                 * der bisherige. Wer ein Verzeichnis aussucht, soll den
                 * Zugang nicht ein zweites Mal aus einer Liste heraussuchen.
                 *
                 * Nur ergaenzend, nie loeschend: Findet sich keiner, bleibt
                 * stehen, was jemand von Hand gewaehlt hat.
                 */
                credentialId:
                  (freigabe ? zugangFuerFreigabe(credentials, pfad)?.id : undefined) ?? zugang,
              })
            }
          />
        </>
      )}
    </Klappkarte>
  );
}

function StageSource({
  value,
  preceding,
  onChange,
}: {
  value: StageInput;
  /** Fehlt, wenn dieser Schritt der erste des Workflows ist. */
  preceding?: { label: string; path: string };
  onChange(next: StageInput): void;
}) {
  // Ohne Vorgänger gibt es nichts zu übernehmen. Die Wahl wird dann nicht nur
  // gesperrt, sondern gar nicht erst angeboten — und eine gespeicherte
  // Übernahme, der jemand nachträglich den Vorgänger abgeschaltet hat, wird
  // benannt statt stillschweigend anders ausgelegt.
  const orphaned = !preceding && value.from === 'PRECEDING';

  return (
    <>
      {orphaned && (
        <Notice kind="warn">
          Dieser Schritt soll übernehmen, was der Schritt davor ablegt — aber davor liegt keiner mehr. Bitte ein
          Quellverzeichnis angeben.
        </Notice>
      )}

      <Field label="Quelle">
        <select
          value={preceding ? value.from : 'DIRECTORY'}
          onChange={(event) =>
            onChange(
              event.target.value === 'PRECEDING' ? { from: 'PRECEDING' } : { from: 'DIRECTORY', directory: '' }
            )
          }
        >
          {preceding && <option value="PRECEDING">Übernimmt, was {preceding.label} ablegt</option>}
          <option value="DIRECTORY">Ein eigenes Verzeichnis</option>
        </select>
      </Field>

      {preceding && value.from === 'PRECEDING' ? (
        <Field label="Das ist zurzeit">
          <input value={preceding.path || '— noch nicht festgelegt —'} readOnly className="input--derived" />
        </Field>
      ) : (
        <Field label="Quellverzeichnis">
          <input
            value={value.from === 'DIRECTORY' ? value.directory : ''}
            onChange={(event) => onChange({ from: 'DIRECTORY', directory: event.target.value })}
          />
        </Field>
      )}
    </>
  );
}

/** Wohin ein Glied schreibt. Weiterreichen gibt es nur, wenn etwas folgt. */
/**
 * Wohin ein Glied sein Ergebnis legt.
 *
 * Wo kein weiteres Glied folgt, ist das Verzeichnis **Pflicht**: „Wenn Modul 3
 * nicht ausgeführt werden kann, dann brauchen wir bei Modul 2 ein
 * Ergebnis-Verzeichnis, das angegeben werden muss." Der Ergebnisbestand ist
 * Unikoms eigene Buchführung; der Kunde kommt an seine Daten über ein
 * Verzeichnis.
 */
function StageDestination({
  value,
  following,
  onChange,
}: {
  value: StageOutput;
  following?: string;
  onChange(next: StageOutput): void;
}) {
  return (
    <>
      <Field label="Ziel">
        <select
          value={following ? value.to : 'DIRECTORY'}
          onChange={(event) =>
            onChange(event.target.value === 'FOLLOWING' ? { to: 'FOLLOWING' } : { to: 'DIRECTORY', directory: '' })
          }
        >
          {following && <option value="FOLLOWING">Reicht weiter an {following}</option>}
          <option value="DIRECTORY">Legt in einem Verzeichnis ab</option>
        </select>
      </Field>

      {(!following || value.to === 'DIRECTORY') && (
        <Field
          label="Zielverzeichnis"
          explain="Wohin das Ergebnis gelegt wird. Es steht zusätzlich im Ergebnisbestand — dort führt Unikom seine eigene Buchführung mit Prüfung und Freigabe; hierher kommt es für den Kunden."
        >
          <input
            value={value.to === 'DIRECTORY' ? value.directory : ''}
            onChange={(event) => onChange({ to: 'DIRECTORY', directory: event.target.value })}
          />
        </Field>
      )}
    </>
  );
}

/**
 * Zeigt auf Anfrage die `authorized_keys`-Zeile eines gewählten SSH-Zugangs.
 *
 * Auf Anfrage und nicht von selbst: Dafür muss der private Schlüssel entschlüsselt
 * werden, und das gehört nicht in das Zeichnen einer Maske, die sich bei jeder
 * Eingabe erneuert.
 */
function PublicKeyOf({ credential }: { credential?: Credential }) {
  const [state, setState] = useState<{ open: boolean; publicKey?: string; problem?: string }>({ open: false });

  if (!credential) {
    return null;
  }

  async function show(): Promise<void> {
    setState({ open: true });

    try {
      const key = await api.get<{ publicKey: string }>(`/api/credentials/${credential!.id}/public-key`);
      setState({ open: true, publicKey: key.publicKey });
    } catch (failure) {
      setState({ open: true, problem: messageOf(failure, 'Der öffentliche Schlüssel ist nicht abrufbar') });
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: '-0.6rem', marginBottom: '1.2rem' }}>
        <button type="button" className="secondary" onClick={() => void show()}>
          Öffentlichen Schlüssel anzeigen
        </button>
      </div>

      {state.open && (
        <Modal title={`Öffentlicher Schlüssel — ${credential.name}`} onClose={() => setState({ open: false })}>
          {!state.publicKey && !state.problem ? (
            <Loading />
          ) : (
            <PublicKeyPanel publicKey={state.publicKey} problem={state.problem} />
          )}
        </Modal>
      )}
    </>
  );
}


/**
 * Die Verzweigung des dritten Gliedes (SPEC-01, Abschnitt 32).
 *
 * ```text
 * ( ) In eine Datenbank importieren     braucht „Daten importieren"
 * (•) Als Datei exportieren             legt eine Datei ab
 *     [ ] vorher konvertieren nach …    braucht „Daten konvertieren"
 * ```
 *
 * Entweder, oder — nicht beides. Ein Schritt, der zugleich Tabellen füllt und
 * eine Datei ablegt, wäre zwei Schritte, und dann müsste geklärt werden, was
 * gilt, wenn einer davon misslingt.
 *
 * Ein Zweig, für den die Lizenz fehlt, steht nicht zur Wahl: Wer nur das
 * Konvertieren gekauft hat, soll nicht auf einen Datenbankimport klicken
 * können, den das Speichern gleich darauf ablehnt.
 */
/**
 * Wonach der Konsolidierungsschritt arbeitet, wenn niemand zusieht.
 *
 * ```text
 * Sammeln      alle Quellen gleichwertig     Filiallisten aneinander
 * Anreichern   eine führt, die übrigen ergänzen sie
 *
 * Aneinander   Datensätze nebeneinander
 * Ineinander   Datensätze über den Schlüssel verschmelzen
 * ```
 *
 * Die beiden sind getrennt und nicht eines: Ein Anhängen zweier gleichartiger
 * Filiallisten hat keine Hauptdatei, und ohne diese Trennung wäre jeder
 * Datensatz der zweiten Liste ein Konflikt.
 *
 * **Ohne Schlüssel wird nichts verschmolzen und nichts als Dublette erkannt.**
 * Das ist kein Versäumnis, sondern die Regel: Einen Schlüssel zu erraten ist
 * ausdrücklich untersagt — ein falsch geratener führte Datensätze zusammen, die
 * nichts miteinander zu tun haben, und das fiele erst beim Kunden auf.
 */
function Konsolidierungsregeln({
  tenantId,
  config,
  onChange,
}: {
  tenantId: string;
  config: KonsolidierungConfig;
  onChange(next: Partial<KonsolidierungConfig>): void;
}) {
  const regeln: Regeln = config.regeln ?? { betriebsart: 'SAMMELN', art: 'APPEND' };
  const felder = regeln.schluessel?.felder ?? [];

  const setzeRegeln = (next: Partial<Regeln>): void => onChange({ regeln: { ...regeln, ...next } });

  return (
    <>
      {/*
        * Das Namensmuster stand hier als einzelnes Feld und steht jetzt in der
        * Fläche „Welche Dateien" — zusammen mit dem, was dazugehört: den
        * erwarteten Lieferungen, der Frist und den Verzeichnissen. Ein Muster
        * allein beantwortete die Frage nicht, die daran hängt: Ist der Bestand
        * vollständig?
        */}
      <Ergebnisformat tenantId={tenantId} config={config} onChange={onChange} />

      <Zuordnung tenantId={tenantId} config={config} />

      <WeitereDurchgaenge
        tenantId={tenantId}
        config={config}
        onChange={(weitere) => onChange({ weitere })}
      />

      <Umformungen
        tenantId={tenantId}
        config={config}
        onChange={(umformung) => onChange({ umformung })}
      />

      <Field
        label="Wie die Quellen zueinander stehen"
        explain="Beim Anreichern führt eine Datei und die übrigen ergänzen sie; beim Sammeln sind alle gleichwertig."
      >
        <select
          value={regeln.betriebsart}
          onChange={(event) => {
            const betriebsart = event.target.value as Betriebsart;

            setzeRegeln({ betriebsart, fuehrend: betriebsart === 'SAMMELN' ? undefined : regeln.fuehrend });
          }}
        >
          <option value="SAMMELN">Sammeln — alle Quellen sind gleichwertig</option>
          <option value="ANREICHERN">Anreichern — eine Datei führt</option>
        </select>
      </Field>

      {regeln.betriebsart === 'ANREICHERN' && (
        <Field
          label="Führende Datei"
          explain="Ihr Dateiname, so wie er im Verzeichnis steht. Findet der Lauf sie nicht, meldet er das als fehlende Hauptdatei — er sucht sich keine Ersatzdatei."
        >
          <input
            value={regeln.fuehrend ?? ''}
            placeholder="Kunden.csv"
            onChange={(event) => setzeRegeln({ fuehrend: event.target.value || undefined })}
          />
        </Field>
      )}

      <Field label="Was mit den Datensätzen geschieht">
        <select value={regeln.art} onChange={(event) => setzeRegeln({ art: event.target.value as Art })}>
          <option value="APPEND">Aneinander — die Datensätze stehen nebeneinander</option>
          <option value="MERGE">Ineinander — gleiche Datensätze werden verschmolzen</option>
        </select>
      </Field>

      <Field
        label="Schlüsselfelder"
        explain="Die Felder, an denen zwei Datensätze als derselbe erkannt werden — durch Komma getrennt, etwa: kdnr oder name, plz. Ohne Schlüssel wird nichts verschmolzen und nichts als Dublette erkannt; geraten wird er nicht."
      >
        <input
          value={felder.join(', ')}
          placeholder="kdnr"
          onChange={(event) => {
            const eingetragen = event.target.value
              .split(',')
              .map((feld) => feld.trim())
              .filter((feld) => feld !== '');

            setzeRegeln({ schluessel: eingetragen.length > 0 ? { felder: eingetragen } : undefined });
          }}
        />
      </Field>

      {felder.length > 0 && (
        <Field
          label="Doppelte Datensätze"
          explain="Was geschieht, wenn zwei Datensätze denselben Schlüssel tragen."
        >
          <select
            value={regeln.dubletten?.auswahl ?? 'ENTSCHEIDEN'}
            onChange={(event) =>
              setzeRegeln({
                dubletten: {
                  auswahl: event.target.value as Dublettenauswahl,
                  verbleib: regeln.dubletten?.verbleib ?? 'MITGEBEN',
                },
              })
            }
          >
            <option value="ENTSCHEIDEN">Ein Mensch entscheidet — sie werden zu Konfliktfällen</option>
            <option value="ERSTER">Den ersten behalten</option>
            <option value="LETZTER">Den letzten behalten</option>
            <option value="ZUSAMMENFUEHREN">Zusammenführen</option>
            <option value="ALLE_BEHALTEN">Alle behalten</option>
          </select>
        </Field>
      )}

      {regeln.betriebsart === 'ANREICHERN' && (
        <Field
          label="Datensatz ohne Hauptsatz"
          explain="Ein Datensatz der Zusatzdatei, zu dem es in der führenden Datei keinen gibt."
        >
          <select
            value={regeln.ohneHauptsatz ?? 'KONFLIKT'}
            onChange={(event) => setzeRegeln({ ohneHauptsatz: event.target.value as OhneHauptsatz })}
          >
            <option value="KONFLIKT">Als Konflikt melden</option>
            <option value="UEBERNEHMEN">Trotzdem übernehmen</option>
            <option value="UEBERSPRINGEN">Übergehen</option>
          </select>
        </Field>
      )}

      {regeln.betriebsart === 'ANREICHERN' && felder.length > 0 && (
        <Field
          label="Mehrere passende Sätze in der Zusatzdatei"
          explain="Wenn zu einem Hauptsatz mehr als ein Satz der Zusatzdatei passt."
        >
          <select
            value={regeln.mehrfachtreffer?.regel ?? 'KONFLIKT'}
            onChange={(event) => {
              const gewaehlt = event.target.value as Mehrfachtrefferregel['regel'];

              setzeRegeln({
                mehrfachtreffer:
                  gewaehlt === 'FELD'
                    ? { regel: 'FELD', feld: '', nimm: 'GROESSTER' }
                    : { regel: gewaehlt },
              });
            }}
          >
            <option value="KONFLIKT">Als Konflikt melden — genau einer wird erwartet</option>
            <option value="ALLE">Alle übernehmen — aus einem Satz werden mehrere</option>
            <option value="FELD">Ein Feld entscheidet</option>
          </select>
        </Field>
      )}

      {regeln.mehrfachtreffer?.regel === 'FELD' && (
        <>
          <Field
            label="Entscheidendes Feld"
            explain="Ein Änderungsdatum, eine Versionsnummer, ein Statusrang — das Feld der Zusatzdatei, an dem sich entscheidet, welcher Satz gilt."
          >
            <input
              value={regeln.mehrfachtreffer.feld}
              placeholder="geaendert_am"
              onChange={(event) =>
                setzeRegeln({
                  mehrfachtreffer: { regel: 'FELD', feld: event.target.value, nimm: nimmt(regeln) },
                })
              }
            />
          </Field>

          <Field label="Welcher Wert gewinnt">
            <select
              value={nimmt(regeln)}
              onChange={(event) =>
                setzeRegeln({
                  mehrfachtreffer: {
                    regel: 'FELD',
                    feld: regeln.mehrfachtreffer?.regel === 'FELD' ? regeln.mehrfachtreffer.feld : '',
                    nimm: event.target.value as 'GROESSTER' | 'KLEINSTER',
                  },
                })
              }
            >
              <option value="GROESSTER">Der größte — das jüngste Datum, die höchste Version</option>
              <option value="KLEINSTER">Der kleinste</option>
            </select>
          </Field>
        </>
      )}

      <Prioritaeten regeln={regeln} onChange={setzeRegeln} />
      <Ergaenzung regeln={regeln} onChange={setzeRegeln} />
      <Aehnlichkeit regeln={regeln} onChange={setzeRegeln} />

      <Referenzen tenantId={tenantId} regeln={regeln} onChange={setzeRegeln} />
    </>
  );
}




/**
 * Der Abgleich gegen verwaltete Referenzquellen (SPEC-04, Abschnitt 6 und 8).
 *
 * ““ Was hier steht und was nicht
 *
 * Hier steht der **Verweis** — welche Quelle, über welche Felder, was übernommen
 * wird. Die Datenmenge steht unter „Daten konsolidieren → Referenzen": Ein
 * Referenzbestand in jedem Workflow ergäbe so viele Stände wie Workflows, und
 * beim nächsten Umzug wüsste niemand, welcher gilt.
 *
 * ““ Übernehmen ist nicht dasselbe wie prüfen
 *
 * Ohne Angabe wird nur nachgeschlagen: kennt die Referenz diesen Wert? Erst
 * wenn hier Felder stehen, schreibt sie etwas in den Datensatz — „Dies muss
 * ausdrücklich im Profil definiert sein“. Eine Referenz, die ungefragt Werte
 * ergänzt, wäre eine zweite Datenquelle, die niemand ausgewählt hat.
 */
function Referenzen({
  tenantId,
  regeln,
  onChange,
}: {
  tenantId: string;
  regeln: Regeln;
  onChange(next: Partial<Regeln>): void;
}) {
  const quellen = useResource<Referenzquelle[]>(
    tenantId ? `/api/reference-sources?tenantId=${encodeURIComponent(tenantId)}` : undefined
  );

  const verweise = regeln.referenzen ?? [];

  const setze = (naechste: Referenzverweis[]): void =>
    onChange({ referenzen: naechste.length > 0 ? naechste : undefined });

  return (
    <>
      <h4>Referenzabgleich</h4>

      <div className="field__row">
        <span className="field__note">
          {quellen.data && quellen.data.length === 0
            ? 'Noch keine Referenzquelle eingetragen — unter „Daten konsolidieren → Referenzen".'
            : 'Nachschlagen gegen ein Verzeichnis, eine Kundenliste, einen Artikelstamm.'}
        </span>
        <Hint title="Was der Abgleich tut">
          Er beantwortet zwei Fragen: <em>Kennt die Referenz diesen Wert?</em> und, wenn Sie es ausdrücklich
          einstellen, <em>was weiß sie sonst noch darüber?</em> Ein Treffer darf übernommen werden, kein Treffer
          wird gemeldet — und <strong>mehrere Treffer niemals automatisch</strong>: Zwei plausible Treffer sind
          keine Auswahl, sondern eine Frage. Referenzdaten werden dabei nur gelesen und nie verändert.
        </Hint>
      </div>

      {verweise.map((verweis, stelle) => (
        <section className="card card--nested" key={`referenz-${stelle}`}>
          <div className="row row--between">
            <strong>Abgleich {stelle + 1}</strong>
            <button type="button" className="secondary" onClick={() => setze(ohne(verweise, stelle))}>
              Entfernen
            </button>
          </div>

          <Field label="Referenzquelle">
            <select
              value={verweis.quelleId}
              onChange={(event) =>
                setze(ersetze(verweise, stelle, { ...verweis, quelleId: event.target.value }))
              }
            >
              <option value="">— wählen —</option>
              {(quellen.data ?? []).map((quelle) => (
                <option key={quelle.id} value={quelle.id}>
                  {quelle.name}
                  {quelle.version ? ` (${quelle.version})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Nachschlagen über"
            explain="Die Felder des Datensatzes, mit Komma getrennt. Heißen sie in der Referenz anders, tragen Sie die dortigen Namen darunter ein."
          >
            <input
              value={verweis.felder.join(', ')}
              placeholder="plz"
              onChange={(event) =>
                setze(ersetze(verweise, stelle, { ...verweis, felder: liste(event.target.value) }))
              }
            />
          </Field>

          <Field label="Heißen dort" explain="Leer heißt: genauso.">
            <input
              value={(verweis.referenzfelder ?? []).join(', ')}
              placeholder="postleitzahl"
              onChange={(event) => {
                const felder = liste(event.target.value);

                setze(
                  ersetze(verweise, stelle, {
                    ...verweis,
                    referenzfelder: felder.length > 0 ? felder : undefined,
                  })
                );
              }}
            />
          </Field>

          <Field
            label="Übernehmen"
            explain="Zielfeld = Referenzfeld, mit Komma getrennt — etwa ort = ort. Leer heißt: nur prüfen, nichts schreiben."
          >
            <input
              value={(verweis.uebernehmen ?? []).map((eintrag) => `${eintrag.feld} = ${eintrag.aus}`).join(', ')}
              placeholder="ort = ort"
              onChange={(event) => {
                const paare = liste(event.target.value)
                  .map((eintrag) => eintrag.split('='))
                  .filter((teile) => teile.length === 2)
                  .map((teile) => ({ feld: teile[0].trim(), aus: teile[1].trim() }))
                  .filter((eintrag) => eintrag.feld && eintrag.aus);

                setze(
                  ersetze(verweise, stelle, { ...verweis, uebernehmen: paare.length > 0 ? paare : undefined })
                );
              }}
            />
          </Field>

          <Field label="Wenn nichts gefunden wird">
            <select
              value={verweis.ohneTreffer ?? 'WARNUNG'}
              onChange={(event) =>
                setze(
                  ersetze(verweise, stelle, {
                    ...verweis,
                    ohneTreffer: event.target.value as Referenzverweis['ohneTreffer'],
                  })
                )
              }
            >
              <option value="WARNUNG">Warnen — der Datensatz läuft weiter</option>
              <option value="KONFLIKT">Als Prüffall vorlegen</option>
              <option value="IGNORIEREN">Nichts tun</option>
            </select>
          </Field>
        </section>
      ))}

      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={quellen.data?.length === 0}
          onClick={() => setze([...verweise, { quelleId: '', felder: [] }])}
        >
          Abgleich hinzufügen …
        </button>
      </div>
    </>
  );
}


/**
 * In welchem Format die Ergebnisdatei geschrieben wird (SPEC-03, Abschnitt 6).
 *
 * ““ Warum feste Feldbreiten
 *
 * Weil die Gegenseite es so liest. Wer an ein Hostsystem liefert, liefert keine
 * CSV — und ohne diese Möglichkeit endet das Ergebnis in einem Zwischenschritt,
 * den jemand von Hand baut.
 *
 * ““ Ohne Feldbeschreibung wird nicht geschrieben
 *
 * Und auch nicht auf CSV ausgewichen: Ein Empfänger, der eine Datei fester
 * Breite erwartet und eine CSV bekommt, liest sie als eine einzige, sehr breite
 * Spalte — das sieht nach kaputten Daten aus und nicht nach einer falschen
 * Einstellung.
 *
 * ““ Zu lange Werte werden nicht heimlich gekürzt
 *
 * Sie fehlen in der Datei und stehen im Protokoll. Aus „Meiersheimer-Krüger“
 * würde sonst „Meiersheimer-Kr“, und das sähe der Empfänger als vollständigen
 * Namen an.
 */
function Ergebnisformat({
  tenantId,
  config,
  onChange,
}: {
  /** Für die Dateiwahl: Sie sieht im Verzeichnis dieses Mandanten nach. */
  tenantId: string;
  config: KonsolidierungConfig;
  onChange(next: Partial<KonsolidierungConfig>): void;
}) {
  const felder = config.festbreiten?.felder ?? [];

  const setzeFelder = (naechste: Festbreitenfeld[]): void =>
    onChange({ festbreiten: { ...config.festbreiten, felder: naechste } });

  return (
    <>

      <h4>Eingangsprüfung</h4>

      <div className="field__row">
        <span className="field__note">Gegen ein JSON Schema, vor der Verarbeitung.</span>
        <Hint title="Warum vorher">
          „Kritische Fehler … müssen vor Beginn der Verarbeitung erkannt … werden.“ Eine Prüfung hinterher sagt,
          dass ein Ergebnis auf schlechten Daten beruht — da liegt es aber schon im Zielverzeichnis. Geprüft wird
          das <strong>Dokument</strong> und nicht die zerlegten Zeilen: Ein Schema beschreibt die Struktur der
          Datei, und die gibt es nach dem Zerlegen nicht mehr. Was Unikom am Schema nicht versteht — „$ref“,
          „allOf“ —, steht im Protokoll, statt als grünes Häkchen durchzugehen.
        </Hint>
      </div>

      <Dateifeld
        label="Schemadatei"
        explain="Die JSON-Schema-Datei. Leer heißt: keine Prüfung."
        titel="Schemadatei wählen"
        wert={config.schema?.datei ?? ''}
        lies={(pfad) =>
          api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
            name: 'Schemaprüfung',
            tenantId,
            directory: pfad,
            known: [],
            sourceType: 'LOCAL',
          })
        }
        onChange={(pfad) =>
          onChange({ schema: pfad ? { ...config.schema, datei: pfad } : undefined })
        }
      />

      {config.schema?.datei && (
        <Field label="Wenn eine Datei nicht passt">
          <select
            value={config.schema.bei ?? 'ABBRECHEN'}
            onChange={(event) =>
              onChange({
                schema: {
                  ...(config.schema as Schemapruefungsregel),
                  bei: event.target.value as Schemapruefungsregel['bei'],
                },
              })
            }
          >
            <option value="ABBRECHEN">Nicht verarbeiten</option>
            <option value="WARNEN">Trotzdem verarbeiten und warnen</option>
          </select>
        </Field>
      )}

      <h4>Format der Ergebnisdatei</h4>

      <Field label="Geschrieben wird als">
        <select
          value={config.format ?? 'CSV'}
          onChange={(event) => onChange({ format: event.target.value as ErgebnisformatTyp })}
        >
          <option value="CSV">CSV</option>
          <option value="FESTBREITEN">Feste Feldbreiten (TXT)</option>
        </select>
      </Field>

      {config.format === 'FESTBREITEN' && (
        <>
          <div className="field__row">
            <span className="field__note">Ohne Feldbeschreibung wird keine Datei geschrieben.</span>
            <Hint title="Warum nicht einfach CSV">
              Ein Empfänger, der eine Datei fester Breite erwartet und eine CSV bekommt, liest sie als eine
              einzige, sehr breite Spalte — das sieht nach kaputten Daten aus und nicht nach einer falschen
              Einstellung. Werte, die nicht ins Feld passen, werden <strong>nicht gekürzt</strong>: Sie fehlen
              in der Datei und stehen im Protokoll.
            </Hint>
          </div>

          <CheckField
            label="Kopfzeile voranstellen"
            checked={config.festbreiten?.kopfzeile === true}
            onChange={(ein) => onChange({ festbreiten: { felder, kopfzeile: ein || undefined } })}
          />

          {felder.map((feld, stelle) => (
            <section className="card card--nested" key={`breite-${stelle}`}>
              <div className="row row--between">
                <strong>
                  Stelle {feld.start}–{feld.start + feld.laenge - 1}
                </strong>
                <button type="button" className="secondary" onClick={() => setzeFelder(ohne(felder, stelle))}>
                  Entfernen
                </button>
              </div>

              <Field label="Feld" explain="So, wie es im Ergebnis heißt.">
                <input
                  value={feld.name}
                  onChange={(event) =>
                    setzeFelder(ersetze(felder, stelle, { ...feld, name: event.target.value }))
                  }
                />
              </Field>

              <div className="row">
                <Field label="Beginnt bei">
                  <input
                    type="number"
                    min={1}
                    value={feld.start}
                    onChange={(event) =>
                      setzeFelder(ersetze(felder, stelle, { ...feld, start: Number(event.target.value) || 1 }))
                    }
                  />
                </Field>

                <Field label="Länge">
                  <input
                    type="number"
                    min={1}
                    value={feld.laenge}
                    onChange={(event) =>
                      setzeFelder(ersetze(felder, stelle, { ...feld, laenge: Number(event.target.value) || 1 }))
                    }
                  />
                </Field>
              </div>

              <div className="row">
                <Field label="Steht" explain="Rechtsbündig sind Zahlen, linksbündig ist Text.">
                  <select
                    value={feld.ausrichtung ?? 'LINKS'}
                    onChange={(event) =>
                      setzeFelder(
                        ersetze(felder, stelle, {
                          ...feld,
                          ausrichtung: event.target.value as Festbreitenfeld['ausrichtung'],
                        })
                      )
                    }
                  >
                    <option value="LINKS">links</option>
                    <option value="RECHTS">rechts</option>
                  </select>
                </Field>

                <Field label="Aufgefüllt mit" explain="Ein Zeichen. Leer heißt Leerzeichen.">
                  <input
                    value={feld.fuellzeichen ?? ''}
                    maxLength={1}
                    placeholder=" "
                    onChange={(event) =>
                      setzeFelder(
                        ersetze(felder, stelle, { ...feld, fuellzeichen: event.target.value || undefined })
                      )
                    }
                  />
                </Field>
              </div>

              <CheckField
                label="Zu lange Werte kürzen"
                explain="Ohne Häkchen bleibt das Feld leer und der Wert steht im Protokoll — ein gekürzter Wert sähe für den Empfänger wie ein vollständiger aus."
                checked={feld.kuerzen === true}
                onChange={(ein) => setzeFelder(ersetze(felder, stelle, { ...feld, kuerzen: ein || undefined }))}
              />
            </section>
          ))}

          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setzeFelder([
                  ...felder,
                  {
                    name: '',
                    start: felder.reduce((weit, feld) => Math.max(weit, feld.start + feld.laenge), 1),
                    laenge: 10,
                  },
                ])
              }
            >
              Feld hinzufügen …
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Weitere Durchgänge der Konsolidierung (SPEC-06, Abschnitt 7).
 *
 * ```text
 * Durchgang 1  Filialen sammeln    /eingang  →  /arbeit
 * Durchgang 2  anreichern          /arbeit   →  /ergebnis
 * ```
 *
 * ““ Die Reihenfolge ist die Liste
 *
 * Sie wird nicht hergeleitet. „Eine automatisch ermittelte Reihenfolge darf keine
 * fachliche Entscheidung ersetzen“ — wer zwei Durchgänge hat, deren Reihenfolge
 * das Ergebnis verändert, legt sie selbst fest und sieht dann auch, dass er es
 * getan hat.
 *
 * ““ Warum jeder Durchgang sein eigenes Verzeichnis nennt
 *
 * Damit der zweite nicht raten muss, ob der erste schon irgendwohin geschrieben
 * hat. „Übernimmt vom Durchgang davor“ ist die kurze Form davon — und wenn der
 * Durchgang davor nichts ablegt, sagt das Protokoll es vor dem Lauf.
 */
function WeitereDurchgaenge({
  tenantId,
  config,
  onChange,
}: {
  /** Für die Verzeichniswahl: Sie sieht im Verzeichnis dieses Mandanten nach. */
  tenantId: string;
  config: KonsolidierungConfig;
  onChange(next: Konsolidierungsdurchgang[] | undefined): void;
}) {
  const weitere = config.weitere ?? [];

  /*
   * Örtlich durchsehen — ein Durchgang liest auf dem Rechner, auf dem Unikom
   * läuft. Derselbe Aufruf wie beim Quellverzeichnis einer lokalen Quelle: Der
   * **Server** antwortet, und damit sieht das Fenster, was der Lauf später
   * findet, und nicht das, was der Browser für wahrscheinlich hält.
   */
  const durchsehen = (pfad: string): Promise<RemoteDirectoryResult> =>
    api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
      name: 'Konsolidierung',
      tenantId,
      directory: pfad,
      known: [],
      sourceType: 'LOCAL',
    });

  const setze = (naechste: Konsolidierungsdurchgang[]): void => onChange(naechste.length > 0 ? naechste : undefined);

  return (
    <>
      <h4>Weitere Durchgänge</h4>

      <div className="field__row">
        <span className="field__note">Laufen nacheinander, in dieser Reihenfolge.</span>
        <Hint title="Wozu">
          Erst die Filialdateien zusammenlegen, dann das Ergebnis gegen die Kundenliste anreichern. Die
          Reihenfolge steht so, wie sie hier steht — Unikom ordnet sie nicht um, denn das wäre eine fachliche
          Entscheidung. Was daran mehrdeutig ist, meldet der Lauf vorher: zwei Durchgänge auf dasselbe Ziel,
          oder einer, der aus einem Verzeichnis liest, in das ein späterer erst schreibt.
        </Hint>
      </div>

      {weitere.map((durchgang, stelle) => (
        <section className="card card--nested" key={`durchgang-${stelle}`}>
          <div className="row row--between">
            <strong>Durchgang {stelle + 2}</strong>
            <button type="button" className="secondary" onClick={() => setze(ohne(weitere, stelle))}>
              Entfernen
            </button>
          </div>

          <Field label="Name" explain="Steht so in jeder Meldung und in jedem Protokolleintrag.">
            <input
              value={durchgang.name ?? ''}
              placeholder="anreichern"
              onChange={(event) =>
                setze(ersetze(weitere, stelle, { ...durchgang, name: event.target.value || undefined }))
              }
            />
          </Field>

          <Field label="Liest">
            <select
              value={durchgang.input.from}
              onChange={(event) =>
                setze(
                  ersetze(weitere, stelle, {
                    ...durchgang,
                    input:
                      event.target.value === 'PRECEDING'
                        ? { from: 'PRECEDING' }
                        : { from: 'DIRECTORY', directory: '' },
                  })
                )
              }
            >
              <option value="PRECEDING">Übernimmt vom Durchgang davor</option>
              <option value="DIRECTORY">Aus einem Verzeichnis</option>
            </select>
          </Field>

          {durchgang.input.from === 'DIRECTORY' && (
            <Verzeichnisfeld
              label="Verzeichnis"
              titel={`Verzeichnis für Durchgang ${stelle + 2} wählen`}
              wert={durchgang.input.directory}
              lies={durchsehen}
              onChange={(pfad) =>
                setze(
                  ersetze(weitere, stelle, { ...durchgang, input: { from: 'DIRECTORY', directory: pfad } })
                )
              }
            />
          )}

          <Verzeichnisfeld
            label="Schreibt nach"
            explain="Leer heißt: Dieser Durchgang legt nichts ab — dann kann der nächste nichts übernehmen."
            titel={`Ziel von Durchgang ${stelle + 2} wählen`}
            wert={durchgang.output?.to === 'DIRECTORY' ? durchgang.output.directory : ''}
            lies={durchsehen}
            onChange={(pfad) =>
              setze(
                ersetze(weitere, stelle, {
                  ...durchgang,
                  output: pfad ? { to: 'DIRECTORY', directory: pfad } : undefined,
                })
              )
            }
          />
        </section>
      ))}

      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => setze([...weitere, { input: { from: 'PRECEDING' } }])}
        >
          Durchgang hinzufügen …
        </button>
      </div>
    </>
  );
}

/**
 * Welchem internen Feld eine Spalte entspricht (SPEC-09, Abschnitt 11).
 *
 * ““ Die andere Frage
 *
 * Die Vorschau weiter unten zeigt, was mit den **Werten** geschieht. Diese hier
 * zeigt, welchem Feld eine **Spalte** überhaupt entspricht — ob „Kd-Nr.“,
 * „KdNr“ und „Kundennummer“ alle dasselbe meinen. Beide Antworten braucht, wer
 * einen Workflow einrichtet.
 *
 * ““ Warum es diesen Bildschirm geben muss
 *
 * Die Erkennung gibt es seit Anfang an. Gesehen hat sie nie jemand: Ohne
 * Bildschirm kann niemand eine falsche Vermutung berichtigen und keine
 * unsichere bestätigen — und ohne Bestätigung entsteht keine dauerhafte Regel,
 * die beim nächsten Mal von selbst greift. Eine Erkennung, die niemand
 * korrigieren kann, lernt nichts.
 *
 * ““ Zwei Schritte bis zur Regel
 *
 * Auswählen und dann merken. Eine Auswahl, die sofort eine Regel schriebe, wäre
 * bequemer und ginge beim Verrutschen still in den Bestand — wo sie ab da jede
 * Erkennung schlägt.
 */
function Zuordnung({ tenantId, config }: { tenantId: string; config: KonsolidierungConfig }) {
  const [stand, setStand] = useState<{ busy: boolean; daten?: Zuordnungsvorschau; fehler?: string }>({
    busy: false,
  });
  const [wahl, setWahl] = useState<Record<string, string>>({});

  const verzeichnis = config.input.from === 'DIRECTORY' ? config.input.directory : '';

  async function hole(): Promise<void> {
    setStand({ busy: true });

    try {
      const daten = await api.post<Zuordnungsvorschau>('/api/consolidation/mapping-preview', {
        tenantId,
        directory: verzeichnis,
      });

      setWahl({});
      setStand({ busy: false, daten });
    } catch (fehler) {
      setStand({ busy: false, fehler: messageOf(fehler, 'Die Zuordnung ließ sich nicht holen') });
    }
  }

  async function merke(spalte: string, intern: string): Promise<void> {
    setStand((vorher) => ({ ...vorher, busy: true }));

    try {
      await api.post('/api/mappings', {
        art: 'FELD',
        ebene: 'MANDANT',
        tenantId,
        von: spalte,
        nach: intern,
      });

      await hole();
    } catch (fehler) {
      setStand((vorher) => ({
        ...vorher,
        busy: false,
        fehler: messageOf(fehler, 'Die Zuordnung ließ sich nicht merken'),
      }));
    }
  }

  if (config.input.from !== 'DIRECTORY') {
    return <span className="field__note">Spaltenzuordnung nur bei einem eigenen Verzeichnis.</span>;
  }

  return (
    <>
      <div className="field__row">
        <button
          type="button"
          className="secondary"
          disabled={stand.busy || !verzeichnis.trim()}
          onClick={() => void hole()}
        >
          {stand.busy ? 'Wird geholt …' : 'Spalten zuordnen'}
        </button>
        <Hint title="Was das ist">
          Unikom erkennt, welchem internen Feld eine Spalte entspricht — „Kd-Nr.“, „KdNr“ und
          „Kundennummer“ meinen dasselbe. Sicheres wird übernommen, Unsicheres nur vorgeschlagen, und
          Mehrdeutiges bleibt liegen: Ein falsches Feldmapping leitet eine ganze Spalte still ins falsche
          Zielfeld. Was Sie hier merken, gilt ab dann für diesen Mandanten — derselbe Lieferant wird beim
          nächsten Mal nicht wieder gefragt.
        </Hint>
      </div>

      {stand.fehler && <Notice kind="warn">{stand.fehler}</Notice>}

      {stand.daten && (
        <Zuordnungstabelle
          daten={stand.daten}
          wahl={wahl}
          busy={stand.busy}
          onWahl={(spalte, intern) => setWahl({ ...wahl, [spalte]: intern })}
          onMerken={(spalte, intern) => void merke(spalte, intern)}
        />
      )}
    </>
  );
}

function Zuordnungstabelle({
  daten,
  wahl,
  busy,
  onWahl,
  onMerken,
}: {
  daten: Zuordnungsvorschau;
  wahl: Record<string, string>;
  busy: boolean;
  onWahl(spalte: string, intern: string): void;
  onMerken(spalte: string, intern: string): void;
}) {
  return (
    <section className="card card--nested">
      <div className="row row--between">
        <strong>{daten.datei}</strong>
        <span className="muted">
          {daten.spalten.length} Spalten, {daten.datensaetze} Zeilen
        </span>
      </div>

      <p className="muted">
        {daten.uebernommen} sicher · {daten.vorgeschlagen} zur Bestätigung · {daten.offen} offen
      </p>

      {daten.hinweise.map((hinweis) => (
        <p className="muted" key={hinweis}>
          {hinweis}
        </p>
      ))}

      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Spalte</th>
              <th>Werte</th>
              <th>Internes Feld</th>
              <th>Stand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {daten.spalten.map((spalte) => (
              <Zuordnungszeile
                key={spalte.spalte}
                spalte={spalte}
                felder={daten.felder}
                gewaehlt={wahl[spalte.spalte] ?? spalte.intern ?? ''}
                busy={busy}
                onWahl={(intern) => onWahl(spalte.spalte, intern)}
                onMerken={(intern) => onMerken(spalte.spalte, intern)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Zuordnungszeile({
  spalte,
  felder,
  gewaehlt,
  busy,
  onWahl,
  onMerken,
}: {
  spalte: Spaltenvorschau;
  felder: Zuordnungsvorschau['felder'];
  gewaehlt: string;
  busy: boolean;
  onWahl(intern: string): void;
  onMerken(intern: string): void;
}) {
  /*
   * Gemerkt werden kann, was ausgewählt ist und noch keine Regel ist — also
   * eine Berichtigung oder die Bestätigung einer Vermutung. Steht die Regel
   * schon und niemand hat etwas verändert, gibt es nichts zu tun.
   */
  const offen = gewaehlt !== '' && !(spalte.istRegel && gewaehlt === spalte.intern);

  return (
    <tr>
      <td>
        <div>{spalte.spalte}</div>
        <div className="muted">{spalte.typ}</div>
      </td>
      <td className="muted">
        {spalte.beispiele.join(' · ') || '(leer)'}
        {spalte.leer > 0 && <div>{spalte.leer} leer</div>}
      </td>
      <td>
        <select value={gewaehlt} disabled={busy} onChange={(event) => onWahl(event.target.value)}>
          <option value="">— keins —</option>
          {felder.map((feld) => (
            <option key={feld.intern} value={feld.intern}>
              {feld.label}
            </option>
          ))}
        </select>
        <details>
          <summary className="muted">Warum</summary>
          <ul>
            {spalte.gruende.map((grund) => (
              <li key={grund}>{grund}</li>
            ))}
          </ul>
        </details>
      </td>
      <td>
        <Zuordnungsstand spalte={spalte} />
      </td>
      <td>
        <button type="button" className="secondary" disabled={busy || !offen} onClick={() => onMerken(gewaehlt)}>
          Merken
        </button>
      </td>
    </tr>
  );
}

/**
 * Was mit dieser Spalte im Lauf geschieht — in einem Wort.
 *
 * „Regel“ und „sicher“ sind nicht dasselbe: Sicher heißt, die Erkennung ist
 * sich einig und wendet es **für diesen Lauf** an; Regel heißt, ein Mensch hat
 * es entschieden und es gilt dauerhaft.
 */
function Zuordnungsstand({ spalte }: { spalte: Spaltenvorschau }) {
  if (spalte.istRegel) {
    return <span className="badge badge--good">Regel</span>;
  }

  if (spalte.sicherheit === 'EINDEUTIG') {
    return <span className="badge badge--good">sicher</span>;
  }

  if (spalte.sicherheit === 'VORSCHLAG') {
    return <span className="badge badge--warn">Vorschlag</span>;
  }

  return <span className="badge badge--muted">offen</span>;
}

/**
 * Was vor dem Konsolidieren mit den Feldern geschieht (SPEC-09, Abschnitt 8 und 9).
 *
 * ```text
 * 1. Felder putzen      trimmen, Schreibweise, Datum, Zahl
 * 2. Aufteilen          ein Feld wird mehrere
 * 3. Zusammenführen     mehrere Felder werden eines
 * ```
 *
 * **Vorher und nicht nachher:** Ein Schlüssel über „ Meier" und „Meier" findet
 * zwei Kunden, wo einer ist — und die Zusammenführung, die das hätte heilen
 * sollen, findet dann gar nicht erst statt.
 *
 * Die Reihenfolge steht fest und ist nicht einstellbar. Sie hat nur eine
 * sinnvolle Antwort, und eine Auswahl verlangte von jedem eine Entscheidung
 * darüber.
 */
function Umformungen({
  tenantId,
  config,
  onChange,
}: {
  /** Für die Vorschau: Sie liest im Verzeichnis dieses Mandanten. */
  tenantId: string;
  config: KonsolidierungConfig;
  onChange(next: Umformungsplan | undefined): void;
}) {
  const plan = config.umformung;
  const felder = plan?.felder ?? [];
  const aufteilungen = plan?.aufteilungen ?? [];
  const zusammenfuehrungen = plan?.zusammenfuehrungen ?? [];

  const setze = (next: Partial<Umformungsplan>): void => {
    const zusammen: Umformungsplan = { felder, aufteilungen, zusammenfuehrungen, ...next };
    const leer =
      (zusammen.felder?.length ?? 0) === 0 &&
      (zusammen.aufteilungen?.length ?? 0) === 0 &&
      (zusammen.zusammenfuehrungen?.length ?? 0) === 0;

    onChange(leer ? undefined : zusammen);
  };

  return (
    <>
      <h4>Felder vorbereiten</h4>

      <div className="field__row">
        <span className="field__note">Läuft vor dem Konsolidieren.</span>
        <Hint title="Warum vorher">
          Ein Schlüssel über „ Meier" und „Meier" findet zwei Kunden, wo einer ist. Was hier eingestellt wird,
          wirkt deshalb, bevor gruppiert und zusammengeführt wird — sonst fände die Zusammenführung gar nicht
          erst statt. Die Reihenfolge steht fest: putzen, aufteilen, zusammenführen.
        </Hint>
      </div>

      {felder.map((eintrag, stelle) => (
        <Feldputz
          key={`putz-${stelle}`}
          eintrag={eintrag}
          onChange={(next) =>
            setze({ felder: next ? ersetze(felder, stelle, next) : ohne(felder, stelle) })
          }
        />
      ))}

      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => setze({ felder: [...felder, { feld: '', schritte: [{ art: 'TRIMMEN' }] }] })}
        >
          Feld putzen …
        </button>
      </div>

      {aufteilungen.map((eintrag, stelle) => (
        <Feldaufteilung
          key={`teil-${stelle}`}
          eintrag={eintrag}
          onChange={(next) =>
            setze({ aufteilungen: next ? ersetze(aufteilungen, stelle, next) : ohne(aufteilungen, stelle) })
          }
        />
      ))}

      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setze({
              aufteilungen: [
                ...aufteilungen,
                { quelle: '', ziele: [], trennung: { art: 'ZEICHEN', zeichen: ' ' }, ueberschuss: 'PRUEFFALL' },
              ],
            })
          }
        >
          Feld aufteilen …
        </button>
      </div>

      {zusammenfuehrungen.map((eintrag, stelle) => (
        <Feldzusammenfuehrung
          key={`fuehr-${stelle}`}
          eintrag={eintrag}
          onChange={(next) =>
            setze({
              zusammenfuehrungen: next
                ? ersetze(zusammenfuehrungen, stelle, next)
                : ohne(zusammenfuehrungen, stelle),
            })
          }
        />
      ))}

      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => setze({ zusammenfuehrungen: [...zusammenfuehrungen, { ziel: '', quellen: [], trenner: ' ' }] })}
        >
          Felder zusammenführen …
        </button>
      </div>

      <Vorschau tenantId={tenantId} config={config} />
    </>
  );
}

/**
 * Was die eingestellten Regeln mit einer echten Datei tun (SPEC-09, Abschnitt 11).
 *
 * ## Warum sie hier steht und nicht auf einem eigenen Bildschirm
 *
 * Sie ist die Antwort auf die Frage, die man beim Einstellen hat — nicht auf
 * eine, die man später stellt. Wer die Regeln eingibt und erst auf einem
 * anderen Bildschirm nachsehen kann, was sie bewirken, sieht nicht nach.
 *
 * ## Was sie zeigen muss
 *
 * SPEC-09, Abschnitt 11, nennt **„mögliche Datenverluste"** ausdrücklich. Sie
 * sind der eigentliche Grund für die Vorschau: Eine Aufteilung, die bei
 * neunzehn von zwanzig Zeilen aufgeht, sieht ohne diese Liste vollkommen in
 * Ordnung aus. Deshalb rechnet der Server über die **ganze** Datei und zeigt
 * nur den Anfang — der Prüffall steckt selten in Zeile drei.
 */
function Vorschau({ tenantId, config }: { tenantId: string; config: KonsolidierungConfig }) {
  const [stand, setStand] = useState<{ busy: boolean; daten?: Umformungsvorschau; fehler?: string }>({
    busy: false,
  });

  const verzeichnis = config.input.from === 'DIRECTORY' ? config.input.directory : '';

  async function hole(): Promise<void> {
    setStand({ busy: true });

    try {
      setStand({
        busy: false,
        daten: await api.post<Umformungsvorschau>('/api/consolidation/transform-preview', {
          tenantId,
          directory: verzeichnis,
          umformung: config.umformung,
        }),
      });
    } catch (fehler) {
      setStand({ busy: false, fehler: messageOf(fehler, 'Die Vorschau ließ sich nicht holen') });
    }
  }

  if (config.input.from !== 'DIRECTORY') {
    return (
      <div className="field__row">
        <span className="field__note">Vorschau nur bei einem eigenen Verzeichnis.</span>
        <Hint title="Warum">
          Dieser Schritt übernimmt, was der Schritt davor ablegt — und das entsteht erst, wenn der Workflow läuft.
          Zum Ausprobieren lässt sich vorübergehend ein Verzeichnis eintragen.
        </Hint>
      </div>
    );
  }

  return (
    <>
      <div className="row">
        <button type="button" className="secondary" disabled={stand.busy || !verzeichnis.trim()} onClick={() => void hole()}>
          {stand.busy ? 'Wird geholt …' : 'An einer echten Datei ausprobieren'}
        </button>
      </div>

      {stand.fehler && <Notice kind="warn">{stand.fehler}</Notice>}

      {stand.daten && <Vorschautabelle daten={stand.daten} />}
    </>
  );
}

function Vorschautabelle({ daten }: { daten: Umformungsvorschau }) {
  const felder = daten.felder.filter((feld) => feld.veraendert || feld.neu);

  return (
    <section className="card card--nested">
      <div className="row row--between">
        <strong>{daten.datei}</strong>
        <span className="muted">
          {daten.gezeigt} von {daten.datensaetze} Zeilen
        </span>
      </div>

      {daten.pruefaelle.length > 0 && (
        <Notice kind="warn">
          {daten.pruefaelle.length} Zeile(n) gehen so nicht durch — der Lauf legt sie als Konflikt vor und
          übernimmt nichts davon. Gefunden über die ganze Datei, nicht nur über die gezeigten Zeilen.
        </Notice>
      )}

      {daten.hinweise.map((hinweis) => (
        <p className="muted" key={hinweis}>
          {hinweis}
        </p>
      ))}

      {felder.length === 0 ? (
        <p className="muted">Die eingestellten Regeln ändern an dieser Datei nichts.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Zeile</th>
                {felder.map((feld) => (
                  <th key={feld.feld}>
                    {feld.feld}
                    {feld.neu && <span className="badge badge--good">neu</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daten.zeilen.map((zeile) => (
                <tr key={zeile.zeile}>
                  <td className="muted">{zeile.zeile}</td>
                  {felder.map((feld) => (
                    <td key={feld.feld}>
                      {zeile.geaendert.includes(feld.feld) && zeile.vorher[feld.feld] !== undefined && (
                        <div className="muted">
                          <s>{zeile.vorher[feld.feld] || '(leer)'}</s>
                        </div>
                      )}
                      {zeile.nachher[feld.feld] || <span className="muted">(leer)</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {daten.pruefaelle.length > 0 && (
        <>
          <h5>Was so nicht durchgeht</h5>
          <ul>
            {daten.pruefaelle.slice(0, 10).map((fall) => (
              <li key={`${fall.zeile}-${fall.feld}`}>
                <strong>Zeile {fall.zeile}</strong>, {fall.feld}: „{fall.wert}" — {fall.hinweis}
              </li>
            ))}
          </ul>
          {daten.pruefaelle.length > 10 && (
            <p className="muted">… und {daten.pruefaelle.length - 10} weitere.</p>
          )}
        </>
      )}
    </section>
  );
}

function ersetze<T>(liste: readonly T[], stelle: number, wert: T): T[] {
  return liste.map((eintrag, index) => (index === stelle ? wert : eintrag));
}

function ohne<T>(liste: readonly T[], stelle: number): T[] {
  return liste.filter((_, index) => index !== stelle);
}

/** Die Schritte, die ohne weitere Angabe auskommen — die häufigen. */
const EINFACHE_SCHRITTE: { art: Umformungsschritt['art']; label: string }[] = [
  { art: 'TRIMMEN', label: 'Leerzeichen am Rand entfernen' },
  { art: 'GROSS', label: 'in Großbuchstaben' },
  { art: 'KLEIN', label: 'in Kleinbuchstaben' },
  { art: 'ANFANGSGROSS', label: 'Wortanfänge groß' },
];

function Feldputz({
  eintrag,
  onChange,
}: {
  eintrag: { feld: string; schritte: Umformungsschritt[] };
  onChange(next: { feld: string; schritte: Umformungsschritt[] } | undefined): void;
}) {
  const schritt = eintrag.schritte[0];
  const art = schritt?.art ?? 'TRIMMEN';
  /*
   * Eine leere Liste heißt „jedes Wort groß"; keine Liste heißt „die
   * Voreinstellung". Der Unterschied ist der ganze Zweck: „von der Heide" darf
   * nicht zu „Von Der Heide" werden, und eine Produktbezeichnung soll es.
   */
  const partikelKlein = !(schritt?.art === 'ANFANGSGROSS' && schritt.partikel?.length === 0);

  return (
    <div className="card card--nested">
      <Field label="Feld">
        <input
          value={eintrag.feld}
          placeholder="nachname"
          onChange={(event) => onChange({ ...eintrag, feld: event.target.value })}
        />
      </Field>

      <Field label="Was damit geschieht">
        <select
          value={art}
          onChange={(event) =>
            onChange({ ...eintrag, schritte: [{ art: event.target.value as 'TRIMMEN' }] })
          }
        >
          {EINFACHE_SCHRITTE.map((schritt) => (
            <option key={schritt.art} value={schritt.art}>
              {schritt.label}
            </option>
          ))}
        </select>
      </Field>

      {art === 'ANFANGSGROSS' && (
        <CheckField
          label="Namenspartikel klein lassen"
          explain="von, van, de, der, du, di, zu … — „BERT VON DER HEIDE“ wird damit „Bert von der Heide“ und nicht „Bert Von Der Heide“. Für Felder ohne Namen abschalten."
          checked={partikelKlein}
          onChange={(ein) =>
            onChange({ ...eintrag, schritte: [{ art: 'ANFANGSGROSS', ...(ein ? {} : { partikel: [] }) }] })
          }
        />
      )}

      <div className="row">
        <button type="button" className="secondary" onClick={() => onChange(undefined)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}

/**
 * Ein Feld auf mehrere aufteilen.
 *
 * Der Umgang mit dem Überschuss ist die wichtige Einstellung: „Bei
 * Transformationen dürfen keine Quellinformationen unbeabsichtigt verloren
 * gehen." Voreingestellt ist deshalb der Prüffall — abgeschnitten sähe das
 * Ergebnis untadelig aus und wäre falsch.
 */
function Feldaufteilung({
  eintrag,
  onChange,
}: {
  eintrag: Aufteilung;
  onChange(next: Aufteilung | undefined): void;
}) {
  return (
    <div className="card card--nested">
      <Field label="Feld aufteilen">
        <input
          value={eintrag.quelle}
          placeholder="name"
          onChange={(event) => onChange({ ...eintrag, quelle: event.target.value })}
        />
      </Field>

      <Field label="Trennzeichen" explain="Woran der Wert zerfällt — ein Komma, ein Leerzeichen, ein Schrägstrich.">
        <input
          value={eintrag.trennung.art === 'ZEICHEN' ? eintrag.trennung.zeichen : ''}
          placeholder=","
          onChange={(event) =>
            onChange({ ...eintrag, trennung: { art: 'ZEICHEN', zeichen: event.target.value } })
          }
        />
      </Field>

      <Field label="Zielfelder" explain="Durch Komma getrennt, in der Reihenfolge der Teile: nachname, vorname">
        <input
          value={eintrag.ziele.join(', ')}
          placeholder="nachname, vorname"
          onChange={(event) => onChange({ ...eintrag, ziele: liste(event.target.value) })}
        />
      </Field>

      <Field
        label="Wenn mehr Teile herauskommen als Zielfelder"
        explain="Abgeschnitten wird nie: Ein fehlender Namensteil sieht im Ergebnis aus wie ein Name."
      >
        <select
          value={eintrag.ueberschuss ?? 'PRUEFFALL'}
          onChange={(event) => onChange({ ...eintrag, ueberschuss: event.target.value as Ueberschuss })}
        >
          <option value="PRUEFFALL">Als Prüffall vorlegen — nichts übernehmen</option>
          <option value="AN_LETZTES">Den Rest ans letzte Zielfeld</option>
        </select>
      </Field>

      <div className="row">
        <button type="button" className="secondary" onClick={() => onChange(undefined)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}

function Feldzusammenfuehrung({
  eintrag,
  onChange,
}: {
  eintrag: Zusammenfuehrung;
  onChange(next: Zusammenfuehrung | undefined): void;
}) {
  return (
    <div className="card card--nested">
      <Field label="Felder zusammenführen" explain="Durch Komma getrennt, in dieser Reihenfolge: vorname, nachname">
        <input
          value={eintrag.quellen.join(', ')}
          placeholder="vorname, nachname"
          onChange={(event) => onChange({ ...eintrag, quellen: liste(event.target.value) })}
        />
      </Field>

      <Field label="Zielfeld">
        <input
          value={eintrag.ziel}
          placeholder="name"
          onChange={(event) => onChange({ ...eintrag, ziel: event.target.value })}
        />
      </Field>

      <Field
        label="Dazwischen"
        explain="Ein leeres Feld zieht keinen Trenner nach sich — aus einem fehlenden Vornamen wird nicht „ Meier“."
      >
        <input
          value={eintrag.trenner}
          placeholder="(Leerzeichen)"
          onChange={(event) => onChange({ ...eintrag, trenner: event.target.value })}
        />
      </Field>

      <div className="row">
        <button type="button" className="secondary" onClick={() => onChange(undefined)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}

/** Welcher Wert bei einem Mehrfachtreffer gewinnt; ohne Angabe der größte. */
function nimmt(regeln: Regeln): 'GROESSTER' | 'KLEINSTER' {
  return regeln.mehrfachtreffer?.regel === 'FELD' ? regeln.mehrfachtreffer.nimm : 'GROESSTER';
}

/** Eine Liste aus einem Feld mit Kommas — und zurück. */
function liste(eingabe: string): string[] {
  return eingabe
    .split(',')
    .map((teil) => teil.trim())
    .filter((teil) => teil !== '');
}

/**
 * Wer gewinnt, wenn zwei Quellen dasselbe Feld verschieden füllen.
 *
 * Ohne Reihenfolge entscheidet Unikom nur, wo sich alle einig sind oder wo nur
 * eine Quelle etwas zu sagen hat; alles andere wird ein Konfliktfall. Das ist
 * kein Mangel, sondern die Voreinstellung: Lieber eine Frage zu viel als eine
 * stille Entscheidung, die niemand nachvollziehen kann.
 */
function Prioritaeten({ regeln, onChange }: { regeln: Regeln; onChange(next: Partial<Regeln>): void }) {
  const entscheidung = regeln.entscheidung;
  const an = entscheidung !== undefined;

  const setze = (next: Partial<Entscheidungsregeln>): void =>
    onChange({ entscheidung: { ...entscheidung, ...next } });

  return (
    <>
      <h4>Wer bei widersprüchlichen Werten gewinnt</h4>

      <CheckField
        label="Eine Rangfolge festlegen"
        explain="Ohne sie entscheidet Unikom nur, wo sich alle Quellen einig sind — alles andere wird ein Konfliktfall."
        checked={an}
        onChange={(ein) => onChange({ entscheidung: ein ? {} : undefined })}
      />

      {an && (
        <>
          <Field
            label="Quellen, beste zuerst"
            explain="Dateinamen durch Komma getrennt. Was hier nicht steht, kommt danach — in der Reihenfolge, in der die Dateien gelesen wurden."
          >
            <input
              value={(entscheidung.quellen ?? []).join(', ')}
              placeholder="Stammdaten.csv, Filiale_Nord.csv"
              onChange={(event) => setze({ quellen: liste(event.target.value) })}
            />
          </Field>

          <CheckField
            label="Bei Gleichstand entscheidet das neuere Änderungsdatum"
            explain="Nur, wo die Rangfolge nichts hergibt. Steht eine Quelle ausdrücklich vorn, gewinnt sie auch mit dem älteren Datum — und der Lauf vermerkt, dass etwas dagegen sprach."
            checked={entscheidung.aktualitaet === true}
            onChange={(aktualitaet) => setze({ aktualitaet })}
          />

          <h5>Wann zwei Werte als derselbe gelten</h5>

          <CheckField
            label="Groß- und Kleinschreibung ist egal"
            checked={entscheidung.vergleich?.grossKleinEgal === true}
            onChange={(wert) => setze({ vergleich: { ...entscheidung.vergleich, grossKleinEgal: wert } })}
          />
          <CheckField
            label="Leerzeichen sind egal"
            checked={entscheidung.vergleich?.leerzeichenEgal === true}
            onChange={(wert) => setze({ vergleich: { ...entscheidung.vergleich, leerzeichenEgal: wert } })}
          />
          <CheckField
            label="Umlaute gelten wie ihre Umschreibung"
            explain="„Müller“ und „Mueller“ sind dann derselbe Wert."
            checked={entscheidung.vergleich?.umlauteEgal === true}
            onChange={(wert) => setze({ vergleich: { ...entscheidung.vergleich, umlauteEgal: wert } })}
          />
          <CheckField
            label="Satzzeichen sind egal"
            checked={entscheidung.vergleich?.satzzeichenEgal === true}
            onChange={(wert) => setze({ vergleich: { ...entscheidung.vergleich, satzzeichenEgal: wert } })}
          />
        </>
      )}
    </>
  );
}

/**
 * Fehlende Werte aus vergleichbaren Datensätzen ergänzen (SPEC-08, Abschnitt 5).
 *
 * Ergänzt wird nur, wo sich **alle** vergleichbaren Datensätze einig sind — und
 * ein ergänzter Wert wird nie zum Beleg für den nächsten. Sonst pflanzte sich
 * ein einzelner Tippfehler durch den ganzen Bestand fort.
 */
function Ergaenzung({ regeln, onChange }: { regeln: Regeln; onChange(next: Partial<Regeln>): void }) {
  const ergaenzung = regeln.ergaenzung;

  const setze = (next: Partial<ErgaenzungsregelTyp>): void =>
    onChange({ ergaenzung: { vergleichbarAn: [], felder: [], ...ergaenzung, ...next } });

  return (
    <>
      <h4>Fehlende Werte ergänzen</h4>

      <CheckField
        label="Aus vergleichbaren Datensätzen ergänzen"
        explain="Beispiel: Alle Sätze mit derselben Postleitzahl tragen denselben Ort — dann bekommt der Satz ohne Ort ihn dazu."
        checked={ergaenzung !== undefined}
        onChange={(ein) => onChange({ ergaenzung: ein ? { vergleichbarAn: [], felder: [] } : undefined })}
      />

      {ergaenzung && (
        <>
          <Field
            label="Vergleichbar an"
            explain="Die Felder, in denen zwei Sätze übereinstimmen müssen, damit sie als vergleichbar gelten."
          >
            <input
              value={ergaenzung.vergleichbarAn.join(', ')}
              placeholder="plz"
              onChange={(event) => setze({ vergleichbarAn: liste(event.target.value) })}
            />
          </Field>

          <Field label="Zu ergänzende Felder" explain="Nur diese werden gefüllt, und nur, wo sie leer sind.">
            <input
              value={ergaenzung.felder.join(', ')}
              placeholder="ort"
              onChange={(event) => setze({ felder: liste(event.target.value) })}
            />
          </Field>

          <Field
            label="Mindestens so viele Belege"
            explain="Unter zwei vergleichbaren Sätzen ist es kein Muster, sondern ein Zufall. Leer heißt: zwei."
          >
            <input
              value={ergaenzung.mindestens === undefined ? '' : String(ergaenzung.mindestens)}
              placeholder="2"
              onChange={(event) =>
                setze({ mindestens: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </Field>
        </>
      )}
    </>
  );
}

/**
 * Ähnliche, aber nicht gleiche Datensätze (SPEC-04, Abschnitt 7).
 *
 * Sie verändert das Ergebnis **nicht**: Beide Datensätze bleiben stehen, und
 * daneben entsteht eine Frage. Deshalb ist sie ausdrücklich einzuschalten —
 * wer sie nicht bestellt hat, bekommt keinen Berg von Verdachtsfällen.
 */
function Aehnlichkeit({ regeln, onChange }: { regeln: Regeln; onChange(next: Partial<Regeln>): void }) {
  const aehnlich = regeln.aehnlichkeit;

  const setze = (next: Partial<AehnlichkeitsregelnTyp>): void =>
    onChange({ aehnlichkeit: { felder: [], ...aehnlich, ...next } });

  return (
    <>
      <h4>Nach ähnlichen Datensätzen suchen</h4>

      <CheckField
        label="Verdächtig ähnliche Sätze melden"
        explain="Sie verändert nichts: Beide Sätze bleiben stehen, und daneben entsteht eine Frage — „Meier GmbH“ und „Meyer GmbH“ etwa."
        checked={aehnlich !== undefined}
        onChange={(ein) => onChange({ aehnlichkeit: ein ? { felder: [] } : undefined })}
      />

      {aehnlich && (
        <>
          <Field
            label="Verglichene Felder"
            explain="Das erste Feld trägt die Vorauswahl — dort sollte etwas Aussagekräftiges stehen, ein Name oder eine Firma."
          >
            <input
              value={aehnlich.felder.join(', ')}
              placeholder="firma, ort"
              onChange={(event) => setze({ felder: liste(event.target.value) })}
            />
          </Field>

          <Field
            label="Ab welcher Ähnlichkeit"
            explain="0 bis 1; leer heißt 0,85. Bei kurzen Werten wie einer Postleitzahl ist 0,85 zu hoch — dort lässt sie rechnerisch keine einzige Abweichung zu."
          >
            <input
              value={aehnlich.schwelle === undefined ? '' : String(aehnlich.schwelle)}
              placeholder="0.85"
              onChange={(event) =>
                setze({ schwelle: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </Field>

          <Field
            label="Höchstens so viele Datensätze vergleichen"
            explain="Jeder mit jedem: Bei 20 000 Sätzen sind das zweihundert Millionen Vergleiche. Wird abgebrochen, steht es im Bericht. Leer heißt 2000."
          >
            <input
              value={aehnlich.hoechstens === undefined ? '' : String(aehnlich.hoechstens)}
              placeholder="2000"
              onChange={(event) =>
                setze({ hoechstens: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </Field>
        </>
      )}
    </>
  );
}

function Lieferzweig({
  config,
  features,
  onChange,
}: {
  config?: DeliverConfig;
  features: Feature[];
  onChange(next: Partial<DeliverConfig>): void;
}) {
  const ziel = config?.ziel ?? 'DATEI';
  const kannImportieren = features.includes('DATA_IMPORT');
  const kannKonvertieren = features.includes('CONVERSION');

  return (
    <>
      <Field
        label="Wohin"
        explain="Entweder, oder. Wer beides braucht, baut zwei Workflows — sonst wäre unklar, was gilt, wenn eines davon misslingt."
      >
        <select
          value={ziel}
          onChange={(event) => {
            const gewaehlt = event.target.value as Lieferziel;

            onChange({
              ziel: gewaehlt,
              // Der Datenbankimport schreibt in Tabellen: kein Verzeichnis,
              // keine Konvertierung.
              ...(gewaehlt === 'DATENBANK'
                ? { output: undefined, konvertieren: undefined }
                : { output: config?.output ?? { to: 'DIRECTORY', directory: '' } }),
            });
          }}
        >
          {kannImportieren && <option value="DATENBANK">In eine Datenbank importieren</option>}
          <option value="DATEI">Als Datei exportieren</option>
        </select>
      </Field>

      {ziel === 'DATEI' && kannKonvertieren && (
        <>
          <CheckField
            label="Vorher in ein anderes Format konvertieren"
            explain="Ohne Häkchen geht das Ergebnis hinaus, wie es entstanden ist."
            checked={config?.konvertieren !== undefined}
            onChange={(on) => onChange({ konvertieren: on ? { format: 'CSV' } : undefined })}
          />

          {config?.konvertieren && (
            <Field label="Format">
              <select
                value={config.konvertieren.format}
                onChange={(event) => onChange({ konvertieren: { format: event.target.value as Lieferformat } })}
              >
                <option value="CSV">CSV</option>
                <option value="JSON">JSON</option>
                <option value="XML">XML</option>
              </select>
            </Field>
          )}
        </>
      )}
    </>
  );
}
