import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RETRY_CONFIG, RetryPolicy, isTransientError } from './RetryPolicy.js';

function errorWith(message: string, code?: string | number): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code });
}

/** Records the delays instead of waiting them out. */
function recordingPolicy(config = DEFAULT_RETRY_CONFIG) {
  const waited: number[] = [];
  const policy = new RetryPolicy(config, async (milliseconds) => {
    waited.push(milliseconds);
  });

  return { policy, waited };
}

test('a successful operation runs exactly once', async () => {
  const { policy } = recordingPolicy();
  let calls = 0;

  const result = await policy.run(async () => {
    calls += 1;
    return 'done';
  });

  assert.equal(result, 'done');
  assert.equal(calls, 1);
});

test('a temporary failure is repeated until it succeeds', async () => {
  const { policy, waited } = recordingPolicy();
  let calls = 0;

  const result = await policy.run(async () => {
    calls += 1;
    if (calls < 3) {
      throw errorWith('socket hang up', 'ECONNRESET');
    }
    return 'done';
  });

  assert.equal(result, 'done');
  assert.equal(calls, 3);
  assert.deepEqual(waited, [5_000, 15_000], 'the configured delays from spec section 65');
});

test('a permanently failing operation stops after the configured attempts', async () => {
  const { policy } = recordingPolicy();
  let calls = 0;

  await assert.rejects(
    () =>
      policy.run(async () => {
        calls += 1;
        throw errorWith('connection reset by peer', 'ECONNRESET');
      }),
    /connection reset/
  );

  assert.equal(calls, 3);
});

test('a permanent error is never repeated', async () => {
  const { policy } = recordingPolicy();
  let calls = 0;

  await assert.rejects(
    () =>
      policy.run(async () => {
        calls += 1;
        throw new Error('All configured authentication methods failed');
      }),
    /authentication/
  );

  assert.equal(calls, 1, 'a wrong password will not become right by asking again');
});

test('the retry callback reports what is about to happen', async () => {
  const { policy } = recordingPolicy();
  const seen: string[] = [];
  let calls = 0;

  await policy.run(
    async () => {
      calls += 1;
      if (calls < 2) {
        throw errorWith('Timeout (control socket)');
      }
      return 'done';
    },
    ({ attempt, delaySeconds }) => seen.push(`attempt ${attempt} waits ${delaySeconds}s`)
  );

  assert.deepEqual(seen, ['attempt 1 waits 5s']);
});

test('network faults count as temporary', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']) {
    assert.equal(isTransientError(errorWith('network trouble', code)), true, code);
  }

  assert.equal(isTransientError(new Error('Timeout while waiting for handshake')), true);
  assert.equal(isTransientError(new Error('Service not available, closing control connection')), true);
});

test('configuration and authentication faults count as permanent', () => {
  const permanent = [
    'All configured authentication methods failed',
    'Permission denied (publickey,password)',
    'The SSH host key of example.com does not match the configured fingerprint',
    'self-signed certificate in certificate chain',
    'Rejected unsafe filename "../x": the name contains a path separator',
    'The credential abc does not exist',
  ];

  for (const message of permanent) {
    assert.equal(isTransientError(new Error(message)), false, message);
  }
});

test('FTP reply codes are classified by their first digit', () => {
  // 4xx is a temporary negative reply, 5xx a permanent one.
  assert.equal(isTransientError(errorWith('421 Service not available', 421)), true);
  assert.equal(isTransientError(errorWith('425 Cannot open data connection', 425)), true);
  assert.equal(isTransientError(errorWith('530 Not logged in', 530)), false);
  assert.equal(isTransientError(errorWith('550 No such file', 550)), false);
});

test('an unknown error is not repeated', () => {
  // Hammering a server over a fault we do not understand is the worse default.
  assert.equal(isTransientError(new Error('something unexpected happened')), false);
  assert.equal(isTransientError('a plain string'), false);
});

test('a single attempt configuration disables retrying', async () => {
  const { policy } = recordingPolicy({ attempts: 1, delaysSeconds: [] });
  let calls = 0;

  await assert.rejects(() =>
    policy.run(async () => {
      calls += 1;
      throw errorWith('socket hang up', 'ECONNRESET');
    })
  );

  assert.equal(calls, 1);
});
