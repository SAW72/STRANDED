import { isAddress, type Address } from "viem";

/**
 * Live open GRTT on Arb Sepolia. The demo-token default for the wallet.
 * Do not replace this with a nonce-predicted address. After Spencer signs
 * the H1 migration, set `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` on the Render static
 * site `stranded` to the deployed token and rebuild.
 */
export const LIVE_ARB_GRTT = "0x5649fF51123D534044aA7E6cBc8762698Ffed713" as const;

/** Env override, or live GRTT when unset or not an address. */
export function liveDemoToken(): Address {
  const raw = readEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA");
  return raw && isAddress(raw) ? raw : LIVE_ARB_GRTT;
}

function readEnv(name: string): string {
  const value = (import.meta.env as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}
