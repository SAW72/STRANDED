import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNonceStore } from "../nonceStore.mjs";

const USER = "0x1111111111111111111111111111111111111111";

describe("nonce reservation", () => {
  it("issues distinct nonces for concurrent quotes of the same user", async () => {
    let t = 1_700_000_000_000;
    const store = createNonceStore({ now: () => t, isNonceUsed: async () => false });
    const got = await Promise.all([store.reserve(USER), store.reserve(USER.toUpperCase()), store.reserve(USER)]);
    assert.deepEqual(
      [...got].sort((a, b) => (a < b ? -1 : 1)),
      [1700000000000n, 1700000000001n, 1700000000002n],
    );
  });

  it("skips on-chain usedNonces and in-memory reservations", async () => {
    const used = new Set(["1700000000000"]);
    const store = createNonceStore({
      now: () => 1_700_000_000_000,
      isNonceUsed: async (_user, nonce) => used.has(nonce.toString()),
    });
    const first = await store.reserve(USER);
    assert.equal(first, 1700000000001n);
    const second = await store.reserve(USER);
    assert.equal(second, 1700000000002n);
  });

  it("can reuse an expired reservation that is still unused on-chain", async () => {
    let t = 1000;
    const store = createNonceStore({ now: () => t, isNonceUsed: async () => false });
    const first = await store.reserve(USER, { ttlMs: 10 });
    assert.equal(first, 1000n);
    t = 1020;
    const again = await store.reserve(USER, { ttlMs: 10 });
    assert.equal(again, 1020n);
  });

  it("does not reissue a consumed nonce after expiry", async () => {
    let t = 1000;
    const store = createNonceStore({ now: () => t, isNonceUsed: async () => false });
    const first = await store.reserve(USER, { ttlMs: 10 });
    store.markConsumed(USER, first);
    t = 5000;
    const next = await store.reserve(USER, { ttlMs: 10 });
    assert.notEqual(next, first);
    assert.equal(next, 5000n);
  });

  it("stops after maxProbes instead of looping", async () => {
    const store = createNonceStore({
      now: () => 1,
      maxProbes: 3,
      isNonceUsed: async () => true,
    });
    await assert.rejects(() => store.reserve(USER), /nonce_unavailable/);
  });
});
