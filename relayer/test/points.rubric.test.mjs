import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createLedgerStore, syntheticTxKey } from "../points/ledgerStore.mjs";
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
  scoreWalletSession,
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
      {
        action: "wallet_session",
        points: 10,
        run: () =>
          scoreWalletSession(
            { wallet: USER, at: "2999-01-01T00:00:00.000Z" },
            () => Date.parse("2026-10-12T15:00:00.000Z"),
          ),
      },
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

  it("caps sessions at one per wallet per ISO week", async () => {
    const weeks = [
      { at: "2019-12-30T00:00:00.000Z", week: "2020-W01" },
      { at: "2020-01-01T12:00:00.000Z", week: "2020-W01" },
      { at: "2021-01-01T00:00:00.000Z", week: "2020-W53" },
      { at: "2026-10-12T15:00:00.000Z", week: isoWeekKey("2026-10-18T23:00:00.000Z") },
    ];
    for (const row of weeks) assert.equal(isoWeekKey(row.at), row.week);
    assert.notEqual(isoWeekKey("2026-10-18T23:00:00.000Z"), isoWeekKey("2026-10-19T00:00:00.000Z"));
    assert.throws(() => isoWeekKey("not-a-date"), rejection("invalid_week"));

    const serverNow = () => Date.parse("2026-10-12T15:00:00.000Z");
    const serverWeek = isoWeekKey(serverNow());
    const from2999 = scoreWalletSession({ wallet: USER.toUpperCase(), at: "2999-01-01T00:00:00.000Z" }, serverNow);
    const from1970 = scoreWalletSession({ wallet: USER, at: "1970-01-01T00:00:00.000Z" }, serverNow);
    const nextWeek = scoreWalletSession({ wallet: USER, at: "1970-01-01T00:00:00.000Z" }, () => Date.parse("2026-10-19T00:00:00.000Z"));
    const otherWallet = scoreWalletSession({ wallet: OTHER, at: "2999-06-01T00:00:00.000Z" }, serverNow);
    assert.equal(from2999.points, 10);
    assert.equal(from2999.wallet, USER);
    assert.equal(from2999.week, serverWeek);
    assert.equal(from1970.week, serverWeek);
    assert.notEqual(from2999.week, isoWeekKey("2999-01-01T00:00:00.000Z"));
    assert.notEqual(from1970.week, isoWeekKey("1970-01-01T00:00:00.000Z"));
    assert.equal(from2999.txHash, from1970.txHash);
    assert.notEqual(from2999.txHash, nextWeek.txHash);
    assert.notEqual(from2999.txHash, otherWallet.txHash);
    assert.equal(from2999.txHash, syntheticTxKey("wallet_session", [serverWeek, USER.toUpperCase()]));

    const live2999 = scoreWalletSession({ wallet: USER, at: "2999-12-31T00:00:00.000Z" });
    const live1970 = scoreWalletSession({ wallet: USER, at: "1970-01-01T00:00:00.000Z" });
    assert.equal(live2999.week, isoWeekKey(Date.now()));
    assert.equal(live1970.week, live2999.week);
    assert.equal(live2999.txHash, live1970.txHash);

    let clock = Date.parse("2026-10-12T15:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "points-week-"));
    const store = createLedgerStore({ dataDir: dir, now: () => clock });
    try {
      assert.throws(
        () => store.appendScored("wallet_session", { wallet: USER, at: "2999-01-01T00:00:00.000Z" }),
        /excluded_action/,
      );
      assert.throws(
        () => store.appendScored("wallet_session", { wallet: OTHER, at: "2999-06-01T00:00:00.000Z" }),
        /excluded_action/,
      );
      assert.equal(store.totals(USER).total, 0);
      assert.equal(store.byWallet(USER).length, 0);
      assert.equal(store.totals(OTHER).total, 0);
    } finally {
      store.close();
    }
  });

  it("matches the c1f201f session score for the same inputs", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const now = () => Date.parse("2026-10-12T15:00:00.000Z");
    const expectedTx = `off:${["3ff91a60", "5dd3f401", "93afc91c", "4df04175", "ad580f23", "5dc49f92", "e38165ae", "42d79fb6"].join("")}`;
    const fromScore = score(
      { action: "wallet_session", wallet: wallet.toUpperCase(), at: "2999-01-01T00:00:00.000Z" },
      now,
    );
    const fromDirect = scoreWalletSession({ wallet, at: "1970-01-01T00:00:00.000Z" }, now);
    for (const row of [fromScore, fromDirect]) {
      assert.equal(row.points, 10);
      assert.equal(row.week, "2026-W42");
      assert.equal(row.wallet, wallet);
      assert.equal(row.txHash, expectedTx);
    }
  });
});
