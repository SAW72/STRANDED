import { isAddress, isHex, type Address, type Hex } from "viem";
import { isSupportedChainId, type SupportedChainId } from "./chains";

/** Canonical Relayer / fixture quote. Field names must match the design freeze. */
export type RescueQuote = {
  quoteId: string;
  chainId: SupportedChainId;
  tokenIn: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  user: Address;
  amountIn: bigint;
  amountSwap: bigint;
  feeAmount: bigint;
  feeTo: Address;
  to: Address;
  nativeTo: Address;
  minAmountOut: bigint;
  amountRemainder: bigint;
  router: Address;
  pathHash: Hex;
  deadline: bigint;
  nonce: bigint;
};

export type QuoteSource = "relayer" | "fixture";

export type QuoteFetchResult =
  | { ok: true; quote: RescueQuote; source: QuoteSource }
  | { ok: false; reason: string };

/** Fields the Review rescue screen must show before Confirm details. */
export const DISPLAY_BEFORE_CONFIRM = [
  "amountIn",
  "amountSwap",
  "amountRemainder",
  "feeAmount",
  "feeTo",
  "to",
  "nativeTo",
  "minAmountOut",
  "tokenSymbol",
  "tokenDecimals",
  "chainId",
] as const;

export type DisplayBeforeConfirm = Pick<RescueQuote, (typeof DISPLAY_BEFORE_CONFIRM)[number]>;

/** EIP-712 Order fields the user must review before sign. nativeTo — not safeRecipient. */
export const ORDER_REVIEW_FIELDS = [
  "user",
  "tokenIn",
  "amountIn",
  "feeAmount",
  "feeTo",
  "amountSwap",
  "minAmountOut",
  "to",
  "nativeTo",
  "router",
  "pathHash",
  "chainId",
  "deadline",
  "nonce",
] as const;

export function displayBeforeConfirm(quote: RescueQuote): DisplayBeforeConfirm {
  return {
    amountIn: quote.amountIn,
    amountSwap: quote.amountSwap,
    amountRemainder: quote.amountRemainder,
    feeAmount: quote.feeAmount,
    feeTo: quote.feeTo,
    to: quote.to,
    nativeTo: quote.nativeTo,
    minAmountOut: quote.minAmountOut,
    tokenSymbol: quote.tokenSymbol,
    tokenDecimals: quote.tokenDecimals,
    chainId: quote.chainId,
  };
}

export function hasRequiredQuoteFields(quote: RescueQuote | null): quote is RescueQuote {
  if (!quote) return false;
  if (quote.quoteId.length === 0 || quote.tokenSymbol.length === 0) return false;
  return (
    ORDER_REVIEW_FIELDS.every((key) => quote[key] !== undefined && quote[key] !== null) &&
    quote.amountRemainder !== undefined &&
    quote.tokenDecimals !== undefined
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function readAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? value : null;
}

function readDecimals(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 36) {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value.trim())) {
    const n = Number(value.trim());
    return n >= 0 && n <= 36 ? n : null;
  }
  return null;
}

function readChainId(value: unknown): SupportedChainId | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value.trim())
        ? Number(value.trim())
        : null;
  return n !== null && isSupportedChainId(n) ? n : null;
}

function readPathHash(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isHex(trimmed) || trimmed.length !== 66) return null;
  return trimmed;
}

function readQuoteId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readSymbol(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unwrapCandidate(data: unknown): unknown {
  const obj = asObject(data);
  if (!obj) return data;
  if (obj.quote !== undefined) return obj.quote;
  if (Array.isArray(obj.quotes) && obj.quotes.length > 0) return obj.quotes[0];
  return obj;
}

const REQUIRED_PARSE_HINT =
  "quoteId, chainId, tokenIn, tokenSymbol, tokenDecimals, user, amountIn, amountSwap, feeAmount, feeTo, to, nativeTo, minAmountOut, amountRemainder, router, pathHash, deadline, nonce";

function sameInt(left: unknown, right: bigint): boolean {
  const parsed = readBigInt(left);
  return parsed !== null && parsed === right;
}

function sameAddress(left: unknown, right: Address): boolean {
  const parsed = readAddress(left);
  return parsed !== null && parsed.toLowerCase() === right.toLowerCase();
}

function samePath(left: unknown, right: Hex): boolean {
  const parsed = readPathHash(left);
  return parsed !== null && parsed.toLowerCase() === right.toLowerCase();
}

/**
 * If `eip712` is present, fail closed unless domain is StewardGasRescue / 1,
 * Order field order matches the freeze, and message agrees with top-level fields.
 */
function eip712Agrees(raw: Record<string, unknown>, quote: RescueQuote): boolean {
  if (raw.eip712 === undefined) return true;
  const eip = asObject(raw.eip712);
  if (!eip) return false;
  const domain = asObject(eip.domain);
  if (!domain) return false;
  if (domain.name !== "StewardGasRescue") return false;
  if (String(domain.version) !== "1") return false;
  const domainChain = readChainId(domain.chainId);
  if (domainChain !== quote.chainId) return false;
  if (eip.primaryType !== undefined && eip.primaryType !== "Order") return false;

  const types = asObject(eip.types);
  const orderType = types?.Order;
  if (!Array.isArray(orderType)) return false;
  const names = orderType.map((field) => {
    const obj = asObject(field);
    return obj ? obj.name : null;
  });
  if (JSON.stringify(names) !== JSON.stringify([...ORDER_REVIEW_FIELDS])) return false;
  if (names.includes("safeRecipient")) return false;

  const message = asObject(eip.message);
  if (!message) return false;
  if (!sameAddress(message.user, quote.user)) return false;
  if (!sameAddress(message.tokenIn, quote.tokenIn)) return false;
  if (!sameInt(message.amountIn, quote.amountIn)) return false;
  if (!sameInt(message.feeAmount, quote.feeAmount)) return false;
  if (!sameAddress(message.feeTo, quote.feeTo)) return false;
  if (!sameInt(message.amountSwap, quote.amountSwap)) return false;
  if (!sameInt(message.minAmountOut, quote.minAmountOut)) return false;
  if (!sameAddress(message.to, quote.to)) return false;
  if (!sameAddress(message.nativeTo, quote.nativeTo)) return false;
  if (!sameAddress(message.router, quote.router)) return false;
  if (!samePath(message.pathHash, quote.pathHash)) return false;
  if (!sameInt(message.chainId, BigInt(quote.chainId))) return false;
  if (!sameInt(message.deadline, quote.deadline)) return false;
  if (!sameInt(message.nonce, quote.nonce)) return false;
  if (message.safeRecipient !== undefined) return false;
  return true;
}

/**
 * Parse Relayer POST /v1/quotes QuoteResponse JSON. Top-level Appendix A fields
 * are required. Returns null when required fields are absent or invalid.
 * Does not invent amounts, addresses, or swap legs.
 * Does not read `safeRecipient` — native gas destination is `nativeTo` only.
 */
export function parseQuoteResponse(data: unknown): RescueQuote | null {
  const raw = asObject(unwrapCandidate(data));
  if (!raw) return null;

  const quoteId = readQuoteId(raw.quoteId);
  const chainId = readChainId(raw.chainId);
  const tokenIn = readAddress(raw.tokenIn);
  const tokenSymbol = readSymbol(raw.tokenSymbol);
  const tokenDecimals = readDecimals(raw.tokenDecimals);
  const user = readAddress(raw.user);
  const amountIn = readBigInt(raw.amountIn);
  const amountSwap = readBigInt(raw.amountSwap);
  const feeAmount = readBigInt(raw.feeAmount);
  const feeTo = readAddress(raw.feeTo);
  const to = readAddress(raw.to);
  const nativeTo = readAddress(raw.nativeTo);
  const minAmountOut = readBigInt(raw.minAmountOut);
  const amountRemainder = readBigInt(raw.amountRemainder);
  const router = readAddress(raw.router);
  const pathHash = readPathHash(raw.pathHash);
  const deadline = readBigInt(raw.deadline);
  const nonce = readBigInt(raw.nonce);

  if (
    quoteId === null ||
    chainId === null ||
    tokenIn === null ||
    tokenSymbol === null ||
    tokenDecimals === null ||
    user === null ||
    amountIn === null ||
    amountSwap === null ||
    feeAmount === null ||
    feeTo === null ||
    to === null ||
    nativeTo === null ||
    minAmountOut === null ||
    amountRemainder === null ||
    router === null ||
    pathHash === null ||
    deadline === null ||
    nonce === null
  ) {
    return null;
  }

  if (amountIn === 0n) return null;
  if (amountSwap === 0n) return null;
  if (feeAmount >= amountIn) return null;
  if (amountSwap + feeAmount + amountRemainder !== amountIn) return null;

  const quote: RescueQuote = {
    quoteId,
    chainId,
    tokenIn,
    tokenSymbol,
    tokenDecimals,
    user,
    amountIn,
    amountSwap,
    feeAmount,
    feeTo,
    to,
    nativeTo,
    minAmountOut,
    amountRemainder,
    router,
    pathHash,
    deadline,
    nonce,
  };

  if (!eip712Agrees(raw, quote)) return null;
  return quote;
}

/** POST /v1/quotes request. Required: user, tokenIn, amountIn. */
export type QuoteRequest = {
  user: Address;
  tokenIn: Address;
  amountIn: bigint;
  chainId?: number;
  amountSwap?: bigint;
  to?: Address;
  nativeTo?: Address;
  slippageBps?: number;
};

export function quotesUrl(relayerBase: string): string {
  const base = relayerBase.replace(/\/$/, "");
  return `${base}/v1/quotes`;
}

export function quoteRequestBody(params: QuoteRequest): Record<string, string | number> {
  const body: Record<string, string | number> = {
    user: params.user,
    tokenIn: params.tokenIn,
    amountIn: params.amountIn.toString(),
  };
  if (params.chainId !== undefined) body.chainId = params.chainId;
  if (params.amountSwap !== undefined) body.amountSwap = params.amountSwap.toString();
  if (params.to) body.to = params.to;
  if (params.nativeTo) body.nativeTo = params.nativeTo;
  if (params.slippageBps !== undefined) body.slippageBps = params.slippageBps;
  return body;
}

/**
 * Fetch a quote from Relayer POST /v1/quotes.
 * Fail closed: empty base URL, HTTP error, or unparsable body → not ok.
 * Never synthesizes a live quote. Fixtures are used only when VITE_RELAYER_URL is unset.
 */
export async function fetchRescueQuote(
  relayerBase: string,
  params: QuoteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteFetchResult> {
  if (!relayerBase.trim()) {
    return { ok: false, reason: "VITE_RELAYER_URL is not set." };
  }
  if (params.chainId !== undefined && !isSupportedChainId(params.chainId)) {
    return { ok: false, reason: "Quotes are only requested on Base Sepolia or Arb Sepolia." };
  }
  if (params.amountIn === 0n) {
    return { ok: false, reason: "Amount is zero; no quote requested." };
  }

  const source = quotesUrl(relayerBase);
  let response: Response;
  try {
    response = await fetchImpl(source, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(quoteRequestBody(params)),
    });
  } catch {
    return { ok: false, reason: `Could not reach Relayer POST /v1/quotes at ${relayerBase}.` };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `Relayer POST /v1/quotes returned HTTP ${response.status}. Signing is blocked.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "Relayer POST /v1/quotes did not return JSON." };
  }

  const quote = parseQuoteResponse(body);
  if (!quote) {
    return {
      ok: false,
      reason: `Relayer quote is missing required fields (${REQUIRED_PARSE_HINT}).`,
    };
  }

  if (params.chainId !== undefined && quote.chainId !== params.chainId) {
    return { ok: false, reason: "Relayer quote chainId does not match the selected testnet." };
  }

  return { ok: true, quote, source: "relayer" };
}
