import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Job, Tenant } from '../api/types.js';
import { Empty, formatMoment, Loading, Notice } from '../components/Pieces.js';

const SOURCE_LABELS: Record<Job['sourceType'], string> = {
  LOCAL: 'Lokal',
  SHARE: 'Freigabe',
  SFTP: 'SFTP',
  FTPS: 'FTPS',
};

interface Props {
  canManage: boolean;
  canRun: boolean;
  onEdit(jobId: string | 'new'): void;
  onShowHistory(jobId: string): void;
}

/**
 * Die Werkbank: hier werden Workflows zusammengebaut, angehalten und wieder in
 * Betrieb genommen. Was gerade läuft, steht nicht hier, sondern unter Jobs —
 * Einrichten und Zusehen sind zwei verschiedene Tätigkeiten, und wer eine davon
 * tut, will die andere nicht dazwischen haben.
 */
export function WorkflowsScreen({ canManage, canRun, onEdit, onShowHistory }: Props) {
  const jobs = useResource<Job[]>('/api/jobs');
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [busyJob, setBusyJob] = useState<string>();
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [tenantFilter, setTenantFilter] = useState('');

  async function runNow(job: Job): Promise<void> {
    setBusyJob(job.id);
    setMessage(undefined);

    try {
      await api.post(`/api/jobs/${job.id}/run`);
      setMessage({ kind: 'info', text: `"${job.name}" wurde gestartet. Der Verlauf steht unter Jobs.` });
      await jobs.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Der Job konnte nicht gestartet werden') });
    } finally {
      setBusyJob(undefined);
    }
  }

  /** Ein ruhender Workflow bleibt bestehen, er wird nur nicht mehr eingeplant. */
  async function setEnabled(job: Job, enabled: boolean): Promise<void> {
    setBusyJob(job.id);
    setMessage(undefined);

    try {
      await api.put(`/api/jobs/${job.id}`, { enabled });
      await jobs.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Der Workflow konnte nicht umgestellt werden') });
    } finally {
      setBusyJob(undefined);
    }
  }

  async function remove(job: Job): Promise<void> {
    if (!confirm(`"${job.name}" wirklich löschen? Die Historie des Jobs bleibt erhalten.`)) {
      return;
    }

    try {
      await api.delete(`/api/jobs/${job.id}`);
      await jobs.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Der Job konnte nicht gelöscht werden') });
    }
  }

  if (jobs.loading && !jobs.data) {
    return <Loading />;
  }

  if (jobs.error) {
    return <Notice kind="error">{jobs.error}</Notice>;
  }

  const all = jobs.data ?? [];
  const shown = tenantFilter ? all.filter((job) => job.tenantId === tenantFilter) : all;
  const tenantName = (id: string): string => tenants.data?.find((tenant) => tenant.id === id)?.name ?? id;
  const severalTenants = (tenants.data?.length ?? 0) > 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
        {/* Der Filter erscheint erst, wenn er etwas zu tun hat. */}
        {severalTenants ? (
          <select
            style={{ width: 'auto' }}
            value={tenantFilter}
            onChange={(event) => setTenantFilter(event.target.value)}
          >
            <option value="">Alle Mandanten</option>
            {tenants.data?.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}

        {canManage && <button onClick={() => onEdit('new')}>Neuer Workflow</button>}
      </div>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {shown.length === 0 ? (
        <Empty>
          {all.length === 0 ? 'Es ist noch kein Workflow angelegt.' : 'Für diesen Mandanten gibt es keinen Workflow.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                {severalTenants && <th>Mandant</th>}
                <th>Quelle</th>
                <th>Status</th>
                <th>Nächste Ausführung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((job) => {
                const blocked = (job.missingFeatures?.length ?? 0) > 0;

                return (
                  <tr key={job.id}>
                    <td>
                      {/*
                        * Nur der Name. Die Beschreibung gehört dorthin, wo sie
                        * bearbeitet wird — in der Liste macht sie aus jeder
                        * Zeile zwei und aus zehn Workflows eine Rolle.
                        */}
                      <div style={{ fontWeight: 600 }}>{job.name}</div>
                    </td>
                    {severalTenants && <td>{tenantName(job.tenantId)}</td>}
                    <td>
                      {SOURCE_LABELS[job.sourceType]}
                      {job.encryptionConfig.enabled && (
                        <span className="badge badge--muted" style={{ marginLeft: '0.4rem' }}>
                          verschlüsselt
                        </span>
                      )}
                    </td>
                    <td>
                      {/* Ein Workflow, dessen Modul nicht mehr lizenziert ist,
                          wird gezeigt statt versteckt: sonst bliebe ein
                          nächtlicher Zeitplan stehen, ohne dass es jemand merkt. */}
                      {blocked ? (
                        <span className="badge badge--bad" title={job.missingFeatures?.join(', ')}>
                          Modul fehlt
                        </span>
                      ) : job.enabled ? (
                        <span className="badge badge--good">Aktiv</span>
                      ) : (
                        <span className="badge badge--muted">Ruht</span>
                      )}
                    </td>
                    <td>{job.enabled && !blocked ? formatMoment(job.nextExecutionAt) : '—'}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <RowActions
                          job={job}
                          blocked={blocked}
                          busy={busyJob === job.id}
                          canManage={canManage}
                          canRun={canRun}
                          onEdit={() => onEdit(job.id)}
                          onHistory={() => onShowHistory(job.id)}
                          onRun={() => void runNow(job)}
                          onToggle={() => void setEnabled(job, !job.enabled)}
                          onRemove={() => void remove(job)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Was man mit einem Workflow tun kann — als eine Auswahl statt als fünf Knöpfe.
 *
 * Fünf Knöpfe je Zeile ergeben bei zehn Workflows fünfzig Knöpfe auf einem
 * Bildschirm, und der eine, den man sucht, steht jedes Mal woanders, weil
 * „Aktivieren" und „Deaktivieren" verschieden breit sind. Eine Auswahl ist
 * gleich breit, immer an derselben Stelle und nennt die Handlungen in fester
 * Reihenfolge.
 *
 * Es ist ein gewöhnliches Auswahlfeld und kein nachgebautes Menü: Es kennt
 * Tastatur, Bildschirmleser und die Gewohnheiten des Betriebssystems, ohne dass
 * wir eines davon nachbilden müssen.
 */
function RowActions({
  job,
  blocked,
  busy,
  canManage,
  canRun,
  onEdit,
  onHistory,
  onRun,
  onToggle,
  onRemove,
}: {
  job: Job;
  blocked: boolean;
  busy: boolean;
  canManage: boolean;
  canRun: boolean;
  onEdit(): void;
  onHistory(): void;
  onRun(): void;
  onToggle(): void;
  onRemove(): void;
}) {
  const actions: Record<string, () => void> = {
    edit: onEdit,
    history: onHistory,
    run: onRun,
    toggle: onToggle,
    remove: onRemove,
  };

  return (
    <select
      className="row-actions"
      value=""
      disabled={busy}
      aria-label={`Aktion für ${job.name}`}
      onChange={(event) => actions[event.target.value]?.()}
    >
      {/* Bleibt stehen: Das Feld zeigt eine Handlung an, nicht einen Zustand. */}
      <option value="">Aktion wählen …</option>

      {canManage && <option value="edit">Bearbeiten</option>}
      <option value="history">Historie</option>
      {canRun && (
        <option value="run" disabled={blocked}>
          Jetzt starten
        </option>
      )}
      {canManage && <option value="toggle">{job.enabled ? 'Deaktivieren' : 'Aktivieren'}</option>}
      {canManage && <option value="remove">Löschen</option>}
    </select>
  );
}
