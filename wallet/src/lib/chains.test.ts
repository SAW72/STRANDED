import { describe, expect, it } from "vitest";
import {
  ARB_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  chainLabel,
  isSupportedChainId,
  SUPPORTED_CHAIN_IDS,
} from "./chains";

describe("supported testnets", () => {
  it("allows Base Sepolia and Arb Sepolia only", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual([BASE_SEPOLIA_CHAIN_ID, ARB_SEPOLIA_CHAIN_ID]);
    expect(isSupportedChainId(84532)).toBe(true);
    expect(isSupportedChainId(421614)).toBe(true);
    expect(isSupportedChainId(1)).toBe(false);
    expect(isSupportedChainId(8453)).toBe(false);
    expect(isSupportedChainId(42161)).toBe(false);
  });

  it("labels the two testnets", () => {
    expect(chainLabel(84532)).toBe("Base Sepolia");
    expect(chainLabel(421614)).toBe("Arb Sepolia");
  });
});
