import { useEffect, useState } from 'react';

import { useResource } from '../../api/useResource.js';
import type { Job, RunSummary, Tenant, TransferFile } from '../../api/types.js';
import { Empty, formatDuration, formatMoment, Loading, Notice, RunBadge } from '../../components/Pieces.js';
import { fill, type TextKey } from '../../i18n/texts.js';
import { useText } from '../../i18n/useText.js';
import { RunDetailScreen } from './RunDetailScreen.js';

interface Props {
  initialJobId?: string;
}

export function HistoryScreen({ initialJobId }: Props) {
  const t = useText();
  const jobs = useResource<Job[]>('/api/jobs');
  const tenants = useResource<Tenant[]>('/api/tenants');
  // Leer heißt beide Male: alle. Ein Mandant ist eine Einschränkung, keine
  // Vorbedingung — wer nur einen hat, soll ihn nicht erst auswählen müssen.
  const [tenantId, setTenantId] = useState('');
  const [jobId, setJobId] = useState(initialJobId ?? '');
  const [runId, setRunId] = useState<string>();
  const [onlyFailures, setOnlyFailures] = useState(false);

  const shown = jobs.data?.filter((job) => !tenantId || job.tenantId === tenantId) ?? [];

  // Ein gewählter Gegenstand, der nicht mehr zum Mandanten gehört, fällt auf
  // „alle" zurück. Sonst zeigte die Ansicht die Läufe eines Jobs, der in der
  // Combobox darüber gar nicht mehr steht.
  useEffect(() => {
    if (!jobs.data || !jobId) {
      return;
    }

    const job = jobs.data.find((entry) => entry.id === jobId);

    if (!job || (tenantId && job.tenantId !== tenantId)) {
      setJobId('');
    }
  }, [jobId, jobs.data, tenantId]);

  /*
   * Ohne einzelnen Gegenstand kommen die Läufe quer über alle Jobs. Der Mandant
   * wird dabei vom Server eingegrenzt und nicht hier: Eine Seite der neuesten
   * Läufe nachträglich zu filtern zeigte für einen Mandanten nichts, dessen
   * Läufe älter sind als diese Seite.
   */
  const runs = useResource<RunSummary[]>(
    jobId
      ? `/api/jobs/${jobId}/runs`
      : `/api/runs${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`
  );
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
    return <Empty>{t('history.noJobs')}</Empty>;
  }

  const jobById = new Map(jobs.data.map((job) => [job.id, job]));
  const tenantById = new Map((tenants.data ?? []).map((tenant) => [tenant.id, tenant]));
  const times = (key: TextKey, count: number) => fill(t(key), { n: count });

  return (
    <>
      {/*
       * Zwei Comboboxen nebeneinander: erst der Mandant, dann sein Gegenstand.
       * Die zweite zeigt nur, was zur ersten gehört — eine Liste aller Jobs
       * aller Mandanten ist bei mehreren Kunden nicht mehr zu überblicken.
       */}
      <div className="filters">
        <div className="filters__field">
          <label htmlFor="history-tenant">{t('history.tenant')}</label>
          <select id="history-tenant" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">{t('history.allTenants')}</option>
            {tenants.data?.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filters__field">
          <label htmlFor="history-subject">{t('history.subject')}</label>
          <select id="history-subject" value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">{t('history.allSubjects')}</option>
            {shown.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </div>

        {/*
         * Fehlgeschlagene Dateien gibt es nur je Gegenstand. Der Haken bleibt
         * trotzdem stehen, statt zu verschwinden und wiederzukommen — gesperrt
         * mit dem Grund daneben ist ehrlicher als eine Zeile, die springt.
         */}
        <label className={jobId ? 'check' : 'check check--off'} title={jobId ? undefined : t('history.needsSubject')}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            disabled={!jobId}
            checked={onlyFailures && Boolean(jobId)}
            onChange={(event) => setOnlyFailures(event.target.checked)}
          />
          {t('history.onlyFailures')}
        </label>
      </div>

      {onlyFailures && jobId ? (
        <FailureList resource={failures} />
      ) : runs.error ? (
        <Notice kind="error">{runs.error}</Notice>
      ) : !runs.data ? (
        <Loading />
      ) : runs.data.length === 0 ? (
        <Empty>{t('history.neverRan')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table--runs">
            <thead>
              <tr>
                {/*
                 * Mandant und Gegenstand teilen sich eine Spalte, so wie Beginn
                 * und Dauer. Der Gegenstand gehört dem Mandanten — untereinander
                 * liest sich das als eine Angabe, und es spart den Innenabstand
                 * einer zweiten Spalte.
                 *
                 * Sie stehen auch dann da, wenn beide Comboboxen auf einen
                 * einzelnen zeigen: Bei „Alle Mandanten" sieht man, wessen Lauf
                 * man vor sich hat, und die Tabelle behält ihre Spalten, wenn
                 * man den Filter ändert.
                 *
                 * Es ist außerdem die einzige Spalte, die wachsen darf. Ohne sie
                 * verteilte sich der übrige Platz auf die Zahlen, und vier
                 * Ziffern nahmen über sechzig Prozent der Fläche ein.
                 */}
                <th>{t('history.who')}</th>
                {/*
                 * Beginn und Dauer teilen sich eine Spalte. Sie beschreiben
                 * denselben Vorgang — wann er anfing und wie lange er dauerte —
                 * und in zwei Spalten kostete das Breite, die die Tabelle auf
                 * 1920×1080 nicht hat.
                 */}
                <th>{t('history.began')}</th>
                <th>{t('history.status')}</th>
                <th className="numeric">{t('history.found')}</th>
                <th className="numeric">{t('history.taken')}</th>
                <th className="numeric">{t('history.skipped')}</th>
                <th className="numeric">{t('history.failed')}</th>
                <th className="cell--open" />
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => {
                const job = jobById.get(run.jobId);
                const tenant = job ? tenantById.get(job.tenantId) : undefined;

                return (
                  // Die ganze Zeile öffnet den Lauf. Der Knopf am Ende bleibt
                  // trotzdem: eine Zeile ist mit der Tastatur nicht erreichbar,
                  // und ohne ihn sähe niemand, dass hier etwas zu öffnen ist.
                  <tr key={run.runId} className="row--opens" onClick={() => setRunId(run.runId)}>
                    <td>
                      <div>{tenant?.name ?? '-'}</div>
                      <div className="cell__sub">{job?.name ?? '-'}</div>
                    </td>
                    <td>
                      <div>{formatMoment(run.startedAt)}</div>
                      <div className="cell__sub">{formatDuration(run.durationMs)}</div>
                    </td>
                    <td>
                      <RunBadge status={run.status} />
                    </td>
                    <td className="numeric" title={times('history.found.each', run.filesFound)}>
                      {run.filesFound}
                    </td>
                    <td className="numeric" title={times('history.taken.each', run.filesSucceeded)}>
                      {run.filesSucceeded}
                    </td>
                    <td className="numeric" title={times('history.skipped.each', run.filesSkipped)}>
                      {run.filesSkipped}
                    </td>
                    <td className="numeric" title={times('history.failed.each', run.filesFailed)}>
                      {run.filesFailed > 0 ? <strong className="value--bad">{run.filesFailed}</strong> : 0}
                    </td>
                    <td className="cell--open">
                      <OpenButton label={t('history.open')} onOpen={() => setRunId(run.runId)} />
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

/** Der Pfeil am Zeilenende — dieselbe Wirkung wie ein Klick auf die Zeile. */
function OpenButton({ label, onOpen }: { label: string; onOpen(): void }) {
  return (
    <button
      type="button"
      className="open-button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        // Sonst zählte der Klick zweimal: einmal hier, einmal in der Zeile.
        event.stopPropagation();
        onOpen();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m9 5 7 7-7 7" />
      </svg>
    </button>
  );
}

/** Jede Datei dieses Jobs, die es nie geschafft hat — über alle Läufe hinweg. */
function FailureList({ resource }: { resource: ReturnType<typeof useResource<TransferFile[]>> }) {
  const t = useText();

  if (resource.error) {
    return <Notice kind="error">{resource.error}</Notice>;
  }

  if (!resource.data) {
    return <Loading />;
  }

  if (resource.data.length === 0) {
    return <Empty>{t('history.noFailures')}</Empty>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('history.file')}</th>
            <th>{t('history.moment')}</th>
            <th>{t('history.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {resource.data.map((file) => (
            <tr key={file.id}>
              <td>
                <div>{file.sourceFilename}</div>
                <div className="cell__sub">{file.sourcePath}</div>
              </td>
              <td className="cell--moment">{formatMoment(file.startedAt)}</td>
              <td>{file.errorMessage ?? file.errorCode ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
