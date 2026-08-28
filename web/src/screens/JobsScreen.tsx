import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { ActiveRun, Job, LogEntry, Tenant } from '../api/types.js';
import { Empty, formatMoment, Loading, Notice } from '../components/Pieces.js';
import { locale } from '../i18n/texts.js';

/** Wie oft die Leitwarte nachsieht, was läuft. */
const RUNS_INTERVAL_MS = 2000;
/** Wie oft das offene Protokoll nachlädt — nur das, was neu ist. */
const LOG_INTERVAL_MS = 1000;

interface Props {
  canRun: boolean;
}

/**
 * Die Leitwarte: was läuft gerade, was steht als Nächstes an, und was tut ein
 * Lauf in diesem Moment. Eingerichtet wird hier nichts — dafür gibt es
 * Workflows. Wer zusieht, soll nicht aus Versehen etwas verstellen.
 */
export function JobsScreen({ canRun }: Props) {
  const jobs = useResource<Job[]>('/api/jobs');
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [runs, setRuns] = useState<ActiveRun[]>();
  const [watching, setWatching] = useState<string>();
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api.get<ActiveRun[]>('/api/active-runs'));
    } catch {
      // Ein Aussetzer beim Nachsehen ist kein Ereignis: der nächste Blick in
      // zwei Sekunden holt es nach, und eine Fehlermeldung im Sekundentakt
      // wäre schlimmer als die Lücke.
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const timer = setInterval(() => void loadRuns(), RUNS_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [loadRuns]);

  // Der beobachtete Lauf verschwindet, wenn er zu Ende ist — das Protokoll
  // bleibt dann stehen, wo es aufgehört hat, statt sich zu schließen.
  const active = runs ?? [];

  async function control(run: ActiveRun, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    setBusy(true);
    setMessage(undefined);

    try {
      await api.post(`/api/runs/${run.runId}/${action}`);
      await loadRuns();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Der Lauf ließ sich nicht steuern') });
    } finally {
      setBusy(false);
    }
  }

  if (jobs.error) {
    return <Notice kind="error">{jobs.error}</Notice>;
  }

  if (!jobs.data || runs === undefined) {
    return <Loading />;
  }

  const tenantName = (id: string): string => tenants.data?.find((tenant) => tenant.id === id)?.name ?? id;
  const severalTenants = (tenants.data?.length ?? 0) > 1;

  /** Was eingeplant ist und nicht gerade läuft — nach Fälligkeit geordnet. */
  const upcoming = jobs.data
    .filter(
      (job) =>
        job.enabled &&
        (job.missingFeatures?.length ?? 0) === 0 &&
        job.nextExecutionAt &&
        !active.some((run) => run.jobId === job.id)
    )
    .sort((left, right) => (left.nextExecutionAt ?? '').localeCompare(right.nextExecutionAt ?? ''));

  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <section className="card">
        <h2>Läuft gerade</h2>

        {active.length === 0 ? (
          <div className="muted">Im Moment läuft kein Job.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  {severalTenants && <th>Mandant</th>}
                  <th>Seit</th>
                  <th>Zustand</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((run) => (
                  <tr key={run.runId}>
                    <td style={{ fontWeight: 600 }}>{run.jobName}</td>
                    {severalTenants && <td>{tenantName(run.tenantId)}</td>}
                    <td>{formatMoment(run.startedAt)}</td>
                    <td>
                      {run.state === 'RUNNING' ? (
                        <span className="badge badge--good">Läuft</span>
                      ) : run.state === 'PAUSED' ? (
                        <span className="badge badge--warn">Angehalten</span>
                      ) : (
                        <span className="badge badge--muted">Bricht ab …</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="secondary"
                          onClick={() => setWatching(watching === run.runId ? undefined : run.runId)}
                        >
                          {watching === run.runId ? 'Protokoll zu' : 'Protokoll'}
                        </button>

                        {canRun && run.state !== 'CANCELLED' && (
                          <>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => void control(run, run.state === 'PAUSED' ? 'resume' : 'pause')}
                            >
                              {run.state === 'PAUSED' ? 'Fortsetzen' : 'Anhalten'}
                            </button>
                            <button className="secondary" disabled={busy} onClick={() => void control(run, 'cancel')}>
                              Abbrechen
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canRun && active.length > 0 && (
          <div className="field__hint" style={{ marginTop: '0.8rem' }}>
            Angehalten und abgebrochen wird zwischen zwei Dateien. Eine Datei, die gerade übertragen wird, läuft zu
            Ende - halb im Ziel darf keine liegen.
          </div>
        )}
      </section>

      {watching && <RunLog runId={watching} live={active.some((run) => run.runId === watching)} />}

      <section className="card">
        <h2>Steht an</h2>

        {upcoming.length === 0 ? (
          <Empty>Es ist nichts eingeplant.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  {severalTenants && <th>Mandant</th>}
                  <th>Nächste Ausführung</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((job) => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 600 }}>{job.name}</td>
                    {severalTenants && <td>{tenantName(job.tenantId)}</td>}
                    <td>{formatMoment(job.nextExecutionAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Das mitlaufende Protokoll eines Laufs. Es holt nur, was seit dem letzten Blick
 * dazugekommen ist — der Server nummeriert die Zeilen, und wir merken uns die
 * höchste. Zeitstempel würden dafür nicht reichen: mehrere Zeilen teilen sich
 * eine Millisekunde.
 */
function RunLog({ runId, live }: { runId: string; live: boolean }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string>();
  const since = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ein anderer Lauf ist ein anderes Protokoll, kein Anhang an das alte.
    setEntries([]);
    since.current = 0;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const fresh = await api.get<LogEntry[]>(
          `/api/runs/${runId}/log?minimumLevel=DEBUG&after=${since.current}`
        );

        if (cancelled || fresh.length === 0) {
          return;
        }

        since.current = Math.max(since.current, ...fresh.map((entry) => entry.sequence ?? 0));
        setEntries((previous) => [...previous, ...fresh].slice(-500));
        setError(undefined);
      } catch (failure) {
        if (!cancelled) {
          setError(messageOf(failure, 'Das Protokoll konnte nicht gelesen werden'));
        }
      }
    };

    void poll();

    // Ein beendeter Lauf schreibt nichts mehr; einmal lesen genügt.
    if (!live) {
      return () => {
        cancelled = true;
      };
    }

    const timer = setInterval(() => void poll(), LOG_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, live]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [entries]);

  return (
    <section className="card">
      <h2>Protokoll {live ? '' : '(abgeschlossen)'}</h2>

      {error && <Notice kind="error">{error}</Notice>}

      {entries.length === 0 ? (
        <div className="muted">Noch keine Einträge.</div>
      ) : (
        <div className="run-log">
          {entries.map((entry, index) => (
            <div key={`${entry.sequence ?? index}`} className={`run-log__line run-log__line--${entry.level}`}>
              <span className="run-log__time">{new Date(entry.timestamp).toLocaleTimeString(locale())}</span>
              <span className="run-log__level">{entry.level}</span>
              <span className="run-log__message">
                {entry.filename ? `${entry.filename}: ` : ''}
                {entry.message}
              </span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
    </section>
  );
}
