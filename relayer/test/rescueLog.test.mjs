import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createRescueLog, orderLogSummary, sanitizeLogRecord } from "../rescueLog.mjs";

describe("rescue log", () => {
  it("summarizes order fields without permit or signature material", () => {
    const summary = orderLogSummary({
      quoteId: "q-1",
      orderSignature: "0xdead",
      v: 28,
      r: "0x11",
      s: "0x22",
      order: {
        user: "0xabc",
        tokenIn: "0xdef",
        amountIn: 100n,
        feeAmount: "1",
        amountSwap: "20",
        nonce: 9,
        deadline: 99,
        chainId: 421614,
      },
    });
    assert.equal(summary.quoteId, "q-1");
    assert.equal(summary.user, "0xabc");
    assert.equal(summary.nonce, "9");
    assert.equal(summary.orderSignature, undefined);
    assert.equal(summary.v, undefined);
  });

  it("drops private keys and permit fields from records", () => {
    const clean = sanitizeLogRecord({
      event: "rescue_ok",
      txHash: "0xab",
      RELAYER_PRIVATE_KEY: "0xsecret",
      orderSignature: "0xsig",
      permitR: "0x11",
      v: 27,
      adminSecret: "nope",
    });
    assert.equal(clean.event, "rescue_ok");
    assert.equal(clean.txHash, "0xab");
    assert.equal(clean.RELAYER_PRIVATE_KEY, undefined);
    assert.equal(clean.orderSignature, undefined);
    assert.equal(clean.permitR, undefined);
    assert.equal(clean.v, undefined);
    assert.equal(clean.adminSecret, undefined);
  });

  it("appends JSONL with timestamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stranded-rescue-log-"));
    const log = createRescueLog({ dataDir: dir, now: () => Date.parse("2026-09-17T20:00:00.000Z") });
    await log.append({
      event: "rescue_error",
      quoteId: "q-9",
      user: "0x1",
      nonce: 3,
      error: "simulation_failed",
      orderSignature: "0xshould-not-appear",
      RELAYER_PRIVATE_KEY: "0xno",
    });
    const raw = await readFile(log.filePath, "utf8");
    const line = JSON.parse(raw.trim());
    assert.equal(line.event, "rescue_error");
    assert.equal(line.quoteId, "q-9");
    assert.equal(line.ts, "2026-09-17T20:00:00.000Z");
    assert.equal(line.orderSignature, undefined);
    assert.equal(line.RELAYER_PRIVATE_KEY, undefined);
    assert.match(raw, /\n$/);
  });
});
