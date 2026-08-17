/**
 * What should happen to a transfer while it is running.
 *
 * Pausing and cancelling take effect **between two files**, never inside one. A
 * half-written file must not appear in the destination — the same promise the
 * staging area and the encryption already carry: what lies in the destination is
 * complete, or it is not there at all.
 *
 * The price is visible: with one very large file it takes until that file is
 * done. That is the right price.
 */
export type RunControlState = 'RUNNING' | 'PAUSED' | 'CANCELLED';

export interface RunControl {
  /**
   * Asked before every file. Waits while the run is paused and returns `false`
   * once it was cancelled — from then on the run touches no further file.
   */
  beforeFile(): Promise<boolean>;
  state(): RunControlState;
}
