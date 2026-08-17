/**
 * The optional modules of the product.
 *
 * Each names what it does, and none of them is numbered. A number would have to
 * mean one of two things — which module this is, or where it sits in a workflow
 * — and it cannot mean both: a customer who buys only consolidation and
 * conversion runs them as first and second, while the price list would still
 * call them two and four. So the name carries the identity, and the position in
 * a particular workflow carries the number.
 *
 * All four modules are licensed separately, transferring included. It used to be
 * the free base product, which only held while everything else was an addition
 * to it. Once a customer can buy consolidation alone, handing them the transfer
 * for nothing would give away the module that carries the others.
 *
 * Scheduling, history, users and the job editor stay outside the licence: they
 * are the platform every module runs on, not a product of their own.
 *
 * SFTP and FTPS form one module. Both are remote file access over an encrypted
 * channel, they share credential handling, host verification and their whole
 * test setup; separating them would double the licensing surface without
 * offering a customer a decision they would actually want to make.
 *
 * Conversion and import are two modules and not one, because writing a file in
 * another format and loading records into database tables differ far more in
 * effort than a shared name would suggest: the first writes a file, the second
 * needs connections, schema mapping, transactions and a failure story of its
 * own. Each is bought on its own and each runs on its own.
 */
export const FEATURES = [
  'TRANSFER',
  'REMOTE_SOURCES',
  'ENCRYPTION',
  'CONSOLIDATION',
  'DATA_IMPORT',
  'CONVERSION',
] as const;

export type Feature = (typeof FEATURES)[number];

/** Wording for the licence overview and for error messages. */
export const FEATURE_LABELS: Record<Feature, string> = {
  TRANSFER: 'Daten übertragen',
  REMOTE_SOURCES: 'Entfernte Quellen (SFTP, FTPS)',
  ENCRYPTION: 'Verschlüsselte Ablage',
  CONSOLIDATION: 'Daten konsolidieren',
  DATA_IMPORT: 'Daten importieren',
  CONVERSION: 'Daten konvertieren',
};

export function isFeature(candidate: string): candidate is Feature {
  return (FEATURES as readonly string[]).includes(candidate);
}

/** Which modules an installation may use. */
export interface FeatureSet {
  isEnabled(feature: Feature): boolean;
  /** The enabled modules in the declared order, for display and for logs. */
  enabled(): readonly Feature[];
}

export class FeatureNotLicensedError extends Error {
  constructor(
    readonly feature: Feature,
    attemptedAction: string
  ) {
    super(
      `${attemptedAction} braucht das Modul „${FEATURE_LABELS[feature]}“, das diese Installation nicht enthält`
    );
    this.name = 'FeatureNotLicensedError';
  }
}

export class StaticFeatureSet implements FeatureSet {
  private readonly granted: ReadonlySet<Feature>;

  constructor(granted: Iterable<Feature>) {
    this.granted = new Set(granted);
  }

  isEnabled(feature: Feature): boolean {
    return this.granted.has(feature);
  }

  enabled(): readonly Feature[] {
    return FEATURES.filter((feature) => this.granted.has(feature));
  }
}

/**
 * Every module enabled. This is the default for development, tests and the demo
 * so that working on the product is not a licensing exercise. A distribution
 * build has to pass the customer's actual set instead — see
 * `ApplicationOptions.features`.
 */
export function allFeatures(): FeatureSet {
  return new StaticFeatureSet(FEATURES);
}

/**
 * No module at all. This is what an installation without a licence has: the
 * platform runs, jobs can be looked at and edited, and nothing may execute.
 */
export function noModules(): FeatureSet {
  return new StaticFeatureSet([]);
}

/** Transferring from local sources — the smallest set that can move a file. */
export function transferOnly(): FeatureSet {
  return new StaticFeatureSet(['TRANSFER']);
}
