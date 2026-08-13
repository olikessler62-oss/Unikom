import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client.js';

const MINIMUM_LENGTH = 12;

interface Props {
  /** Shown when the account was handed a password and may do nothing else. */
  forced: boolean;
  displayName: string;
  onChange(currentPassword: string, newPassword: string): Promise<void>;
  onCancel?(): void;
}

export function ChangePasswordScreen({ forced, displayName, onChange, onCancel }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MINIMUM_LENGTH;
  const mismatch = repeat.length > 0 && next !== repeat;
  const ready = current.length > 0 && next.length >= MINIMUM_LENGTH && next === repeat;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      await onChange(current, next);
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

        <div className="field">
          <label htmlFor="current">Bisheriges Passwort</label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            autoFocus
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
