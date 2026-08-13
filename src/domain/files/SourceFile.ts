export interface SourceFile {
  name: string;
  fullPath: string;
  size?: number;
  lastModified?: Date;
  isDirectory: boolean;
  metadata?: Record<string, unknown>;
}

export interface FileSelectionCriteria {
  filenamePrefix?: string;
  allowedExtensions: string[];
  caseSensitivePrefix: boolean;
  includeSubdirectories: boolean;
  minimumFileAgeSeconds: number;
  /**
   * Whether the job demands a stability check. The check itself needs repeated
   * measurements over time and therefore lives in FileStabilityService, not in
   * the stateless selection filter.
   */
  requireStableFile: boolean;
  /** Upload markers such as .part or .tmp that must never be picked up (spec section 37). */
  ignoredTemporaryExtensions?: string[];
}
