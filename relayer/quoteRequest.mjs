import { ARB_SEPOLIA_ONLY, fail } from "./httpError.mjs";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value) {
  return ADDRESS_RE.test(String(value ?? "").trim());
}

function trimmed(value) {
  return String(value ?? "").trim();
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ allowZero?: boolean }} [opts]
 */
export function parseWholeAmount(value, field, opts = {}) {
  const label = field || "amountIn";
  if (typeof value === "bigint") {
    if (value < 0n || (!opts.allowZero && value === 0n)) {
      throw fail(400, "invalid_amount", `${label} must be a positive whole number of token units.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw fail(
        400,
        "invalid_amount",
        `${label} must be a base-10 string of token units, not a JSON number.`,
      );
    }
    if (value < 0 || (!opts.allowZero && value === 0)) {
      throw fail(400, "invalid_amount", `${label} must be a positive whole number of token units.`);
    }
    return BigInt(value);
  }
  const s = trimmed(value);
  if (!s) {
    throw fail(400, "invalid_amount", `${label} is required and must be a positive whole number of token units.`);
  }
  if (!/^[0-9]+$/.test(s)) {
    throw fail(400, "invalid_amount", `${label} must be a positive whole number of token units (base-10).`);
  }
  const n = BigInt(s);
  if (!opts.allowZero && n === 0n) {
    throw fail(400, "invalid_amount", `${label} must be greater than zero.`);
  }
  return n;
}

/**
 * Cheap quote checks (no RPC). Chain is Arb Sepolia only.
 * @param {object} body
 * @param {{ defaultChainId?: number }} [opts]
 */
export function parseQuoteBody(body, opts = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw fail(400, "invalid_json", "Request body must be a JSON object.");
  }
  const defaultChainId = Number(opts.defaultChainId ?? 421614);
  const userRaw = body.user;
  if (userRaw === undefined || userRaw === null || trimmed(userRaw) === "") {
    throw fail(400, "missing_user", "user is required.");
  }
  if (!isAddress(userRaw)) {
    throw fail(400, "invalid_address", "user must be an 0x address (20 bytes).");
  }

  let tokenIn;
  if (body.tokenIn !== undefined && body.tokenIn !== null && trimmed(body.tokenIn) !== "") {
    if (!isAddress(body.tokenIn)) {
      throw fail(400, "invalid_address", "tokenIn must be an 0x address (20 bytes).");
    }
    tokenIn = trimmed(body.tokenIn);
  }

  const amountIn = parseWholeAmount(body.amountIn, "amountIn");

  let amountSwap;
  if (body.amountSwap !== undefined && body.amountSwap !== null && trimmed(body.amountSwap) !== "") {
    amountSwap = parseWholeAmount(body.amountSwap, "amountSwap", { allowZero: true });
  }

  let chainId = defaultChainId;
  if (body.chainId !== undefined && body.chainId !== null && body.chainId !== "") {
    const n = Number(body.chainId);
    if (!Number.isInteger(n) || n !== 421614) {
      throw fail(400, "wrong_chain", ARB_SEPOLIA_ONLY);
    }
    chainId = n;
  } else if (defaultChainId !== 421614) {
    throw fail(400, "wrong_chain", ARB_SEPOLIA_ONLY);
  }

  return {
    user: trimmed(userRaw),
    tokenIn,
    amountIn,
    amountSwap,
    chainId,
  };
}

/** Wallet that would receive the rescue. Invalid input is a 400, not a limit hit. */
export function parseRescueUser(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw fail(400, "invalid_json", "Request body must be a JSON object.");
  }
  const order = body.order;
  const user = order && typeof order === "object" ? order.user : undefined;
  if (user === undefined || user === null || trimmed(user) === "") {
    throw fail(400, "missing_user", "user is required.");
  }
  if (!isAddress(user)) {
    throw fail(400, "invalid_address", "user must be an 0x address (20 bytes).");
  }
  return trimmed(user);
}
