import { describe, expect, it } from "vitest";
import { buildOrder, splitPermitSignature } from "./order";

describe("buildOrder", () => {
  it("copies amount, feeAmount, and feeTo from the quote only", () => {
    const order = buildOrder({
      user: "0x1111111111111111111111111111111111111111",
      token: "0x2222222222222222222222222222222222222222",
      quote: {
        amount: 99n,
        feeAmount: 3n,
        feeTo: "0x3333333333333333333333333333333333333333",
        tokenDecimals: 18,
      },
      deadline: 1n,
      nonce: 7n,
    });
    expect(order.amount).toBe(99n);
    expect(order.feeAmount).toBe(3n);
    expect(order.feeTo).toBe("0x3333333333333333333333333333333333333333");
    expect(order.nonce).toBe(7n);
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
