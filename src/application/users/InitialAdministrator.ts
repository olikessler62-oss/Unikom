import { generateInitialPassword } from '../../infrastructure/security/PasswordHasher.js';
import type { UserService } from './UserService.js';

export interface InitialAdministrator {
  username: string;
  password: string;
}

/**
 * Creates the first administrator when there is not a single user yet, and
 * returns the generated password — the only time it exists in readable form.
 *
 * A generated password rather than a setup screen on first start: a setup
 * screen makes whoever reaches the machine first the administrator, and on a
 * company network that is not necessarily the person who installed it. Reading
 * the password off the console proves you have access to the machine.
 *
 * Returns undefined when users already exist, so calling this on every start
 * is safe.
 */
export async function ensureInitialAdministrator(
  userService: UserService,
  username = 'admin'
): Promise<InitialAdministrator | undefined> {
  if ((await userService.count()) > 0) {
    return undefined;
  }

  const password = generateInitialPassword();

  await userService.create({
    username,
    displayName: 'Administrator',
    role: 'ADMIN',
    password,
    // Until it is replaced, the session may do nothing but replace it.
    mustChangePassword: true,
  });

  return { username, password };
}

/** The one message that has to be impossible to miss in the console output. */
export function initialAdministratorNotice(administrator: InitialAdministrator): string {
  return [
    '',
    '  ┌──────────────────────────────────────────────────────────────┐',
    '  │  Unikom — erster Start                                       │',
    '  ├──────────────────────────────────────────────────────────────┤',
    `  │  Benutzer:  ${administrator.username.padEnd(48)} │`,
    `  │  Passwort:  ${administrator.password.padEnd(48)} │`,
    '  │                                                              │',
    '  │  Dieses Passwort wird nur dieses eine Mal angezeigt und      │',
    '  │  muss bei der ersten Anmeldung geändert werden.              │',
    '  └──────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
}
