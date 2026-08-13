import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client.js';
import type { Dashboard } from '../api/types.js';

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardScreen() {
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
          setError(failure instanceof ApiError ? failure.message : 'Die Kennzahlen konnten nicht geladen werden');
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
  }, []);

  if (error) {
    return <div className="notice notice--error">{error}</div>;
  }

  if (!figures) {
    return <div className="empty">Wird geladen …</div>;
  }

  return (
    <>
      <div className="cards">
        <Figure label="Aktive Jobs" value={figures.activeJobs} />
        <Figure label="Läufe heute" value={figures.runsToday} />
        <Figure label="Dateien übernommen" value={figures.filesTransferredToday} />
        <Figure label="Dateien fehlgeschlagen" value={figures.filesFailedToday} bad={figures.filesFailedToday > 0} />
      </div>

      {figures.runningJobs.length > 0 && (
        <div className="notice notice--info">
          Gerade in Arbeit: {figures.runningJobs.length} {figures.runningJobs.length === 1 ? 'Lauf' : 'Läufe'}
        </div>
      )}

      <h2>Nächste Ausführungen</h2>
      {figures.nextExecutions.length === 0 ? (
        <div className="card empty">Kein Job ist zur Ausführung eingeplant.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Nächste Ausführung</th>
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
