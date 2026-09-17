import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lockedQuoteAmounts, slipMinAmountOut } from "../quoteMath.mjs";

describe("locked Arb Sepolia quote math", () => {
  it("keeps 1% fee, ~20% swap, 100 bps slip — no USD floor", () => {
    const amountIn = 10n ** 18n;
    const payAmount = 1000n;
    const q = lockedQuoteAmounts(amountIn, payAmount);
    assert.equal(q.feeAmount, amountIn / 100n);
    assert.equal(q.amountSwap, amountIn / 5n);
    assert.equal(q.amountRemainder, amountIn - q.amountSwap - q.feeAmount);
    assert.equal(q.minAmountOut, (payAmount * 9900n) / 10000n);
    assert.equal(q.slippageBps, 100);
    assert.equal(slipMinAmountOut(payAmount), 990n);
    assert.equal(q.feeUsd, undefined);
    assert.equal(q.minUsd, undefined);
    assert.equal(q.maxUsd, undefined);
    const keys = Object.keys(q).join(",");
    assert.equal(keys.includes("usd") || keys.includes("Usd"), false);
  });

  it("honors amountSwap override without changing the 1% fee", () => {
    const amountIn = 1000n;
    const q = lockedQuoteAmounts(amountIn, 500n, 100n);
    assert.equal(q.feeAmount, 10n);
    assert.equal(q.amountSwap, 100n);
    assert.equal(q.amountRemainder, 890n);
  });
});
