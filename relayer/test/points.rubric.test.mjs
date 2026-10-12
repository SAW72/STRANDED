import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createLedgerStore, syntheticTxKey } from "../points/ledgerStore.mjs";
import {
  BUG_SEVERITY_POINTS,
  FIXED_POINTS,
  MAX_POINTS_PER_ROW,
  RESCUE_POINTS_PLACEHOLDER,
  isoWeekKey,
  pointsForAction,
  score,
  scoreBugReport,
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
    assert.equal(BUG_SEVERITY_POINTS.critical, MAX_POINTS_PER_ROW);
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

  it("requires tx hash or repro steps on a bug report", () => {
    const cases = [
      { name: "tx only", severity: "low", txHash: TX_MIXED, reproSteps: "  ", points: 100, tx: TX },
      { name: "steps only", severity: "medium", txHash: null, reproSteps: "open the wallet, then rescue", points: 200 },
      { name: "both", severity: "high", txHash: TX, reproSteps: "also steps", points: 300, tx: TX },
      {
        name: "critical steps",
        severity: "critical",
        reproSteps: "repro",
        reportId: "R-9",
        points: 500,
      },
    ];
    for (const row of cases) {
      const scored = scoreBugReport(row);
      assert.equal(scored.points, row.points, row.name);
      assert.equal(scored.action, "bug_report", row.name);
      if (row.tx) assert.equal(scored.txHash, row.tx, row.name);
      else assert.match(scored.txHash, /^off:[0-9a-f]{64}$/, row.name);
    }

    const rejected = [
      { severity: "low", txHash: null, reproSteps: "   ", code: "bug_report_evidence" },
      { severity: "low", code: "bug_report_evidence" },
      { severity: "urgent", txHash: TX, code: "invalid_severity" },
      { severity: "low", txHash: "0xabc", reproSteps: "steps", code: "invalid_tx_hash" },
    ];
    for (const row of rejected) {
      assert.throws(() => score({ action: "bug_report", ...row }), rejection(row.code));
    }

    const fromSteps = scoreBugReport({ severity: "low", reproSteps: "Same Steps" });
    const fromStepsAgain = scoreBugReport({ severity: "medium", reproSteps: "same steps" });
    assert.equal(fromSteps.txHash, fromStepsAgain.txHash);
    assert.equal(fromSteps.txHash, syntheticTxKey("bug_report", ["same steps"]));
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
      const row = store.appendScored("wallet_session", { wallet: USER, at: "2999-01-01T00:00:00.000Z" });
      assert.equal(row.txHash, from2999.txHash);
      assert.throws(
        () => store.appendScored("wallet_session", { wallet: USER, at: "1970-01-01T00:00:00.000Z" }),
        rejection("duplicate"),
      );
      store.appendScored("wallet_session", { wallet: OTHER, at: "2999-06-01T00:00:00.000Z" });
      clock = Date.parse("2026-10-19T00:00:00.000Z");
      store.appendScored("wallet_session", { wallet: USER, at: "1970-01-01T00:00:00.000Z" });
      assert.equal(store.totals(USER).total, 20);
      assert.equal(store.byWallet(USER).length, 2);
      assert.equal(store.totals(OTHER).total, 10);
    } finally {
      store.close();
    }
  });
});
