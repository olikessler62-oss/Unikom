import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client.js';

interface Props {
  onLogin(username: string, password: string): Promise<void>;
}

export function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      await onLogin(username, password);
    } catch (failure) {
      // The server deliberately says the same thing for an unknown user and a
      // wrong password; passing its message through keeps it that way.
      setError(failure instanceof ApiError ? failure.message : 'Anmeldung fehlgeschlagen');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__box" onSubmit={submit}>
        <div className="login__brand">Unikom</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Bitte anmelden
        </p>

        {error && <div className="notice notice--error">{error}</div>}

        <div className="field">
          <label htmlFor="username">Benutzer</label>
          <input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
