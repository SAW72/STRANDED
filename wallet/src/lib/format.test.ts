import { describe, expect, it } from "vitest";
import {
  formatNativeOut,
  formatNetwork,
  formatTokenAmount,
  parseHumanAmount,
  shortenAddress,
  shortenBytes32,
} from "./format";

describe("format", () => {
  it("round-trips 18-decimal amounts", () => {
    expect(formatTokenAmount(10n ** 18n, 18)).toBe("1");
    expect(parseHumanAmount("1.5", 18)).toBe(15n * 10n ** 17n);
  });

  it("shortens addresses for headers without losing review-screen full values", () => {
    expect(shortenAddress("0x3333333333333333333333333333333333333333")).toBe("0x3333…3333");
  });

  it("shortens path hashes and formats native out + network", () => {
    const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(shortenBytes32(hash)).toBe("0xaaaaaaaa…aaaaaaaa");
    expect(formatNativeOut(25n * 10n ** 14n, 84532)).toBe("0.0025 ETH");
    expect(formatNetwork(421614)).toBe("Arb Sepolia (421614)");
  });
});
