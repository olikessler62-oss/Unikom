import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositeLogger, LevelFilteredLogger, RecordingLogger } from './Loggers.js';
import { combineEventListeners, createTransferEventLogger, levelOf } from './TransferEventLogger.js';
import { ConsoleLogger, formatLogEntry } from '../../infrastructure/logging/ConsoleLogger.js';
import { isAtLeast, type LogEntry, type LogLevel } from '../../domain/logging/LogEntry.js';
import type { TransferEvent } from '../transfer/TransferEvents.js';

function entry(level: LogLevel, message = 'something happened'): LogEntry {
  return { timestamp: new Date('2026-08-13T06:45:00.000Z'), level, message };
}

test('levels are ordered from DEBUG to ERROR', () => {
  assert.equal(isAtLeast('ERROR', 'DEBUG'), true);
  assert.equal(isAtLeast('INFO', 'INFO'), true);
  assert.equal(isAtLeast('DEBUG', 'INFO'), false);
  assert.equal(isAtLeast('WARNING', 'ERROR'), false);
});

test('the default level hides DEBUG but keeps everything else', () => {
  const recorder = new RecordingLogger();
  const logger = new LevelFilteredLogger(recorder);

  for (const level of ['DEBUG', 'INFO', 'WARNING', 'ERROR'] as LogLevel[]) {
    logger.log(entry(level));
  }

  assert.deepEqual(
    recorder.entries.map((recorded) => recorded.level),
    ['INFO', 'WARNING', 'ERROR']
  );
});

test('the level can be lowered for troubleshooting', () => {
  const recorder = new RecordingLogger();
  new LevelFilteredLogger(recorder, 'DEBUG').log(entry('DEBUG'));

  assert.equal(recorder.entries.length, 1);
});

test('a failing log target does not silence the others', () => {
  const working = new RecordingLogger();
  const broken = {
    log() {
      throw new Error('disk full');
    },
  };

  const logger = new CompositeLogger(broken, working);
  logger.log(entry('ERROR'));

  assert.equal(working.entries.length, 1, 'logging must never break the run it describes');
});

test('pipeline events carry a sensible severity', () => {
  assert.equal(levelOf('TRANSFER_RUN_STARTED'), 'INFO');
  assert.equal(levelOf('STEP_1_COMPLETED'), 'INFO');
  // Noisy per-file bookkeeping stays out of a production log.
  assert.equal(levelOf('FILE_DISCOVERED'), 'DEBUG');
  assert.equal(levelOf('FILE_SELECTED'), 'DEBUG');
  // A retry means the run is still healthy; only a real failure is an error.
  assert.equal(levelOf('FILE_RETRYING'), 'WARNING');
  assert.equal(levelOf('FILE_FAILED'), 'ERROR');
});

test('an event becomes a log entry with its origin attached', () => {
  const recorder = new RecordingLogger();
  const listener = createTransferEventLogger(recorder, () => new Date('2026-08-13T06:45:10.000Z'));

  const event: TransferEvent = {
    name: 'FILE_STORED',
    runId: 'TR-1',
    jobId: 'job-1',
    filename: 'ORDER_001.csv',
    message: 'File stored successfully',
    details: { destinationFilename: 'ORDER_001.csv' },
  };

  listener(event);
  const [logged] = recorder.entries;

  assert.equal(logged.level, 'INFO');
  assert.equal(logged.runId, 'TR-1');
  assert.equal(logged.jobId, 'job-1');
  assert.equal(logged.filename, 'ORDER_001.csv');
  assert.equal(logged.timestamp.toISOString(), '2026-08-13T06:45:10.000Z');
  assert.deepEqual(logged.context, { destinationFilename: 'ORDER_001.csv' });
});

test('several listeners each see the event, even if one throws', () => {
  const first: TransferEvent[] = [];
  const second: TransferEvent[] = [];

  const listener = combineEventListeners(
    () => {
      throw new Error('listener exploded');
    },
    (event) => first.push(event),
    undefined,
    (event) => second.push(event)
  );

  listener({ name: 'TRANSFER_RUN_STARTED', runId: 'TR-1', jobId: 'job-1', message: 'started' });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});

test('a log line reads like the transfer log from the spec', () => {
  const line = formatLogEntry({
    timestamp: new Date('2026-08-13T06:45:08.000Z'),
    level: 'INFO',
    filename: 'ORDER_001.csv',
    message: 'Download completed',
  });

  assert.equal(line, '2026-08-13 06:45:08  INFO     ORDER_001.csv  Download completed');
});

test('errors go to the error stream, everything else to standard output', () => {
  const standard: string[] = [];
  const errors: string[] = [];
  const logger = new ConsoleLogger({
    log: (line) => standard.push(line),
    error: (line) => errors.push(line),
  });

  logger.log(entry('INFO', 'Job started'));
  logger.log(entry('WARNING', 'Retrying in 5s'));
  logger.log(entry('ERROR', 'Download failed'));

  assert.equal(standard.length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Download failed/);
});
