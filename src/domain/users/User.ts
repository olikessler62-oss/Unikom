/**
 * What a person may do. Kept deliberately coarse: three roles that a customer
 * can explain to their own staff beat a permission matrix nobody configures
 * correctly.
 */
export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export const ROLES: readonly Role[] = ['ADMIN', 'OPERATOR', 'VIEWER'];

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
  | 'MANAGE_USERS';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['VIEW', 'RUN_JOBS', 'MANAGE_JOBS', 'MANAGE_CREDENTIALS', 'MANAGE_USERS'],
  OPERATOR: ['VIEW', 'RUN_JOBS', 'MANAGE_JOBS'],
  VIEWER: ['VIEW'],
};

export function permissionsOf(role: Role): readonly Permission[] {
  return PERMISSIONS[role];
}

export function may(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export interface User {
  id: string;
  /** Used to log in; compared case-insensitively, stored as entered. */
  username: string;
  displayName: string;
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

/** A user as the interface and the API may see them — without the hash. */
export type UserSummary = Omit<User, 'passwordHash'>;

export function toSummary(user: User): UserSummary {
  const { passwordHash, ...summary } = user;
  return summary;
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
