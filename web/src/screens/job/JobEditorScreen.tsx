import { useEffect, useState, type ReactNode } from 'react';

import { api } from '../../api/client.js';
import { messageOf, useResource } from '../../api/useResource.js';
import type {
  ConnectionTestResult,
  Credential,
  DirectoryCheckResult,
  Feature,
  Job,
  RemoteDirectoryResult,
  StageConfig,
  StageId,
  StageInput,
  StageOutput,
  Tenant,
} from '../../api/types.js';
import { CredentialForm, PublicKeyPanel } from '../../components/CredentialForm.js';
import { CheckField, DurationField, Field, Hint, Loading, Modal, Notice } from '../../components/Pieces.js';
import { useLanguage } from '../../i18n/useText.js';
import {
  DEFAULT_JOB_LOG_LEVEL,
  emptyJob,
  notationOf,
  parseList,
  withDestinationType,
  withSourceDirectory,
  withSourceType,
} from './emptyJob.js';

/** Welche Seite eines Workflows gerade gemeint ist — sie holt oder sie legt ab. */
type Side = 'SOURCE' | 'DESTINATION';

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
  STAGE_FEATURES,
  STAGE_FIELDS,
  STAGE_LABELS,
  transfers,
  type ConfigurableStage,
} from './stages.js';

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
  { id: 'IMPORT', stage: 'IMPORT' },
  { id: 'CONVERT', stage: 'CONVERT' },
  { id: 'schedule' },
];

const STEP_LABELS: Record<string, string> = { basics: 'Grunddaten', schedule: 'Zeitplan', ...STAGE_LABELS };

/**
 * Ob das Archiv im Quellverzeichnis liegt.
 *
 * Zusammen mit einbezogenen Unterverzeichnissen ist das die Falle, die sich
 * nicht von selbst zeigt: Der Lauf findet seine eigenen archivierten Dateien
 * wieder, und weil sie an einem anderen Pfad liegen, sind sie für die
 * Dublettenerkennung neue Dateien.
 *
 * Absichtlich großzügig verglichen — Groß- und Kleinschreibung egal, beide
 * Trennzeichen erlaubt. Ein Fehlalarm kostet hier eine Zeile Text, ein
 * übersehener Fall einen Lauf, der jede Nacht dieselben Dateien noch einmal
 * liefert.
 */
function archiveInsideSource(job: Job): boolean {
  const tidy = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const source = tidy(job.sourceDirectory);
  const archive = tidy(job.sourceArchiveDirectory ?? '');

  return source !== '' && archive !== '' && (archive === source || archive.startsWith(`${source}/`));
}

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
  const [browsing, setBrowsing] = useState<{
    busy: boolean;
    open: boolean;
    side: Side;
    at?: RemoteDirectoryResult;
  }>({
    busy: false,
    open: false,
    side: 'SOURCE',
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

  useEffect(() => {
    if (jobId === 'new') {
      if (tenants.data && !job) {
        // Bei genau einem Mandanten gibt es nichts zu entscheiden. Bei mehreren
        // ist es eine echte Entscheidung, und eine Voreinstellung wäre eine, die
        // jemand anders getroffen hat — der Job liefe dann für den falschen
        // Kunden, ohne dass ein Feld je angefasst wurde.
        setJob(emptyJob(tenants.data.length === 1 ? tenants.data[0].id : '', language));
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
  const remote = job.sourceType !== 'LOCAL';
  const remoteTarget = (job.destinationType ?? 'LOCAL') !== 'LOCAL';
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
    if (side === 'DESTINATION') {
      return api.post<RemoteDirectoryResult>('/api/jobs/browse-destination', {
        name: job!.name || 'Neuer Job',
        tenantId: job!.tenantId,
        destinationType: job!.destinationType,
        destinationConfig: job!.destinationConfig,
        destinationCredentialId: job!.destinationCredentialId,
        directory,
      });
    }

    return api.post<RemoteDirectoryResult>('/api/jobs/browse-remote', {
      name: job!.name || 'Neuer Job',
      tenantId: job!.tenantId,
      sourceType: job!.sourceType,
      sourceConfig: job!.sourceConfig,
      credentialId: job!.credentialId,
      directory,
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
  async function openBrowser(at: string, side: Side): Promise<void> {
    setBrowsing({ busy: true, open: true, side });

    try {
      setBrowsing({ busy: false, open: true, side, at: await askRemote(at, side) });
    } catch (failure) {
      setBrowsing({
        busy: false,
        open: true,
        side,
        at: { ok: false, message: messageOf(failure, 'Die Verbindung ist fehlgeschlagen'), entries: [] },
      });
    }
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
  const steps = STEPS.filter((entry) => {
    const feature = entry.stage ? STAGE_FEATURES[entry.stage] : undefined;
    return feature === undefined || features.includes(feature);
  });

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
      {browsing.open && (
        <Modal
          title={
            browsing.side === 'DESTINATION'
              ? 'Zielverzeichnis auf dem Server wählen'
              : 'Quellverzeichnis auf dem Server wählen'
          }
          onClose={() => setBrowsing({ busy: false, open: false, side: browsing.side })}
        >
          {browsing.busy && !browsing.at ? (
            <Loading />
          ) : !browsing.at?.ok ? (
            <p className="verdict verdict--bad">✗ {browsing.at?.message}</p>
          ) : (
            <>
              <p className="browse__here">
                <span className="browse__label">Hier:</span> <code>{browsing.at.path}</code>
                {browsing.at.filesFound !== undefined && (
                  <span className="browse__count">
                    {browsing.at.filesFound === 1 ? '1 Datei' : `${browsing.at.filesFound} Dateien`}
                  </span>
                )}
              </p>

              <ul className="browse">
                {browsing.at.path !== browsing.at.parentPath && (
                  <li>
                    <button type="button" onClick={() => void openBrowser(browsing.at!.parentPath!, browsing.side)}>
                      <span className="browse__up">↑</span> eine Ebene höher
                    </button>
                  </li>
                )}
                {browsing.at.entries.map((entry) => (
                  <li key={entry.path}>
                    <button type="button" onClick={() => void openBrowser(entry.path, browsing.side)}>
                      {entry.name}
                    </button>
                  </li>
                ))}
                {browsing.at.entries.length === 0 && <li className="browse__empty">Keine Unterverzeichnisse</li>}
              </ul>

              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    // Der Pfad des Servers, in der Schreibweise des Feldes.
                    const chosen = browsing.at!.relativePath ?? '';

                    if (browsing.side === 'DESTINATION') {
                      change({ destinationDirectory: chosen });
                      // Die Zielprüfung daneben zeigt sonst noch das Urteil über
                      // den Pfad, der eben ersetzt wurde.
                      setTarget({ busy: false });
                    } else {
                      setJob(withSourceDirectory(job, chosen));
                      setRemoteCheck(browsing.at);
                    }

                    setBrowsing({ busy: false, open: false, side: browsing.side });
                  }}
                >
                  Dieses Verzeichnis übernehmen
                </button>
              </div>
            </>
          )}
        </Modal>
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
                onChange={(event) => change({ name: event.target.value })}
                autoFocus={Boolean(job.tenantId)}
              />
            </Field>

            <Field label="Workflow-Beschreibung">
              <input
                value={job.description ?? ''}
                onChange={(event) => change({ description: event.target.value || undefined })}
              />
            </Field>

            <Field
              label="Protokoll"
              explain={
                <>
                  <p>
                    Wie ausführlich dieser Workflow mitschreibt. Jeder Workflow entscheidet das für sich — einer,
                    der Ärger macht, kann ausführlich protokollieren, während die übrigen leise bleiben.
                  </p>
                  <ul className="samples">
                    <li>
                      <code>Alles</code>
                      <span>jeder Schritt der Anmeldung, jeder Pfad wie eingegeben und wie gelesen, jede Datei vor und nach jedem Schritt</span>
                    </li>
                    <li>
                      <code>Das Wesentliche</code>
                      <span>was geschehen ist: geholt, geprüft, verschlüsselt, abgelegt</span>
                    </li>
                    <li>
                      <code>Nur Warnungen</code>
                      <span>für einen Workflow, der jede Minute läuft</span>
                    </li>
                    <li>
                      <code>Nur Fehler</code>
                      <span>nur, was schiefging</span>
                    </li>
                  </ul>
                  <p>
                    „Alles" ist für den Ernstfall gedacht — für die Frage „warum hat er die Datei nicht geholt". Auf
                    Dauer wird das Protokoll damit groß; wie lange es aufgehoben wird, steht im Schritt „Zeitplan".
                  </p>
                </>
              }
            >
              <select
                value={job.logLevel ?? DEFAULT_JOB_LOG_LEVEL}
                onChange={(event) => change({ logLevel: event.target.value as Job['logLevel'] })}
              >
                <option value="DEBUG">Alles — jeder Schritt</option>
                <option value="INFO">Das Wesentliche</option>
                <option value="WARNING">Nur Warnungen und Fehler</option>
                <option value="ERROR">Nur Fehler</option>
              </select>
            </Field>

            <CheckField
              label="Protokoll jedes Laufs als Datei ablegen"
              explain={
                <>
                  <p>
                    Das Protokoll steht sonst nur im Arbeitsspeicher: Es lässt sich in der Laufansicht ansehen und von
                    Hand speichern, und ein Neustart nimmt es mit.
                  </p>
                  <p>
                    Für einen Workflow, der nachts läuft, genügt das nicht — was um drei Uhr schiefging, sieht jemand
                    um acht, und dazwischen kann der Rechner neu gestartet haben. Eingeschaltet legt jeder Lauf sein
                    Protokoll selbst ab, nach Jahr und Monat sortiert:
                  </p>
                  <ul className="samples">
                    <li>
                      <code>protokolle/2026/08/</code>
                      <span>im Datenverzeichnis der Installation</span>
                    </li>
                    <li>
                      <code>Kunde-A_2026-08-17_0345_TR-8f2c.log</code>
                      <span>Workflow, Zeitpunkt, Lauf</span>
                    </li>
                  </ul>
                  <p>
                    Abgelegte Protokolle werden nach 30 Tagen aufgeräumt. Voreingestellt ist das Ablegen aus — sonst
                    wüchse ein Verzeichnis, das niemand bestellt hat.
                  </p>
                </>
              }
              checked={job.saveProtocol ?? false}
              onChange={(saveProtocol) => change({ saveProtocol: saveProtocol || undefined })}
            />

            {job.saveProtocol && (
              <Field
                label="Protokollverzeichnis"
                explain="Leer lassen für das Datenverzeichnis der Installation. Ein eigener Pfad ist der Fall „unsere Protokolle gehören auf Laufwerk P:“ — das Konto, unter dem Unikom läuft, braucht dort Schreibrecht."
              >
                <input
                  value={job.protocolDirectory ?? ''}
                  placeholder="P:\Protokolle\Unikom"
                  onChange={(event) => change({ protocolDirectory: event.target.value || undefined })}
                />
              </Field>
            )}

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
            <section className="card">
              <h2>{STAGE_LABELS.TRANSFER}</h2>

              <div className="prose">
                <p>{STAGE_DESCRIPTIONS.TRANSFER}</p>
              </div>

              <CheckField
                label={`„${STAGE_LABELS.TRANSFER}" in diesem Workflow verwenden`}
                checked={transfers(job)}
                onChange={(on) => change({ transfer: { enabled: on } })}
              />
            </section>
          </>
        )}

        {step === 'TRANSFER' && transfers(job) && (
          <>
            <section className="card">
              <h2>Quelle</h2>

              <Field label="Art">
                <select
                  value={job.sourceType}
                  onChange={(event) => setJob(withSourceType(job, event.target.value as Job['sourceType']))}
                >
                  <option value="LOCAL">Lokales Verzeichnis oder Netzlaufwerk</option>
                  <option value="SFTP">SFTP</option>
                  <option value="FTPS">FTPS</option>
                </select>
              </Field>

              {remote && (
                <>
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

                  <Field label="Anmeldung am Quellserver" explain="Nur für SFTP und FTPS nötig.">
                    <div className="field__row">
                      <select
                        value={job.credentialId ?? ''}
                        onChange={(event) => change({ credentialId: event.target.value || undefined })}
                      >
                        <option value="">— keine —</option>
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
              {remote && (
                <div className="row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!job.tenantId || browsing.busy}
                    onClick={() => void openBrowser(job.sourceDirectory, 'SOURCE')}
                  >
                    {browsing.busy ? 'Öffnet …' : 'Verzeichnis wählen'}
                  </button>
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

              <CheckField
                label="Unterverzeichnisse einbeziehen"
                checked={job.includeSubdirectories}
                onChange={(includeSubdirectories) =>
                  change({
                    includeSubdirectories,
                    sourceConfig: { ...job.sourceConfig, recursive: includeSubdirectories },
                  })
                }
              />

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
            </section>

            <section className="card">
              <h2>Welche Dateien</h2>

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

              <CheckField
                label="Groß- und Kleinschreibung beachten"
                checked={job.caseSensitivePrefix}
                onChange={(caseSensitivePrefix) => change({ caseSensitivePrefix })}
              />

              <Field label="Berücksichtigte Endungen" explain="Durch Komma getrennt. Leer bedeutet: alle.">
                <input
                  value={job.allowedExtensions.join(', ')}
                  placeholder="csv, xml"
                  onChange={(event) => change({ allowedExtensions: parseList(event.target.value) })}
                />
              </Field>

              <Field
                label="Endungen unfertiger Uploads"
                explain="Dateien mit diesen Endungen werden nie übernommen — sie werden gerade erst geschrieben."
              >
                <input
                  value={job.ignoredTemporaryExtensions.join(', ')}
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
            </section>

            <section className="card">
              <h2>Ziel</h2>

              <Field label="Art">
                <select
                  value={job.destinationType ?? 'LOCAL'}
                  onChange={(event) =>
                    setJob(withDestinationType(job, event.target.value as Job['sourceType']))
                  }
                >
                  <option value="LOCAL">Lokales Verzeichnis oder Freigabe</option>
                  <option value="SFTP">SFTP</option>
                  <option value="FTPS">FTPS</option>
                </select>
              </Field>

              {remoteTarget && (
                <>
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

                  <Field
                    label="Anmeldung am Zielserver"
                    explain="Ein eigener Zugang, auch wenn Quelle und Ziel derselbe Server sind. Zwei Richtungen, zwei Berechtigungen."
                  >
                    <div className="field__row">
                      <select
                        value={job.destinationCredentialId ?? ''}
                        onChange={(event) =>
                          change({ destinationCredentialId: event.target.value || undefined })
                        }
                      >
                        <option value="">— keine —</option>
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

                {/*
                 * Nur beim entfernten Ziel. Ein lokaler Pfad wird vom Dateidialog
                 * des Betriebssystems gewählt, und den kann eine Seite im Browser
                 * nicht öffnen — ein eigener Nachbau wäre eine schlechtere
                 * Fassung von etwas, das jeder schon kennt.
                 */}
                {remoteTarget && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={browsing.busy || !job.destinationConfig?.host}
                    onClick={() => void openBrowser(job.destinationDirectory, 'DESTINATION')}
                  >
                    {browsing.busy ? 'Öffnet …' : 'Verzeichnis wählen'}
                  </button>
                )}
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
            </section>

            <section className="card">
              <h2>Nach erfolgreicher Übernahme</h2>

              <Field
                label="Mit der Quelldatei geschieht"
                explain="Erst wenn die Datei gespeichert und registriert ist, wird die Quelle angefasst."
              >
                <select
                  value={job.sourceSuccessAction}
                  onChange={(event) => change({ sourceSuccessAction: event.target.value as Job['sourceSuccessAction'] })}
                >
                  <option value="KEEP">Nichts — sie bleibt liegen</option>
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
                          <strong>Nicht unterhalb des Quellverzeichnisses</strong>, solange Unterverzeichnisse
                          einbezogen werden: Eine Datei wird daran wiedererkannt, wo sie lag, wie sie hieß, wie groß
                          sie war und wann sie zuletzt geschrieben wurde — und das Verschieben ändert das Erste davon.
                          Der nächste Lauf hielte die archivierte Datei also für eine neue. Daneben ist der sichere
                          Platz: <code>…/eingang</code> und <code>…/archiv</code> nebeneinander.
                        </p>
                      </>
                    }
                  >
                    <input
                      value={job.sourceArchiveDirectory ?? ''}
                      placeholder={remote ? '/exports/archiv' : 'D:\\Daten\\eingang\\archiv'}
                      onChange={(event) => change({ sourceArchiveDirectory: event.target.value || undefined })}
                    />
                  </Field>

                  {job.includeSubdirectories && archiveInsideSource(job) && (
                    <div className="notice notice--warn">
                      Das Archiv liegt im Quellverzeichnis, und Unterverzeichnisse werden einbezogen. Der nächste Lauf
                      findet die archivierten Dateien dort wieder und hält sie für neue: Er holt sie jedes Mal erneut —
                      und legt sie ein zweites Mal ab, sobald oben etwas anderes als „Überspringen" eingestellt ist.
                      Legen Sie das Archiv neben das Quellverzeichnis statt hinein.
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {steps.map((entry) =>
          entry.stage && isConfigurable(entry.stage) && step === entry.id ? (
            <StageModule
              key={entry.id}
              job={job}
              stage={entry.stage}
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

                <Field label="Zeitzone" hint="Sommer- und Winterzeit werden darüber richtig berechnet.">
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
  onChange,
}: {
  job: Job;
  stage: ConfigurableStage;
  onChange(patch: Partial<Job>): void;
}) {
  const field = STAGE_FIELDS[stage];
  const config = stageOf(job, stage);
  const preceding = precedingOf(job, stage);
  const following = followingOf(job, stage);
  // Der Import schreibt in Tabellen, nicht in ein Verzeichnis.
  const writesFiles = stage !== 'IMPORT';

  const patch = (next: Partial<StageConfig>): void =>
    onChange({ [field]: { ...config!, ...next } } as Partial<Job>);

  return (
    <section className="card">
      <h2>{STAGE_LABELS[stage]}</h2>

      <div className="prose">
        <p>{STAGE_DESCRIPTIONS[stage]}</p>
      </div>

      <>
        <CheckField
            label={`„${STAGE_LABELS[stage]}“ in diesem Workflow verwenden`}
            hint="Aus bedeutet: dieses Glied wird übersprungen, die Kette schließt sich darüber."
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

          {config?.enabled && (
            <>
              <StageSource
                value={config.input}
                preceding={preceding}
                onChange={(input) => patch({ input })}
              />

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

              <div className="field__row">
                <span className="field__note">Verarbeitung wird noch gebaut.</span>
                <Hint kind="warn" title="Noch nicht ausführbar">
                  Die Verkettung wird gespeichert, die Verarbeitung selbst wird noch gebaut. Ein Workflow mit
                  eingeschaltetem Glied „{STAGE_LABELS[stage]}“ startet deshalb noch nicht — er bricht mit einem
                  Hinweis ab, statt die übrigen Glieder allein auszuführen und unverarbeitete Daten weiterzugeben.
                </Hint>
              </div>
            </>
          )}
        </>
    </section>
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
        <Field label="Zielverzeichnis">
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
