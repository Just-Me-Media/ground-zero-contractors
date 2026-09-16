'use strict';
/**
 * Ephemeral onion relay — RAM-only reference implementation.
 * State: blob_id(hex) -> { envelope:Buffer, readCapHash:Buffer, deleteCapHash:Buffer, expiry:number }
 * Locked: 24h default TTL, 72h max, explicit_bzero (fill(0)) on expiry/DELETE, no logs.
 */
const sodium = require('libsodium-wrappers');
const { decodeEnvelope, blake2b32, envelopeLen } = require('../crypto/wire');

const DEFAULT_TTL_H = 24;
const MAX_TTL_H = 72;

class EphemeralRelay {
  constructor() {
    this.store = new Map();
    this.counters = { puts: 0, gets: 0, deletes: 0, evictions: 0 };
  }

  _hash(b) {
    return blake2b32(b);
  }

  _expired(entry) {
    return Date.now() > entry.expiry;
  }

  _zeroize(entry) {
    // explicit_bzero equivalent: overwrite all held buffers then drop refs
    try { entry.envelope.fill(0); } catch (_) {}
    try { entry.readCapHash.fill(0); } catch (_) {}
    try { entry.deleteCapHash.fill(0); } catch (_) {}
  }

  sweep() {
    for (const [id, entry] of this.store) {
      if (this._expired(entry)) {
        this._zeroize(entry);
        this.store.delete(id);
        this.counters.evictions++;
      }
    }
  }

  /** PUT /b/{blob_id} — throws {status} on error. */
  put(blobIdHex, envelopeBuf, { readCap, deleteCap, ttlHours = DEFAULT_TTL_H } = {}) {
    this.sweep();
    if (!readCap || !deleteCap) {
      const e = new Error('missing capability headers'); e.status = 400; throw e;
    }
    if (ttlHours < 1 || ttlHours > MAX_TTL_H) {
      const e = new Error('TTL out of range (1-72h)'); e.status = 400; throw e;
    }
    const { blobId, n } = decodeEnvelope(envelopeBuf); // validates magic/ver/len/hash
    const actualHex = Buffer.from(blobId).toString('hex');
    if (actualHex !== String(blobIdHex).toLowerCase()) {
      const e = new Error('blob_id path != BLAKE2b(ciphertext)'); e.status = 400; throw e;
    }
    if (Buffer.from(envelopeBuf).length !== envelopeLen(n)) {
      const e = new Error('length formula mismatch'); e.status = 400; throw e;
    }
    if (this.store.has(actualHex)) {
      const e = new Error('already stored'); e.status = 409; throw e;
    }
    this.store.set(actualHex, {
      envelope: Buffer.from(envelopeBuf),
      readCapHash: this._hash(Buffer.from(readCap)),
      deleteCapHash: this._hash(Buffer.from(deleteCap)),
      expiry: Date.now() + ttlHours * 3600 * 1000,
    });
    this.counters.puts++;
    return { status: 'stored', expires_at: Math.floor(this.store.get(actualHex).expiry / 1000), n };
  }

  /** GET /b/{blob_id} with X-Capability-Token */
  get(blobIdHex, presentedReadCap) {
    this.sweep();
    const entry = this.store.get(String(blobIdHex).toLowerCase());
    if (!entry) { const e = new Error('not found'); e.status = 404; throw e; }
    if (!presentedReadCap) { const e = new Error('missing capability'); e.status = 403; throw e; }
    const h = this._hash(Buffer.from(presentedReadCap));
    const ok = h.length === entry.readCapHash.length && sodium.memcmp(h, entry.readCapHash);
    h.fill(0);
    if (!ok) { const e = new Error('forbidden'); e.status = 403; throw e; }
    this.counters.gets++;
    return Buffer.from(entry.envelope);
  }

  /** DELETE /b/{blob_id} with X-Delete-Token — immediate RAM zeroization */
  del(blobIdHex, presentedDeleteCap) {
    this.sweep();
    const id = String(blobIdHex).toLowerCase();
    const entry = this.store.get(id);
    if (!entry) { const e = new Error('not found'); e.status = 404; throw e; }
    const h = this._hash(Buffer.from(presentedDeleteCap || Buffer.alloc(0)));
    const ok = presentedDeleteCap && h.length === entry.deleteCapHash.length && sodium.memcmp(h, entry.deleteCapHash);
    h.fill(0);
    if (!ok) { const e = new Error('forbidden'); e.status = 403; throw e; }
    this._zeroize(entry);
    this.store.delete(id);
    this.counters.deletes++;
    return { status: 'deleted' };
  }

  metrics() {
    this.sweep();
    let bytes = 0;
    for (const e of this.store.values()) bytes += e.envelope.length;
    return { blobs_live: this.store.size, bytes_live: bytes, ...this.counters };
  }
}

module.exports = { EphemeralRelay, DEFAULT_TTL_H, MAX_TTL_H };
