import type { Address, Hex } from "viem";
import mockArb from "../fixtures/mock-quotes-response-arb.json";
import mockBase from "../fixtures/mock-quotes-response-base.json";
import sampleArb from "../fixtures/sample-swap-quote-arb.json";
import sampleBase from "../fixtures/sample-swap-quote.json";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, type SupportedChainId } from "./chains";
import { parseQuoteResponse, type RescueQuote } from "./quotes";

export const RELAYER_DRY_PATH_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

/** Base Sepolia (84532) Relayer deploy — fixtures only, not a live quote. */
export const BASE_SEPOLIA_DEPLOY = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  tokenIn: "0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166",
  feeTo: "0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D",
  gasRescue: "0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688",
  router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
} as const;

/** Arb Sepolia (421614) live deploy — fixtures pin these addrs; quotes stay fixture-only unless Relayer URL is set. */
export const ARB_SEPOLIA_DEPLOY = {
  chainId: ARB_SEPOLIA_CHAIN_ID,
  tokenIn: "0x5649fF51123D534044aA7E6cBc8762698Ffed713",
  tokenSymbol: "GRTT",
  feeTo: "0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D",
  gasRescue: "0x65e712222745A8FCCbF038A90Fa75caB0867993D",
  router: "0x680410c7f64e06EB7e80dc7B5c149f7855e225A8",
} as const;

/** Relayer dry-mock amounts: 1e18 in, 0.2e18 swap, 0.01e18 fee, 0.79e18 remainder. */
export const RELAYER_DRY_AMOUNTS = {
  amountIn: 10n ** 18n,
  amountSwap: 2n * 10n ** 17n,
  feeAmount: 10n ** 16n,
  amountRemainder: 79n * 10n ** 16n,
} as const;

export const SAMPLE_FIXTURE_RAW = sampleBase;
export const SAMPLE_FIXTURE_ARB_RAW = sampleArb;
export const MOCK_QUOTES_RESPONSE_BASE = mockBase;
export const MOCK_QUOTES_RESPONSE_ARB = mockArb;

export type SampleFixtureOverrides = {
  chainId?: SupportedChainId;
  user?: Address;
  tokenIn?: Address;
  tokenSymbol?: string;
};

function cloneJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Full Relayer dry-mock QuoteResponse (Appendix A + eip712). */
export function sampleFixtureRaw(overrides: SampleFixtureOverrides = {}): Record<string, unknown> {
  const chainId = overrides.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const raw = cloneJson(chainId === ARB_SEPOLIA_CHAIN_ID ? mockArb : mockBase);
  if (overrides.user) raw.user = overrides.user;
  if (overrides.tokenIn) raw.tokenIn = overrides.tokenIn;
  if (overrides.tokenSymbol) raw.tokenSymbol = overrides.tokenSymbol;
  raw.chainId = chainId;

  const eip = raw.eip712;
  if (eip && typeof eip === "object" && !Array.isArray(eip)) {
    const block = eip as Record<string, unknown>;
    const domain = block.domain;
    if (domain && typeof domain === "object" && !Array.isArray(domain)) {
      (domain as Record<string, unknown>).chainId = chainId;
    }
    const message = block.message;
    if (message && typeof message === "object" && !Array.isArray(message)) {
      const msg = message as Record<string, unknown>;
      msg.chainId = chainId;
      if (overrides.user) msg.user = overrides.user;
      if (overrides.tokenIn) msg.tokenIn = overrides.tokenIn;
    }
  }
  return raw;
}

/** Parse the Relayer dry mock into a RescueQuote. Throws only if the checked-in shape is broken. */
export function sampleFixtureQuote(overrides: SampleFixtureOverrides = {}): RescueQuote {
  const quote = parseQuoteResponse(sampleFixtureRaw(overrides));
  if (!quote) {
    throw new Error("Sample fixture failed to parse — the checked-in Relayer dry mock is invalid.");
  }
  return quote;
}

export function isSamplePathHash(pathHash: Hex): boolean {
  return pathHash.toLowerCase() === RELAYER_DRY_PATH_HASH;
}
