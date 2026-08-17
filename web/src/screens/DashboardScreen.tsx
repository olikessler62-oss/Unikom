import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client.js';
import type { Dashboard } from '../api/types.js';
import { locale, textOf } from '../i18n/texts.js';
import { useLanguage } from '../i18n/useText.js';
import { Empty, Loading, Notice } from '../components/Pieces.js';

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardScreen() {
  const { language, t } = useLanguage();
  const [figures, setFigures] = useState<Dashboard>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const loaded = await api.get<Dashboard>('/api/dashboard');
        if (!cancelled) {
          setFigures(loaded);
          setError(undefined);
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof ApiError ? failure.message : textOf('dash.loadFailed', language));
        }
      }
    }

    void load();
    // Refreshed rather than pushed: a scheduler tick happens once a minute, so
    // there is nothing a live connection would show sooner.
    const timer = setInterval(() => void load(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [language]);

  if (error) {
    return <Notice kind="error">{error}</Notice>;
  }

  if (!figures) {
    return <Loading />;
  }

  return (
    <>
      <div className="cards">
        <Figure label={t('dash.activeJobs')} value={figures.activeJobs} />
        <Figure label={t('dash.runsToday')} value={figures.runsToday} />
        <Figure label={t('dash.filesTaken')} value={figures.filesTransferredToday} />
        <Figure label={t('dash.filesFailed')} value={figures.filesFailedToday} bad={figures.filesFailedToday > 0} />
      </div>

      <h2>{t('dash.next')}</h2>
      {figures.nextExecutions.length === 0 ? (
        <Empty>{t('dash.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('dash.job')}</th>
                <th>{t('dash.nextRun')}</th>
              </tr>
            </thead>
            <tbody>
              {figures.nextExecutions.map((entry) => (
                <tr key={entry.jobId}>
                  <td>{entry.jobName}</td>
                  <td>{formatMoment(entry.nextExecutionAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** The row itself carries the frame and the dividing rules; this is one cell. */
function Figure({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <div className={bad ? 'figure__value figure__value--bad' : 'figure__value'}>{value}</div>
      <div className="figure__label">{label}</div>
    </div>
  );
}
