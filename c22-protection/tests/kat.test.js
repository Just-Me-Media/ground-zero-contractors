'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sodium = require('libsodium-wrappers');
const wire = require('../packages/crypto/wire');
const keys = require('../packages/crypto/keys');
const manifest = require('../packages/crypto/manifest');

test('wire: envelope length formula Len=61+N*65536+16', async () => {
  await wire.ready();
  for (const plainLen of [0, 1, 65535, 65536, 100000]) {
    const key = Buffer.from(sodium.randombytes_buf(32));
    const { envelope, n } = wire.encryptBlob(Buffer.alloc(plainLen, 0x41), key);
    assert.equal(envelope.length, wire.envelopeLen(n));
    assert.equal(envelope.length, 61 + n * 65536 + 16);
    assert.ok(n >= 1 && n <= 64);
  }
});

test('wire: round-trip + tamper rejection (magic/hash)', async () => {
  await wire.ready();
  const key = Buffer.from(sodium.randombytes_buf(32));
  const msg = Buffer.from('sensitive production log entry #42', 'utf8');
  const { envelope } = wire.encryptBlob(msg, key);
  assert.deepEqual(Buffer.from(wire.decryptBlob(envelope, key)), msg);
  const bad = Buffer.from(envelope);
  bad[bad.length - 1] ^= 0x01; // flip ciphertext bit -> hash mismatch
  assert.throws(() => wire.decodeEnvelope(bad), /BLAKE2b mismatch/);
  const badMagic = Buffer.from(envelope);
  badMagic.writeUInt32BE(0xdeadbeef, 0);
  assert.throws(() => wire.decodeEnvelope(badMagic), /bad magic/);
});

test('wire: 0x80 padding edge (exact block grows)', async () => {
  await wire.ready();
  const key = Buffer.from(sodium.randombytes_buf(32));
  const { n } = wire.encryptBlob(Buffer.alloc(65536, 0x42), key);
  assert.equal(n, 2); // 0x80 forces next block
});

test('keys: KDF determinism + domain separation', async () => {
  await keys.ready();
  const root = Buffer.from(sodium.randombytes_buf(32));
  assert.deepEqual(keys.manifestKey(root), keys.manifestKey(root));
  assert.notDeepEqual(keys.manifestKey(root), keys.chunkKey(root, 0));
  assert.notDeepEqual(keys.chunkKey(root, 0), keys.chunkKey(root, 1));
  const blobId = Buffer.from(sodium.randombytes_buf(32));
  assert.deepEqual(keys.readCap(root, blobId), keys.readCap(root, blobId));
  assert.notDeepEqual(keys.readCap(root, blobId), keys.deleteCap(root, blobId));
});

test('slip39: pure 2-of-3 recover, 1 share fails', async () => {
  await keys.ready();
  const entropy = Buffer.from(sodium.randombytes_buf(32));
  const { shares } = keys.generateShares256(entropy);
  assert.equal(shares.length, 3);
  for (const s of shares) assert.ok(s.trim().split(/\s+/).length >= 20);
  const rec = keys.combineShares([shares[0], shares[2]]);
  assert.deepEqual(rec, entropy);
  const rec2 = keys.combineShares([shares[1], shares[2]]);
  assert.deepEqual(rec2, entropy);
  assert.throws(() => keys.combineShares([shares[0]]), /at least 2 shares/);
});

test('manifest: build -> encrypt -> decrypt preserves index', async () => {
  await wire.ready(); await keys.ready();
  const root = keys.randomRootSecret();
  const mKey = keys.manifestKey(root);
  const c0 = keys.chunkKey(root, 0);
  const c1 = keys.chunkKey(root, 1);
  // fake chunk blobs to get ids
  const e0 = wire.encryptBlob(Buffer.from('chunk0'), c0);
  const e1 = wire.encryptBlob(Buffer.from('chunk1-data'), c1);
  const obj = manifest.buildManifestObject({
    fileName: 'sensitive_document.pdf', mimeType: 'application/pdf',
    totalBytes: 1249280, fileBlake2bHex: 'ab'.repeat(32),
    chunks: [
      { idx: 0, blobId: e0.blobId, readerKey: c0 },
      { idx: 1, blobId: e1.blobId, readerKey: c1 },
    ],
  });
  const { envelope } = manifest.encryptManifest(obj, mKey);
  const back = manifest.decryptManifest(envelope, mKey);
  assert.equal(back.file_name, 'sensitive_document.pdf');
  assert.equal(back.chunks.length, 2);
  assert.equal(back.chunk_size, 65536);
});
