import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { StabilityCheckConfig } from '../../domain/transfer/TransferJob.js';

/**
 * A single metadata measurement of a source file. `undefined` means the file
 * could not be measured any more (for example because it disappeared).
 */
export interface StabilityProbe {
  size?: number;
  lastModified?: Date;
}

export type StabilityProbeFn = (file: SourceFile) => Promise<StabilityProbe | undefined>;

export interface StabilityCheckResult {
  stable: boolean;
  performedChecks: number;
  message: string;
}

const defaultWait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Implements the mandatory stability check from spec sections 32-34: a file is
 * only considered stable once its metadata stayed identical across the
 * configured number of measurements. The probing itself is injected so the
 * service stays independent of the concrete protocol (spec section 20).
 */
export class FileStabilityService {
  constructor(private readonly wait: (milliseconds: number) => Promise<void> = defaultWait) {}

  async check(
    file: SourceFile,
    config: StabilityCheckConfig,
    probe: StabilityProbeFn
  ): Promise<StabilityCheckResult> {
    if (!config.enabled) {
      return { stable: true, performedChecks: 0, message: 'Die Stabilitätsprüfung ist für diesen Workflow ausgeschaltet' };
    }

    // The listing that discovered the file already counts as the first measurement.
    const requiredChecks = Math.max(config.requiredStableChecks, 2);
    let previous: StabilityProbe = { size: file.size, lastModified: file.lastModified };
    let performedChecks = 1;

    while (performedChecks < requiredChecks) {
      await this.wait(config.intervalSeconds * 1000);

      const current = await probe(file);
      if (!current) {
        return {
          stable: false,
          performedChecks,
          message: `${file.name} ist während der Stabilitätsprüfung aus der Quelle verschwunden`,
        };
      }

      performedChecks += 1;

      if (!this.isUnchanged(previous, current, config)) {
        return {
          stable: false,
          performedChecks,
          message: `${file.name} wird noch geschrieben — beim nächsten Lauf wird erneut geprüft`,
        };
      }

      previous = current;
    }

    return {
      stable: true,
      performedChecks,
      message: `${file.name} liegt stabil: ${performedChecks} übereinstimmende Messungen`,
    };
  }

  isUnchanged(previous: StabilityProbe, current: StabilityProbe, config: StabilityCheckConfig): boolean {
    if (config.compareSize && previous.size !== current.size) {
      return false;
    }

    if (config.compareLastModified) {
      const previousTime = previous.lastModified?.getTime();
      const currentTime = current.lastModified?.getTime();
      if (previousTime !== currentTime) {
        return false;
      }
    }

    return true;
  }
}
