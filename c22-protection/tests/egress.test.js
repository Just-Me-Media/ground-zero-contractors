'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sodium = require('libsodium-wrappers');
const ob = require('../packages/onboarding/onboarding');
const keys = require('../packages/crypto/keys');

test('egress guard: onboarding makes zero network calls', async () => {
  await sodium.ready; await keys.ready();
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('blocked'); };
  try {
    const entropy = Buffer.from(sodium.randombytes_buf(32));
    const out = await ob.runOnboardingOffline(entropy);
    assert.equal(out.egressCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.ok(out.shareA && out.shareB && out.shareC);
    // Share B 3-word verification round-trips
    const words = out.shareB.trim().split(/\s+/);
    const answers = out.verifyIndices.map((i) => ({ index: i, word: words[i] }));
    assert.ok(keys.verifyShareWords(out.shareB, answers));
    assert.ok(!keys.verifyShareWords(out.shareB, [{ index: answers[0].index, word: 'wrongword' }]));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('egress guard: counts calls when active', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x');
  try {
    ob.startGuard();
    try { await globalThis.fetch('https://example.com'); } catch (_) {}
    assert.equal(ob.getEgressCalls(), 1);
    assert.throws(() => ob.assertNoEgress(), /egress guard violated/);
  } finally {
    ob.stopGuardRestore();
    globalThis.fetch = realFetch;
  }
});
