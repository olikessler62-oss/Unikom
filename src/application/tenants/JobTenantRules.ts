import { isUsableBy, type CredentialRepository } from '../../domain/credentials/Credential.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import { assertWithinTenant, TenantBoundaryError } from '../../domain/tenants/TenantContainment.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * The rules that keep two clients apart. Checked when a job is saved so the
 * mistake surfaces while somebody is editing, and again where the capability is
 * created — the same two chokepoints licensing uses, for the same reason: a job
 * may have been saved before a directory was narrowed, or written straight into
 * the database.
 */
export async function assertJobStaysWithinItsTenant(
  job: TransferJob,
  tenants: TenantRepository,
  credentials: CredentialRepository
): Promise<void> {
  if (!job.tenantId) {
    throw new Error(`The job "${job.name}" has no client assigned`);
  }

  const tenant = await tenants.getById(job.tenantId);

  if (!tenant) {
    throw new Error(`The job "${job.name}" points at client ${job.tenantId}, which does not exist`);
  }

  // Only the destination is ours. The source lies on the client's own server or
  // in a directory they handed us, and is none of our boundary's business.
  assertWithinTenant(tenant, job.destinationDirectory, `The destination of job "${job.name}"`);

  await assertCredentialBelongsToTenant(job, tenants, credentials);
}

async function assertCredentialBelongsToTenant(
  job: TransferJob,
  tenants: TenantRepository,
  credentials: CredentialRepository
): Promise<void> {
  for (const [purpose, credentialId] of [
    ['source', job.credentialId],
    ['encryption', job.encryptionConfig.keyCredentialId],
  ] as const) {
    if (!credentialId) {
      continue;
    }

    const credential = await credentials.getById(credentialId);

    // A missing credential is reported where it is used, not here: it may be
    // created after the job, and refusing the job would be the wrong moment.
    if (!credential || isUsableBy(credential, job.tenantId)) {
      continue;
    }

    const owner = await tenants.getById(credential.tenantId!);

    throw new TenantBoundaryError(
      owner?.name ?? credential.tenantId!,
      `The ${purpose} credential "${credential.name}" belongs to client "${owner?.name ?? credential.tenantId}" ` +
        `and cannot be used by a job of another client.`
    );
  }
}
