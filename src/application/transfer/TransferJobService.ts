import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import { allFeatures, type Feature, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { assertJobIsLicensed, requiredFeaturesFor } from '../licensing/JobLicensing.js';
import { assertJobStaysWithinItsTenant } from '../tenants/JobTenantRules.js';

/**
 * The way in for everything that creates or changes jobs: job editor, API, CLI
 * and imports. It is the first of the two places where licensing is enforced,
 * so writing to the repository directly bypasses that check — worth keeping
 * that path to tests and fixtures.
 */
export class TransferJobService {
  constructor(
    private readonly repository: TransferJobRepository,
    private readonly features: FeatureSet = allFeatures(),
    /** Absent in tests that do not care about clients. */
    private readonly tenants?: TenantRepository,
    private readonly credentials?: CredentialRepository
  ) {}

  async getAll(): Promise<TransferJob[]> {
    return this.repository.list();
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return this.repository.getById(id);
  }

  async create(job: TransferJob): Promise<TransferJob> {
    assertJobIsLicensed(job, this.features);
    await this.assertTenantRules(job);

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
    // job over to SFTP arrives here as a change to two unremarkable fields,
    // and so does moving a destination out of a client's directory.
    assertJobIsLicensed(updated, this.features);
    await this.assertTenantRules(updated);

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
  private async assertTenantRules(job: TransferJob): Promise<void> {
    if (this.tenants && this.credentials) {
      await assertJobStaysWithinItsTenant(job, this.tenants, this.credentials);
    }
  }

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
