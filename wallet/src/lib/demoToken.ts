import { isAddress, type Address } from "viem";

/**
 * Live open GRTT on Arb Sepolia. The demo-token default for the wallet.
 * Do not replace this with a nonce-predicted address. After Spencer signs
 * the H1 migration, set `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` on the Render static
 * site `stranded` to the deployed token and rebuild.
 */
export const LIVE_ARB_GRTT = "0x5649fF51123D534044aA7E6cBc8762698Ffed713" as const;

/** Fixed-supply SDEMO. Eighteen tokens sit in its faucet. Rescue uses tDEMO. */
export const LIVE_SDEMO_ADDRESS = "0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C" as const;

/** Arb Sepolia tDEMO. One trillion tokens, no later mint. Not a secret. */
export const LIVE_TDEMO_ADDRESS = "0x0EAfC1151CfbAFBFDa307C7C8F40Ae2dF5dAaBD7" as Address;

const RETIRED_ARB_DEMO = new Set([LIVE_ARB_GRTT.toLowerCase(), LIVE_SDEMO_ADDRESS.toLowerCase()]);

/** tDEMO, unless the env sets some other address. SDEMO and GRTT map to tDEMO. */
export function liveDemoToken(): Address {
  const raw = envString(import.meta.env.VITE_TOKEN_ADDRESS_ARB_SEPOLIA);
  if (raw && isAddress(raw) && !RETIRED_ARB_DEMO.has(raw.toLowerCase())) return raw;
  return LIVE_TDEMO_ADDRESS;
}

function envString(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
