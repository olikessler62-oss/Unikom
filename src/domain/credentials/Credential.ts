export type CredentialType = 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';

/**
 * Credentials are managed separately from transfer jobs (spec section 49); a
 * job only ever stores a `credentialId`. The secret itself is never held in
 * plaintext, neither here nor in the database (section 51).
 */
export interface Credential {
  id: string;
  /**
   * The client this belongs to. Left out for something the operator uses
   * across all of them, typically an encryption key of their own.
   *
   * A job may only use its own tenant's credentials or a shared one: the SFTP
   * password of one client has no business in another client's job.
   */
  tenantId?: string;
  name: string;
  type: CredentialType;
  username?: string;
  /**
   * Die Windows-Freigabe, für die dieser Zugang gilt — `\\SERVER01\Austausch`.
   *
   * Am Zugang und nicht in einem eigenen Bestand: Ein zweites Verzeichnis
   * „bekannte Freigaben" wäre eine halbe Kopie dieser Tabelle, und an dem Tag,
   * an dem jemand hier das Kennwort ändert, wäre die andere veraltet.
   *
   * Wozu sie da ist: Wer ein Verzeichnis auf einer Freigabe aussucht, soll den
   * Zugang nicht noch einmal heraussuchen müssen — er wird über den längsten
   * übereinstimmenden Anfang gefunden.
   */
  freigabe?: string;
  encryptedSecret: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a credential looks like once it leaves the credential service: the
 * secret is stripped, so it cannot end up in a log, an API response or a UI
 * state by accident.
 */
export type CredentialSummary = Omit<Credential, 'encryptedSecret'>;

export interface CredentialInput {
  name: string;
  type: CredentialType;
  username?: string;
  /** Siehe `Credential.freigabe`. */
  freigabe?: string;
  /** Absent means shared across all tenants. */
  tenantId?: string;
  /** Plaintext, only in transit; it is encrypted before it is stored. */
  secret: string;
}

/**
 * Whether a job of `tenantId` may use this credential. Shared credentials are
 * available to everyone; a tenant's own credential is not.
 */
export function isUsableBy(credential: Pick<Credential, 'tenantId'>, tenantId: string): boolean {
  return credential.tenantId === undefined || credential.tenantId === tenantId;
}

export interface CredentialRepository {
  list(): Promise<Credential[]>;
  getById(id: string): Promise<Credential | undefined>;
  findByName(name: string): Promise<Credential | undefined>;
  save(credential: Credential): Promise<Credential>;
  delete(id: string): Promise<void>;
}

export function toSummary(credential: Credential): CredentialSummary {
  const { encryptedSecret: _encryptedSecret, ...summary } = credential;
  return summary;
}

/**
 * Der Zugang, der für diesen Freigabepfad gilt.
 *
 * Gewählt wird der **längste** passende Anfang. Zwei Zugänge auf demselben
 * Server sind der Regelfall und nicht die Ausnahme: einer, der auf
 * `\\SERVER01\Austausch` alles darf, und einer, der nur in
 * `\\SERVER01\Austausch\Fremd` hineinsehen darf. Der genauere gewinnt — der
 * gröbere wäre der mit den weiteren Rechten, und der ist beim Lesen nie die
 * richtige Wahl.
 *
 * Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung und auf die
 * Richtung der Trennzeichen: Windows macht dort keinen Unterschied, und ein
 * Zugang, der wegen eines Schrägstrichs nicht gefunden wird, sieht aus wie
 * einer, den es nicht gibt.
 */
export function zugangFuerFreigabe<T extends { freigabe?: string }>(
  zugaenge: readonly T[],
  pfad: string
): T | undefined {
  const gleich = (text: string): string =>
    text.replace(/[\\/]+/g, String.fromCharCode(92)).replace(/[\\/]+$/, '').toLowerCase();

  const gesucht = gleich(pfad);

  if (!gesucht) {
    return undefined;
  }

  return zugaenge
    .filter((zugang) => {
      const anfang = gleich(zugang.freigabe ?? '');

      // Nur an der Grenze eines Gliedes: `\\srv\austausch` ist kein Anfang von
      // `\\srv\austausch-alt`, auch wenn die Zeichen es nahelegen.
      return (
        anfang !== '' &&
        (gesucht === anfang || gesucht.startsWith(anfang + String.fromCharCode(92)))
      );
    })
    .sort((a, b) => gleich(b.freigabe ?? '').length - gleich(a.freigabe ?? '').length)[0];
}
