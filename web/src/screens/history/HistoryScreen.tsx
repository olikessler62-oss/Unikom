import { useEffect, useState } from 'react';

import { useResource } from '../../api/useResource.js';
import type { Job, RunSummary, TransferFile } from '../../api/types.js';
import { Empty, formatDuration, formatMoment, Loading, Notice, RunBadge } from '../../components/Pieces.js';
import { RunDetailScreen } from './RunDetailScreen.js';

interface Props {
  initialJobId?: string;
}

export function HistoryScreen({ initialJobId }: Props) {
  const jobs = useResource<Job[]>('/api/jobs');
  const [jobId, setJobId] = useState(initialJobId ?? '');
  const [runId, setRunId] = useState<string>();
  const [onlyFailures, setOnlyFailures] = useState(false);

  // The first job is picked once the list arrives, so the screen is never
  // empty for no reason.
  useEffect(() => {
    if (!jobId && jobs.data && jobs.data.length > 0) {
      setJobId(jobs.data[0].id);
    }
  }, [jobId, jobs.data]);

  const runs = useResource<RunSummary[]>(jobId ? `/api/jobs/${jobId}/runs` : undefined);
  const failures = useResource<TransferFile[]>(jobId && onlyFailures ? `/api/jobs/${jobId}/failures` : undefined);

  if (runId) {
    return <RunDetailScreen runId={runId} onBack={() => setRunId(undefined)} />;
  }

  if (jobs.error) {
    return <Notice kind="error">{jobs.error}</Notice>;
  }

  if (!jobs.data) {
    return <Loading />;
  }

  if (jobs.data.length === 0) {
    return <Empty>Es ist noch kein Job angelegt, also gibt es auch keine Historie.</Empty>;
  }

  return (
    <>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <select style={{ width: 'auto' }} value={jobId} onChange={(event) => setJobId(event.target.value)}>
          {jobs.data.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>

        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: 0, fontWeight: 400 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={onlyFailures}
            onChange={(event) => setOnlyFailures(event.target.checked)}
          />
          Nur fehlgeschlagene Dateien
        </label>
      </div>

      {onlyFailures ? (
        <FailureList resource={failures} />
      ) : runs.error ? (
        <Notice kind="error">{runs.error}</Notice>
      ) : !runs.data ? (
        <Loading />
      ) : runs.data.length === 0 ? (
        <Empty>Dieser Job ist noch nie gelaufen.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Beginn</th>
                <th>Status</th>
                <th className="numeric">Dauer</th>
                <th className="numeric">Gefunden</th>
                <th className="numeric">Übernommen</th>
                <th className="numeric">Übersprungen</th>
                <th className="numeric">Fehler</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.runId}>
                  <td>{formatMoment(run.startedAt)}</td>
                  <td>
                    <RunBadge status={run.status} />
                  </td>
                  <td className="numeric">{formatDuration(run.durationMs)}</td>
                  <td className="numeric">{run.filesFound}</td>
                  <td className="numeric">{run.filesSucceeded}</td>
                  <td className="numeric">{run.filesSkipped}</td>
                  <td className="numeric">
                    {run.filesFailed > 0 ? <strong style={{ color: 'var(--bad)' }}>{run.filesFailed}</strong> : 0}
                  </td>
                  <td>
                    <button className="secondary" onClick={() => setRunId(run.runId)}>
                      Öffnen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Every file of this job that never made it, across all runs. */
function FailureList({ resource }: { resource: ReturnType<typeof useResource<TransferFile[]>> }) {
  if (resource.error) {
    return <Notice kind="error">{resource.error}</Notice>;
  }

  if (!resource.data) {
    return <Loading />;
  }

  if (resource.data.length === 0) {
    return <Empty>Keine Datei dieses Jobs ist bisher fehlgeschlagen.</Empty>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Datei</th>
            <th>Zeitpunkt</th>
            <th>Grund</th>
          </tr>
        </thead>
        <tbody>
          {resource.data.map((file) => (
            <tr key={file.id}>
              <td>
                <div>{file.sourceFilename}</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {file.sourcePath}
                </div>
              </td>
              <td>{formatMoment(file.startedAt)}</td>
              <td>{file.errorMessage ?? file.errorCode ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
