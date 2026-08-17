import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, setCsrfToken } from '../api/client.js';
import type { Identity, Permission } from '../api/types.js';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'active'; identity: Identity };

export interface Session {
  state: SessionState;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** The same change from the login page, where nobody is signed in yet. */
  changePasswordAtLogin(username: string, currentPassword: string, newPassword: string): Promise<void>;
  /** Whether the interface may show something. The server checks again. */
  may(permission: Permission): boolean;
  reload(): Promise<void>;
}

/**
 * Holds who is logged in. On start it asks the server rather than trusting
 * anything stored locally: the session cookie is httpOnly, so the browser
 * cannot tell us whether it is still valid — only the server can.
 */
export function useSession(): Session {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const adopt = useCallback((identity: Identity) => {
    setCsrfToken(identity.csrfToken);
    setState({ status: 'active', identity });
  }, []);

  const reload = useCallback(async () => {
    try {
      adopt(await api.get<Identity>('/api/me'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCsrfToken(undefined);
        setState({ status: 'anonymous' });
        return;
      }

      throw error;
    }
  }, [adopt]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(
    async (username: string, password: string) => {
      adopt(await api.post<Identity>('/api/session', { username, password }));
    },
    [adopt]
  );

  const logout = useCallback(async () => {
    try {
      await api.delete('/api/session');
    } finally {
      // Even if the call failed, this browser is done with the session.
      setCsrfToken(undefined);
      setState({ status: 'anonymous' });
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.post('/api/me/password', { currentPassword, newPassword });

    // The server ends every session of this user, including this one, so the
    // only honest thing to do is ask for the new password.
    setCsrfToken(undefined);
    setState({ status: 'anonymous' });
  }, []);

  /**
   * Only the account itself may change its password, so this signs in first —
   * briefly, and without opening the interface. Whichever way it ends, the
   * borrowed session is gone by the time this returns: the server drops every
   * session of the user on a successful change, and a failed change hands it
   * back instead of leaving one open behind the login page.
   */
  const changePasswordAtLogin = useCallback(
    async (username: string, currentPassword: string, newPassword: string) => {
      const identity = await api.post<Identity>('/api/session', { username, password: currentPassword });
      setCsrfToken(identity.csrfToken);

      try {
        await api.post('/api/me/password', { currentPassword, newPassword });
      } catch (failure) {
        await api.delete('/api/session').catch(() => undefined);
        throw failure;
      } finally {
        setCsrfToken(undefined);
      }
    },
    []
  );

  const may = useCallback(
    (permission: Permission) =>
      state.status === 'active' && state.identity.permissions.includes(permission),
    [state]
  );

  return { state, login, logout, changePassword, changePasswordAtLogin, may, reload };
}
