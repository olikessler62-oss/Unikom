import { useState } from 'react';

import { ChangePasswordScreen } from './screens/ChangePasswordScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { useSession } from './session/useSession.js';
import type { Permission } from './api/types.js';

interface Area {
  id: string;
  label: string;
  /** Hidden without it. The server refuses regardless; this only tidies up. */
  permission: Permission;
}

const AREAS: Area[] = [
  { id: 'dashboard', label: 'Übersicht', permission: 'VIEW' },
  { id: 'jobs', label: 'Jobs', permission: 'VIEW' },
  { id: 'history', label: 'Historie', permission: 'VIEW' },
  { id: 'tenants', label: 'Mandanten', permission: 'VIEW' },
  { id: 'credentials', label: 'Zugangsdaten', permission: 'MANAGE_CREDENTIALS' },
  { id: 'users', label: 'Benutzer', permission: 'MANAGE_USERS' },
];

export function App() {
  const session = useSession();
  const [area, setArea] = useState('dashboard');
  const [changingPassword, setChangingPassword] = useState(false);

  if (session.state.status === 'loading') {
    return <div className="empty">Wird geladen …</div>;
  }

  if (session.state.status === 'anonymous') {
    return <LoginScreen onLogin={session.login} />;
  }

  const { identity } = session.state;

  // A handed-out password may do exactly one thing. Showing anything else
  // would only lead to a screen where every action is refused.
  if (identity.mustChangePassword || changingPassword) {
    return (
      <ChangePasswordScreen
        forced={identity.mustChangePassword}
        displayName={identity.user.displayName}
        onChange={session.changePassword}
        onCancel={() => setChangingPassword(false)}
      />
    );
  }

  const visible = AREAS.filter((entry) => session.may(entry.permission));
  const current = visible.find((entry) => entry.id === area) ?? visible[0];

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar__brand">Unikom</div>
        <div className="sidebar__nav">
          {visible.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === current?.id ? 'sidebar__link sidebar__link--active' : 'sidebar__link'}
              onClick={() => setArea(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="sidebar__footer">
          <div>{identity.user.displayName}</div>
          <div style={{ marginBottom: '0.6rem' }}>{roleLabel(identity.user.role)}</div>
          <button className="secondary" style={{ width: '100%' }} onClick={() => setChangingPassword(true)}>
            Passwort ändern
          </button>
          <button
            className="secondary"
            style={{ width: '100%', marginTop: '0.4rem' }}
            onClick={() => void session.logout()}
          >
            Abmelden
          </button>
        </div>
      </nav>

      <main className="main">
        <div className="main__header">
          <h1>{current?.label ?? 'Unikom'}</h1>
        </div>

        {current?.id === 'dashboard' ? (
          <DashboardScreen />
        ) : (
          <div className="card empty">Dieser Bereich wird gerade gebaut.</div>
        )}
      </main>
    </div>
  );
}

function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'OPERATOR') return 'Bearbeiter';
  return 'Betrachter';
}
