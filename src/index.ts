import { TransferExecutionService } from './application/transfer/TransferExecutionService.js';
import { FileSelectionService } from './application/transfer/FileSelectionService.js';
import { LocalSourceAdapter } from './infrastructure/sources/local/LocalSourceAdapter.js';
import type { TransferJob } from './domain/transfer/TransferJob.js';

const job: TransferJob = {
  id: 'job-demo-001',
  name: 'Demo Transfer Job',
  description: 'Initiales Beispiel gemäß Step 1',
  enabled: true,
  sourceType: 'LOCAL',
  sourceConfig: {
    type: 'LOCAL',
    directory: 'C:/Import',
    recursive: false,
  },
  sourceDirectory: 'C:/Import',
  includeSubdirectories: false,
  filenamePrefix: 'ORDER_',
  caseSensitivePrefix: false,
  allowedExtensions: ['csv', 'xml'],
  ignoredTemporaryExtensions: ['.part', '.tmp', '.temp'],
  minimumFileAgeSeconds: 60,
  stabilityCheck: {
    enabled: true,
    intervalSeconds: 5,
    requiredStableChecks: 2,
    compareSize: true,
    compareLastModified: true,
  },
  destinationDirectory: 'D:/Data/Incoming/CustomerA',
  createDestinationDirectory: true,
  conflictStrategy: 'SKIP',
  encryptionConfig: {
    enabled: false,
    provider: 'NONE',
    keyCredentialId: undefined,
  },
  sourceSuccessAction: 'KEEP',
  executionMode: 'MANUAL_AND_AUTOMATIC',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const selectionService = new FileSelectionService();
const sourceAdapter = new LocalSourceAdapter();
const executionService = new TransferExecutionService(selectionService, sourceAdapter);

console.log('UNikom initialized');
console.log('Demo Job:', job.name);
console.log('Execution mode:', job.executionMode);
console.log('Execution service ready:', typeof executionService.execute);
