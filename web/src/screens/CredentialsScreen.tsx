import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Credential, Tenant } from '../api/types.js';
import { Empty, Field, Loading, Notice } from '../components/Pieces.js';

const TYPE_LABELS: Record<Credential['type'], string> = {
  USERNAME_PASSWORD: 'Benutzer und Passwort',
  SSH_PRIVATE_KEY: 'SSH-Schlüssel',
  ENCRYPTION_KEY: 'Verschlüsselungsschlüssel',
};

interface Draft {
  name: string;
  type: Credential['type'];
  username: string;
  secret: string;
  tenantId: string;
  /** For an encryption key: let Unikom generate one instead of typing it. */
  generate: boolean;
}

const EMPTY: Draft = {
  name: '',
  type: 'USERNAME_PASSWORD',
  username: '',
  secret: '',
  tenantId: '',
  generate: true,
};

export function CredentialsScreen() {
  const credentials = useResource<Credential[]>('/api/credentials');
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [draft, setDraft] = useState<Draft>();
  const [replacing, setReplacing] = useState<{ id: string; name: string; secret: string }>();
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    if (!draft) {
      return;
    }

    setBusy(true);
    setMessage(undefined);

    try {
      await api.post('/api/credentials', {
        name: draft.name,
        type: draft.type,
        username: draft.username || undefined,
        tenantId: draft.tenantId || undefined,
        // Leaving the secret out asks the server to generate a key.
        secret: draft.type === 'ENCRYPTION_KEY' && draft.generate ? undefined : draft.secret,
      });

      setDraft(undefined);
      await credentials.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Die Zugangsdaten konnten nicht angelegt werden') });
    } finally {
      setBusy(false);
    }
  }

  async function replaceSecret(): Promise<void> {
    if (!replacing) {
      return;
    }

    setBusy(true);

    try {
      await api.put(`/api/credentials/${replacing.id}/secret`, { secret: replacing.secret });
      setReplacing(undefined);
      setMessage({ kind: 'info', text: 'Das Geheimnis wurde ersetzt.' });
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Das Geheimnis konnte nicht ersetzt werden') });
    } finally {
      setBusy(false);
    }
  }

  async function check(credential: Credential): Promise<void> {
    try {
      const result = await api.get<{ resolvable: boolean }>(`/api/credentials/${credential.id}/check`);

      setMessage(
        result.resolvable
          ? { kind: 'info', text: `"${credential.name}" lässt sich mit dem Hauptschlüssel öffnen.` }
          : {
              kind: 'error',
              text: `"${credential.name}" lässt sich nicht öffnen. Wurde der Hauptschlüssel ausgetauscht?`,
            }
      );
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Die Prüfung ist fehlgeschlagen') });
    }
  }

  async function remove(credential: Credential): Promise<void> {
    if (!confirm(`"${credential.name}" wirklich löschen? Jobs, die sie verwenden, laufen danach nicht mehr.`)) {
      return;
    }

    try {
      await api.delete(`/api/credentials/${credential.id}`);
      await credentials.reload();
    } catch (failure) {
      setMessage({ kind: 'error', text: messageOf(failure, 'Löschen fehlgeschlagen') });
    }
  }

  if (credentials.error) {
    return <Notice kind="error">{credentials.error}</Notice>;
  }

  if (!credentials.data) {
    return <Loading />;
  }

  const tenantName = (id?: string): string =>
    id === undefined ? 'übergreifend' : (tenants.data?.find((entry) => entry.id === id)?.name ?? id);

  return (
    <>
      <Notice kind="info">
        Geheimnisse werden verschlüsselt gespeichert und lassen sich hier nicht mehr ansehen — nur ersetzen. Der
        Hauptschlüssel dafür liegt in der Umgebungsvariablen <code>UNIKOM_MASTER_KEY</code>, also außerhalb der
        Datenbank, die er schützt.
      </Notice>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {draft ? (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <h2>Neue Zugangsdaten</h2>

          <Field label="Name">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
          </Field>

          <Field label="Art">
            <select
              value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as Credential['type'] })}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mandant" hint="Ohne Zuordnung stehen sie allen Mandanten zur Verfügung.">
            <select value={draft.tenantId} onChange={(event) => setDraft({ ...draft, tenantId: event.target.value })}>
              <option value="">Übergreifend</option>
              {tenants.data?.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </Field>

          {draft.type !== 'ENCRYPTION_KEY' && (
            <Field label="Benutzername">
              <input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            </Field>
          )}

          {draft.type === 'ENCRYPTION_KEY' ? (
            <>
              <div className="field">
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={draft.generate}
                    onChange={(event) => setDraft({ ...draft, generate: event.target.checked })}
                  />
                  Schlüssel erzeugen lassen
                </label>
                <div className="field__hint">
                  Empfohlen. Ein selbst ausgedachtes Passwort ist selten so stark, wie es aussieht.
                </div>
              </div>

              {!draft.generate && (
                <Field label="Schlüssel">
                  <input
                    type="password"
                    value={draft.secret}
                    onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
                  />
                </Field>
              )}
            </>
          ) : (
            <Field label={draft.type === 'SSH_PRIVATE_KEY' ? 'Privater Schlüssel' : 'Passwort'}>
              <input
                type="password"
                value={draft.secret}
                onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
              />
            </Field>
          )}

          <div className="row">
            <button
              disabled={busy || !draft.name || (!draft.secret && !(draft.type === 'ENCRYPTION_KEY' && draft.generate))}
              onClick={() => void create()}
            >
              Anlegen
            </button>
            <button className="secondary" onClick={() => setDraft(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        <div className="row" style={{ marginBottom: '1rem' }}>
          <button onClick={() => setDraft(EMPTY)}>Neue Zugangsdaten</button>
        </div>
      )}

      {replacing && (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <h2>Geheimnis von „{replacing.name}" ersetzen</h2>
          <Field label="Neues Geheimnis">
            <input
              type="password"
              autoFocus
              value={replacing.secret}
              onChange={(event) => setReplacing({ ...replacing, secret: event.target.value })}
            />
          </Field>
          <div className="row">
            <button disabled={busy || !replacing.secret} onClick={() => void replaceSecret()}>
              Ersetzen
            </button>
            <button className="secondary" onClick={() => setReplacing(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      )}

      {credentials.data.length === 0 ? (
        <Empty>Es sind keine Zugangsdaten hinterlegt.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Art</th>
                <th>Benutzer</th>
                <th>Mandant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {credentials.data.map((credential) => (
                <tr key={credential.id}>
                  <td style={{ fontWeight: 600 }}>{credential.name}</td>
                  <td>{TYPE_LABELS[credential.type]}</td>
                  <td>{credential.username ?? '—'}</td>
                  <td>
                    {credential.tenantId === undefined ? (
                      <span className="badge badge--muted">übergreifend</span>
                    ) : (
                      tenantName(credential.tenantId)
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="secondary" onClick={() => void check(credential)}>
                        Prüfen
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setReplacing({ id: credential.id, name: credential.name, secret: '' })}
                      >
                        Ersetzen
                      </button>
                      <button className="secondary" onClick={() => void remove(credential)}>
                        Löschen
                      </button>
                    </div>
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
