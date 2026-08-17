import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client.js';

/** Dieselbe Grenze wie im Server (MINIMUM_PASSWORD_LENGTH); er prüft erneut. */
const MINIMUM_LENGTH = 10;

export interface PasswordChange {
  /** Only set where nobody is signed in and the form had to ask. */
  username?: string;
  current: string;
  next: string;
}

interface Props {
  /** Shown when the account was handed a password and may do nothing else. */
  forced?: boolean;
  displayName?: string;
  /** Nobody is signed in, so the form has to ask whose password this is. */
  askForUser?: boolean;
  onChange(change: PasswordChange): Promise<void>;
  onCancel?(): void;
}

export function ChangePasswordScreen({ forced = false, displayName, askForUser = false, onChange, onCancel }: Props) {
  const [username, setUsername] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MINIMUM_LENGTH;
  const mismatch = repeat.length > 0 && next !== repeat;
  const named = !askForUser || username.length > 0;
  const ready = named && current.length > 0 && next.length >= MINIMUM_LENGTH && next === repeat;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      await onChange({ username: askForUser ? username : undefined, current, next });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Das Passwort konnte nicht geändert werden');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__box" onSubmit={submit}>
        <div className="login__brand">Unikom</div>
        <h2 style={{ marginTop: '0.5rem' }}>Passwort ändern</h2>

        {forced ? (
          <div className="notice notice--warn">
            Für {displayName} wurde ein Passwort vergeben. Es muss geändert werden, bevor irgendetwas anderes möglich
            ist.
          </div>
        ) : (
          <p className="muted">Nach der Änderung müssen Sie sich neu anmelden — auch in anderen Browsern.</p>
        )}

        {error && <div className="notice notice--error">{error}</div>}

        {askForUser && (
          <div className="field">
            <label htmlFor="who">Benutzer</label>
            <input
              id="who"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="current">Bisheriges Passwort</label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            autoFocus={!askForUser}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="next">Neues Passwort</label>
          <input
            id="next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
          />
          <div className="field__hint">
            {tooShort ? `Noch zu kurz — mindestens ${MINIMUM_LENGTH} Zeichen.` : `Mindestens ${MINIMUM_LENGTH} Zeichen.`}
          </div>
        </div>

        <div className="field">
          <label htmlFor="repeat">Neues Passwort wiederholen</label>
          <input
            id="repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
          />
          {mismatch && <div className="field__hint">Die beiden Eingaben stimmen nicht überein.</div>}
        </div>

        <div className="row">
          <button type="submit" disabled={!ready || busy}>
            {busy ? 'Ändern …' : 'Passwort ändern'}
          </button>
          {onCancel && !forced && (
            <button type="button" className="secondary" onClick={onCancel}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
