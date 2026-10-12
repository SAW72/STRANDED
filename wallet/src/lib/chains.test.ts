import { describe, expect, it } from "vitest";
import {
  ARB_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  chainLabel,
  isSupportedChainId,
  SUPPORTED_CHAIN_IDS,
  transactionUrl,
  viemChain,
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

  it("links a transaction with the explorer already on that chain", () => {
    const tx = `0x${"ab".repeat(32)}`;
    expect(transactionUrl(ARB_SEPOLIA_CHAIN_ID, tx)).toBe(
      `${viemChain(ARB_SEPOLIA_CHAIN_ID).blockExplorers.default.url}/tx/${tx}`,
    );
    expect(transactionUrl(BASE_SEPOLIA_CHAIN_ID, tx)).toBe(
      `${viemChain(BASE_SEPOLIA_CHAIN_ID).blockExplorers.default.url}/tx/${tx}`,
    );
    expect(transactionUrl(ARB_SEPOLIA_CHAIN_ID, tx)).toMatch(
      /^https:\/\/sepolia\.arbiscan\.io\/tx\//,
    );
    expect(transactionUrl(BASE_SEPOLIA_CHAIN_ID, tx)).toMatch(
      /^https:\/\/sepolia\.basescan\.org\/tx\//,
    );
    expect(transactionUrl(1, tx)).toBeNull();
    expect(transactionUrl(42161, tx)).toBeNull();
    expect(transactionUrl(ARB_SEPOLIA_CHAIN_ID, "0x1234")).toBeNull();
  });
});
