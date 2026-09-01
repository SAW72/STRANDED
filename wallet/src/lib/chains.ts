import { arbitrumSepolia, baseSepolia } from "viem/chains";

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const ARB_SEPOLIA_CHAIN_ID = 421_614 as const;

export const SUPPORTED_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID, ARB_SEPOLIA_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const TESTNET_CHAINS = [baseSepolia, arbitrumSepolia] as const;

export type TestnetChain = (typeof TESTNET_CHAINS)[number];

export const DEFAULT_RPC: Record<SupportedChainId, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: "https://sepolia.base.org",
  [ARB_SEPOLIA_CHAIN_ID]: "https://sepolia-rollup.arbitrum.io/rpc",
};

export function isSupportedChainId(chainId: number | undefined): chainId is SupportedChainId {
  return chainId === BASE_SEPOLIA_CHAIN_ID || chainId === ARB_SEPOLIA_CHAIN_ID;
}

export function chainLabel(chainId: number | undefined): string {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return "Base Sepolia";
  if (chainId === ARB_SEPOLIA_CHAIN_ID) return "Arb Sepolia";
  if (chainId === undefined) return "unknown network";
  return `unsupported network (${chainId})`;
}

export function nativeSymbol(chainId: number | undefined): string {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) return "ETH";
  return "ETH";
}

export function viemChain(chainId: SupportedChainId): TestnetChain {
  return chainId === ARB_SEPOLIA_CHAIN_ID ? arbitrumSepolia : baseSepolia;
}
