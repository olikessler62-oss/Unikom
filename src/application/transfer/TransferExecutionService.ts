import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import { FileSelectionService } from './FileSelectionService.js';

export class TransferExecutionService {
  constructor(
    private readonly fileSelectionService: FileSelectionService,
    private readonly sourceAdapter: SourceAdapter
  ) {}

  async execute(job: TransferJob): Promise<{ ok: boolean; processedFiles: SourceFile[]; message: string }> {
    const connectionTest = await this.sourceAdapter.testConnection();
    if (!connectionTest.ok) {
      return {
        ok: false,
        processedFiles: [],
        message: `Connection failed: ${connectionTest.message}`,
      };
    }

    const files = await this.sourceAdapter.listFiles(job.sourceDirectory, job.includeSubdirectories);
    const selectedFiles = files.filter((file) =>
      this.fileSelectionService.matches(file, {
        filenamePrefix: job.filenamePrefix,
        allowedExtensions: job.allowedExtensions,
        caseSensitivePrefix: job.caseSensitivePrefix,
        includeSubdirectories: job.includeSubdirectories,
        minimumFileAgeSeconds: job.minimumFileAgeSeconds,
        requireStableFile: job.stabilityCheck.enabled,
      })
    );

    return {
      ok: true,
      processedFiles: selectedFiles,
      message: `Found ${selectedFiles.length} matching files`,
    };
  }
}
