/**
 * Single source of truth for the demo-token disclosure and the site banner.
 * The ticker comes from the configured or loaded token symbol (GRTT today, SDEMO after the flip).
 * Sample mode always passes SDEMO. The network name follows the selected chain.
 */

import { BASE_SEPOLIA_CHAIN_ID } from "./chains";

const TICKER = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

const DISCLOSURE_TAIL =
  "It has no value and is not for sale. This is experimental, unaudited demo software.";

/** Ticker used for every sample-mode label. */
export const DEMO_FALLBACK_TICKER = "SDEMO";

export const UNKNOWN_DEMO_BANNER = `Testnet demo. ${DEMO_FALLBACK_TICKER} has no value and isn't for sale.`;

export function disclosureNetwork(chainId?: number): string {
  return chainId === BASE_SEPOLIA_CHAIN_ID ? "Base Sepolia" : "Arbitrum Sepolia";
}

/** Loaded symbol, or null when it is missing or not a ticker. */
export function demoTicker(symbol: string | null | undefined): string | null {
  if (typeof symbol !== "string") return null;
  const trimmed = symbol.trim();
  return TICKER.test(trimmed) ? trimmed : null;
}

export function tokenDisclosure(symbol: string | null | undefined, chainId?: number): string {
  const network = disclosureNetwork(chainId);
  const ticker = demoTicker(symbol);
  if (!ticker) return `This is a testnet demo token on ${network}. ${DISCLOSURE_TAIL}`;
  return `${ticker} is a testnet demo token on ${network}. ${DISCLOSURE_TAIL}`;
}

export const UNKNOWN_TOKEN_DISCLOSURE = tokenDisclosure(null);

export function demoBannerText(symbol: string | null | undefined): string {
  const ticker = demoTicker(symbol);
  if (!ticker) return UNKNOWN_DEMO_BANNER;
  return `Testnet demo. ${ticker} has no value and isn't for sale.`;
}
