import { describe, expect, it } from "vitest";
import { formatTokenAmount, parseHumanAmount, shortenAddress } from "./format";

describe("format", () => {
  it("round-trips 18-decimal amounts", () => {
    expect(formatTokenAmount(10n ** 18n, 18)).toBe("1");
    expect(parseHumanAmount("1.5", 18)).toBe(15n * 10n ** 17n);
  });

  it("shortens addresses for headers without losing review-screen full values", () => {
    expect(shortenAddress("0x3333333333333333333333333333333333333333")).toBe("0x3333…3333");
  });
});
