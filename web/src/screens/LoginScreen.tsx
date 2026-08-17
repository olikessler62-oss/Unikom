import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client.js';
import { Notice } from '../components/Pieces.js';
import { useText } from '../i18n/useText.js';
import { ChangePasswordScreen, type PasswordChange } from './ChangePasswordScreen.js';

interface Props {
  onLogin(username: string, password: string): Promise<void>;
  onChangePassword(username: string, currentPassword: string, newPassword: string): Promise<void>;
}

export function LoginScreen({ onLogin, onChangePassword }: Props) {
  const t = useText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Changing a password is the one thing that happens here rather than inside
  // the running interface: a password nobody remembers is exactly the case
  // where getting in first is impossible.
  const [changing, setChanging] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setBusy(true);

    try {
      await onLogin(username, password);
    } catch (failure) {
      // The server deliberately says the same thing for an unknown user and a
      // wrong password; passing its message through keeps it that way.
      setError(failure instanceof ApiError ? failure.message : t('login.failed'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function change({ username: who, current, next }: PasswordChange): Promise<void> {
    await onChangePassword(who ?? '', current, next);

    // Only reached when the change went through — the form keeps every failure.
    setChanging(false);
    setPassword('');
    setError(undefined);
    setNotice(t('login.changed'));
  }

  if (changing) {
    return <ChangePasswordScreen askForUser onChange={change} onCancel={() => setChanging(false)} />;
  }

  return (
    <div className="login">
      <form className="login__box" onSubmit={submit}>
        <div className="login__brand">Unikom</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('login.please')}
        </p>

        {notice && <Notice kind="info">{notice}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}

        <div className="field">
          <label htmlFor="username">{t('login.username')}</label>
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
          <label htmlFor="password">{t('login.password')}</label>
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
          {busy ? t('login.working') : t('login.submit')}
        </button>

        <button
          type="button"
          className="secondary"
          style={{ width: '100%', marginTop: '0.5rem' }}
          onClick={() => {
            setNotice(undefined);
            setError(undefined);
            setChanging(true);
          }}
        >
          {t('login.changePassword')}
        </button>

        <div className="build-stamp">{t('nav.build')} {__UNIKOM_BUILD__}</div>
      </form>
    </div>
  );
}
