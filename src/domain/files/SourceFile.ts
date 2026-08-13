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
  requireStableFile: boolean;
}
