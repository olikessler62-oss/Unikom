/**
 * What a person may do. Two levels, deliberately: eine Stufe, die ein Kunde
 * seinen eigenen Leuten in einem Satz erklären kann, wird richtig vergeben —
 * eine Rechtematrix nicht.
 */
export type Role = 'ADMIN' | 'STANDARD';

export const ROLES: readonly Role[] = ['ADMIN', 'STANDARD'];

export type Permission =
  /** See dashboard, jobs, runs and the log. */
  | 'VIEW'
  /** Start a job by hand and cancel a running one. */
  | 'RUN_JOBS'
  /** Create, change and delete jobs. */
  | 'MANAGE_JOBS'
  /** Create and change credentials. The secret itself stays unreadable. */
  | 'MANAGE_CREDENTIALS'
  /** Create and change users, assign roles. */
  | 'MANAGE_USERS'
  /**
   * Konfliktdatensätze ansehen und bearbeiten.
   *
   * Das einzige Recht, das nicht an der Stufe hängt, sondern am Benutzer.
   * Grund: Im Konfliktbestand stehen die ursprünglichen Feldwerte im Klartext
   * (SPEC-02, Abschnitt 22) — es ist der Bestand mit dem dichtesten
   * Personenbezug. Wer ihn sehen darf, soll namentlich feststehen und nicht
   * aus einer Stufe folgen, in der zwanzig Leute sind (FR_009, Abschnitt 7).
   */
  | 'HANDLE_CONFLICTS';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['VIEW', 'RUN_JOBS', 'MANAGE_JOBS', 'MANAGE_CREDENTIALS', 'MANAGE_USERS'],
  /*
   * Alles rund um die Arbeit selbst — nur nicht die Zugänge und nicht die
   * Benutzer. Ein Zugang trägt das Kennwort eines fremden Servers, und wer
   * Benutzer anlegen darf, kann sich selbst zum Administrator machen.
   */
  STANDARD: ['VIEW', 'RUN_JOBS', 'MANAGE_JOBS'],
};

export function permissionsOf(role: Role): readonly Permission[] {
  return PERMISSIONS[role];
}

/**
 * Was dieser Benutzer darf — seine Stufe und das, was ihm einzeln zugestanden
 * wurde.
 *
 * Auch ein Administrator bekommt das Recht auf Konfliktdaten nicht von selbst.
 * Er kann es sich zwar geben; dann ist es aber eine Handlung, die im Protokoll
 * steht, und die Frage „wer darf die Werte sehen" bleibt aus der Benutzerliste
 * beantwortbar.
 */
export function permissionsFor(user: Pick<User, 'role' | 'handleConflicts'>): readonly Permission[] {
  return user.handleConflicts ? [...PERMISSIONS[user.role], 'HANDLE_CONFLICTS'] : PERMISSIONS[user.role];
}

export function mayUser(user: Pick<User, 'role' | 'handleConflicts'>, permission: Permission): boolean {
  return permissionsFor(user).includes(permission);
}

export function may(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export interface User {
  id: string;
  /** Used to log in; compared case-insensitively, stored as entered. */
  username: string;
  firstName: string;
  lastName: string;
  /**
   * Drei Stellen, in der ganzen Installation eindeutig — siehe Initials.ts.
   * Vergeben wird es gerechnet, nicht eingetippt.
   */
  initials: string;
  role: Role;
  /** Salt and hash, never the password. See PasswordHasher for the format. */
  passwordHash: string;
  /**
   * Set for the generated first password and for one an administrator handed
   * out. Until it is changed, the session may do nothing but change it.
   */
  mustChangePassword: boolean;
  /** A disabled user keeps their history but cannot log in. */
  enabled: boolean;
  /** Darf Konfliktdatensätze sehen und bearbeiten; siehe Permission. */
  handleConflicts: boolean;
  /** Consecutive failed attempts; reset by every successful login. */
  failedLoginAttempts: number;
  /**
   * Blocked until this moment after too many failed attempts. Expires by
   * itself on purpose: a permanent lock would let anyone lock out the only
   * administrator by typing a wrong password often enough.
   */
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Der ausgeschriebene Name. Abgeleitet und nicht gespeichert: ein zweites,
 * getrennt gepflegtes Namensfeld widerspricht irgendwann dem ersten, und dann
 * steht im Protokoll ein anderer Mensch als in der Benutzerverwaltung.
 */
export function displayNameOf(user: Pick<User, 'firstName' | 'lastName' | 'username'>): string {
  return [user.firstName, user.lastName].map((part) => part.trim()).filter(Boolean).join(' ') || user.username;
}

/** A user as the interface and the API may see them — without the hash. */
export type UserSummary = Omit<User, 'passwordHash'> & { displayName: string };

export function toSummary(user: User): UserSummary {
  const { passwordHash, ...summary } = user;
  return { ...summary, displayName: displayNameOf(user) };
}

export interface UserRepository {
  list(): Promise<User[]>;
  getById(id: string): Promise<User | undefined>;
  /** Case-insensitive: "Anna" and "anna" are the same login. */
  findByUsername(username: string): Promise<User | undefined>;
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
