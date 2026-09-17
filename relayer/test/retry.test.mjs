import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backoffMs,
  isTransientBroadcastError,
  withBroadcastRetry,
} from "../retry.mjs";

describe("broadcast retry bounds", () => {
  it("classifies RPC/nonce/replacement as transient and user/sig as permanent", () => {
    assert.equal(isTransientBroadcastError(new Error("HTTP 429 too many requests")), true);
    assert.equal(isTransientBroadcastError({ shortMessage: "replacement transaction underpriced" }), true);
    assert.equal(isTransientBroadcastError({ message: "nonce too low" }), true);
    assert.equal(isTransientBroadcastError(new Error("fetch failed")), true);
    assert.equal(isTransientBroadcastError(new Error("UsedNonce")), false);
    assert.equal(isTransientBroadcastError(new Error("InvalidSignature")), false);
    assert.equal(isTransientBroadcastError({ errorName: "ERC2612InvalidSigner", message: "ERC2612InvalidSigner" }), false);
    assert.equal(isTransientBroadcastError(new Error("simulation_failed")), false);
    assert.equal(isTransientBroadcastError(new Error("Underfunded")), false);
  });

  it("uses bounded exponential backoff", () => {
    assert.equal(backoffMs(1, 200), 200);
    assert.equal(backoffMs(2, 200), 400);
    assert.equal(backoffMs(3, 200), 800);
  });

  it("retries transient failures then succeeds", async () => {
    const delays = [];
    let n = 0;
    const logs = [];
    const result = await withBroadcastRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error("timeout connecting to rpc");
        return "0xabc";
      },
      {
        maxAttempts: 4,
        baseDelayMs: 10,
        sleep: async (ms) => {
          delays.push(ms);
        },
        log: (info) => logs.push(info),
      },
    );
    assert.equal(result, "0xabc");
    assert.equal(n, 3);
    assert.deepEqual(delays, [10, 20]);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].transient, true);
  });

  it("does not retry user/sig errors", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withBroadcastRetry(
          async () => {
            n += 1;
            throw new Error("InvalidSignature");
          },
          { maxAttempts: 5, sleep: async () => assert.fail("should not sleep") },
        ),
      /InvalidSignature/,
    );
    assert.equal(n, 1);
  });

  it("stops after maxAttempts on persistent transient errors", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withBroadcastRetry(
          async () => {
            n += 1;
            throw Object.assign(new Error("503"), { code: "ETIMEDOUT" });
          },
          { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} },
        ),
      /503/,
    );
    assert.equal(n, 3);
  });
});
