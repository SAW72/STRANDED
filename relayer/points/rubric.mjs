// ledgerStore imports MAX_POINTS_PER_ROW from this file. syntheticTxKey is
// called only from functions, after both modules have finished evaluating.
import { syntheticTxKey } from "./ledgerStore.mjs";

/**
 * Scoring rubric for docs/POINTS-PROGRAM.md.
 *
 * Points are off-chain scores and are unpaid. They are not a token and have
 * no cash value. This module does not read a price and does not score from
 * a dollar or token amount.
 *
 * RESCUE_POINTS_PLACEHOLDER is a FLAT 100 PLACEHOLDER pending Spencer's
 * decision. It is not a per-dollar score.
 *
 * Anti-gaming:
 * - One wallet session per wallet per ISO week. The week is the server
 *   clock. A caller-supplied `at` is ignored. The session tx key includes
 *   that week, so a second session in that week is a duplicate row.
 * - No referral action and no referral points.
 * - Splitting a rescue across wallets does not multiply points. One rescue
 *   transaction produces one award of the flat placeholder.
 * - A bug report needs an on-chain tx hash or reproducible steps.
 */

/** FLAT 100 PLACEHOLDER pending Spencer's decision. Not dollar-based. */
export const RESCUE_POINTS_PLACEHOLDER = 100;

/**
 * Maximum points stored on one ledger row.
 * This is the top of the bug-report range. schema.sql checks the same bound.
 */
export const MAX_POINTS_PER_ROW = 500;

export const FIXED_POINTS = Object.freeze({
  rescue_completed: RESCUE_POINTS_PLACEHOLDER,
  relayer_job: 50,
  registry_find_posted: 30,
  registry_find_claimed: 50,
  wallet_session: 10,
});

/** Working map of "100–500 by severity". Critical sits on the row cap. */
export const BUG_SEVERITY_POINTS = Object.freeze({
  low: 100,
  medium: 200,
  high: 300,
  critical: 500,
});

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const ONCHAIN_TX_RE = /^0x[0-9a-fA-F]{64}$/;
const REFERRAL_ACTIONS = new Set(["referral", "referral_bonus"]);

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function normalizeWallet(wallet) {
  const key = String(wallet ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(key)) throw fail("invalid_address");
  return key;
}

function normalizeOnchainTx(txHash) {
  const raw = String(txHash ?? "").trim();
  if (!ONCHAIN_TX_RE.test(raw)) throw fail("invalid_tx_hash");
  return raw.toLowerCase();
}

export function pointsForAction(action) {
  if (!Object.hasOwn(FIXED_POINTS, action)) throw fail("invalid_action");
  return FIXED_POINTS[action];
}

/**
 * ISO week of `input`, as `YYYY-Www` in UTC.
 * @param {string | number | Date} input
 */
export function isoWeekKey(input) {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) throw fail("invalid_week");
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const diffDays = (utc.getTime() - yearStart.getTime()) / 86400000;
  const week = Math.ceil((diffDays + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * One rescue, one flat award.
 * `wallets` may list every participant. The result is still one row: splitting
 * the rescue does not multiply points. `valueUsd` and other price fields are
 * not read.
 * @param {object} [input]
 */
export function scoreRescue(input = {}) {
  const txHash = normalizeOnchainTx(input.txHash);
  if (input.wallets !== undefined) {
    if (!Array.isArray(input.wallets) || input.wallets.length === 0) throw fail("invalid_address");
    for (const wallet of input.wallets) normalizeWallet(wallet);
  }
  return {
    action: "rescue_completed",
    points: RESCUE_POINTS_PLACEHOLDER,
    txHash,
  };
}

/**
 * Relayer jobs require a registered operator identity.
 * This does not look the operator up on a chain.
 * @param {object} [input]
 */
export function scoreRelayerJob(input = {}) {
  const operatorId = String(input.operatorId ?? "").trim();
  if (!operatorId) throw fail("operator_required");
  return {
    action: "relayer_job",
    points: FIXED_POINTS.relayer_job,
    txHash: normalizeOnchainTx(input.txHash),
    operatorId,
  };
}

/** Scores a posted find. It does not decide whether the balance is real. */
export function scoreRegistryFindPosted(input = {}) {
  return {
    action: "registry_find_posted",
    points: FIXED_POINTS.registry_find_posted,
    txHash: normalizeOnchainTx(input.txHash),
  };
}

/** Scores a claim. It does not decide whether the claim succeeded on-chain. */
export function scoreRegistryFindClaimed(input = {}) {
  return {
    action: "registry_find_claimed",
    points: FIXED_POINTS.registry_find_claimed,
    txHash: normalizeOnchainTx(input.txHash),
  };
}

/**
 * Ten points, once per wallet per ISO week.
 * The week is taken from `now` (the server clock: a function or a timestamp)
 * and defaults to Date.now. Caller field `at` is ignored.
 * The tx key is syntheticTxKey("wallet_session", [week, wallet]), and
 * syntheticTxKey lowercases its inputs, so address case does not open a
 * second session.
 * @param {object} [input]
 * @param {(() => number | string | Date) | number | string | Date} [now]
 */
export function scoreWalletSession(input = {}, now = Date.now) {
  const wallet = normalizeWallet(input.wallet);
  const instant = typeof now === "function" ? now() : now;
  const week = isoWeekKey(instant);
  return {
    action: "wallet_session",
    points: FIXED_POINTS.wallet_session,
    wallet,
    week,
    txHash: syntheticTxKey("wallet_session", [week, wallet]),
  };
}

function reproText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * Bug-report points come from BUG_SEVERITY_POINTS.
 * Evidence is an on-chain tx hash or non-empty repro steps. With steps and
 * no tx hash, the row uses a synthetic key so tx_hash stays NOT NULL.
 * @param {object} [input]
 */
export function scoreBugReport(input = {}) {
  const severity = String(input.severity ?? "");
  if (!Object.hasOwn(BUG_SEVERITY_POINTS, severity)) throw fail("invalid_severity");
  const steps = reproText(input.reproSteps);
  const rawTx = input.txHash == null ? "" : String(input.txHash).trim();
  const txOk = ONCHAIN_TX_RE.test(rawTx);
  if (!txOk && rawTx) throw fail("invalid_tx_hash");
  if (!txOk && !steps) throw fail("bug_report_evidence");
  const reportId = String(input.reportId ?? "").trim();
  const txHash = txOk ? rawTx.toLowerCase() : syntheticTxKey("bug_report", [reportId || steps]);
  return {
    action: "bug_report",
    points: BUG_SEVERITY_POINTS[severity],
    severity,
    txHash,
  };
}

/** Referrals are not a rubric action. */
export function scoreReferral() {
  throw fail("referrals_disabled");
}

/**
 * Score one rubric event.
 * Referral actions throw `referrals_disabled`.
 * `now` is the server clock used for a wallet session. Caller field `at` is ignored.
 * @param {object} input
 * @param {(() => number | string | Date) | number | string | Date} [now]
 */
export function score(input, now = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("invalid_entry");
  const action = String(input.action ?? "").trim();
  if (REFERRAL_ACTIONS.has(action)) return scoreReferral();
  switch (action) {
    case "rescue_completed":
      return scoreRescue(input);
    case "relayer_job":
      return scoreRelayerJob(input);
    case "registry_find_posted":
      return scoreRegistryFindPosted(input);
    case "registry_find_claimed":
      return scoreRegistryFindClaimed(input);
    case "wallet_session":
      return scoreWalletSession(input, now);
    case "bug_report":
      return scoreBugReport(input);
    default:
      throw fail("invalid_action");
  }
}
