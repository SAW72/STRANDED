import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  NonceTooLowError,
  RpcRequestError,
  TimeoutError,
  TransactionExecutionError,
  UnknownNodeError,
} from "viem";
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

  it("retries real viem nonce, replacement, and HTTP errors", async () => {
    const rpc = new RpcRequestError({
      body: { method: "eth_sendRawTransaction" },
      url: "https://rpc.example.invalid/SECRET",
      error: { code: -32000, message: "nonce too low" },
    });
    const nonce = new NonceTooLowError({ cause: rpc, nonce: 3 });
    const wrapped = new TransactionExecutionError(nonce, {});
    assert.equal(isTransientBroadcastError(new BaseError("nonce too low")), true);
    assert.equal(isTransientBroadcastError(nonce), true);
    assert.equal(isTransientBroadcastError(wrapped), true);

    const replacementRpc = new RpcRequestError({
      body: {},
      url: "https://rpc.example.invalid/SECRET",
      error: { code: -32000, message: "replacement transaction underpriced" },
    });
    assert.equal(isTransientBroadcastError(new UnknownNodeError({ cause: replacementRpc })), true);

    const http = new HttpRequestError({
      url: "https://rpc.example.invalid/SECRET",
      status: 503,
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    assert.equal(isTransientBroadcastError(http), true);
    assert.equal(isTransientBroadcastError(new TimeoutError({ url: "https://rpc.example.invalid/SECRET" })), true);

    const broken = new BaseError("nonce too low");
    broken.walk = () => {
      throw new TypeError("fn is not a function");
    };
    assert.equal(isTransientBroadcastError(broken), true);

    let n = 0;
    const hash = await withBroadcastRetry(
      async () => {
        n += 1;
        if (n < 3) throw wrapped;
        return "0xabc";
      },
      { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} },
    );
    assert.equal(hash, "0xabc");
    assert.equal(n, 3);
  });

  it("retries nonce_expired and nonce-expired but not other expired errors", async () => {
    assert.equal(isTransientBroadcastError(new Error("nonce_expired")), true);
    assert.equal(isTransientBroadcastError(new Error("nonce-expired")), true);
    assert.equal(isTransientBroadcastError(new Error("Nonce expired")), true);
    assert.equal(isTransientBroadcastError(new Error("deadline expired")), false);
    assert.equal(isTransientBroadcastError(new Error("OrderExpired")), false);

    let n = 0;
    const hash = await withBroadcastRetry(
      async () => {
        n += 1;
        if (n < 2) throw new Error("nonce_expired");
        return "0xabc";
      },
      { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} },
    );
    assert.equal(hash, "0xabc");
    assert.equal(n, 2);

    let dashed = 0;
    const dashedHash = await withBroadcastRetry(
      async () => {
        dashed += 1;
        if (dashed < 2) throw new Error("nonce-expired");
        return "0xdef";
      },
      { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} },
    );
    assert.equal(dashedHash, "0xdef");
    assert.equal(dashed, 2);

    let permanent = 0;
    await assert.rejects(
      () =>
        withBroadcastRetry(
          async () => {
            permanent += 1;
            throw new Error("deadline expired");
          },
          { maxAttempts: 4, sleep: async () => assert.fail("should not sleep") },
        ),
      /deadline expired/,
    );
    assert.equal(permanent, 1);
  });

  it("does not retry viem contract reverts", async () => {
    const reverted = new ContractFunctionRevertedError({
      abi: [],
      functionName: "rescueWithPermit",
      message: "InvalidSignature",
    });
    const plainRevert = new ContractFunctionRevertedError({
      abi: [],
      functionName: "rescueWithPermit",
    });
    const execution = new ExecutionRevertedError({ message: "SwapFailed" });
    assert.equal(isTransientBroadcastError(reverted), false);
    assert.equal(isTransientBroadcastError(plainRevert), false);
    assert.equal(isTransientBroadcastError(execution), false);

    let n = 0;
    await assert.rejects(
      () =>
        withBroadcastRetry(
          async () => {
            n += 1;
            throw plainRevert;
          },
          { maxAttempts: 4, sleep: async () => assert.fail("should not sleep") },
        ),
      (err) => err === plainRevert,
    );
    assert.equal(n, 1);
  });
});
