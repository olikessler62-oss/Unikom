/**
 * The optional modules of the product. Step 1 with local sources, scheduling,
 * history and the job editor is the base product and deliberately not a
 * feature: it is always present, and every other module builds on it.
 *
 * SFTP and FTPS form one module. Both are remote file access over an encrypted
 * channel, they share credential handling, host verification and their whole
 * test setup; separating them would double the licensing surface without
 * offering a customer a decision they would actually want to make.
 *
 * Step 3 is two modules, because a file export and a migration into database
 * tables differ far more in effort than their common name suggests: the first
 * writes a file, the second needs connections, schema mapping, transactions and
 * a failure story of its own.
 */
export const FEATURES = [
  'REMOTE_SOURCES',
  'ENCRYPTION',
  'STEP_2_CONSOLIDATION',
  'STEP_3_FILE_EXPORT',
  'STEP_3_DATABASE_MIGRATION',
] as const;

export type Feature = (typeof FEATURES)[number];

/** Wording for the licence overview and for error messages. */
export const FEATURE_LABELS: Record<Feature, string> = {
  REMOTE_SOURCES: 'Remote sources (SFTP, FTPS)',
  ENCRYPTION: 'Encrypted storage',
  STEP_2_CONSOLIDATION: 'Consolidation, correction and record deduplication',
  STEP_3_FILE_EXPORT: 'Export to file formats',
  STEP_3_DATABASE_MIGRATION: 'Migration into database tables',
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
    super(`${attemptedAction} requires the module "${FEATURE_LABELS[feature]}", which this installation does not include`);
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

/** The base product alone: Step 1 with local sources. */
export function coreOnly(): FeatureSet {
  return new StaticFeatureSet([]);
}
