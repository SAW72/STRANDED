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

function envString(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalAddress(raw: string): Address | null {
  return raw && isAddress(raw) ? raw : null;
}

/**
 * Public Relayer origin for the selected testnet.
 * Arb uses only VITE_RELAYER_URL_ARB_SEPOLIA (empty → sample quotes).
 * Base uses VITE_RELAYER_URL, then VITE_RELAYER_BASE_URL.
 * Never fall back to the Base Relayer origin — that host is a different chain.
 * Unprefixed RELAYER_BASE_URL is not read. See DEPLOY.md.
 */
export function relayerUrl(chainId?: SupportedChainId): string {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return envString(import.meta.env.VITE_RELAYER_URL_ARB_SEPOLIA).replace(/\/$/, "");
  }
  const raw =
    envString(import.meta.env.VITE_RELAYER_URL) || envString(import.meta.env.VITE_RELAYER_BASE_URL);
  return raw.replace(/\/$/, "");
}

/** @deprecated use relayerUrl — kept so existing imports do not break during the align. */
export function relayerBaseUrl(): string {
  return relayerUrl();
}

export function gasRescueAddress(chainId: SupportedChainId = BASE_SEPOLIA_CHAIN_ID): Address | null {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return optionalAddress(envString(import.meta.env.VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA));
  }
  return optionalAddress(envString(import.meta.env.VITE_GAS_RESCUE_ADDRESS));
}

/** Optional. Empty until Spencer broadcasts `DeployGasRescueLens` on Arb Sepolia. */
export function gasRescueLensAddress(): Address | null {
  return optionalAddress(envString(import.meta.env.VITE_GAS_RESCUE_LENS_ADDRESS));
}

/** Live SDEMO on Arb Sepolia. The faucet cannot mint more of it. */
export const LIVE_SDEMO_ADDRESS = "0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C" as Address;

/**
 * Arb Sepolia SDEMO faucet. Empty until Spencer deploys `SdemoFaucet`
 * and sets VITE_SDEMO_FAUCET_ARB_SEPOLIA. Not a secret.
 */
export function sdemoFaucetAddress(): Address | null {
  return optionalAddress(readEnv("VITE_SDEMO_FAUCET_ARB_SEPOLIA"));
}

export function tokenAddress(chainId: SupportedChainId = BASE_SEPOLIA_CHAIN_ID): Address | null {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return optionalAddress(envString(import.meta.env.VITE_TOKEN_ADDRESS_ARB_SEPOLIA));
  }
  return optionalAddress(envString(import.meta.env.VITE_TOKEN_ADDRESS));
}

/**
 * Public origin for GET /points/:wallet and GET /points/leaderboard.
 * Empty unless VITE_POINTS_API_URL is set — the dashboard then uses labelled example data.
 */
export function pointsApiUrl(): string {
  return envString(import.meta.env.VITE_POINTS_API_URL).replace(/\/$/, "");
}

export function rpcUrl(chainId: SupportedChainId): string {
  if (chainId === ARB_SEPOLIA_CHAIN_ID) {
    return envString(import.meta.env.VITE_ARB_SEPOLIA_RPC_URL) || DEFAULT_RPC[ARB_SEPOLIA_CHAIN_ID];
  }
  return envString(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL) || DEFAULT_RPC[BASE_SEPOLIA_CHAIN_ID];
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
