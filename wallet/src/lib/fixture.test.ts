import { describe, expect, it } from "vitest";
import mockArb from "../fixtures/mock-quotes-response-arb.json";
import mockBase from "../fixtures/mock-quotes-response-base.json";
import sampleArb from "../fixtures/sample-swap-quote-arb.json";
import sampleBase from "../fixtures/sample-swap-quote.json";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "./chains";
import {
  BASE_SEPOLIA_DEPLOY,
  MOCK_QUOTES_RESPONSE_ARB,
  MOCK_QUOTES_RESPONSE_BASE,
  RELAYER_DRY_AMOUNTS,
  RELAYER_DRY_PATH_HASH,
  sampleFixtureQuote,
  sampleFixtureRaw,
} from "./fixture";
import { displayBeforeConfirm, parseQuoteResponse } from "./quotes";

describe("Relayer dry-mock fixtures", () => {
  it("parses sample-swap-quote.json and the Arb pair", () => {
    const base = parseQuoteResponse(sampleBase);
    const arb = parseQuoteResponse(sampleArb);
    expect(base?.chainId).toBe(84532);
    expect(arb?.chainId).toBe(421614);
    expect(base?.tokenSymbol).toBe("mPERMIT");
    expect(arb?.tokenSymbol).toBe("mPERMIT");
    expect(base?.amountIn).toBe(RELAYER_DRY_AMOUNTS.amountIn);
    expect(base?.amountSwap).toBe(RELAYER_DRY_AMOUNTS.amountSwap);
    expect(base?.feeAmount).toBe(RELAYER_DRY_AMOUNTS.feeAmount);
    expect(base?.amountRemainder).toBe(RELAYER_DRY_AMOUNTS.amountRemainder);
    expect(base?.pathHash).toBe(RELAYER_DRY_PATH_HASH);
    expect(arb?.pathHash).toBe(RELAYER_DRY_PATH_HASH);
    expect(base?.tokenIn).toBe(BASE_SEPOLIA_DEPLOY.tokenIn);
    expect(base?.feeTo).toBe(BASE_SEPOLIA_DEPLOY.feeTo);
    expect(base?.router).toBe(BASE_SEPOLIA_DEPLOY.router);
    expect(base?.chainId).toBe(84532);
    // Arb fixtures stay placeholders — do not invent an Arb deploy.
    expect(arb?.tokenIn).not.toBe(BASE_SEPOLIA_DEPLOY.tokenIn);
    expect(arb?.router).not.toBe(BASE_SEPOLIA_DEPLOY.router);
    expect(base).not.toHaveProperty("safeRecipient");
  });

  it("parses full mock-quotes-response-base.json / arb.json including eip712", () => {
    const base = parseQuoteResponse(mockBase);
    const arb = parseQuoteResponse(mockArb);
    expect(base).not.toBeNull();
    expect(arb).not.toBeNull();
    expect(base?.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(arb?.chainId).toBe(ARB_SEPOLIA_CHAIN_ID);
    expect(mockBase.eip712.domain.name).toBe("StewardGasRescue");
    expect(mockBase.eip712.domain.verifyingContract).toBe(BASE_SEPOLIA_DEPLOY.gasRescue);
    expect(mockArb.eip712.domain.version).toBe("1");
    expect(mockArb.eip712.domain.verifyingContract).not.toBe(BASE_SEPOLIA_DEPLOY.gasRescue);
    expect(mockBase.eip712.types.Order.map((field) => field.name)).not.toContain("safeRecipient");
    expect(MOCK_QUOTES_RESPONSE_BASE.quoteId).toMatch(/base/);
    expect(MOCK_QUOTES_RESPONSE_ARB.quoteId).toMatch(/arb/);
  });

  it("sampleFixtureQuote binds Base and Arb without inventing extra legs", () => {
    const base = sampleFixtureQuote({ chainId: BASE_SEPOLIA_CHAIN_ID });
    const arb = sampleFixtureQuote({ chainId: ARB_SEPOLIA_CHAIN_ID });
    expect(base.chainId).toBe(84532);
    expect(arb.chainId).toBe(421614);
    expect(base.amountIn).toBe(arb.amountIn);
    expect(displayBeforeConfirm(base).nativeTo).toBe(base.nativeTo);
    expect(String(sampleFixtureRaw().quoteId)).toMatch(/mock|sample/i);
  });
});
