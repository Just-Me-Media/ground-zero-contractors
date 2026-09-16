'use strict';
/**
 * manifest.v1.json (before encryption):
 * { v:1, created_at, file_name, mime_type, total_bytes, chunk_size:65536,
 *   file_blake2b, chunks:[{idx, blob_id(hex), reader_key(hex)}] }
 * Manifest JSON is padded to N x 64KB, encrypted with manifest_key,
 * uploaded as root manifest blob (same wire envelope).
 */
const { encryptBlob, decryptBlob, blake2b32, CHUNK } = require('./wire');

function buildManifestObject({ fileName, mimeType, totalBytes, fileBlake2bHex, chunks }) {
  return {
    v: 1,
    created_at: Math.floor(Date.now() / 1000),
    file_name: fileName,
    mime_type: mimeType,
    total_bytes: totalBytes,
    chunk_size: CHUNK,
    file_blake2b: fileBlake2bHex,
    chunks: chunks.map((c) => ({
      idx: c.idx,
      blob_id: Buffer.from(c.blobId).toString('hex'),
      reader_key: Buffer.from(c.readerKey).toString('hex'),
    })),
  };
}

/** Encrypt manifest object -> envelope + manifestKey-derived ids. */
function encryptManifest(manifestObj, manifestKey32) {
  const json = Buffer.from(JSON.stringify(manifestObj), 'utf8');
  return encryptBlob(json, manifestKey32);
}

function decryptManifest(envelope, manifestKey32) {
  const plain = decryptBlob(envelope, manifestKey32);
  const obj = JSON.parse(plain.toString('utf8'));
  if (obj.v !== 1) throw new Error('bad manifest version');
  if (obj.chunk_size !== CHUNK) throw new Error('bad chunk_size');
  return obj;
}

function fileBlake2bHex(plaintext) {
  return blake2b32(plaintext).toString('hex');
}

module.exports = { buildManifestObject, encryptManifest, decryptManifest, fileBlake2bHex };
