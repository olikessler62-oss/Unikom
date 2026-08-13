import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Job, Tenant } from '../api/types.js';
import { Empty, formatMoment, Loading, Notice } from '../components/Pieces.js';

const SOURCE_LABELS: Record<Job['sourceType'], string> = {
  LOCAL: 'Lokal',
  SFTP: 'SFTP',
  FTPS: 'FTPS',
};

interface Props {
  canManage: boolean;
  canRun: boolean;
  onEdit(jobId: string | 'new'): void;
  onShowHistory(jobId: string): void;
}

export function JobsScreen({ canManage, canRun, onEdit, onShowHistory }: Props) {
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
      setMessage({ kind: 'info', text: `"${job.name}" wurde gestartet.` });
      await jobs.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Der Job konnte nicht gestartet werden') });
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
        {/* The filter only appears once it can do something. */}
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

        {canManage && <button onClick={() => onEdit('new')}>Neuer Job</button>}
      </div>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {shown.length === 0 ? (
        <Empty>
          {all.length === 0 ? 'Es ist noch kein Job angelegt.' : 'Für diesen Mandanten gibt es keinen Job.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
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
                      <div style={{ fontWeight: 600 }}>{job.name}</div>
                      {job.description && <div className="muted">{job.description}</div>}
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
                      {/* A job whose module was licensed away is shown rather
                          than hidden: otherwise a nightly schedule would stop
                          without anybody noticing. */}
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
                        <button className="secondary" onClick={() => onShowHistory(job.id)}>
                          Historie
                        </button>
                        {canRun && (
                          <button
                            className="secondary"
                            disabled={busyJob === job.id || blocked}
                            title={blocked ? 'Das nötige Modul ist nicht lizenziert' : undefined}
                            onClick={() => void runNow(job)}
                          >
                            {busyJob === job.id ? 'Läuft …' : 'Jetzt starten'}
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button className="secondary" onClick={() => onEdit(job.id)}>
                              Bearbeiten
                            </button>
                            <button className="secondary" onClick={() => void remove(job)}>
                              Löschen
                            </button>
                          </>
                        )}
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
