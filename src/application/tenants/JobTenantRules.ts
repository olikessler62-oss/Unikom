import { isUsableBy, type CredentialRepository } from '../../domain/credentials/Credential.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import { assertWithinTenant, TenantBoundaryError } from '../../domain/tenants/TenantContainment.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { outputDirectories, transfers, STAGE_LABELS } from '../../domain/transfer/WorkflowStages.js';

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
    throw new Error(`Dem Workflow „${job.name}“ ist kein Mandant zugeordnet`);
  }

  const tenant = await tenants.getById(job.tenantId);

  if (!tenant) {
    throw new Error(`Der Workflow „${job.name}“ verweist auf den Mandanten ${job.tenantId}, den es nicht gibt`);
  }

  // Only what we write is ours. A source lies on the client's own server or in a
  // directory they handed us, and is none of our boundary's business.
  //
  // Every switched-on link is asked, not just the transfer: consolidation and
  // conversion put files down as well, and a workflow may consist of nothing
  // else. Checking only the transfer destination would leave a door open exactly
  // for the customer who never transfers.
  if (transfers(job)) {
    assertWithinTenant(tenant, job.destinationDirectory, `Das Ziel des Workflows „${job.name}“`);
  }

  for (const { stage, directory } of outputDirectories(job)) {
    assertWithinTenant(tenant, directory, `Das Ziel von „${STAGE_LABELS[stage]}“ im Workflow „${job.name}“`);
  }

  await assertCredentialBelongsToTenant(job, tenants, credentials);
}

async function assertCredentialBelongsToTenant(
  job: TransferJob,
  tenants: TenantRepository,
  credentials: CredentialRepository
): Promise<void> {
  for (const [purpose, credentialId] of [
    ['Der Zugang zur Quelle', job.credentialId],
    ['Der Schlüssel', job.encryptionConfig.keyCredentialId],
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
      `${purpose} „${credential.name}“ gehört dem Mandanten „${owner?.name ?? credential.tenantId}“ ` +
        'und darf nicht im Workflow eines anderen Mandanten verwendet werden.'
    );
  }
}
