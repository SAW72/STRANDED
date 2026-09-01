import { isAddress, type Address } from "viem";
import { baseSepolia } from "viem/chains";

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;

export const FEE_HELPER_COPY =
  "About 1% of the amount you rescue (testnet floor/ceiling apply in token units).";

const DEFAULT_RPC = "https://sepolia.base.org";

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function optionalAddress(raw: string): Address | null {
  return raw && isAddress(raw) ? raw : null;
}

/** Relayer origin from RELAYER_BASE_URL (preferred) or VITE_RELAYER_BASE_URL. */
export function relayerBaseUrl(): string {
  const raw = readEnv("RELAYER_BASE_URL") || readEnv("VITE_RELAYER_BASE_URL");
  return raw.replace(/\/$/, "");
}

export function gasRescueAddress(): Address | null {
  return optionalAddress(readEnv("VITE_GAS_RESCUE_ADDRESS"));
}

export function tokenAddress(): Address | null {
  return optionalAddress(readEnv("VITE_TOKEN_ADDRESS"));
}

export function baseSepoliaRpcUrl(): string {
  return readEnv("VITE_BASE_SEPOLIA_RPC_URL") || DEFAULT_RPC;
}

export function isBaseSepolia(chainId: number | undefined): boolean {
  return chainId === BASE_SEPOLIA_CHAIN_ID || chainId === baseSepolia.id;
}
