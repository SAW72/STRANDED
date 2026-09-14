import { encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { ARB_SEPOLIA_CHAIN_ID } from "./chains";
import { RELAYER_DRY_PATH_HASH } from "./fixture";
import type { RescueQuote } from "./quotes";

/** Live Arb Sepolia mock-router `swapExact(address,uint256,address)`. */
export const SWAP_EXACT_ABI = [
  {
    type: "function",
    name: "swapExact",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const ARB_SEPOLIA_DEMO = {
  chainId: ARB_SEPOLIA_CHAIN_ID,
  swap: "0x65e712222745A8FCCbF038A90Fa75caB0867993D",
  owner: "0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D",
  relayer: "0x8240124dc78a27c80354Ca813Df12aa2888A9AF6",
  weth: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
  grtt: "0x5649fF51123D534044aA7E6cBc8762698Ffed713",
  gmock: "0x30006e29a23c713070136F56db1BDf2A8B82B318",
  router: "0x680410c7f64e06EB7e80dc7B5c149f7855e225A8",
  dryNativeTo: "0x1111111111111111111111111111111111111111",
  amountIn: 10n ** 18n,
  amountSwap: 2n * 10n ** 17n,
  feeAmount: 10n ** 16n,
  amountRemainder: 79n * 10n ** 16n,
} as const;

export function isSupportedDemoToken(tokenIn: Address): boolean {
  const t = tokenIn.toLowerCase();
  return t === ARB_SEPOLIA_DEMO.grtt.toLowerCase() || t === ARB_SEPOLIA_DEMO.gmock.toLowerCase();
}

/** Relayer + Foundry `ArbSepoliaDemoPath.encodeSwapExact`. */
export function encodeSwapExact(tokenIn: Address, amountSwap: bigint, nativeTo: Address): Hex {
  return encodeFunctionData({
    abi: SWAP_EXACT_ABI,
    functionName: "swapExact",
    args: [tokenIn, amountSwap, nativeTo],
  });
}

export function demoPathHash(tokenIn: Address, amountSwap: bigint, nativeTo: Address): Hex {
  return keccak256(encodeSwapExact(tokenIn, amountSwap, nativeTo));
}

export function matchesDemoPath(
  tokenIn: Address,
  amountSwap: bigint,
  nativeTo: Address,
  quotedHash: Hex,
): boolean {
  if (!quotedHash || quotedHash.toLowerCase() === RELAYER_DRY_PATH_HASH) return false;
  return quotedHash.toLowerCase() === demoPathHash(tokenIn, amountSwap, nativeTo).toLowerCase();
}

export function dryGrttFixturePathHash(): Hex {
  return demoPathHash(ARB_SEPOLIA_DEMO.grtt, ARB_SEPOLIA_DEMO.amountSwap, ARB_SEPOLIA_DEMO.dryNativeTo);
}

export function dryGmockFixturePathHash(): Hex {
  return demoPathHash(ARB_SEPOLIA_DEMO.gmock, ARB_SEPOLIA_DEMO.amountSwap, ARB_SEPOLIA_DEMO.dryNativeTo);
}

/**
 * Live Arb quotes must hash `swapExact(tokenIn, amountSwap, nativeTo)`.
 * Wallet dry fixtures keep `0xbbb…` and are labeled, not submitted.
 */
export function quotePathStatus(quote: Pick<RescueQuote, "tokenIn" | "amountSwap" | "nativeTo" | "pathHash">):
  | "wallet-dry-placeholder"
  | "matches-demo-path"
  | "mismatch" {
  if (quote.pathHash.toLowerCase() === RELAYER_DRY_PATH_HASH) return "wallet-dry-placeholder";
  return matchesDemoPath(quote.tokenIn, quote.amountSwap, quote.nativeTo, quote.pathHash)
    ? "matches-demo-path"
    : "mismatch";
}
