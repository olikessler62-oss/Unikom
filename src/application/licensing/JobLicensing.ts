import {
  FeatureNotLicensedError,
  type Feature,
  type FeatureSet,
} from '../../domain/licensing/Feature.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

/**
 * Which modules a job needs in order to run. A job with a local source and
 * without encryption needs none — that is the base product.
 */
export function requiredFeaturesFor(job: TransferJob): Feature[] {
  const required: Feature[] = [];

  if (job.sourceType === 'SFTP' || job.sourceType === 'FTPS') {
    required.push('REMOTE_SOURCES');
  }

  if (job.encryptionConfig.enabled && job.encryptionConfig.provider !== 'NONE') {
    required.push('ENCRYPTION');
  }

  return required;
}

/**
 * First of the two places where licensing is enforced: saving a job. Failing
 * here means the user finds out while editing, with a message naming the
 * module — instead of at three in the morning when the schedule fires.
 *
 * This check alone is not enough. It runs against the job as it is being saved,
 * and a job may well have been created while a module was still licensed. The
 * second check therefore sits where the capability is actually created, and
 * that one is the one that has to hold.
 */
export function assertJobIsLicensed(job: TransferJob, features: FeatureSet): void {
  for (const feature of requiredFeaturesFor(job)) {
    if (!features.isEnabled(feature)) {
      throw new FeatureNotLicensedError(feature, `The job "${job.name}"`);
    }
  }
}
