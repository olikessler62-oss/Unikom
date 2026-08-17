import test from 'node:test';
import assert from 'node:assert/strict';

import { RemotePathError, RemotePathResolver } from './RemotePathResolver.js';

/**
 * The acceptance criteria of the remote path spec, one by one.
 *
 * Written around the two things that must hold at once: every spelling an
 * operator might use has to arrive at the same directory, and no spelling may
 * arrive outside the one the connection was given.
 */

const atRoot = new RemotePathResolver();
const atCustomer = new RemotePathResolver('/customer123');

test('every spelling of the same directory resolves to the same path', () => {
  const spellings = [
    'orders/incoming',
    '/orders/incoming',
    '\\orders\\incoming',
    '/orders/incoming/',
    'orders//incoming',
    '  orders/incoming  ',
    './orders/./incoming',
  ];

  for (const spelling of spellings) {
    assert.equal(atRoot.resolve(spelling), '/orders/incoming', `at the root: ${JSON.stringify(spelling)}`);
    assert.equal(
      atCustomer.resolve(spelling),
      '/customer123/orders/incoming',
      `below a working directory: ${JSON.stringify(spelling)}`
    );
  }
});

test('a relative path is read from the working directory, so the server root stays unknown', () => {
  assert.equal(atCustomer.resolve('orders/incoming'), '/customer123/orders/incoming');
  assert.equal(atCustomer.workingDirectory, '/customer123');
});

test('nothing, a dot and a slash all mean the working directory itself', () => {
  for (const nothing of ['', '   ', '.', '/', '\\', './']) {
    assert.equal(atCustomer.resolve(nothing), '/customer123', JSON.stringify(nothing));
    assert.equal(atRoot.resolve(nothing), '/', JSON.stringify(nothing));
  }
});

test('a path that already carries the working directory is not stacked on it twice', () => {
  // What somebody pastes back out of the directory browser, which shows server
  // paths. Resolving it again must not give /customer123/customer123/orders.
  assert.equal(atCustomer.resolve('/customer123/orders/incoming'), '/customer123/orders/incoming');
});

test('.. walks inside the allowed area', () => {
  assert.equal(atCustomer.resolve('orders/../incoming'), '/customer123/incoming');
  assert.equal(atCustomer.resolve('orders/incoming/..'), '/customer123/orders');
});

test('.. cannot be used to leave the allowed area', () => {
  for (const attempt of ['..', '../othercustomer', '../../othercustomer', 'orders/../../othercustomer', '..\\..\\x']) {
    assert.throws(() => atCustomer.resolve(attempt), RemotePathError, JSON.stringify(attempt));
  }
});

test('an absolute path cannot walk out either', () => {
  // The walk starts inside, so the segment counter alone would not catch it.
  assert.throws(() => atCustomer.resolve('/customer123/../othercustomer'), RemotePathError);
});

test('containment is decided on segments, not on characters', () => {
  // The trap the spec names: /customer1234 is a different customer, and text
  // comparison would wave it through.
  assert.equal(atCustomer.contains('/customer123/orders'), true);
  assert.equal(atCustomer.contains('/customer123'), true);
  assert.equal(atCustomer.contains('/customer1234'), false);
  assert.equal(atCustomer.contains('/customer1234/orders'), false);
  assert.equal(atCustomer.contains('/othercustomer'), false);
});

test('at the root everything is contained, because nothing was ruled out', () => {
  assert.equal(atRoot.contains('/anything/at/all'), true);
  assert.equal(atRoot.workingDirectory, '/');
});

test('a working directory is normalised the same way a path is', () => {
  for (const spelling of ['/customer123', 'customer123', '\\customer123\\', ' /customer123/ ', '//customer123']) {
    assert.equal(new RemotePathResolver(spelling).workingDirectory, '/customer123', JSON.stringify(spelling));
  }
});

test('a working directory that walks above its own root is refused', () => {
  assert.throws(() => new RemotePathResolver('/customer123/../..'), RemotePathError);
});

test('the relative form is what the browser writes back into the field', () => {
  assert.equal(atCustomer.relative('/customer123/orders/incoming'), 'orders/incoming');
  assert.equal(atCustomer.relative('/customer123'), '');
  assert.equal(atRoot.relative('/orders/incoming'), 'orders/incoming');
});

test('joining an entry of a listing needs no path arithmetic in the adapters', () => {
  assert.equal(atCustomer.join('/customer123/orders', 'incoming'), '/customer123/orders/incoming');
  assert.equal(atCustomer.join('/', 'orders'), '/orders');
});

test('an entry name that carries a path is refused rather than followed', () => {
  assert.throws(() => atCustomer.join('/customer123', '../othercustomer'), RemotePathError);
  assert.throws(() => atCustomer.join('/customer123', 'a/b'), RemotePathError);
});

test('walking up stops at the working directory', () => {
  assert.equal(atCustomer.parentOf('/customer123/orders/incoming'), '/customer123/orders');
  assert.equal(atCustomer.parentOf('/customer123/orders'), '/customer123');
  assert.equal(atCustomer.parentOf('/customer123'), '/customer123');
  assert.equal(atRoot.parentOf('/'), '/');
});

/*
 * Doubled directories, from the field: servers carry the customer number twice
 * (/customer123/customer123) and subdirectories repeat their own name
 * (orders/orders). Both readings of such an input are legitimate, and the
 * resolver must offer both rather than pick one quietly.
 */
test('an input that begins with the working directory has two readings', () => {
  assert.deepEqual(atCustomer.candidates('/customer123/orders'), [
    '/customer123/orders',
    '/customer123/customer123/orders',
  ]);
});

test('the first reading is the one a scheduled run follows', () => {
  const [first] = atCustomer.candidates('/customer123/orders');

  assert.equal(first, atCustomer.resolve('/customer123/orders'));
});

test('a relative input has exactly one reading', () => {
  assert.deepEqual(atCustomer.candidates('orders/incoming'), ['/customer123/orders/incoming']);
  assert.deepEqual(atCustomer.candidates('customer123/orders'), ['/customer123/customer123/orders']);
});

test('without a working directory nothing is ambiguous', () => {
  assert.deepEqual(atRoot.candidates('/orders/incoming'), ['/orders/incoming']);
});

test('a doubled subdirectory is not ambiguous — it is simply a path', () => {
  assert.equal(atCustomer.resolve('orders/orders/incoming'), '/customer123/orders/orders/incoming');
  assert.deepEqual(atCustomer.candidates('orders/orders'), ['/customer123/orders/orders']);
});
