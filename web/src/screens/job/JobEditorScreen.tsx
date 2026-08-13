import { useEffect, useState } from 'react';

import { api } from '../../api/client.js';
import { messageOf, useResource } from '../../api/useResource.js';
import type { ConnectionTestResult, Credential, DirectoryCheckResult, Job, Tenant } from '../../api/types.js';
import { CheckField, Field, Loading, Notice } from '../../components/Pieces.js';
import { emptyJob, parseList, withSourceDirectory, withSourceType } from './emptyJob.js';

interface Props {
  jobId: string | 'new';
  onDone(): void;
}

export function JobEditorScreen({ jobId, onDone }: Props) {
  const existing = useResource<Job>(jobId === 'new' ? undefined : `/api/jobs/${jobId}`);
  const tenants = useResource<Tenant[]>('/api/tenants');
  const credentials = useResource<Credential[]>('/api/credentials');

  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; result?: ConnectionTestResult; error?: string }>({ busy: false });
  const [target, setTarget] = useState<{ busy: boolean; result?: DirectoryCheckResult; error?: string }>({
    busy: false,
  });

  useEffect(() => {
    if (jobId === 'new') {
      if (tenants.data && !job) {
        setJob(emptyJob(tenants.data[0]?.id ?? 'default'));
      }
      return;
    }

    if (existing.data && !job) {
      setJob(existing.data);
    }
  }, [jobId, tenants.data, existing.data, job]);

  if (!job) {
    return existing.error ? <Notice kind="error">{existing.error}</Notice> : <Loading />;
  }

  const change = (patch: Partial<Job>): void => setJob({ ...job, ...patch });
  const remote = job.sourceType !== 'LOCAL';
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

  async function checkDestination(): Promise<void> {
    setTarget({ busy: true });

    try {
      const result = await api.post<DirectoryCheckResult>('/api/jobs/check-destination', {
        directory: job!.destinationDirectory,
        createDestinationDirectory: job!.createDestinationDirectory,
        tenantId: job!.tenantId,
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

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>Grunddaten</h2>

        <Field label="Name">
          <input value={job.name} onChange={(event) => change({ name: event.target.value })} autoFocus />
        </Field>

        <Field label="Beschreibung">
          <input
            value={job.description ?? ''}
            onChange={(event) => change({ description: event.target.value || undefined })}
          />
        </Field>

        <Field
          label="Mandant"
          hint={
            tenant?.rootDirectory
              ? `Das Zielverzeichnis muss innerhalb von ${tenant.rootDirectory} liegen.`
              : 'Für diesen Mandanten ist kein Root-Verzeichnis festgelegt.'
          }
        >
          <select value={job.tenantId} onChange={(event) => change({ tenantId: event.target.value })}>
            {tenants.data?.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>

        <CheckField
          label="Job ist aktiv"
          hint="Ein ruhender Job wird weder eingeplant noch von Hand gestartet."
          checked={job.enabled}
          onChange={(enabled) => change({ enabled })}
        />
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
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

            <Field label="Zugangsdaten">
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
            </Field>
          </>
        )}

        {job.sourceType === 'SFTP' && (
          <>
            <Field
              label="Fingerabdruck des Host-Keys"
              hint="So wie OpenSSH ihn ausgibt: SHA256:… — ohne ihn wird die Verbindung abgelehnt."
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
              hint="Nur für Testumgebungen. Damit ist nicht mehr feststellbar, ob wirklich der richtige Server antwortet."
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
              hint="Für ein privates oder selbst signiertes Zertifikat besser das Zertifikat hinterlegen, statt die Prüfung abzuschalten."
              checked={job.sourceConfig.validateCertificates ?? true}
              onChange={(validateCertificates) =>
                change({ sourceConfig: { ...job.sourceConfig, validateCertificates } })
              }
            />
            <CheckField
              label="Implizites FTPS"
              hint="Verschlüsselt ab dem ersten Byte, üblicherweise auf Port 990."
              checked={job.sourceConfig.implicitFtps ?? false}
              onChange={(implicitFtps) => change({ sourceConfig: { ...job.sourceConfig, implicitFtps } })}
            />
          </>
        )}

        <Field
          label="Quellverzeichnis"
          hint={
            job.sourceType === 'LOCAL'
              ? 'Lokaler Pfad oder Freigabe, etwa \\dateiserver\austausch\kunde-a. Bei einer Freigabe zählt das Konto, unter dem Unikom läuft — nicht Ihr eigenes.'
              : 'Pfad auf dem entfernten Server, etwa /export/bestellungen.'
          }
        >
          <input
            value={job.sourceDirectory}
            placeholder={job.sourceType === 'LOCAL' ? 'D:\Daten\eingang' : '/export/bestellungen'}
            onChange={(event) => setJob(withSourceDirectory(job, event.target.value))}
          />
        </Field>

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

        <div className="row">
          <button type="button" className="secondary" disabled={test.busy} onClick={() => void runTest()}>
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
            </Notice>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>Welche Dateien</h2>

        <Field label="Namenspräfix" hint="Leer lassen, wenn der Name keine Rolle spielt.">
          <input
            value={job.filenamePrefix ?? ''}
            placeholder="ORDER_"
            onChange={(event) => change({ filenamePrefix: event.target.value || undefined })}
          />
        </Field>

        <CheckField
          label="Groß- und Kleinschreibung des Präfix beachten"
          checked={job.caseSensitivePrefix}
          onChange={(caseSensitivePrefix) => change({ caseSensitivePrefix })}
        />

        <Field label="Erlaubte Endungen" hint="Durch Komma getrennt. Leer bedeutet: alle.">
          <input
            value={job.allowedExtensions.join(', ')}
            placeholder="csv, xml"
            onChange={(event) => change({ allowedExtensions: parseList(event.target.value) })}
          />
        </Field>

        <Field
          label="Endungen unfertiger Uploads"
          hint="Dateien mit diesen Endungen werden nie übernommen — sie werden gerade erst geschrieben."
        >
          <input
            value={job.ignoredTemporaryExtensions.join(', ')}
            onChange={(event) => change({ ignoredTemporaryExtensions: parseList(event.target.value) })}
          />
        </Field>

        <Field
          label="Mindestalter in Sekunden"
          hint="Eine Datei muss so lange unverändert dagelegen haben, bevor sie geholt wird."
        >
          <input
            type="number"
            min={0}
            value={job.minimumFileAgeSeconds}
            onChange={(event) => change({ minimumFileAgeSeconds: Number(event.target.value) || 0 })}
          />
        </Field>

        <CheckField
          label="Stabilität prüfen"
          hint="Misst Größe und Änderungszeit mehrfach, damit keine Datei mitten im Schreiben geholt wird."
          checked={job.stabilityCheck.enabled}
          onChange={(enabled) => change({ stabilityCheck: { ...job.stabilityCheck, enabled } })}
        />

        <CheckField
          label="Inhaltsgleiche Dateien als Dubletten behandeln"
          hint="Voreingestellt aus. Einschalten, wenn das Quellsystem Dateien nächtlich neu schreibt, ohne etwas zu ändern."
          checked={job.detectContentDuplicates ?? false}
          onChange={(detectContentDuplicates) => change({ detectContentDuplicates })}
        />
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>Ziel</h2>

        <Field
          label="Zielverzeichnis"
          hint="Lokaler Pfad oder Freigabe. Bei einer Freigabe braucht das Konto, unter dem Unikom läuft, dort Schreibrecht."
        >
          <input
            value={job.destinationDirectory}
            placeholder="D:\Daten\kunde-a\eingang"
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
            disabled={target.busy || !job.destinationDirectory}
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

        <Field label="Wenn die Datei dort schon liegt">
          <select
            value={job.conflictStrategy}
            onChange={(event) => change({ conflictStrategy: event.target.value as Job['conflictStrategy'] })}
          >
            <option value="SKIP">Überspringen</option>
            <option value="RENAME">Unter neuem Namen ablegen</option>
            <option value="OVERWRITE">Überschreiben</option>
          </select>
        </Field>

        <CheckField
          label="Verschlüsselt ablegen"
          hint="Die Datei wird vor der endgültigen Ablage verschlüsselt; im Ziel liegt nie Klartext."
          checked={job.encryptionConfig.enabled}
          onChange={(enabled) =>
            change({
              encryptionConfig: {
                ...job.encryptionConfig,
                enabled,
                provider: enabled ? 'AES_256_GCM' : 'NONE',
              },
            })
          }
        />

        {job.encryptionConfig.enabled && (
          <Field label="Schlüssel">
            <select
              value={job.encryptionConfig.keyCredentialId ?? ''}
              onChange={(event) =>
                change({
                  encryptionConfig: { ...job.encryptionConfig, keyCredentialId: event.target.value || undefined },
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
          </Field>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>Nach erfolgreicher Übernahme</h2>

        <Field
          label="Mit der Quelldatei geschieht"
          hint="Erst wenn die Datei gespeichert und registriert ist, wird die Quelle angefasst."
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
          <Field label="Archivverzeichnis">
            <input
              value={job.sourceArchiveDirectory ?? ''}
              onChange={(event) => change({ sourceArchiveDirectory: event.target.value || undefined })}
            />
          </Field>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
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

      <div className="row" style={{ marginBottom: '2rem' }}>
        <button disabled={saving || !job.name || !job.destinationDirectory} onClick={() => void save()}>
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button className="secondary" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </>
  );
}
