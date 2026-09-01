import { isAddress, type Address } from "viem";

/** Quote fields required to review and sign. Missing any one blocks the sign path. */
export type RescueQuote = {
  amount: bigint;
  feeAmount: bigint;
  feeTo: Address;
  tokenDecimals: number;
  deadline?: bigint;
  nonce?: bigint;
  token?: Address;
};

export type QuoteFetchResult =
  | { ok: true; quote: RescueQuote; source: string }
  | { ok: false; reason: string };

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

function unwrapCandidate(data: unknown): unknown {
  const obj = asObject(data);
  if (!obj) return data;
  if (obj.quote !== undefined) return obj.quote;
  if (Array.isArray(obj.quotes) && obj.quotes.length > 0) return obj.quotes[0];
  return obj;
}

/**
 * Parse Relayer GET /quotes JSON. Returns null when required fields are absent
 * or invalid. Does not invent feeAmount / amount / feeTo.
 */
export function parseQuoteResponse(data: unknown): RescueQuote | null {
  const raw = asObject(unwrapCandidate(data));
  if (!raw) return null;

  const amount = readBigInt(raw.amount);
  const feeAmount = readBigInt(raw.feeAmount);
  const feeTo = readAddress(raw.feeTo);
  const tokenDecimals = readDecimals(raw.tokenDecimals);

  if (amount === null || feeAmount === null || feeTo === null || tokenDecimals === null) {
    return null;
  }
  if (amount === 0n || feeAmount >= amount) return null;

  const quote: RescueQuote = { amount, feeAmount, feeTo, tokenDecimals };
  const deadline = readBigInt(raw.deadline);
  const nonce = readBigInt(raw.nonce);
  const token = readAddress(raw.token);
  if (deadline !== null) quote.deadline = deadline;
  if (nonce !== null) quote.nonce = nonce;
  if (token) quote.token = token;
  return quote;
}

export function quotesUrl(
  relayerBase: string,
  params: { chainId: number; token: Address; amount: bigint; user: Address },
): string {
  const base = relayerBase.replace(/\/$/, "");
  const url = new URL(`${base}/quotes`);
  url.searchParams.set("chainId", String(params.chainId));
  url.searchParams.set("token", params.token);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("user", params.user);
  return url.toString();
}

/**
 * Fetch a quote from Relayer GET /quotes.
 * Fail closed: empty base URL, HTTP error, or unparsable body → not ok.
 */
export async function fetchRescueQuote(
  relayerBase: string,
  params: { chainId: number; token: Address; amount: bigint; user: Address },
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteFetchResult> {
  if (!relayerBase.trim()) {
    return { ok: false, reason: "RELAYER_BASE_URL is not set." };
  }
  if (params.amount === 0n) {
    return { ok: false, reason: "Amount is zero; no quote requested." };
  }

  const source = quotesUrl(relayerBase, params);
  let response: Response;
  try {
    response = await fetchImpl(source, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, reason: `Could not reach Relayer GET /quotes at ${relayerBase}.` };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `Relayer GET /quotes returned HTTP ${response.status}. Signing is blocked.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "Relayer GET /quotes did not return JSON." };
  }

  const quote = parseQuoteResponse(body);
  if (!quote) {
    return {
      ok: false,
      reason:
        "Relayer quote is missing required fields (amount, feeAmount, feeTo, tokenDecimals).",
    };
  }

  return { ok: true, quote, source };
}
