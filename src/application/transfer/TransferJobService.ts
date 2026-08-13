import { allFeatures, type Feature, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { assertJobIsLicensed, requiredFeaturesFor } from '../licensing/JobLicensing.js';

/**
 * The way in for everything that creates or changes jobs: job editor, API, CLI
 * and imports. It is the first of the two places where licensing is enforced,
 * so writing to the repository directly bypasses that check — worth keeping
 * that path to tests and fixtures.
 */
export class TransferJobService {
  constructor(
    private readonly repository: TransferJobRepository,
    private readonly features: FeatureSet = allFeatures()
  ) {}

  async getAll(): Promise<TransferJob[]> {
    return this.repository.list();
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return this.repository.getById(id);
  }

  async create(job: TransferJob): Promise<TransferJob> {
    assertJobIsLicensed(job, this.features);
    return this.repository.save(job);
  }

  async update(id: string, patch: Partial<TransferJob>): Promise<TransferJob | undefined> {
    const existing = await this.repository.getById(id);
    if (!existing) {
      return undefined;
    }

    const updated: TransferJob = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };

    // The merged job is what gets checked, not the patch: switching a local
    // job over to SFTP arrives here as a change to two unremarkable fields.
    assertJobIsLicensed(updated, this.features);

    return this.repository.save(updated);
  }

  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  /**
   * Jobs that exist but can no longer run because their module is missing.
   * A downgraded licence must not silently turn nightly transfers into
   * nothing — the overview has to be able to name them.
   */
  async listUnlicensed(): Promise<{ job: TransferJob; missing: Feature[] }[]> {
    const jobs = await this.repository.list();

    return jobs
      .map((job) => ({
        job,
        missing: requiredFeaturesFor(job).filter((feature) => !this.features.isEnabled(feature)),
      }))
      .filter((entry) => entry.missing.length > 0);
  }
}
