import { useState } from 'react';

import { chooseInitials } from '../../../src/domain/users/Initials.js';
import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Role, User } from '../api/types.js';
import {
  Empty,
  Field,
  formatMoment,
  KeyIcon,
  Loading,
  LockIcon,
  Notice,
  PencilIcon,
  RowButton,
  TrashIcon,
  UnlockIcon,
} from '../components/Pieces.js';

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  STANDARD: 'Normal',
};

const ROLE_HINTS: Record<Role, string> = {
  ADMIN: 'Alles — dazu Benutzer, Zugänge und Schlüssel',
  STANDARD: 'Workflows anlegen, ändern und starten; keine Zugänge, keine Benutzer',
};

/** Dieselbe Grenze wie im Server (MINIMUM_PASSWORD_LENGTH); er prüft erneut. */
const MINIMUM_LENGTH = 10;

interface Draft {
  /** Fehlt bei einem neuen Benutzer. */
  id?: string;
  handleConflicts: boolean;
  firstName: string;
  lastName: string;
  username: string;
  role: Role;
  /** Nur beim Anlegen; ein bestehendes Passwort wird hier nie angefasst. */
  password: string;
}

const NEU: Draft = {
  firstName: '',
  lastName: '',
  username: '',
  role: 'STANDARD',
  password: '',
  handleConflicts: false,
};

function toDraft(user: User): Draft {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    role: user.role,
    password: '',
    handleConflicts: user.handleConflicts,
  };
}

/**
 * Das Kürzel, das der Server vergeben wird — mit derselben Funktion gerechnet,
 * die er selbst benutzt. Ein zweites, hier nachgebautes Verfahren zeigte eines
 * Tages etwas anderes an, als hinterher im Konto steht, und dann glaubt der
 * Anzeige zu Recht niemand mehr.
 */
function initialsPreview(draft: Draft, users: User[]): string {
  if (!draft.firstName.trim() || !draft.lastName.trim()) {
    return '';
  }

  const vergeben = users.filter((user) => user.id !== draft.id).map((user) => user.initials);
  const bisher = users.find((user) => user.id === draft.id)?.initials;

  try {
    return chooseInitials(draft, vergeben, bisher);
  } catch {
    // Ein Name ohne Buchstaben, oder kein freies Kürzel mehr: beim Speichern
    // sagt der Server, was los ist — hier bleibt das Feld so lange leer.
    return '';
  }
}

interface Props {
  /** So nobody locks themselves out of the screen they are standing on. */
  ownUserId: string;
}

export function UsersScreen({ ownUserId }: Props) {
  const users = useResource<User[]>('/api/users');
  const [draft, setDraft] = useState<Draft>();
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

  const alle = users.data;
  const bearbeitet = draft?.id ? alle.find((user) => user.id === draft.id) : undefined;
  const kuerzel = draft ? initialsPreview(draft, alle) : '';
  // Grau und kursiv, solange es ein Vorschlag ist. Steht es schon so im Konto,
  // ist es ein wirklicher Eintrag und hat sich nicht als Beispiel auszugeben.
  const kuerzelSteht = Boolean(bearbeitet && kuerzel === bearbeitet.initials);
  const vollstaendig = Boolean(draft?.firstName.trim() && draft?.lastName.trim() && draft?.username.trim());

  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {draft ? (
        <section className="card">
          <h2>{draft.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</h2>

          <Field label="Vorname">
            <input
              value={draft.firstName}
              autoFocus
              placeholder="Anna"
              onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
            />
          </Field>

          <Field label="Nachname">
            <input
              value={draft.lastName}
              placeholder="Berger"
              onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}
            />
          </Field>

          <Field
            label="Kürzel"
            explain={
              kuerzelSteht
                ? 'Bleibt stehen, solange es zum Namen passt.'
                : 'Erster Buchstabe des Vornamens, erster und letzter des Nachnamens. Ist das schon vergeben, rückt die dritte Stelle weiter; vergeben wird es beim Speichern.'
            }
          >
            <input
              readOnly
              tabIndex={-1}
              className={kuerzelSteht ? undefined : 'field__preset'}
              value={kuerzel}
              placeholder="ABR"
            />
          </Field>

          <Field
            label="Anmeldename"
            explain="Damit meldet sich der Benutzer an; Groß- und Kleinschreibung ist dabei gleichgültig."
          >
            <input
              value={draft.username}
              placeholder="a.berger"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </Field>

          <Field label="Berechtigung" explain={ROLE_HINTS[draft.role]}>
            <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Konfliktdaten"
            explain="Im Konfliktbestand stehen die ursprünglichen Feldwerte im Klartext. Dieses Recht hängt am Benutzer und folgt nicht aus der Berechtigung — auch ein Administrator hat es nicht von selbst."
          >
            <label className="check">
              <input
                type="checkbox"
                checked={draft.handleConflicts}
                onChange={(event) => setDraft({ ...draft, handleConflicts: event.target.checked })}
              />
              Darf Konfliktdatensätze sehen und bearbeiten
            </label>
          </Field>

          {!draft.id && (
            <Field
              label="Erstes Passwort"
              explain={`Mindestens ${MINIMUM_LENGTH} Zeichen. Der Benutzer muss es bei der ersten Anmeldung ändern.`}
            >
              <input
                type="password"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            </Field>
          )}

          <div className="row">
            <button
              disabled={busy || !vollstaendig || (!draft.id && draft.password.length < MINIMUM_LENGTH)}
              onClick={() =>
                void act(
                  async () => {
                    if (draft.id) {
                      await api.put(`/api/users/${draft.id}`, {
                        username: draft.username,
                        firstName: draft.firstName,
                        lastName: draft.lastName,
                        role: draft.role,
                        handleConflicts: draft.handleConflicts,
                      });
                    } else {
                      await api.post('/api/users', draft);
                    }

                    setDraft(undefined);
                  },
                  draft.id ? 'Die Änderung war nicht möglich' : 'Der Benutzer konnte nicht angelegt werden',
                  bearbeitet && bearbeitet.role !== draft.role
                    ? 'Gespeichert. Die Berechtigung hat sich geändert; offene Sitzungen dieses Benutzers sind damit beendet.'
                    : undefined
                )
              }
            >
              {draft.id ? 'Speichern' : 'Anlegen'}
            </button>
            <button className="secondary" onClick={() => setDraft(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        <div className="row">
          <button onClick={() => setDraft({ ...NEU })}>Neuer Benutzer</button>
        </div>
      )}

      {resetting && (
        <section className="card">
          <h2>Passwort für „{resetting.name}“ vergeben</h2>
          <Field
            label="Neues Passwort"
            explain={`Mindestens ${MINIMUM_LENGTH} Zeichen. Es gilt einmal: bei der nächsten Anmeldung muss der Benutzer es ersetzen.`}
          >
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

      {alle.length === 0 ? (
        <Empty>Es ist kein Benutzer angelegt.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>Kürzel</th>
                <th>Berechtigung</th>
                <th>Status</th>
                <th>Letzte Anmeldung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alle.map((user) => {
                const self = user.id === ownUserId;

                return (
                  <tr key={user.id}>
                    {/*
                     * Kein Abzeichen „Sie" am eigenen Eintrag. Wer die
                     * Benutzerverwaltung öffnet, weiß, wer er ist — und das
                     * Abzeichen kostete genau die Breite, an der der Name
                     * umbrach. Dass man sich nicht selbst löschen kann, sagt
                     * der fehlende Papierkorb.
                     */}
                    <td>
                      <div style={{ fontWeight: 600 }}>{user.displayName}</div>
                      <div className="muted">{user.username}</div>
                    </td>
                    <td>{user.initials}</td>
                    <td>
                      <span className={user.role === 'ADMIN' ? 'badge' : 'badge badge--muted'}>
                        {ROLE_LABELS[user.role]}
                      </span>
                      {user.handleConflicts && (
                        <span className="badge badge--warn" style={{ marginLeft: '0.4rem' }} title="Darf Konfliktdaten sehen">
                          Konflikte
                        </span>
                      )}
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
                      <div className="row-actions">
                        <RowButton
                          title="Benutzer bearbeiten"
                          disabled={busy}
                          onClick={() => {
                            setMessage(undefined);
                            setResetting(undefined);
                            setDraft(toDraft(user));
                          }}
                        >
                          <PencilIcon />
                        </RowButton>
                        <RowButton
                          title="Neues Passwort vergeben"
                          disabled={busy}
                          onClick={() => {
                            setMessage(undefined);
                            setDraft(undefined);
                            setResetting({ id: user.id, name: user.displayName, password: '' });
                          }}
                        >
                          <KeyIcon />
                        </RowButton>
                        <RowButton
                          title={
                            user.enabled
                              ? 'Benutzer sperren — offene Sitzungen enden sofort'
                              : 'Benutzer wieder freigeben'
                          }
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
                          {user.enabled ? <LockIcon /> : <UnlockIcon />}
                        </RowButton>
                        {!self && (
                          <RowButton
                            title="Benutzer löschen"
                            tone="bad"
                            disabled={busy}
                            onClick={() => {
                              if (confirm(`„${user.displayName}“ wirklich löschen?`)) {
                                void act(
                                  () => api.delete(`/api/users/${user.id}`),
                                  'Der Benutzer konnte nicht gelöscht werden'
                                );
                              }
                            }}
                          >
                            <TrashIcon />
                          </RowButton>
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
