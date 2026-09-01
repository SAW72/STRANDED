import type { Address, Hex } from "viem";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, type SupportedChainId } from "./chains";
import { parseQuoteResponse, type RescueQuote } from "./quotes";

/**
 * Sample fixture — not a live Relayer quote and not a live balance.
 * Field names match the design-freeze quote shape exactly.
 */
export const SAMPLE_FIXTURE_RAW = {
  quoteId: "sample-base-sepolia-swap-for-gas",
  chainId: BASE_SEPOLIA_CHAIN_ID,
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenSymbol: "MOCK",
  tokenDecimals: 18,
  user: "0x1111111111111111111111111111111111111111",
  amountIn: "100000000000000000000",
  amountSwap: "10000000000000000000",
  feeAmount: "1000000000000000000",
  feeTo: "0x3333333333333333333333333333333333333333",
  to: "0x4444444444444444444444444444444444444444",
  nativeTo: "0x5555555555555555555555555555555555555555",
  minAmountOut: "2500000000000000",
  amountRemainder: "89000000000000000000",
  router: "0x6666666666666666666666666666666666666666",
  pathHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  deadline: "1893456000",
  nonce: "1",
} as const;

export type SampleFixtureOverrides = {
  chainId?: SupportedChainId;
  user?: Address;
  tokenIn?: Address;
  tokenSymbol?: string;
};

export function sampleFixtureRaw(overrides: SampleFixtureOverrides = {}): Record<string, unknown> {
  const chainId = overrides.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const quoteId =
    chainId === ARB_SEPOLIA_CHAIN_ID
      ? "sample-arb-sepolia-swap-for-gas"
      : SAMPLE_FIXTURE_RAW.quoteId;
  return {
    ...SAMPLE_FIXTURE_RAW,
    quoteId,
    chainId,
    user: overrides.user ?? SAMPLE_FIXTURE_RAW.user,
    tokenIn: overrides.tokenIn ?? SAMPLE_FIXTURE_RAW.tokenIn,
    tokenSymbol: overrides.tokenSymbol ?? SAMPLE_FIXTURE_RAW.tokenSymbol,
  };
}

/** Parse the sample into a RescueQuote. Throws only if the checked-in sample is broken. */
export function sampleFixtureQuote(overrides: SampleFixtureOverrides = {}): RescueQuote {
  const quote = parseQuoteResponse(sampleFixtureRaw(overrides));
  if (!quote) {
    throw new Error("Sample fixture failed to parse — the checked-in shape is invalid.");
  }
  return quote;
}

export function isSamplePathHash(pathHash: Hex): boolean {
  return pathHash === SAMPLE_FIXTURE_RAW.pathHash;
}
