import fs from 'node:fs/promises';

import {
  CLOCK_HIGH_WATER,
  INSTALLED_LICENCE,
  type InstallationStateRepository,
} from '../../domain/installation/InstallationState.js';
import {
  allFeatures,
  noModules,
  StaticFeatureSet,
  type FeatureSet,
} from '../../domain/licensing/Feature.js';
import {
  evaluateLicence,
  LicenceExpiredError,
  type Licence,
  type LicenceStatus,
} from '../../domain/licensing/Licence.js';
import { verifyLicenceDocument } from '../../infrastructure/licensing/LicenceSigning.js';

export interface LicenceServiceOptions {
  /**
   * Without it this installation checks nothing and runs unlicensed. See
   * `LicencePublicKey.ts` for why that is the state of the repository itself.
   */
  publicKey?: string;
  /** A licence put next to the database; absent means only the installed one counts. */
  licenceFile?: string;
  /**
   * What an unlicensed installation may use. Defaults to every module, which is
   * what development, tests and the demo need.
   */
  unlicensedFeatures?: FeatureSet;
}

/** Only written when the clock moved on by more than this, to spare the disk. */
const CLOCK_WRITE_THRESHOLD_MS = 60_000;

/**
 * Decides what this installation may do: which modules, and whether transfers
 * may start at all.
 *
 * The status is held in memory because `FeatureSet` answers synchronously,
 * while reading the licence is not. It is refreshed at startup, before every
 * run, and on every scheduler tick, so an installation crosses the end of its
 * paid period without needing a restart.
 */
export class LicenceService {
  private status: LicenceStatus;

  constructor(
    private readonly state: InstallationStateRepository,
    private readonly options: LicenceServiceOptions = {}
  ) {
    // Known without reading anything: with no key there is nothing to check,
    // and with a key nothing is proven until a licence has been read.
    this.status = this.options.publicKey
      ? { state: 'MISSING', mayRun: false, problem: 'Es wurde noch keine Lizenz gelesen.' }
      : { state: 'UNLICENSED', mayRun: true };
  }

  /** The last known status. Synchronous, for everything that only reports. */
  current(): LicenceStatus {
    return this.status;
  }

  /**
   * A view that always asks the current status, so services that were handed a
   * `FeatureSet` once still see a licence installed later.
   */
  features(): FeatureSet {
    return {
      isEnabled: (feature) => this.featureSetNow().isEnabled(feature),
      enabled: () => this.featureSetNow().enabled(),
    };
  }

  /** Re-reads both sources and re-evaluates against the guarded clock. */
  async refresh(now: Date = new Date()): Promise<LicenceStatus> {
    const publicKey = this.options.publicKey;

    if (!publicKey) {
      this.status = { state: 'UNLICENSED', mayRun: true };
      return this.status;
    }

    const effectiveNow = await this.guardedNow(now);
    const candidates = await this.readCandidates(publicKey);

    if (candidates.problems.length > 0 && candidates.licences.length === 0) {
      this.status = {
        state: 'INVALID',
        mayRun: false,
        problem: candidates.problems[0],
      };

      return this.status;
    }

    if (candidates.licences.length === 0) {
      this.status = {
        state: 'MISSING',
        mayRun: false,
        problem: 'Für diese Installation ist keine Lizenz hinterlegt.',
      };

      return this.status;
    }

    // The one that reaches furthest wins. Renewing then works the same way
    // whichever route it took — a new file on the server or an upload in the
    // interface — and an older copy left lying around cannot shorten the period.
    const best = candidates.licences.reduce((longest, candidate) =>
      candidate.validUntil.getTime() > longest.validUntil.getTime() ? candidate : longest
    );

    this.status = evaluateLicence(best, effectiveNow);

    return this.status;
  }

  /**
   * Installs a licence handed in through the interface. It has to verify before
   * it is stored: a rejected licence must not be able to replace a working one.
   */
  async install(text: string, now: Date = new Date()): Promise<LicenceStatus> {
    const publicKey = this.options.publicKey;

    if (!publicKey) {
      throw new Error(
        'Diese Installation prüft keine Lizenzen. Sie läuft unlizenziert, eine Lizenz wäre wirkungslos.'
      );
    }

    // Throws with a readable reason for a forged signature or a broken file.
    const licence = verifyLicenceDocument(text, publicKey);
    const installed = evaluateLicence(licence, await this.guardedNow(now));

    if (installed.state === 'EXPIRED') {
      throw new Error(`${installed.problem ?? 'Diese Lizenz ist abgelaufen.'} Sie wurde nicht übernommen.`);
    }

    await this.state.set(INSTALLED_LICENCE, text.trim());

    return this.refresh(now);
  }

  /**
   * The one gate in front of every transfer. Refreshes first so that a licence
   * installed a minute ago takes effect without a restart, and an expiry that
   * happened while the process was running is noticed.
   */
  async assertMayRun(now: Date = new Date()): Promise<void> {
    const status = await this.refresh(now);

    if (!status.mayRun) {
      throw new LicenceExpiredError(status);
    }
  }

  private featureSetNow(): FeatureSet {
    if (this.status.state === 'UNLICENSED') {
      return this.options.unlicensedFeatures ?? allFeatures();
    }

    // An expired licence keeps its modules for what is only being looked at:
    // nothing runs anyway, and hiding a customer's own jobs from them the day
    // after an invoice was due helps nobody.
    return this.status.licence ? new StaticFeatureSet(this.status.licence.features) : noModules();
  }

  private async readCandidates(publicKey: string): Promise<{ licences: Licence[]; problems: string[] }> {
    const licences: Licence[] = [];
    const problems: string[] = [];

    for (const text of await this.licenceTexts()) {
      try {
        licences.push(verifyLicenceDocument(text, publicKey));
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { licences, problems };
  }

  private async licenceTexts(): Promise<string[]> {
    const texts: string[] = [];
    const installed = await this.state.get(INSTALLED_LICENCE);

    if (installed) {
      texts.push(installed);
    }

    if (this.options.licenceFile) {
      try {
        texts.push(await fs.readFile(this.options.licenceFile, 'utf8'));
      } catch {
        // No file is the normal case once a licence was installed through the
        // interface; an unreadable one is covered by the licence that is there.
      }
    }

    return texts;
  }

  /**
   * The clock, but never running backwards. An installation remembers the
   * furthest point in time it has seen, so setting the machine's clock back does
   * not revive an expired licence.
   *
   * The flip side is deliberate: a clock accidentally set far into the future
   * and corrected afterwards leaves the installation looking expired. That is
   * the fail-closed direction, and it is repaired by a new licence — while the
   * opposite would leave the period unenforceable.
   */
  private async guardedNow(now: Date): Promise<Date> {
    const stored = await this.state.get(CLOCK_HIGH_WATER);
    const seen = stored ? new Date(stored) : undefined;
    const valid = seen && !Number.isNaN(seen.getTime()) ? seen : undefined;

    if (!valid || now.getTime() > valid.getTime() + CLOCK_WRITE_THRESHOLD_MS) {
      await this.state.set(CLOCK_HIGH_WATER, now.toISOString());
    }

    return valid && valid.getTime() > now.getTime() ? valid : now;
  }
}
