/**
 * Single source of truth for the demo-token disclosure and the site banner.
 * The ticker comes from the configured or loaded token symbol (SDEMO on Arb, tDEMO once deployed).
 * SDEMO's sentence stays the Arbitrum Sepolia wording on every chain.
 * Other tickers follow the selected testnet: Base Sepolia (84532) or Arbitrum Sepolia (421614).
 */

import { BASE_SEPOLIA_CHAIN_ID } from "./chains";

const TICKER = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

export const UNKNOWN_TOKEN_DISCLOSURE =
  "This is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";

const UNKNOWN_BASE_DISCLOSURE =
  "This is a testnet demo token on Base Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";

const SDEMO_DISCLOSURE =
  "SDEMO is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";

export const UNKNOWN_DEMO_BANNER = "Testnet demo. This token has no value and isn't for sale.";

/** Loaded symbol, or null when it is missing or not a ticker. */
export function demoTicker(symbol: string | null | undefined): string | null {
  if (typeof symbol !== "string") return null;
  const trimmed = symbol.trim();
  return TICKER.test(trimmed) ? trimmed : null;
}

export function tokenDisclosure(symbol: string | null | undefined, chainId?: number): string {
  const ticker = demoTicker(symbol);
  if (ticker === "SDEMO") return SDEMO_DISCLOSURE;
  const onBase = chainId === BASE_SEPOLIA_CHAIN_ID;
  if (!ticker) return onBase ? UNKNOWN_BASE_DISCLOSURE : UNKNOWN_TOKEN_DISCLOSURE;
  const network = onBase ? "Base Sepolia" : "Arbitrum Sepolia";
  return `${ticker} is a testnet demo token on ${network}. It has no value and is not for sale. This is experimental, unaudited demo software.`;
}

export function demoBannerText(symbol: string | null | undefined): string {
  const ticker = demoTicker(symbol);
  if (!ticker) return UNKNOWN_DEMO_BANNER;
  return `Testnet demo. ${ticker} has no value and isn't for sale.`;
}
