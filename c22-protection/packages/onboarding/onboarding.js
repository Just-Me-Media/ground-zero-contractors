'use strict';
/**
 * Onboarding flow (offline) + egress guard.
 * Locked: assert(egress_calls == 0) throughout entropy -> Share A -> Share B -> Share C QR render.
 */
const keys = require('../crypto/keys');

let egressCalls = 0;
let guardActive = false;
const _origFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

function countingFetch(...args) {
  if (guardActive) egressCalls++;
  if (_origFetch) return _origFetch(...args);
  throw new Error('fetch not available in this runtime');
}

function startGuard() {
  egressCalls = 0;
  guardActive = true;
  if (typeof globalThis.fetch === 'function') globalThis.fetch = countingFetch;
}

function stopGuardRestore() {
  guardActive = false;
  if (_origFetch) globalThis.fetch = _origFetch;
}

function assertNoEgress() {
  if (egressCalls !== 0) throw new Error(`egress guard violated: ${egressCalls} network calls`);
}

/** Full offline onboarding sequence (no network). Returns shares + verify indices. */
async function runOnboardingOffline(entropy32) {
  await keys.ready();
  startGuard();
  try {
    // 1. entropy -> SLIP-0039 2-of-3 (pure, no master shown)
    const { shares } = keys.generateShares256(entropy32);
    // 2. Share A: simulated keystore commit (local only)
    const shareA = shares[0];
    // 3. Share B: paper + mandatory 3-word check setup
    const shareB = shares[1];
    const verifyIndices = keys.pickVerifyIndices(shareB, 3);
    // 4. Share C: QR payload prepared (CBOR/UR framing done at UI layer)
    const shareC = shares[2];
    assertNoEgress();
    return { shareA, shareB, shareC, verifyIndices, egressCalls };
  } finally {
    stopGuardRestore();
  }
}

module.exports = { startGuard, stopGuardRestore, assertNoEgress, runOnboardingOffline, getEgressCalls: () => egressCalls };
