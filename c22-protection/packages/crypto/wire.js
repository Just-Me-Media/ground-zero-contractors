'use strict';
/**
 * Wire envelope: magic 4B | ver 1B | blake2b-256(ciphertext) 32B | nonce 24B | ciphertext+16B tag
 * Locked: Len = 61 + (N x 65536) + 16, 1 <= N <= 64
 */
const sodium = require('libsodium-wrappers');

const MAGIC = 0x43323250; // 'C22P'
const VERSION = 0x01;
const HEADER_LEN = 61; // 4 + 1 + 32 + 24
const CHUNK = 65536;
const TAG_LEN = 16;
const MAX_N = 64;

async function ready() {
  await sodium.ready;
}

function envelopeLen(n) {
  return HEADER_LEN + n * CHUNK + TAG_LEN;
}

function numChunksForPlaintext(plainLen) {
  // 0x80 padding always adds >=1 byte, so even exact multiples grow by one block
  return Math.floor(plainLen / CHUNK) + 1;
}

/** 0x80 + zero pad to multiple of 64KB */
function pad80(data) {
  const buf = Buffer.from(data);
  const n = numChunksForPlaintext(buf.length);
  const out = Buffer.alloc(n * CHUNK, 0x00);
  buf.copy(out, 0);
  out[buf.length] = 0x80;
  return { padded: out, n };
}

function unpad80(padded) {
  const buf = Buffer.from(padded);
  let i = buf.length - 1;
  while (i >= 0 && buf[i] === 0x00) i--;
  if (i < 0 || buf[i] !== 0x80) throw new Error('invalid 0x80 padding');
  return buf.subarray(0, i);
}

function blake2b32(data) {
  return Buffer.from(sodium.crypto_generichash(32, Buffer.from(data)));
}

/** Encrypt arbitrary plaintext -> envelope Buffer (random 24B nonce, per-blob key). */
function encryptBlob(plaintext, key32) {
  if (Buffer.from(key32).length !== 32) throw new Error('key must be 32B');
  const { padded, n } = pad80(plaintext);
  if (n > MAX_N) throw new Error(`blob too large: N=${n} > 64`);
  const nonce = Buffer.from(sodium.randombytes_buf(24));
  const ct = Buffer.from(
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      padded, null, null, nonce, Buffer.from(key32)
    )
  );
  if (ct.length !== n * CHUNK + TAG_LEN) throw new Error('ciphertext length invariant violated');
  const blobId = blake2b32(ct);
  const env = Buffer.alloc(HEADER_LEN + ct.length);
  env.writeUInt32BE(MAGIC, 0);
  env.writeUInt8(VERSION, 4);
  blobId.copy(env, 5);
  nonce.copy(env, 37);
  ct.copy(env, HEADER_LEN);
  return { envelope: env, blobId, nonce, n };
}

/** Validate + parse envelope. Throws on any mismatch. */
function decodeEnvelope(env) {
  const buf = Buffer.from(env);
  if (buf.length < envelopeLen(1)) throw new Error('envelope too short');
  if (buf.readUInt32BE(0) !== MAGIC) throw new Error('bad magic');
  if (buf.readUInt8(4) !== VERSION) throw new Error('bad version');
  const blobId = buf.subarray(5, 37);
  const nonce = buf.subarray(37, 61);
  const ct = buf.subarray(HEADER_LEN);
  const bodyLen = buf.length - HEADER_LEN;
  if ((bodyLen - TAG_LEN) % CHUNK !== 0) throw new Error('body not N x 64KB + tag');
  const n = (bodyLen - TAG_LEN) / CHUNK;
  if (n < 1 || n > MAX_N) throw new Error(`N out of range: ${n}`);
  if (buf.length !== envelopeLen(n)) throw new Error('length formula mismatch');
  const digest = blake2b32(ct);
  if (!sodium.memcmp(digest, blobId)) throw new Error('BLAKE2b mismatch');
  return { blobId: Buffer.from(blobId), nonce: Buffer.from(nonce), ciphertext: Buffer.from(ct), n };
}

function decryptBlob(envelope, key32) {
  const { ciphertext } = decodeEnvelope(envelope);
  const { nonce } = decodeEnvelope(envelope);
  const padded = Buffer.from(
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, ciphertext, null, nonce, Buffer.from(key32)
    )
  );
  return unpad80(padded);
}

module.exports = {
  MAGIC, VERSION, HEADER_LEN, CHUNK, TAG_LEN, MAX_N,
  ready, envelopeLen, pad80, unpad80, blake2b32,
  encryptBlob, decodeEnvelope, decryptBlob,
};
