import {
  ARB_SEPOLIA_ONLY,
  INVALID_AMOUNT_MESSAGE,
  INVALID_JSON_MESSAGE,
  INVALID_TOKEN_ADDRESS_MESSAGE,
  INVALID_WALLET_ADDRESS_MESSAGE,
  MISSING_USER_MESSAGE,
  fail,
} from "./httpError.mjs";

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
  void field;
  if (typeof value === "bigint") {
    if (value < 0n || (!opts.allowZero && value === 0n)) {
      throw fail(400, "invalid_amount", INVALID_AMOUNT_MESSAGE);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || (!opts.allowZero && value === 0)) {
      throw fail(400, "invalid_amount", INVALID_AMOUNT_MESSAGE);
    }
    return BigInt(value);
  }
  const s = trimmed(value);
  if (!s || !/^[0-9]+$/.test(s)) {
    throw fail(400, "invalid_amount", INVALID_AMOUNT_MESSAGE);
  }
  const n = BigInt(s);
  if (!opts.allowZero && n === 0n) {
    throw fail(400, "invalid_amount", INVALID_AMOUNT_MESSAGE);
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
    throw fail(400, "invalid_json", INVALID_JSON_MESSAGE);
  }
  const defaultChainId = Number(opts.defaultChainId ?? 421614);
  const userRaw = body.user;
  if (userRaw === undefined || userRaw === null || trimmed(userRaw) === "") {
    throw fail(400, "missing_user", MISSING_USER_MESSAGE);
  }
  if (!isAddress(userRaw)) {
    throw fail(400, "invalid_address", INVALID_WALLET_ADDRESS_MESSAGE);
  }

  let tokenIn;
  if (body.tokenIn !== undefined && body.tokenIn !== null && trimmed(body.tokenIn) !== "") {
    if (!isAddress(body.tokenIn)) {
      throw fail(400, "invalid_address", INVALID_TOKEN_ADDRESS_MESSAGE);
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
    throw fail(400, "invalid_json", INVALID_JSON_MESSAGE);
  }
  const order = body.order;
  const user = order && typeof order === "object" ? order.user : undefined;
  if (user === undefined || user === null || trimmed(user) === "") {
    throw fail(400, "missing_user", MISSING_USER_MESSAGE);
  }
  if (!isAddress(user)) {
    throw fail(400, "invalid_address", INVALID_WALLET_ADDRESS_MESSAGE);
  }
  return trimmed(user);
}
