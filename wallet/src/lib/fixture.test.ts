import { describe, expect, it } from "vitest";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "./chains";
import { SAMPLE_FIXTURE_RAW, sampleFixtureQuote, sampleFixtureRaw } from "./fixture";
import { displayBeforeConfirm, parseQuoteResponse } from "./quotes";

describe("sample fixture", () => {
  it("uses the freeze field names", () => {
    const keys = Object.keys(SAMPLE_FIXTURE_RAW);
    expect(keys).toEqual([
      "quoteId",
      "chainId",
      "tokenIn",
      "tokenSymbol",
      "tokenDecimals",
      "user",
      "amountIn",
      "amountSwap",
      "feeAmount",
      "feeTo",
      "to",
      "nativeTo",
      "minAmountOut",
      "amountRemainder",
      "router",
      "pathHash",
      "deadline",
      "nonce",
    ]);
    expect(keys).not.toContain("safeRecipient");
    expect(keys).not.toContain("amount");
    expect(keys).not.toContain("token");
  });

  it("parses for both testnets without inventing extra legs", () => {
    const base = sampleFixtureQuote({ chainId: BASE_SEPOLIA_CHAIN_ID });
    const arb = sampleFixtureQuote({ chainId: ARB_SEPOLIA_CHAIN_ID });
    expect(base.chainId).toBe(84532);
    expect(arb.chainId).toBe(421614);
    expect(arb.quoteId).toMatch(/arb/);
    expect(base.amountIn).toBe(arb.amountIn);
    expect(displayBeforeConfirm(base).nativeTo).toBe(base.nativeTo);
  });

  it("is labeled as a sample in the raw quoteId", () => {
    expect(String(sampleFixtureRaw().quoteId)).toMatch(/sample/i);
    expect(parseQuoteResponse(sampleFixtureRaw({ chainId: ARB_SEPOLIA_CHAIN_ID }))?.quoteId).toMatch(
      /sample/i,
    );
  });
});
