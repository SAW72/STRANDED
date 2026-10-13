/**
 * Single source of truth for the demo-token disclosure and the site banner.
 * The ticker comes from the configured or loaded token symbol (GRTT today, SDEMO after the flip).
 */

const TICKER = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

export const UNKNOWN_TOKEN_DISCLOSURE =
  "This is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";

export const UNKNOWN_DEMO_BANNER = "Testnet demo. This token has no value and isn't for sale.";

/** Loaded symbol, or null when it is missing or not a ticker. */
export function demoTicker(symbol: string | null | undefined): string | null {
  if (typeof symbol !== "string") return null;
  const trimmed = symbol.trim();
  return TICKER.test(trimmed) ? trimmed : null;
}

export function tokenDisclosure(symbol: string | null | undefined): string {
  const ticker = demoTicker(symbol);
  if (!ticker) return UNKNOWN_TOKEN_DISCLOSURE;
  return `${ticker} is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.`;
}

export function demoBannerText(symbol: string | null | undefined): string {
  const ticker = demoTicker(symbol);
  if (!ticker) return UNKNOWN_DEMO_BANNER;
  return `Testnet demo. ${ticker} has no value and isn't for sale.`;
}
