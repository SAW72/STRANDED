import { isAddress, type Address } from "viem";
import {
  ARB_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_RPC,
  isSupportedChainId,
  type SupportedChainId,
} from "./lib/chains";

export {
  ARB_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  isSupportedChainId,
  type SupportedChainId,
};

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function optionalAddress(raw: string): Address | null {
  return raw && isAddress(raw) ? raw : null;
}

/**
 * Public Relayer origin. Prefer VITE_RELAYER_URL (design freeze).
 * RELAYER_BASE_URL / VITE_RELAYER_BASE_URL remain as aliases.
 */
export function relayerUrl(): string {
  const raw =
    readEnv("VITE_RELAYER_URL") || readEnv("RELAYER_BASE_URL") || readEnv("VITE_RELAYER_BASE_URL");
  return raw.replace(/\/$/, "");
}

/** @deprecated use relayerUrl — kept so existing imports do not break during the align. */
export function relayerBaseUrl(): string {
  return relayerUrl();
}

export function gasRescueAddress(chainId: SupportedChainId = BASE_SEPOLIA_CHAIN_ID): Address | null {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return (
      optionalAddress(readEnv("VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA")) ??
      optionalAddress(readEnv("VITE_GAS_RESCUE_ADDRESS"))
    );
  }
  return optionalAddress(readEnv("VITE_GAS_RESCUE_ADDRESS"));
}

export function tokenAddress(chainId: SupportedChainId = BASE_SEPOLIA_CHAIN_ID): Address | null {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return (
      optionalAddress(readEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA")) ??
      optionalAddress(readEnv("VITE_TOKEN_ADDRESS"))
    );
  }
  return optionalAddress(readEnv("VITE_TOKEN_ADDRESS"));
}

export function rpcUrl(chainId: SupportedChainId): string {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return readEnv("VITE_ARB_SEPOLIA_RPC_URL") || DEFAULT_RPC[ARB_SEPOLIA_CHAIN_ID];
  }
  return readEnv("VITE_BASE_SEPOLIA_RPC_URL") || DEFAULT_RPC[BASE_SEPOLIA_CHAIN_ID];
}

export function baseSepoliaRpcUrl(): string {
  return rpcUrl(BASE_SEPOLIA_CHAIN_ID);
}

export function isBaseSepolia(chainId: number | undefined): boolean {
  return chainId === BASE_SEPOLIA_CHAIN_ID;
}

export function isOnSelectedChain(
  walletChainId: number | undefined,
  selected: SupportedChainId,
): boolean {
  return walletChainId === selected;
}
