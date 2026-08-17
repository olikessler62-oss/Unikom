/**
 * A handful of values that belong to the installation itself rather than to any
 * job, user or client: the licence somebody installed through the interface,
 * and the latest point in time this installation has ever seen.
 *
 * Deliberately a key-value store and not a table per value. These are single
 * facts about one installation, they are read once at a time, and giving each
 * of them its own table and repository would be more scaffolding than content.
 */
export interface InstallationStateRepository {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export const INSTALLED_LICENCE = 'licence';

/**
 * The furthest the clock has ever been. A licence check that trusted the system
 * clock alone could be undone by setting it back a year, and on a machine the
 * customer administers that is a two-second operation.
 */
export const CLOCK_HIGH_WATER = 'clock-high-water';
