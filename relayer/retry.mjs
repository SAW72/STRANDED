/**
 * Bounded broadcast retry after simulate-ok.
 * Transient RPC / account-nonce / replacement only. User and signature
 * reverts must not loop.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 200;

const PERMANENT_MARKERS = [
  "invalidsignature",
  "invalid_signature",
  "usednonce",
  "used_nonce",
  "underfunded",
  "expired",
  "deadlineexpired",
  "pathmismatch",
  "path_mismatch",
  "routernotallowed",
  "router_not_allowed",
  "wrongchain",
  "wrong_chain",
  "erc2612invalidsigner",
  "nogaslessauth",
  "notrelayer",
  "enforcedpause",
  "swapfailed",
  "fotorbalancemismatch",
  "dustremaining",
  "swapinputnotconsumed",
  "user rejected",
  "user denied",
  "simulation_failed",
];

const TRANSIENT_MARKERS = [
  "timeout",
  "timed out",
  "etimedout",
  "econnreset",
  "econnrefused",
  "enotfound",
  "eai_again",
  "socket hang up",
  "fetch failed",
  "network",
  "429",
  "502",
  "503",
  "504",
  "rate limit",
  "too many requests",
  "temporarily unavailable",
  "internal json-rpc",
  "header not found",
  "nonce too low",
  "nonce has already been used",
  "nonce_expired",
  "replacement transaction underpriced",
  "replacement underpriced",
  "already known",
  "alreadyknown",
  "try again",
  "server error",
];

function blob(err) {
  if (!err) return "";
  const parts = [
    err.shortMessage,
    err.details,
    err.walk?.(true)?.message,
    err.message,
    err.name,
    err.code,
    err.cause?.message,
    err.cause?.code,
  ];
  return parts
    .filter((p) => p !== undefined && p !== null)
    .join(" ")
    .toLowerCase();
}

export function isTransientBroadcastError(err) {
  const text = blob(err);
  if (!text) return false;
  if (PERMANENT_MARKERS.some((m) => text.includes(m))) return false;
  return TRANSIENT_MARKERS.some((m) => text.includes(m));
}

export function backoffMs(attempt, baseDelayMs = DEFAULT_BASE_DELAY_MS) {
  const exp = Math.max(0, attempt - 1);
  return Number(baseDelayMs) * 2 ** exp;
}

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.baseDelayMs]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {(info: object) => void} [opts.log]
 */
export async function withBroadcastRetry(fn, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts || DEFAULT_MAX_ATTEMPTS));
  const baseDelayMs = Number(opts.baseDelayMs || DEFAULT_BASE_DELAY_MS);
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log || (() => {});

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const transient = isTransientBroadcastError(err);
      const delayMs = attempt < maxAttempts && transient ? backoffMs(attempt, baseDelayMs) : 0;
      const message = err && (err.shortMessage || err.message || String(err));
      log({
        event: "broadcast_retry",
        attempt,
        maxAttempts,
        transient,
        delayMs,
        message: String(message || "unknown").slice(0, 240),
      });
      if (!transient || attempt === maxAttempts) {
        throw err;
      }
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
