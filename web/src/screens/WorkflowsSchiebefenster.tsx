import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Feature, Job, Tenant } from '../api/types.js';
import { Auswahlfeld } from '../components/Auswahlfeld.js';
import { Empty, formatMoment, Loading, Notice, PencilIcon, PlusIcon, TrashIcon } from '../components/Pieces.js';
import { Bereichsfenster, Listenpanel, Schiebefenster } from '../components/Schiebefenster.js';
import { JobEditorScreen } from './job/JobEditorScreen.js';

const QUELLEN: Record<Job['sourceType'], string> = {
  LOCAL: 'Lokal',
  SHARE: 'Freigabe',
  SFTP: 'SFTP',
  FTPS: 'FTPS',
};

interface Props {
  canManage: boolean;
  /** Welche Module diese Installation hat; der Editor entscheidet danach. */
  features: Feature[];
  onSchliessen(): void;
}

/**
 * Die Workflows als Fenster, das unter der Seitenleiste hervorfährt.
 *
 * ## Warum eine Liste zum Auswählen und keine mit Knöpfen je Zeile
 *
 * Vorher trug jede Zeile ihre eigenen Knöpfe: bearbeiten, starten, anhalten,
 * löschen, Verlauf. Bei zwanzig Workflows sind das hundert Knöpfe, von denen
 * neunundneunzig nicht gemeint sind - und die Spalte dafür nahm den Platz, den
 * die Angaben gebraucht hätten.
 *
 * Jetzt wählt man eine Zeile, und die Knöpfe stehen einmal darunter. Was sie
 * tun, gilt für das Ausgesuchte; solange nichts ausgesucht ist, sind sie
 * ausgegraut und sagen damit, dass zuerst eine Wahl fällig ist.
 */
export function WorkflowsSchiebefenster({ canManage, features, onSchliessen }: Props) {
  const jobs = useResource<Job[]>('/api/jobs');
  const tenants = useResource<Tenant[]>('/api/tenants');

  const [mandant, setMandant] = useState('');
  const [gewaehlt, setGewaehlt] = useState<string>();
  /**
   * Welcher Workflow im Fenster darüber aufgeschlagen ist.
   *
   * `'new'` steht darin für den, den es noch nicht gibt - dieselbe Kennung, die
   * der Editor ohnehin kennt. Ein eigener Zustand daneben wäre eine zweite
   * Stelle, an der später eine vergessen wird.
   */
  const [editor, setEditor] = useState<string>();
  const [meldung, setMeldung] = useState<{ kind: 'info' | 'error'; text: string }>();

  const alle = jobs.data ?? [];
  const gezeigt = mandant ? alle.filter((job) => job.tenantId === mandant) : alle;
  const zeile = gezeigt.find((job) => job.id === gewaehlt);

  const mandantName = (id: string): string => tenants.data?.find((eintrag) => eintrag.id === id)?.name ?? id;

  /** Aufschlagen heißt: ein Fenster darüber, und die Liste bleibt stehen. */
  function oeffne(jobId: string): void {
    setEditor(jobId);
  }

  async function schliesseEditor(): Promise<void> {
    setEditor(undefined);
    // Was der Editor geändert hat, stünde sonst nicht in der Liste dahinter.
    await jobs.reload();
  }

  async function loesche(): Promise<void> {
    if (!zeile || !confirm(`"${zeile.name}" wirklich löschen? Die Historie des Jobs bleibt erhalten.`)) {
      return;
    }

    try {
      await api.delete(`/api/jobs/${zeile.id}`);
      setGewaehlt(undefined);
      await jobs.reload();
    } catch (fehler) {
      setMeldung({ kind: 'error', text: messageOf(fehler, 'Der Workflow konnte nicht gelöscht werden') });
    }
  }

  return (
    <>
      <Schiebefenster
        titel="Workflows"
        unterzeile="Zeile wählen — Öffnen, Anlegen und Löschen gelten für den ausgesuchten Workflow."
        hinweis="Mandant in der Combobox wählen oder Zeile auswählen — Doppelklick zum Öffnen."
        onSchliessen={onSchliessen}
      >
        {meldung && <Notice kind={meldung.kind}>{meldung.text}</Notice>}

        <Listenpanel
          titel="Workflows des Mandanten"
          kopfrechts={
            <Auswahlfeld
              className="input--wahl"
              aria-label="Mandant"
              value={mandant}
              onChange={(ereignis) => {
                setMandant(ereignis.target.value);
                setGewaehlt(undefined);
              }}
            >
              <option value="">Mandant wählen …</option>
              {tenants.data?.map((eintrag) => (
                <option key={eintrag.id} value={eintrag.id}>
                  {eintrag.name}
                </option>
              ))}
            </Auswahlfeld>
          }
          werkzeuge={
            <>
              {canManage && (
                <button type="button" onClick={() => oeffne('new')}>
                  <PlusIcon />
                  Neu
                </button>
              )}

              {/*
                * Bearbeiten trägt nur den Stift. Was es tut, steht im Tooltip -
                * in einer Leiste, in der jeder Knopf ein Wort trägt, wird aus
                * fünf Knöpfen eine Zeile Text.
                */}
              <button
                type="button"
                className="knopf--zeichen"
                title="Bearbeiten"
                aria-label="Bearbeiten"
                disabled={!zeile}
                onClick={() => zeile && oeffne(zeile.id)}
              >
                <PencilIcon />
              </button>

              <span className="listenpanel__luecke" />

              {canManage && (
                <>
                  <span className="listenpanel__trenner" aria-hidden="true" />
                  <button
                    type="button"
                    className="knopf--zeichen"
                    title="Löschen"
                    aria-label="Löschen"
                    disabled={!zeile}
                    onClick={() => void loesche()}
                  >
                    <TrashIcon />
                  </button>
                </>
              )}
            </>
          }
        >
          {jobs.error ? (
            <Notice kind="error">{jobs.error}</Notice>
          ) : !jobs.data ? (
            <Loading />
          ) : gezeigt.length === 0 ? (
            <Empty>
              {alle.length === 0 ? 'Es ist noch kein Workflow angelegt.' : 'Für diesen Mandanten gibt es keinen Workflow.'}
            </Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Mandant</th>
                  <th>Quelle</th>
                  <th>Status</th>
                  <th>Nächste Ausführung</th>
                </tr>
              </thead>
              <tbody>
                {gezeigt.map((job) => {
                  const gesperrt = (job.missingFeatures?.length ?? 0) > 0;

                  return (
                    <tr
                      key={job.id}
                      aria-selected={job.id === gewaehlt}
                      onClick={() => setGewaehlt(job.id)}
                      onDoubleClick={() => oeffne(job.id)}
                    >
                      <td>
                        <span className="listenpanel__punkt" aria-hidden="true" />
                        <strong>{job.name}</strong>
                      </td>
                      <td>{mandantName(job.tenantId)}</td>
                      <td>
                        {QUELLEN[job.sourceType]}
                        {job.encryptionConfig.enabled && ' · verschlüsselt'}
                      </td>
                      <td>{gesperrt ? 'Modul fehlt' : job.enabled ? 'Aktiv' : 'Ruht'}</td>
                      <td>{job.enabled && !gesperrt ? formatMoment(job.nextExecutionAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Listenpanel>
      </Schiebefenster>

      {/*
        * Der Editor steht in einem Fenster über dem Schiebefenster und nicht an
        * dessen Stelle. Wer ihn schließt, ist wieder in der Liste, aus der er
        * kam - ohne sie neu aufschlagen zu müssen.
        */}
      {editor && (
        <Bereichsfenster
          titel={editor === 'new' ? 'Neuer Workflow' : (alle.find((job) => job.id === editor)?.name ?? 'Workflow')}
          unterzeile="Angaben ändern und speichern — die Liste dahinter bleibt stehen."
          onSchliessen={() => void schliesseEditor()}
        >
          <JobEditorScreen jobId={editor} features={features} onDone={() => void schliesseEditor()} />
        </Bereichsfenster>
      )}
    </>
  );
}
