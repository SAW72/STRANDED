/**
 * Public HTTP errors. Responses carry a stable code and a short message.
 * They never include stack traces, RPC URLs, or secrets.
 */

const DEFAULT_STATUS = {
  invalid_json: 400,
  missing_user: 400,
  invalid_address: 400,
  invalid_amount: 400,
  invalid_amount_split: 400,
  wrong_chain: 400,
  token_not_contract: 400,
  amount_too_small: 400,
  insufficient_balance: 400,
  path_mismatch: 400,
  router_not_allowed: 400,
  used_nonce: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited_wallet: 429,
  rate_limited_ip: 429,
  relayer_paused: 503,
  nonce_unavailable: 503,
  quote_unavailable: 502,
  upstream_unavailable: 502,
  simulation_failed: 502,
  broadcast_failed: 502,
  request_failed: 500,
};

export const UPSTREAM_MESSAGE = "The network request failed. Try again in a moment.";
export const BROADCAST_FAILED_MESSAGE = "The rescue could not be broadcast. Try again in a moment.";
export const ARB_SEPOLIA_ONLY = "this Relayer is Arb Sepolia only";
export const AMOUNT_TOO_SMALL_MESSAGE =
  "This amount is too small to pay out native gas. Try a larger amount.";

/**
 * @param {number} status
 * @param {string} code
 * @param {string} [message]
 * @param {{ retryAfter?: number, retryAt?: string, revert?: string }} [extra]
 */
export function fail(status, code, message, extra = {}) {
  const err = new Error(message || code);
  err.status = status;
  err.error = code;
  err.publicMessage = message || "";
  if (extra.retryAfter != null) err.retryAfter = extra.retryAfter;
  if (extra.retryAt) err.retryAt = extra.retryAt;
  if (extra.revert) err.revert = extra.revert;
  return err;
}

function safeRevert(value) {
  if (typeof value !== "string" || !value) return undefined;
  const oneLine = value.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!oneLine) return undefined;
  if (/https?:\/\//i.test(oneLine)) return undefined;
  if (/private[_-]?key|mnemonic|secret/i.test(oneLine)) return undefined;
  return oneLine;
}

/**
 * Map an internal error to a response. Unknown errors become request_failed.
 * @param {unknown} err
 */
export function toPublicError(err) {
  const code = err && typeof err.error === "string" ? err.error : "";
  const known = Object.prototype.hasOwnProperty.call(DEFAULT_STATUS, code);
  if (!known) {
    if (err && err.message === "insufficient_balance") {
      return {
        status: 400,
        body: { ok: false, error: "insufficient_balance" },
        headers: {},
      };
    }
    return {
      status: 500,
      body: { ok: false, error: "request_failed" },
      headers: {},
    };
  }

  const statusFromErr = err && Number.isInteger(err.status) ? err.status : 0;
  const status = statusFromErr >= 400 && statusFromErr <= 599 ? statusFromErr : DEFAULT_STATUS[code];
  /** @type {Record<string, unknown>} */
  const body = { ok: false, error: code };
  const message = err && typeof err.publicMessage === "string" ? err.publicMessage : "";
  if (message && message !== code) body.message = message;
  const revert = safeRevert(err && err.revert);
  if (revert) body.revert = revert;

  /** @type {Record<string, string>} */
  const headers = {};
  const retryAfter = err && Number(err.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    const secs = Math.max(1, Math.ceil(retryAfter));
    body.retryAfter = secs;
    headers["retry-after"] = String(secs);
  }
  const retryAt = err && typeof err.retryAt === "string" ? err.retryAt : "";
  if (retryAt && retryAt.length <= 40 && !/[\r\n]/.test(retryAt)) body.retryAt = retryAt;

  return { status, body, headers };
}

/** Broadcast / unexpected failures stay coded and secret-free. */
export function asBroadcastFailure(err) {
  if (err && typeof err.error === "string" && Number.isInteger(err.status) && DEFAULT_STATUS[err.error]) {
    return err;
  }
  return fail(502, "broadcast_failed", BROADCAST_FAILED_MESSAGE);
}
