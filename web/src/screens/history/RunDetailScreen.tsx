import { useState } from 'react';

import { useResource } from '../../api/useResource.js';
import type { FileStatus, LogLevel, RunDetail } from '../../api/types.js';
import { Empty, formatDuration, formatMoment, Loading, Notice, RunBadge } from '../../components/Pieces.js';

const FILE_STATUS: Record<FileStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Wartet', tone: 'badge--muted' },
  IN_PROGRESS: { label: 'Läuft', tone: '' },
  SUCCESS: { label: 'Übernommen', tone: 'badge--good' },
  SKIPPED: { label: 'Übersprungen', tone: 'badge--muted' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'badge--bad' },
};

const LEVEL_TONE: Record<LogLevel, string> = {
  DEBUG: 'muted',
  INFO: '',
  WARNING: 'badge--warn',
  ERROR: 'badge--bad',
};

function formatSize(bytes?: number): string {
  if (bytes === undefined) {
    return '—';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

interface Props {
  runId: string;
  onBack(): void;
}

export function RunDetailScreen({ runId, onBack }: Props) {
  // DEBUG is not the default: it explains every discarded file, which is what
  // you want when a filter misbehaves and noise the rest of the time.
  const [level, setLevel] = useState<LogLevel>('INFO');
  const run = useResource<RunDetail>(`/api/runs/${runId}?minimumLevel=${level}`);

  if (run.error) {
    return <Notice kind="error">{run.error}</Notice>;
  }

  if (!run.data) {
    return <Loading />;
  }

  const detail = run.data;

  return (
    <>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="secondary" onClick={onBack}>
          ← Zurück zur Historie
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>{detail.jobName ?? detail.jobId}</h2>
            <div className="muted">
              {formatMoment(detail.startedAt)} · Dauer {formatDuration(detail.durationMs)}
            </div>
          </div>
          <RunBadge status={detail.status} />
        </div>

        <div className="cards" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <Count label="Gefunden" value={detail.filesFound} />
          <Count label="Übernommen" value={detail.filesSucceeded} />
          <Count label="Übersprungen" value={detail.filesSkipped} />
          <Count label="Fehlgeschlagen" value={detail.filesFailed} bad={detail.filesFailed > 0} />
        </div>
      </div>

      <h2>Dateien</h2>
      {detail.files.length === 0 ? (
        <Empty>Dieser Lauf hat keine Datei angefasst.</Empty>
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>Datei</th>
                <th>Status</th>
                <th className="numeric">Größe</th>
                <th>Im Ziel als</th>
                <th>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {detail.files.map((file) => {
                const status = FILE_STATUS[file.status];

                return (
                  <tr key={file.id}>
                    <td>
                      <div>{file.sourceFilename}</div>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {file.sourcePath}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${status.tone}`}>{status.label}</span>
                      {file.resolution === 'DUPLICATE' && (
                        <span className="badge badge--muted" style={{ marginLeft: '0.3rem' }}>
                          Dublette
                        </span>
                      )}
                    </td>
                    <td className="numeric">{formatSize(file.destinationSize ?? file.sourceSize)}</td>
                    <td>{file.destinationFilename ?? '—'}</td>
                    <td className="muted">{file.errorMessage ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Protokoll</h2>
        <select
          style={{ width: 'auto' }}
          value={level}
          onChange={(event) => setLevel(event.target.value as LogLevel)}
        >
          <option value="DEBUG">Alles, auch verworfene Dateien</option>
          <option value="INFO">Normal</option>
          <option value="WARNING">Nur Warnungen und Fehler</option>
          <option value="ERROR">Nur Fehler</option>
        </select>
      </div>

      {detail.logs.length === 0 ? (
        <Empty>Auf dieser Stufe gibt es keine Einträge.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Stufe</th>
                <th>Datei</th>
                <th>Meldung</th>
              </tr>
            </thead>
            <tbody>
              {detail.logs.map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(entry.timestamp).toLocaleTimeString('de-DE')}
                  </td>
                  <td>
                    {LEVEL_TONE[entry.level] === 'muted' ? (
                      <span className="muted">{entry.level}</span>
                    ) : (
                      <span className={`badge ${LEVEL_TONE[entry.level]}`}>{entry.level}</span>
                    )}
                  </td>
                  <td>{entry.filename ?? ''}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Count({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <div className={bad ? 'figure__value figure__value--bad' : 'figure__value'} style={{ fontSize: '1.5rem' }}>
        {value}
      </div>
      <div className="figure__label">{label}</div>
    </div>
  );
}
