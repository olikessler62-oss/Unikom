import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Tenant } from '../api/types.js';
import { CheckField, Empty, Field, InfoButton, Loading, Modal, Notice } from '../components/Pieces.js';

interface Draft {
  id?: string;
  name: string;
  description: string;
  rootDirectory: string;
  enabled: boolean;
}

const EMPTY: Draft = { name: '', description: '', rootDirectory: '', enabled: true };

interface Props {
  canManage: boolean;
}

export function TenantsScreen({ canManage }: Props) {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** Die Erklärung zum Root-Verzeichnis, auf Wunsch statt dauerhaft. */
  const [explaining, setExplaining] = useState(false);

  async function save(): Promise<void> {
    if (!draft) {
      return;
    }

    setError(undefined);
    setSaving(true);

    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        rootDirectory: draft.rootDirectory,
        enabled: draft.enabled,
      };

      if (draft.id) {
        await api.put(`/api/tenants/${draft.id}`, payload);
      } else {
        await api.post('/api/tenants', payload);
      }

      setDraft(undefined);
      await tenants.reload();
    } catch (failure) {
      // Overlapping directories and jobs left outside are reported by the
      // server with a message that names the problem.
      setError(messageOf(failure, 'Der Mandant konnte nicht gespeichert werden'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(tenant: Tenant): Promise<void> {
    if (!confirm(`Mandant "${tenant.name}" wirklich löschen?`)) {
      return;
    }

    try {
      await api.delete(`/api/tenants/${tenant.id}`);
      await tenants.reload();
    } catch (failure) {
      setError(messageOf(failure, 'Der Mandant konnte nicht gelöscht werden'));
    }
  }

  if (tenants.error) {
    return <Notice kind="error">{tenants.error}</Notice>;
  }

  if (!tenants.data) {
    return <Loading />;
  }

  return (
    <>
      {explaining && (
        <Modal title="Root-Verzeichnis" onClose={() => setExplaining(false)}>
          <p>
            Jeder Job dieses Mandanten darf seine Dateien nur <strong>unterhalb dieses Ordners</strong> ablegen. Ein
            Zielverzeichnis außerhalb wird beim Speichern abgelehnt — so landen die Daten dieses Kunden auch bei einem
            Tippfehler nicht beim nächsten.
          </p>
          <p>
            Leer lassen, wenn Sie nur eigene Daten verarbeiten. Dann gibt es niemanden, mit dem etwas verwechselt werden
            könnte.
          </p>
        </Modal>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      {draft ? (
        <section className="card">
          <h2>{draft.id ? 'Mandant bearbeiten' : 'Neuer Mandant'}</h2>

          <Field label="Mandanten-Name">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
          </Field>

          <Field label="Mandanten-Beschreibung">
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>

          <Field label="Root-Verzeichnis">
            <div className="field__row">
              <input
                value={draft.rootDirectory}
                placeholder="D:\Daten\Kunde A"
                onChange={(event) => setDraft({ ...draft, rootDirectory: event.target.value })}
              />
              <InfoButton label="Wozu dient das Root-Verzeichnis?" onClick={() => setExplaining(true)} />
            </div>
          </Field>

          <CheckField
            label="Mandant ist aktiv"
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />

          <div className="row">
            <button disabled={saving || !draft.name} onClick={() => void save()}>
              {saving ? 'Wird gespeichert …' : 'Speichern'}
            </button>
            <button className="secondary" onClick={() => setDraft(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        canManage && (
          <div className="row">
            <button onClick={() => setDraft(EMPTY)}>Neuer Mandant</button>
          </div>
        )
      )}

      {tenants.data.length === 0 ? (
        <Empty>Es ist kein Mandant angelegt.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mandant</th>
                <th>Root-Verzeichnis</th>
                <th className="numeric">Jobs</th>
                <th>Status</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {tenants.data.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                    {tenant.description && <div className="muted">{tenant.description}</div>}
                  </td>
                  <td className="muted">
                    {tenant.rootDirectory ?? <span className="badge badge--muted">nicht eingegrenzt</span>}
                  </td>
                  <td className="numeric">{tenant.jobCount ?? 0}</td>
                  <td>
                    {tenant.enabled ? (
                      <span className="badge badge--good">Aktiv</span>
                    ) : (
                      <span className="badge badge--muted">Ruht</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="secondary"
                          onClick={() =>
                            setDraft({
                              id: tenant.id,
                              name: tenant.name,
                              description: tenant.description ?? '',
                              rootDirectory: tenant.rootDirectory ?? '',
                              enabled: tenant.enabled,
                            })
                          }
                        >
                          Bearbeiten
                        </button>
                        <button className="secondary" onClick={() => void remove(tenant)}>
                          Löschen
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
