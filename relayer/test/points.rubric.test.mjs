import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createLedgerStore } from "../points/ledgerStore.mjs";
import {
  FIXED_POINTS,
  MAX_POINTS_PER_ROW,
  RESCUE_POINTS_PLACEHOLDER,
  isoWeekKey,
  pointsForAction,
  score,
  scoreReferral,
  scoreRelayerJob,
  scoreRescue,
} from "../points/rubric.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const THIRD = "0x3333333333333333333333333333333333333333";
const TX = `0x${"ab".repeat(32)}`;
const TX_MIXED = `0x${"aB".repeat(32)}`;

function rejection(code) {
  return (err) => err instanceof Error && err.code === code && err.message === code;
}

describe("points rubric", () => {
  it("scores the fixed actions from a table", () => {
    const rows = [
      { action: "rescue_completed", points: 100, run: () => scoreRescue({ txHash: TX }) },
      { action: "relayer_job", points: 50, run: () => scoreRelayerJob({ txHash: TX, operatorId: "op-1" }) },
      { action: "registry_find_posted", points: 30, run: () => score({ action: "registry_find_posted", txHash: TX }) },
      { action: "registry_find_claimed", points: 50, run: () => score({ action: "registry_find_claimed", txHash: TX }) },
    ];
    assert.equal(rows.length, Object.keys(FIXED_POINTS).length);
    for (const row of rows) {
      const scored = row.run();
      assert.equal(scored.action, row.action);
      assert.equal(scored.points, row.points);
      assert.equal(pointsForAction(row.action), row.points);
      assert.equal(FIXED_POINTS[row.action], row.points);
      assert.ok(scored.points <= MAX_POINTS_PER_ROW);
    }
    assert.equal(RESCUE_POINTS_PLACEHOLDER, 100);
    assert.equal(FIXED_POINTS.rescue_completed, RESCUE_POINTS_PLACEHOLDER);
  });

  it("keeps a split rescue at the flat placeholder", () => {
    const priceFields = [{}, { valueUsd: 0 }, { valueUsd: 1 }, { valueUsd: 10_000 }, { tokenAmount: 5 }, { dollarValue: 25 }];
    const walletSets = [[USER], [USER, OTHER], [USER, OTHER, THIRD]];
    for (const wallets of walletSets) {
      for (const extra of priceFields) {
        const scored = scoreRescue({ txHash: TX_MIXED, wallets, ...extra });
        assert.equal(scored.points, RESCUE_POINTS_PLACEHOLDER);
        assert.equal(scored.txHash, TX);
        assert.equal(scored.action, "rescue_completed");
      }
    }
    assert.throws(() => scoreRescue({ txHash: TX, wallets: [] }), rejection("invalid_address"));
  });

  it("rejects referrals", () => {
    assert.throws(() => scoreReferral(), rejection("referrals_disabled"));
    for (const action of ["referral", "referral_bonus"]) {
      assert.throws(() => score({ action, txHash: TX, wallets: [USER] }), rejection("referrals_disabled"));
      assert.equal(Object.hasOwn(FIXED_POINTS, action), false);
    }
    assert.throws(() => pointsForAction("referral"), rejection("invalid_action"));
    assert.throws(() => scoreRelayerJob({ txHash: TX, operatorId: "  " }), rejection("operator_required"));
  });

  it("awards no points for a bug report or security finding", () => {
    const actions = ["bug_report", "security", "security_finding", "finding"];
    const severities = ["low", "medium", "high", "critical"];
    for (const action of actions) {
      assert.equal(Object.hasOwn(FIXED_POINTS, action), false, action);
      assert.throws(() => pointsForAction(action), rejection("invalid_action"));
      for (const severity of severities) {
        let scored = null;
        assert.throws(
          () => {
            scored = score({
              action,
              severity,
              txHash: TX_MIXED,
              reproSteps: "open the wallet, then rescue",
              reportId: "R-9",
              points: 500,
            });
          },
          rejection("invalid_action"),
          action + " " + severity,
        );
        assert.equal(scored, null, action + " " + severity);
      }
    }
  });

  it("keeps ISO week keys and does not score a wallet session", async () => {
    const weeks = [
      { at: "2019-12-30T00:00:00.000Z", week: "2020-W01" },
      { at: "2020-01-01T12:00:00.000Z", week: "2020-W01" },
      { at: "2021-01-01T00:00:00.000Z", week: "2020-W53" },
      { at: "2026-10-12T15:00:00.000Z", week: isoWeekKey("2026-10-18T23:00:00.000Z") },
    ];
    for (const row of weeks) assert.equal(isoWeekKey(row.at), row.week);
    assert.notEqual(isoWeekKey("2026-10-18T23:00:00.000Z"), isoWeekKey("2026-10-19T00:00:00.000Z"));
    assert.throws(() => isoWeekKey("not-a-date"), rejection("invalid_week"));
    assert.equal(Object.hasOwn(FIXED_POINTS, "wallet_session"), false);
    assert.throws(() => pointsForAction("wallet_session"), rejection("invalid_action"));
    assert.throws(() => score({ action: "wallet_session", wallet: USER }), rejection("invalid_action"));

    const dir = await mkdtemp(join(tmpdir(), "points-week-"));
    const store = createLedgerStore({ dataDir: dir, now: () => Date.parse("2026-10-12T15:00:00.000Z") });
    try {
      assert.throws(
        () => store.appendScored("wallet_session", { wallet: USER, at: "2999-01-01T00:00:00.000Z" }),
        rejection("invalid_action"),
      );
      assert.equal(store.totals(USER).total, 0);
      assert.equal(store.byWallet(USER).length, 0);
    } finally {
      store.close();
    }
  });
});
