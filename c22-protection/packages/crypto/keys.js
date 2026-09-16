'use strict';
/**
 * Key hierarchy (locked):
 *  root_secret = CSPRNG(32B), never displayed
 *  manifest_key = BLAKE2b(root_secret || "manifest-v1")
 *  chunk_key[i] = BLAKE2b(root_secret || "chunk" || le64(i))
 *  read_cap  = BLAKE2b(reader_key || blob_id)
 *  delete_cap = BLAKE2b(reader_key || "delete" || blob_id)
 * SLIP-0039: pure 2-of-3, no BIP39 master ever shown.
 */
const sodium = require('libsodium-wrappers');
const slip39 = require('slip39');
const { blake2b32 } = require('./wire');

async function ready() {
  await sodium.ready;
}

function randomRootSecret() {
  return Buffer.from(sodium.randombytes_buf(32));
}

function le64(i) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(i));
  return b;
}

function manifestKey(rootSecret) {
  return blake2b32(Buffer.concat([Buffer.from(rootSecret), Buffer.from('manifest-v1', 'utf8')]));
}

function chunkKey(rootSecret, idx) {
  return blake2b32(Buffer.concat([Buffer.from(rootSecret), Buffer.from('chunk', 'utf8'), le64(idx)]));
}

function readCap(readerKey32, blobId32) {
  return blake2b32(Buffer.concat([Buffer.from(readerKey32), Buffer.from(blobId32)]));
}

function deleteCap(readerKey32, blobId32) {
  return blake2b32(
    Buffer.concat([Buffer.from(readerKey32), Buffer.from('delete', 'utf8'), Buffer.from(blobId32)])
  );
}

/**
 * Generate pure SLIP-0039 2-of-3 shares from 256-bit entropy.
 * Single group [2,3], threshold 1 group. No master mnemonic displayed.
 * NOTE: slip39 lib expects master secret as Array of bytes (not Buffer).
 * Returns { shares: [mnemonicA, mnemonicB, mnemonicC] (33 words each for 256-bit) }.
 */
function generateShares256(entropy32) {
  const entropy = Buffer.from(entropy32);
  if (entropy.length !== 32) throw new Error('entropy must be 32B for 256-bit strength');
  const inst = slip39.fromArray(Array.from(entropy), {
    passphrase: '',
    threshold: 1,
    groups: [[2, 3]],
  });
  const shares = [0, 1, 2].map((m) => inst.fromPath(`r/0/${m}`).mnemonics[0]);
  return { shares };
}

/** Combine any 2 of 3 mnemonics -> 32B secret. Throws if <2 valid shares. */
function combineShares(mnemonics) {
  if (!Array.isArray(mnemonics) || mnemonics.length < 2) {
    throw new Error('need at least 2 shares to recover');
  }
  const rec = slip39.recoverSecret(mnemonics.slice(0, 2), '');
  return Buffer.from(rec);
}

/** Share B paper check: verify 3 random word positions. */
function pickVerifyIndices(mnemonic, count = 3) {
  const words = mnemonic.trim().split(/\s+/);
  const idx = new Set();
  while (idx.size < Math.min(count, words.length)) {
    idx.add(Math.floor(Math.random() * words.length));
  }
  return [...idx].sort((a, b) => a - b);
}

function verifyShareWords(mnemonic, answers) {
  // answers: [{index, word}]
  const words = mnemonic.trim().split(/\s+/);
  return answers.every(({ index, word }) => words[index] === String(word).trim().toLowerCase());
}

module.exports = {
  ready, randomRootSecret, manifestKey, chunkKey, readCap, deleteCap,
  generateShares256, combineShares, pickVerifyIndices, verifyShareWords,
};
