'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sodium = require('libsodium-wrappers');
const wire = require('../packages/crypto/wire');
const keys = require('../packages/crypto/keys');
const { EphemeralRelay } = require('../packages/relay/relay');

async function putOne(relay, plaintext, ttlHours = 24) {
  const readerKey = Buffer.from(sodium.randombytes_buf(32));
  const { envelope, blobId } = wire.encryptBlob(plaintext, readerKey);
  const rc = keys.readCap(readerKey, blobId);
  const dc = keys.deleteCap(readerKey, blobId);
  const res = relay.put(blobId.toString('hex'), envelope, { readCap: rc, deleteCap: dc, ttlHours });
  return { envelope, blobId, readerKey, rc, dc, res };
}

test('relay: PUT valid -> 201, GET valid cap -> 200, wrong cap -> 403', async () => {
  await sodium.ready; await wire.ready(); await keys.ready();
  const relay = new EphemeralRelay();
  const { envelope, blobId, rc } = await putOne(relay, Buffer.from('hello'));
  const got = relay.get(blobId.toString('hex'), rc);
  assert.deepEqual(Buffer.from(got), Buffer.from(envelope));
  assert.throws(() => relay.get(blobId.toString('hex'), Buffer.alloc(32, 9)), /forbidden/);
});

test('relay: PUT bad hash -> 400, oversize/TTL -> 400', async () => {
  await sodium.ready; await wire.ready(); await keys.ready();
  const relay = new EphemeralRelay();
  const readerKey = Buffer.from(sodium.randombytes_buf(32));
  const { envelope, blobId } = wire.encryptBlob(Buffer.from('x'), readerKey);
  const rc = keys.readCap(readerKey, blobId);
  const dc = keys.deleteCap(readerKey, blobId);
  assert.throws(() => relay.put('ff'.repeat(32), envelope, { readCap: rc, deleteCap: dc }), /blob_id path/);
  assert.throws(() => relay.put(blobId.toString('hex'), envelope, { readCap: rc, deleteCap: dc, ttlHours: 99 }), /TTL/);
  assert.throws(() => relay.put(blobId.toString('hex'), envelope, { readCap: null, deleteCap: dc }), /capability/);
});

test('relay: DELETE zeroizes + 404 after, metrics only counters', async () => {
  await sodium.ready; await wire.ready(); await keys.ready();
  const relay = new EphemeralRelay();
  const { blobId, rc, dc } = await putOne(relay, Buffer.from('wipe me'));
  const before = relay.metrics();
  assert.equal(before.blobs_live, 1);
  assert.ok(!('ids' in before) && !('caps' in before));
  relay.del(blobId.toString('hex'), dc);
  assert.throws(() => relay.get(blobId.toString('hex'), rc), /not found/);
  const after = relay.metrics();
  assert.equal(after.blobs_live, 0);
  assert.equal(after.deletes, 1);
});

test('relay: expired blob -> 404 + eviction counter', async () => {
  await sodium.ready; await wire.ready(); await keys.ready();
  const relay = new EphemeralRelay();
  const { blobId, rc } = await putOne(relay, Buffer.from('short lived'), 1);
  // force expiry
  const entry = relay.store.get(blobId.toString('hex'));
  entry.expiry = Date.now() - 1;
  assert.throws(() => relay.get(blobId.toString('hex'), rc), /not found/);
  assert.equal(relay.metrics().evictions, 1);
});
