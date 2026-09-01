import { describe, expect, it } from "vitest";
import { sampleFixtureQuote } from "./fixture";
import {
  buildOrder,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  gasRescueDomain,
  ORDER_TYPES,
  splitPermitSignature,
} from "./order";

describe("ORDER_TYPES", () => {
  it("lists the canonical EIP-712 Order fields in freeze order", () => {
    expect(ORDER_TYPES.Order.map((field) => field.name)).toEqual([
      "user",
      "tokenIn",
      "amountIn",
      "feeAmount",
      "feeTo",
      "amountSwap",
      "minAmountOut",
      "to",
      "nativeTo",
      "router",
      "pathHash",
      "chainId",
      "deadline",
      "nonce",
    ]);
    expect(ORDER_TYPES.Order.map((field) => field.name)).not.toContain("safeRecipient");
    expect(ORDER_TYPES.Order.map((field) => field.name)).not.toContain("amount");
    expect(ORDER_TYPES.Order.map((field) => field.name)).not.toContain("token");
  });
});

describe("gasRescueDomain", () => {
  it("uses StewardGasRescue / 1", () => {
    const domain = gasRescueDomain("0x7777777777777777777777777777777777777777", 84532);
    expect(domain.name).toBe(EIP712_DOMAIN_NAME);
    expect(domain.name).toBe("StewardGasRescue");
    expect(domain.version).toBe(EIP712_DOMAIN_VERSION);
    expect(domain.chainId).toBe(84532);
  });
});

describe("buildOrder", () => {
  it("copies every Order field from the quote only", () => {
    const quote = sampleFixtureQuote();
    const order = buildOrder({ quote });
    expect(order.user).toBe(quote.user);
    expect(order.tokenIn).toBe(quote.tokenIn);
    expect(order.amountIn).toBe(quote.amountIn);
    expect(order.feeAmount).toBe(quote.feeAmount);
    expect(order.feeTo).toBe(quote.feeTo);
    expect(order.amountSwap).toBe(quote.amountSwap);
    expect(order.minAmountOut).toBe(quote.minAmountOut);
    expect(order.to).toBe(quote.to);
    expect(order.nativeTo).toBe(quote.nativeTo);
    expect(order.router).toBe(quote.router);
    expect(order.pathHash).toBe(quote.pathHash);
    expect(order.chainId).toBe(BigInt(quote.chainId));
    expect(order.deadline).toBe(quote.deadline);
    expect(order.nonce).toBe(quote.nonce);
    expect(order).not.toHaveProperty("safeRecipient");
  });
});

describe("splitPermitSignature", () => {
  it("splits a 65-byte signature into v, r, s", () => {
    const r = "11".repeat(32);
    const s = "22".repeat(32);
    const { v, r: rr, s: ss } = splitPermitSignature(`0x${r}${s}1c`);
    expect(rr).toBe(`0x${r}`);
    expect(ss).toBe(`0x${s}`);
    expect(v).toBe(28);
  });
});
