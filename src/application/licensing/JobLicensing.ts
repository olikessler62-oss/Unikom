import {
  FeatureNotLicensedError,
  type Feature,
  type FeatureSet,
} from '../../domain/licensing/Feature.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { activeStages, eineGenuegt, stageFeatures } from '../../domain/transfer/WorkflowStages.js';

/**
 * Which modules a job needs in order to run. A job with a local source and
 * without encryption needs none — that is the base product.
 */
export function requiredFeaturesFor(job: TransferJob): Feature[] {
  const required: Feature[] = [];

  if (job.sourceType === 'SFTP' || job.sourceType === 'FTPS') {
    required.push('REMOTE_SOURCES');
  }

  // Ein entferntes Ziel verlangt dasselbe Modul wie eine entfernte Quelle: Es
  // ist dieselbe Verbindung, in die andere Richtung gelesen. Ohne diese Zeile
  // stünde der Workflow in der Liste als lauffähig und würde erst beim Start
  // abgewiesen — die Auskunft käme dann von der Uhrzeit, nicht vom Editor.
  if (
    (job.destinationType === 'SFTP' || job.destinationType === 'FTPS') &&
    !required.includes('REMOTE_SOURCES')
  ) {
    required.push('REMOTE_SOURCES');
  }

  if (job.encryptionConfig.enabled && job.encryptionConfig.provider !== 'NONE') {
    required.push('ENCRYPTION');
  }

  // Opening what the source delivered locked is the same module as locking it:
  // it is the same cipher, read in the other direction.
  if (job.sourceEncryption?.enabled && !required.includes('ENCRYPTION')) {
    required.push('ENCRYPTION');
  }

  /*
   * Jedes eingeschaltete Glied verlangt sein eigenes Modul und nur seins. Zwei
   * Glieder desselben Workflows teilen sich keine Lizenz: Wer die Konvertierung
   * gekauft hat, bekommt den Import nicht dazu.
   *
   * Beim Ausliefern hängt das Modul am **Zweig** und nicht am Glied: in eine
   * Datenbank verlangt „Daten importieren", ein konvertierter Export „Daten
   * konvertieren". Ein unveränderter Export verlangt eines von beiden — dort
   * steht die Liste für „irgendeine Hälfte von Modul 3", und `eineGenuegt`
   * sagt der Prüfung, dass sie nicht alle verlangen darf.
   */
  for (const stage of activeStages(job)) {
    if (eineGenuegt(stage, job)) {
      continue;
    }

    for (const feature of stageFeatures(stage, job)) {
      if (!required.includes(feature)) {
        required.push(feature);
      }
    }
  }

  return required;
}

/**
 * Die Glieder, bei denen eines von mehreren Modulen genügt.
 *
 * Getrennt von `requiredFeaturesFor`, weil „alle davon" und „eines davon"
 * verschiedene Prüfungen sind. In eine Liste geworfen würde aus dem Oder ein
 * Und, und ein Kunde mit nur einer Hälfte von Modul 3 könnte nichts mehr
 * ausliefern.
 */
export function alternativeFeaturesFor(job: TransferJob): Feature[][] {
  return activeStages(job)
    .filter((stage) => eineGenuegt(stage, job))
    .map((stage) => stageFeatures(stage, job));
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

  for (const auswahl of alternativeFeaturesFor(job)) {
    if (!auswahl.some((feature) => features.isEnabled(feature))) {
      throw new FeatureNotLicensedError(auswahl[0], `The job "${job.name}"`);
    }
  }
}
