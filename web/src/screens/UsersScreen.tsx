import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Role, User } from '../api/types.js';
import { Empty, Field, formatMoment, Loading, Notice } from '../components/Pieces.js';

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  OPERATOR: 'Bearbeiter',
  VIEWER: 'Betrachter',
};

const ROLE_HINTS: Record<Role, string> = {
  ADMIN: 'Alles, einschließlich Benutzer, Schlüssel und Zugänge',
  OPERATOR: 'Jobs anlegen, ändern und starten',
  VIEWER: 'Nur ansehen',
};

/** Dieselbe Grenze wie im Server (MINIMUM_PASSWORD_LENGTH); er prüft erneut. */
const MINIMUM_LENGTH = 10;

interface Props {
  /** So nobody locks themselves out of the screen they are standing on. */
  ownUserId: string;
}

export function UsersScreen({ ownUserId }: Props) {
  const users = useResource<User[]>('/api/users');
  const [draft, setDraft] = useState<{ username: string; displayName: string; role: Role; password: string }>();
  const [resetting, setResetting] = useState<{ id: string; name: string; password: string }>();
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  async function act(what: () => Promise<unknown>, failure: string, success?: string): Promise<void> {
    setBusy(true);
    setMessage(undefined);

    try {
      await what();
      await users.reload();

      if (success) {
        setMessage({ kind: 'info', text: success });
      }
    } catch (error) {
      // The server refuses to let the last administrator step down, with a
      // message that explains why; showing it beats inventing one.
      setMessage({ kind: 'error', text: messageOf(error, failure) });
    } finally {
      setBusy(false);
    }
  }

  if (users.error) {
    return <Notice kind="error">{users.error}</Notice>;
  }

  if (!users.data) {
    return <Loading />;
  }

  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {draft ? (
        <section className="card">
          <h2>Neuer Benutzer</h2>

          <Field label="Anmeldename">
            <input
              value={draft.username}
              autoFocus
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </Field>

          <Field label="Angezeigter Name">
            <input
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
          </Field>

          <Field label="Rolle" hint={ROLE_HINTS[draft.role]}>
            <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Erstes Passwort"
            hint={`Mindestens ${MINIMUM_LENGTH} Zeichen. Der Benutzer muss es bei der ersten Anmeldung ändern.`}
          >
            <input
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </Field>

          <div className="row">
            <button
              disabled={busy || !draft.username || draft.password.length < MINIMUM_LENGTH}
              onClick={() =>
                void act(
                  async () => {
                    await api.post('/api/users', draft);
                    setDraft(undefined);
                  },
                  'Der Benutzer konnte nicht angelegt werden'
                )
              }
            >
              Anlegen
            </button>
            <button className="secondary" onClick={() => setDraft(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        <div className="row">
          <button onClick={() => setDraft({ username: '', displayName: '', role: 'VIEWER', password: '' })}>
            Neuer Benutzer
          </button>
        </div>
      )}

      {resetting && (
        <section className="card">
          <h2>Passwort für „{resetting.name}" vergeben</h2>
          <Field label="Neues Passwort" hint={`Mindestens ${MINIMUM_LENGTH} Zeichen.`}>
            <input
              type="password"
              autoFocus
              value={resetting.password}
              onChange={(event) => setResetting({ ...resetting, password: event.target.value })}
            />
          </Field>
          <div className="row">
            <button
              disabled={busy || resetting.password.length < MINIMUM_LENGTH}
              onClick={() =>
                void act(
                  async () => {
                    await api.post(`/api/users/${resetting.id}/password`, { password: resetting.password });
                    setResetting(undefined);
                  },
                  'Das Passwort konnte nicht vergeben werden',
                  'Das Passwort wurde vergeben und muss bei der nächsten Anmeldung geändert werden.'
                )
              }
            >
              Vergeben
            </button>
            <button className="secondary" onClick={() => setResetting(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      )}

      {users.data.length === 0 ? (
        <Empty>Es ist kein Benutzer angelegt.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Letzte Anmeldung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => {
                const self = user.id === ownUserId;

                return (
                  <tr key={user.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {user.displayName}
                        {self && (
                          <span className="badge badge--muted" style={{ marginLeft: '0.4rem' }}>
                            Sie
                          </span>
                        )}
                      </div>
                      <div className="muted">{user.username}</div>
                    </td>
                    <td>
                      <select
                        style={{ width: 'auto' }}
                        value={user.role}
                        disabled={busy}
                        onChange={(event) =>
                          void act(
                            () => api.put(`/api/users/${user.id}/role`, { role: event.target.value }),
                            'Die Rolle konnte nicht geändert werden',
                            'Die Rolle wurde geändert. Offene Sitzungen dieses Benutzers sind damit beendet.'
                          )
                        }
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {!user.enabled ? (
                        <span className="badge badge--bad">Gesperrt</span>
                      ) : user.mustChangePassword ? (
                        <span className="badge badge--warn">Passwort offen</span>
                      ) : (
                        <span className="badge badge--good">Aktiv</span>
                      )}
                    </td>
                    <td className="muted">{formatMoment(user.lastLoginAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="secondary"
                          onClick={() => setResetting({ id: user.id, name: user.displayName, password: '' })}
                        >
                          Passwort
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => api.put(`/api/users/${user.id}/enabled`, { enabled: !user.enabled }),
                              'Die Änderung war nicht möglich',
                              user.enabled
                                ? 'Der Benutzer ist gesperrt; offene Sitzungen wurden sofort beendet.'
                                : undefined
                            )
                          }
                        >
                          {user.enabled ? 'Sperren' : 'Freigeben'}
                        </button>
                        {!self && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              if (confirm(`"${user.displayName}" wirklich löschen?`)) {
                                void act(
                                  () => api.delete(`/api/users/${user.id}`),
                                  'Der Benutzer konnte nicht gelöscht werden'
                                );
                              }
                            }}
                          >
                            Löschen
                          </button>
                        )}
                      </div>
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
