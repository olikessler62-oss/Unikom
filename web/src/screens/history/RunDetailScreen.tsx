import { useState } from 'react';

import { api } from '../../api/client.js';
import { messageOf, useResource } from '../../api/useResource.js';
import type { FileStatus, LogLevel, RunDetail } from '../../api/types.js';
import {
  Empty,
  formatDuration,
  formatMoment,
  HeaderAction,
  Loading,
  Notice,
  RunBadge,
} from '../../components/Pieces.js';
import { locale } from '../../i18n/texts.js';
import { useText } from '../../i18n/useText.js';

const FILE_TONE: Record<FileStatus, string> = {
  PENDING: 'badge--muted',
  IN_PROGRESS: '',
  SUCCESS: 'badge--good',
  SKIPPED: 'badge--muted',
  FAILED: 'badge--bad',
};

/**
 * Das Protokoll liegt im Arbeitsspeicher des Servers und verschwindet mit dem
 * Neustart. Was aufgehoben werden soll, holt man sich hier als Datei — mit
 * jeder Zeile, nicht nur mit denen des eingestellten Detailgrads.
 */
async function saveProtocol(runId: string): Promise<void> {
  const document_ = await api.get<{ filename: string; text: string }>(`/api/runs/${runId}/protokoll`);

  const link = window.document.createElement('a');
  const url = URL.createObjectURL(new Blob([document_.text], { type: 'text/plain;charset=utf-8' }));

  link.href = url;
  link.download = document_.filename;
  link.click();

  // Ohne das behält der Browser den Speicher, bis die Seite neu geladen wird.
  URL.revokeObjectURL(url);
}

const LEVEL_TONE: Record<LogLevel, string> = {
  DEBUG: 'muted',
  INFO: '',
  WARNING: 'badge--warn',
  ERROR: 'badge--bad',
};

const LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];

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
  const t = useText();
  // DEBUG ist nicht die Voreinstellung: Dort steht jede verworfene Datei mit
  // Begründung — das will man, wenn ein Filter sich falsch verhält, und den
  // Rest der Zeit ist es Lärm.
  const [level, setLevel] = useState<LogLevel>('INFO');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
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
      {/*
       * Der Weg zurück steht neben der Überschrift, nicht über dem Inhalt. Dort
       * scrollte er weg, sobald man las — der Ausgang gehört an eine Stelle, die
       * stehen bleibt.
       */}
      <HeaderAction>
        <button className="secondary" onClick={onBack}>
          ← {t('detail.back')}
        </button>
      </HeaderAction>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>{detail.jobName ?? detail.jobId}</h2>
            <div className="muted">
              {formatMoment(detail.startedAt)} · {t('detail.duration')} {formatDuration(detail.durationMs)}
            </div>
          </div>
          <RunBadge status={detail.status} />
        </div>

        <div className="cards" style={{ marginTop: '1.2rem', marginBottom: 0, border: 0 }}>
          <Count label={t('detail.found')} value={detail.filesFound} />
          <Count label={t('detail.taken')} value={detail.filesSucceeded} />
          <Count label={t('detail.skipped')} value={detail.filesSkipped} />
          <Count label={t('detail.failed')} value={detail.filesFailed} bad={detail.filesFailed > 0} />
        </div>
      </div>

      <h2>{t('detail.files')}</h2>
      {detail.files.length === 0 ? (
        <Empty>{t('detail.noFiles')}</Empty>
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>{t('detail.col.file')}</th>
                <th>{t('detail.col.status')}</th>
                <th className="numeric">{t('detail.col.size')}</th>
                <th>{t('detail.col.target')}</th>
                <th>{t('detail.col.note')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.files.map((file) => (
                <tr key={file.id}>
                  <td>
                    <div>{file.sourceFilename}</div>
                    <div className="cell__sub">{file.sourcePath}</div>
                  </td>
                  <td>
                    <span className={`badge ${FILE_TONE[file.status]}`}>{t(`file.${file.status}`)}</span>
                    {file.resolution === 'DUPLICATE' && (
                      <span className="badge badge--muted" style={{ marginLeft: '0.3rem' }}>
                        {t('detail.duplicate')}
                      </span>
                    )}
                  </td>
                  <td className="numeric">{formatSize(file.destinationSize ?? file.sourceSize)}</td>
                  <td>{file.destinationFilename ?? '—'}</td>
                  <td className="muted">{file.errorMessage ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{t('detail.log')}</h2>
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setSaveError(undefined);
              saveProtocol(runId)
                .catch((failure) => setSaveError(messageOf(failure, 'Das Protokoll konnte nicht geholt werden')))
                .finally(() => setSaving(false));
            }}
          >
            {saving ? 'Wird geholt …' : 'Protokoll speichern'}
          </button>
          <select
            style={{ width: 'auto' }}
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel)}
          >
            {LEVELS.map((entry) => (
              <option key={entry} value={entry}>
                {t(`detail.log.${entry}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveError && <Notice kind="error">{saveError}</Notice>}

      {detail.logs.length === 0 ? (
        <Empty>{t('detail.log.empty')}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('detail.col.time')}</th>
                <th>{t('detail.col.level')}</th>
                <th>{t('detail.col.file')}</th>
                <th>{t('detail.col.message')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.logs.map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(entry.timestamp).toLocaleTimeString(locale())}
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
      <div className={bad ? 'figure__value figure__value--bad' : 'figure__value'} style={{ fontSize: '1.8rem' }}>
        {value}
      </div>
      <div className="figure__label">{label}</div>
    </div>
  );
}
