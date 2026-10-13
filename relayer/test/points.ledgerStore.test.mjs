import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { EXCLUDED_POINTS_ACTIONS } from "../../shared/excludedPointsActions.mjs";
import {
  EXCLUDED_POINTS_ACTIONS as ledgerExcluded,
  POINTS_ACTIONS,
  createLedgerStore,
  isDuplicateError,
  syntheticTxKey,
} from "../points/ledgerStore.mjs";
import { MAX_POINTS_PER_ROW } from "../points/rubric.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const MIXED = `0x${"AbCdEf01".repeat(5)}`;
const MIXED_LOWER = `0x${"abcdef01".repeat(5)}`;
const TX = `0x${"ab".repeat(32)}`;
const TX_MIXED = `0x${"aB".repeat(32)}`;
const TX2 = `0x${"cd".repeat(32)}`;
const TX3 = `0x${"ef".repeat(32)}`;
const TX4 = `0x${"12".repeat(32)}`;

/** Action CHECK from main 5789a77, which still allows bug_report. */
const OLD_SCHEMA_5789A77 = `
CREATE TABLE points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  points INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    length(wallet) = 42
    AND substr(wallet, 1, 2) = '0x'
    AND wallet = lower(wallet)
    AND substr(wallet, 3) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    action IN (
      'rescue_completed',
      'relayer_job',
      'registry_find_posted',
      'registry_find_claimed',
      'wallet_session',
      'bug_report'
    )
  ),
  CHECK (typeof(points) = 'integer' AND points > 0 AND points <= 500),
  CHECK (
    (
      length(tx_hash) = 66
      AND substr(tx_hash, 1, 2) = '0x'
      AND tx_hash = lower(tx_hash)
      AND substr(tx_hash, 3) NOT GLOB '*[^0-9a-f]*'
    )
    OR (
      length(tx_hash) = 68
      AND substr(tx_hash, 1, 4) = 'off:'
      AND substr(tx_hash, 5) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (metadata IS NULL OR (json_valid(metadata) AND length(metadata) <= 4096)),
  CHECK (length(created_at) >= 20),
  UNIQUE (wallet, action, tx_hash)
) STRICT;
`;

function rejection(code) {
  return (err) => err instanceof Error && err.code === code && err.message === code;
}

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "points-ledger-"));
  const store = createLedgerStore({ dataDir: dir, now: () => 1_700_000_000_000 });
  try {
    return await fn(store, dir);
  } finally {
    store.close();
  }
}

describe("points ledger", () => {
  it("normalizes mixed-case wallets and transaction hashes", async () => {
    await withStore((store) => {
      const row = store.appendScored("rescue_completed", {
        wallet: MIXED,
        txHash: TX_MIXED,
        metadata: { note: "already settled" },
      });
      assert.equal(row.wallet, MIXED_LOWER);
      assert.equal(row.txHash, TX_MIXED.toLowerCase());
      assert.equal(row.points, 100);
      assert.equal(row.createdAt, "2023-11-14T22:13:20.000Z");
      assert.deepEqual(row.metadata, { note: "already settled" });

      const found = store.byWallet(MIXED.toUpperCase());
      assert.equal(found.length, 1);
      assert.equal(found[0].wallet, MIXED_LOWER);
      assert.equal(store.totals(MIXED).wallet, MIXED_LOWER);
      assert.equal(store.totals(MIXED).total, 100);
    });
  });

  it("rejects a duplicate insert and does not double-count", async () => {
    await withStore((store) => {
      store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      store.appendScored("relayer_job", { wallet: USER, txHash: TX, operatorId: "op-1" });

      assert.throws(
        () => store.appendScored("rescue_completed", { wallet: USER.toUpperCase(), txHash: TX_MIXED, points: 100 }),
        rejection("duplicate"),
      );

      const rows = store.byWallet(USER);
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => row.action),
        ["rescue_completed", "relayer_job"],
      );
      assert.equal(store.totals(USER).total, 150);
      assert.deepEqual(store.totals(USER).byAction, {
        relayer_job: 50,
        rescue_completed: 100,
      });
      assert.equal(store.totals().total, 150);
      assert.equal(store.totals().wallets.length, 1);
    });
  });

  it("uses a deterministic synthetic key for an off-chain action", async () => {
    await withStore((store) => {
      const first = syntheticTxKey("wallet_session", ["2026-W41", USER.toUpperCase()]);
      const again = syntheticTxKey("wallet_session", ["2026-w41", USER]);
      assert.equal(first, again);
      assert.notEqual(first, syntheticTxKey("wallet_session", ["2026-W42", USER]));
      assert.match(first, /^off:[0-9a-f]{64}$/);

      const row = store.appendScored("wallet_session", { wallet: USER, at: "2999-01-01T00:00:00.000Z" });
      assert.match(row.txHash, /^off:[0-9a-f]{64}$/);
      assert.notEqual(row.txHash, first);
      assert.throws(
        () => store.appendScored("wallet_session", { wallet: USER, at: "1970-01-01T00:00:00.000Z" }),
        rejection("duplicate"),
      );
      assert.equal(store.totals(USER).total, 10);
      assert.equal(store.byWallet(USER).length, 1);
    });
  });

  it("rejects bad addresses and non-positive points", async () => {
    await withStore((store) => {
      const badAddresses = ["", "0x1234", "not-a-wallet", `0x${"z".repeat(40)}`, `0x${"a".repeat(39)}`, null];
      for (const wallet of badAddresses) {
        assert.throws(
          () => store.appendScored("rescue_completed", { wallet, txHash: TX }),
          rejection("invalid_address"),
        );
      }
      assert.throws(() => store.byWallet("0x1234"), rejection("invalid_address"));
      assert.throws(() => store.totals("nope"), rejection("invalid_address"));

      const badPoints = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0", "-3", "", null, 0n];
      for (const points of badPoints) {
        assert.throws(
          () => store.appendScored("rescue_completed", { wallet: USER, points, txHash: TX }),
          rejection("invalid_points"),
        );
      }

      assert.throws(
        () => store.appendScored("not_an_action", { wallet: USER, txHash: TX }),
        rejection("invalid_action"),
      );
      assert.throws(
        () => store.appendScored("rescue_completed", { wallet: USER, txHash: "0xabc" }),
        rejection("invalid_tx_hash"),
      );
      assert.throws(
        () => store.appendScored("rescue_completed", { wallet: USER, txHash: "" }),
        rejection("invalid_tx_hash"),
      );

      const secretField = "not-stored";
      assert.throws(
        () =>
          store.appendScored("rescue_completed", {
            wallet: USER,
            txHash: TX,
            points: 100,
            metadata: { private_key: secretField },
          }),
        (err) => rejection("invalid_metadata")(err) && !err.message.includes(secretField),
      );

      assert.deepEqual(store.byWallet(USER), []);
      assert.equal(store.totals(USER).total, 0);
      assert.equal(store.totals().total, 0);

      store.appendScored("registry_find_posted", { wallet: USER, points: "30", txHash: TX });
      store.appendScored("registry_find_claimed", { wallet: USER, points: 50n, txHash: TX });
      assert.equal(store.totals(USER).total, 80);
    });
  });

  it("has no update or delete path, and triggers block raw UPDATE and DELETE", async () => {
    await withStore((store) => {
      assert.deepEqual(Object.keys(store).sort(), [
        "appendScored",
        "byWallet",
        "close",
        "filePath",
        "leaderboard",
        "totals",
        "walletPoints",
      ]);
      assert.equal(Object.hasOwn(store, "append"), false);
      assert.equal(Object.hasOwn(store, "update"), false);
      assert.equal(Object.hasOwn(store, "delete"), false);

      store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      const filePath = store.filePath;
      store.close();

      const db = new Database(filePath);
      try {
        db.pragma("recursive_triggers = ON");
        const triggers = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'points_ledger' ORDER BY name")
          .all()
          .map((row) => row.name);
        assert.deepEqual(triggers, [
          "points_ledger_no_delete",
          "points_ledger_no_excluded_insert",
          "points_ledger_no_excluded_update",
          "points_ledger_no_insert",
          "points_ledger_no_update",
        ]);

        const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'points_ledger'").get().sql;
        assert.match(tableSql, /UNIQUE\s*\(\s*wallet\s*,\s*action\s*,\s*tx_hash\s*\)/i);

        db.prepare(
          `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
           VALUES (?, 'relayer_job', 50, ?, NULL, '2024-01-01T00:00:00.000Z')`,
        ).run(USER, TX2);

        assert.throws(() => db.prepare("UPDATE points_ledger SET points = 1").run(), /append-only/);
        assert.throws(() => db.prepare("DELETE FROM points_ledger").run(), /append-only/);
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 5, ?, NULL, '2024-01-01T00:00:00.000Z')
                 ON CONFLICT (wallet, action, tx_hash) DO UPDATE SET points = excluded.points`,
              )
              .run(USER, TX),
          /duplicate/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 5, ?, NULL, '2024-01-01T00:00:00.000Z')
                 ON CONFLICT (wallet, action, tx_hash) DO NOTHING`,
              )
              .run(USER, TX),
          /duplicate/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT OR REPLACE INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 5, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, TX),
          /duplicate/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 0, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, TX2),
          /CHECK constraint failed/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 1, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER.toUpperCase(), `0x${"ef".repeat(32)}`),
          /CHECK constraint failed/,
        );

        const left = db.prepare("SELECT action, points FROM points_ledger ORDER BY id ASC").all();
        assert.deepEqual(left, [
          { action: "rescue_completed", points: 100 },
          { action: "relayer_job", points: 50 },
        ]);
      } finally {
        db.close();
      }

      const again = createLedgerStore({ dbPath: filePath, now: () => 1_700_000_000_000 });
      try {
        assert.equal(again.byWallet(USER).length, 2);
        assert.equal(again.totals(USER).total, 150);
      } finally {
        again.close();
      }
    });
  });

  it("rejects REPLACE when recursive triggers are off", async () => {
    await withStore((store) => {
      const inserted = store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      const filePath = store.filePath;
      store.close();

      const db = new Database(filePath);
      try {
        assert.equal(db.pragma("recursive_triggers", { simple: true }), 0);
        const readRow = () => db.prepare("SELECT id, wallet, action, points, tx_hash, metadata, created_at FROM points_ledger").get();
        const original = readRow();
        assert.equal(original.id, inserted.id);
        assert.equal(original.points, 100);

        const statements = [
          [
            `REPLACE INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, 'rescue_completed', 5, ?, NULL, '2024-02-01T00:00:00.000Z')`,
            [USER, TX],
          ],
          [
            `INSERT OR REPLACE INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, 'rescue_completed', 5, ?, NULL, '2024-02-01T00:00:00.000Z')`,
            [USER, TX],
          ],
          [
            `REPLACE INTO points_ledger (id, wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, ?, 'relayer_job', 7, ?, NULL, '2024-03-01T00:00:00.000Z')`,
            [inserted.id, USER, TX2],
          ],
          [
            `INSERT OR REPLACE INTO points_ledger (id, wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, ?, 'relayer_job', 9, ?, NULL, '2024-03-01T00:00:00.000Z')`,
            [inserted.id, USER, TX2],
          ],
        ];
        for (const [sql, params] of statements) {
          assert.throws(() => db.prepare(sql).run(...params), /duplicate/);
          assert.deepEqual(readRow(), original);
        }
      } finally {
        db.close();
      }
    });
  });

  it("keeps the schema action check aligned with the fixed set", () => {
    const sql = readFileSync(new URL("../points/schema.sql", import.meta.url), "utf8");
    for (const action of POINTS_ACTIONS) {
      assert.match(sql, new RegExp(`'${action}'`));
    }
    assert.equal(POINTS_ACTIONS.length, 5);
    assert.equal(POINTS_ACTIONS.includes("bug_report"), false);
    const tableDdl = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS points_ledger"), sql.indexOf(") STRICT;"));
    for (const action of ["bug_report", "security", "security_finding", "finding"]) {
      assert.equal(tableDdl.includes(`'${action}'`), false, action);
      assert.match(sql, new RegExp(`'${action}'`));
    }
    assert.match(sql, /points_ledger_no_excluded_insert/);
    assert.match(sql, /points_ledger_no_excluded_update/);
    assert.match(sql, /RAISE\(ABORT, 'excluded_action'\)/);
    assert.doesNotMatch(sql, /CREATE UNIQUE INDEX points_ledger_bug_action_tx/);
    assert.doesNotMatch(sql, /action='bug_report'/);
    assert.match(sql, new RegExp(`points <= ${MAX_POINTS_PER_ROW}`));
    assert.match(sql, /CREATE UNIQUE INDEX points_ledger_onchain_action_tx/);
    assert.match(sql, /WHERE substr\(tx_hash,1,2\)='0x'/);
  });

  it("matches schema trigger action lists to the excluded-action constant", () => {
    const sql = readFileSync(new URL("../points/schema.sql", import.meta.url), "utf8");
    const points = readFileSync(new URL("../../wallet/src/Points.tsx", import.meta.url), "utf8");
    const lists = [];
    for (const block of sql.match(/CREATE TRIGGER\s+\w+[\s\S]*?END;/g) ?? []) {
      for (const match of block.matchAll(/IN\s*\(([^)]*)\)/g)) {
        lists.push([...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1]));
      }
    }
    assert.equal(lists.length, 3);
    for (const list of lists) {
      assert.deepEqual(list, [...EXCLUDED_POINTS_ACTIONS]);
    }
    assert.deepEqual([...ledgerExcluded], [...EXCLUDED_POINTS_ACTIONS]);
    assert.match(points, /from "\.\.\/\.\.\/shared\/excludedPointsActions\.mjs"/);
    assert.match(points, /new Set\(EXCLUDED_POINTS_ACTIONS\)/);
    assert.doesNotMatch(points, /new Set\(\s*\[/);
  });

  it("rejects bug_report in the schema action check", async () => {
    const sql = readFileSync(new URL("../points/schema.sql", import.meta.url), "utf8");
    const tableDdl = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS points_ledger"), sql.indexOf(") STRICT;"));
    assert.equal(tableDdl.includes("'bug_report'"), false);
    await withStore((store) => {
      const filePath = store.filePath;
      store.close();
      const db = new Database(filePath);
      try {
        const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'points_ledger'").get().sql;
        assert.equal(tableSql.includes("bug_report"), false);
        const indexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'points_ledger'")
          .all()
          .map((row) => row.name);
        assert.equal(indexes.includes("points_ledger_bug_action_tx"), false);
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'bug_report', 100, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, TX),
          /excluded_action/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'security', 300, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, TX2),
          /excluded_action/,
        );
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM points_ledger WHERE action IN ('bug_report', 'security')").get().n, 0);
      } finally {
        db.close();
      }
    });
  });

  it("lets a listed update through and rejects an excluded action change", async () => {
    const excluded = ["bug_report", "security", "security_finding", "finding"];
    const dir = await mkdtemp(join(tmpdir(), "points-excluded-update-"));
    const filePath = join(dir, "points-ledger.sqlite");
    const created = "2024-01-01T00:00:00.000Z";
    const txFor = (byte) => `0x${byte.repeat(32)}`;
    const seed = new Database(filePath);
    seed.exec(`
      CREATE TABLE points_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet TEXT NOT NULL,
        action TEXT NOT NULL,
        points INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL,
        CHECK (action IN (
          'rescue_completed', 'relayer_job', 'bug_report', 'security', 'security_finding', 'finding'
        )),
        CHECK (typeof(points) = 'integer' AND points > 0 AND points <= 500),
        UNIQUE (wallet, action, tx_hash)
      ) STRICT;
    `);
    const insert = seed.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, ?, 100, ?, NULL, ?)`,
    );
    const forward = excluded.map((action, index) => ({ action, txHash: txFor(String(index + 1).padStart(2, "0")) }));
    for (const row of forward) insert.run(USER, "rescue_completed", row.txHash, created);
    const reverse = excluded.map((action, index) => ({ action, txHash: txFor(String(index + 5).padStart(2, "0")) }));
    for (const row of reverse) insert.run(USER, row.action, row.txHash, created);
    const amountTx = txFor("09");
    const listedTx = txFor("0a");
    insert.run(USER, "rescue_completed", amountTx, created);
    insert.run(USER, "rescue_completed", listedTx, created);
    seed.close();

    const store = createLedgerStore({ dbPath: filePath, now: () => 1_700_000_000_000 });
    store.close();
    const db = new Database(filePath);
    try {
      // The append-only trigger rejects every update. Drop it so this test can see
      // whether the excluded-update WHEN allows a listed change.
      db.exec("DROP TRIGGER points_ledger_no_update");
      const read = db.prepare("SELECT action, points, metadata FROM points_ledger WHERE tx_hash = ?");
      const note = JSON.stringify({ note: "adjusted" });

      assert.doesNotThrow(() =>
        db.prepare("UPDATE points_ledger SET points = 250, metadata = ? WHERE tx_hash = ?").run(note, amountTx),
      );
      assert.deepEqual(read.get(amountTx), { action: "rescue_completed", points: 250, metadata: note });

      assert.doesNotThrow(() =>
        db.prepare("UPDATE points_ledger SET action = 'relayer_job' WHERE tx_hash = ?").run(listedTx),
      );
      assert.deepEqual(read.get(listedTx), { action: "relayer_job", points: 100, metadata: null });

      for (const row of forward) {
        assert.throws(
          () => db.prepare("UPDATE points_ledger SET action = ? WHERE tx_hash = ?").run(row.action, row.txHash),
          /excluded_action/,
          row.action,
        );
        assert.deepEqual(read.get(row.txHash), { action: "rescue_completed", points: 100, metadata: null });
      }
      for (const row of reverse) {
        assert.throws(
          () => db.prepare("UPDATE points_ledger SET action = 'rescue_completed' WHERE tx_hash = ?").run(row.txHash),
          /excluded_action/,
          row.action,
        );
        assert.deepEqual(read.get(row.txHash), { action: row.action, points: 100, metadata: null });
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a null tx_hash and an over-cap points value", async () => {
    await withStore((store) => {
      assert.throws(
        () =>
          store.appendScored("rescue_completed", {
            wallet: USER,
            txHash: TX2,
            points: MAX_POINTS_PER_ROW + 1,
          }),
        rejection("invalid_points"),
      );
      assert.throws(
        () =>
          store.appendScored("rescue_completed", {
            wallet: USER,
            txHash: `0x${"12".repeat(32)}`,
            points: String(MAX_POINTS_PER_ROW + 1),
          }),
        rejection("invalid_points"),
      );
      const row = store.appendScored("rescue_completed", { wallet: USER, txHash: TX2 });
      assert.equal(row.points, 100);

      const filePath = store.filePath;
      store.close();
      const db = new Database(filePath);
      try {
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 1, NULL, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER),
          /NOT NULL constraint failed: points_ledger\.tx_hash/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', ?, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, MAX_POINTS_PER_ROW + 1, TX),
          /CHECK constraint failed/,
        );
        const top = db.prepare("SELECT points FROM points_ledger WHERE action = 'rescue_completed'").get();
        assert.equal(top.points, 100);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM points_ledger WHERE action = 'bug_report'").get().n, 0);
      } finally {
        db.close();
      }
    });
  });

  it("sets created_at from the server clock and ignores a caller timestamp", async () => {
    await withStore((store) => {
      const row = store.appendScored("rescue_completed", {
        wallet: USER,
        txHash: TX,
        createdAt: "1999-01-01T00:00:00.000Z",
      });
      assert.equal(row.createdAt, "2023-11-14T22:13:20.000Z");
      const again = store.appendScored("relayer_job", {
        wallet: USER,
        txHash: TX,
        operatorId: "op-1",
        createdAt: "not-a-date",
      });
      assert.equal(again.createdAt, "2023-11-14T22:13:20.000Z");
    });
  });

  it("matches isDuplicateError only to the duplicate trigger message", async () => {
    await withStore((store) => {
      store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      const filePath = store.filePath;
      store.close();
      const db = new Database(filePath);
      try {
        let duplicateErr;
        try {
          db.prepare(
            `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, 'rescue_completed', 100, ?, NULL, '2024-01-01T00:00:00.000Z')`,
          ).run(USER, TX);
        } catch (err) {
          duplicateErr = err;
        }
        assert.equal(duplicateErr.message, "duplicate");
        assert.equal(isDuplicateError(duplicateErr), true);

        let updateErr;
        try {
          db.prepare("UPDATE points_ledger SET points = 1").run();
        } catch (err) {
          updateErr = err;
        }
        assert.equal(updateErr.message, "append-only");
        assert.equal(isDuplicateError(updateErr), false);

        let deleteErr;
        try {
          db.prepare("DELETE FROM points_ledger").run();
        } catch (err) {
          deleteErr = err;
        }
        assert.equal(deleteErr.message, "append-only");
        assert.equal(isDuplicateError(deleteErr), false);

        let nothingErr;
        try {
          db.prepare(
            `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
             VALUES (?, 'rescue_completed', 100, ?, NULL, '2024-01-01T00:00:00.000Z')
             ON CONFLICT (wallet, action, tx_hash) DO NOTHING`,
          ).run(USER, TX);
        } catch (err) {
          nothingErr = err;
        }
        assert.equal(nothingErr.message, "duplicate");
        assert.equal(isDuplicateError(nothingErr), true);

        assert.equal(isDuplicateError({ code: "SQLITE_CONSTRAINT_TRIGGER", message: "append-only" }), false);
        assert.equal(isDuplicateError({ code: "SQLITE_CONSTRAINT_UNIQUE", message: "UNIQUE constraint failed" }), false);
        assert.equal(isDuplicateError({ message: "points_ledger is append-only" }), false);
      } finally {
        db.close();
      }
    });
  });

  it("resolves the default ledger path from the module or DATA_DIR, not the cwd", async () => {
    const previous = process.env.DATA_DIR;
    const dir = await mkdtemp(join(tmpdir(), "points-data-dir-"));
    process.env.DATA_DIR = dir;
    let fromEnv;
    try {
      fromEnv = createLedgerStore({ now: () => 1_700_000_000_000 });
      assert.equal(fromEnv.filePath, join(dir, "points-ledger.sqlite"));
    } finally {
      fromEnv?.close();
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    }

    const cwd = await mkdtemp(join(tmpdir(), "points-cwd-"));
    const env = { ...process.env };
    delete env.DATA_DIR;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          const { createLedgerStore } = await import(${JSON.stringify(new URL("../points/ledgerStore.mjs", import.meta.url).href)});
          const store = createLedgerStore({ now: () => 1 });
          console.log(store.filePath);
          store.close();
        `,
      ],
      { cwd, env, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    const filePath = child.stdout.trim();
    const expected = join(dirname(fileURLToPath(new URL("../points/ledgerStore.mjs", import.meta.url))), "..", "data", "points-ledger.sqlite");
    assert.equal(filePath, expected);
    assert.equal(filePath.startsWith(cwd), false);
    rmSync(filePath, { force: true });
    for (const suffix of ["-wal", "-shm", "-journal"]) rmSync(filePath + suffix, { force: true });
  });

  it("rejects rescue points that bypass the flat placeholder", async () => {
    await withStore((store) => {
      assert.throws(
        () => store.appendScored("rescue_completed", { wallet: USER, txHash: TX, points: 499 }),
        rejection("rubric_mismatch"),
      );
      const row = store.appendScored("rescue_completed", { wallet: USER, txHash: TX, points: 100 });
      assert.equal(row.points, 100);
      assert.equal(store.byWallet(USER).length, 1);
    });
  });

  it("rejects a second wallet claiming the same on-chain transaction", async () => {
    await withStore((store) => {
      store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      assert.throws(
        () => store.appendScored("rescue_completed", { wallet: OTHER, txHash: TX_MIXED, points: 100 }),
        rejection("duplicate"),
      );
      assert.equal(store.byWallet(OTHER).length, 0);
      assert.equal(store.totals().total, 100);
      store.appendScored("relayer_job", { wallet: OTHER, txHash: TX, operatorId: "op-2" });
      assert.equal(store.totals(OTHER).total, 50);

      const filePath = store.filePath;
      store.close();
      const db = new Database(filePath);
      try {
        const indexSql = db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'points_ledger_onchain_action_tx'")
          .get().sql;
        assert.match(indexSql, /UNIQUE/i);
        assert.match(indexSql, /action/i);
        assert.match(indexSql, /tx_hash/i);
        assert.throws(
          () =>
            db
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, 'rescue_completed', 100, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(OTHER, TX),
          /duplicate/,
        );
        const rescues = db.prepare("SELECT wallet FROM points_ledger WHERE action = 'rescue_completed'").all();
        assert.deepEqual(rescues, [{ wallet: USER }]);
      } finally {
        db.close();
      }
    });
  });

  it("looks up each duplicate EXISTS with an index", async () => {
    await withStore((store) => {
      const filePath = store.filePath;
      store.close();
      const db = new Database(filePath);
      try {
        const queries = [
          ["SELECT 1 FROM points_ledger WHERE id=?", [1]],
          [
            "SELECT 1 FROM points_ledger WHERE wallet=? AND action=? AND tx_hash=?",
            [USER, "rescue_completed", TX],
          ],
          [
            "SELECT 1 FROM points_ledger WHERE action=? AND tx_hash=? AND substr(tx_hash,1,2)='0x'",
            ["rescue_completed", TX],
          ],
        ];
        for (const [query, params] of queries) {
          const steps = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params);
          assert.ok(steps.length > 0, query);
          for (const step of steps) {
            assert.notEqual(step.detail, "SCAN points_ledger", query);
            assert.match(step.detail, /SEARCH points_ledger USING /, query);
          }
        }
      } finally {
        db.close();
      }
    });
  });

  it("rejects a bug report or security action and stores zero points", async () => {
    await withStore((store) => {
      const actions = ["bug_report", "security", "security_finding", "finding"];
      for (const action of actions) {
        let stored = null;
        assert.throws(
          () => {
            stored = store.appendScored(action, {
              wallet: USER,
              severity: "critical",
              txHash: TX,
              reproSteps: "open the page",
              reportId: "R-1",
              points: 500,
            });
          },
          rejection("invalid_action"),
          action,
        );
        assert.equal(stored, null, action);
        assert.equal(POINTS_ACTIONS.includes(action), false, action);
      }
      assert.equal(store.byWallet(USER).length, 0);
      assert.equal(store.totals(USER).total, 0);
      assert.equal(store.totals().total, 0);
      assert.equal(store.byWallet(USER).some((row) => row.action === "bug_report" || row.action === "security"), false);
      store.appendScored("rescue_completed", { wallet: USER, txHash: TX });
      assert.equal(store.totals(USER).total, 100);
      assert.equal(store.byWallet(USER).every((row) => row.action !== "bug_report" && row.action !== "security"), true);
    });
  });

  it("keeps a legacy bug_report row and scores only the visible 100", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-old-schema-"));
    const filePath = join(dir, "points-ledger.sqlite");
    const created = "2024-01-01T00:00:00.000Z";
    const seed = new Database(filePath);
    seed.exec(OLD_SCHEMA_5789A77);
    const insert = seed.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    insert.run(USER, "rescue_completed", 100, TX, created);
    insert.run(USER, "bug_report", 500, TX2, created);
    insert.run(OTHER, "rescue_completed", 100, TX3, created);
    insert.run(OTHER, "relayer_job", 50, TX3, created);
    insert.run(OTHER, "registry_find_posted", 30, TX3, created);
    insert.run(OTHER, "registry_find_claimed", 50, TX3, created);
    const before = seed.prepare("SELECT id, wallet, action, points, tx_hash, metadata, created_at FROM points_ledger ORDER BY id").all();
    const rawUser = seed.prepare("SELECT SUM(points) AS points FROM points_ledger WHERE wallet = ?").get(USER);
    assert.equal(rawUser.points, 600);
    assert.equal(before.length, 6);
    seed.close();

    const open = () => createLedgerStore({ dbPath: filePath, now: () => 1_700_000_000_000 });
    const store = open();
    try {
      const view = store.walletPoints(USER);
      const visible = view.entries.reduce((sum, entry) => sum + entry.points, 0);
      const categorySum = view.categories.reduce((sum, category) => sum + category.points, 0);
      assert.equal(visible, 100);
      assert.equal(categorySum, 100);
      assert.equal(view.total, visible);
      assert.equal(store.totals(USER).total, view.total);
      assert.equal(view.entries.length, 1);
      assert.equal(view.entries[0].action, "rescue_completed");
      assert.equal(view.entries[0].points, 100);
      assert.equal(view.categories.length, 1);
      assert.equal(view.rank, 2);
      const board = store.leaderboard();
      assert.deepEqual(
        board.rows.map((row) => ({ wallet: row.wallet, total: row.total, rank: row.rank })),
        [
          { wallet: OTHER, total: 230, rank: 1 },
          { wallet: USER, total: 100, rank: 2 },
        ],
      );
      assert.equal(board.rows.some((row) => row.total === 600), false);
      assert.equal(store.walletPoints(OTHER).rank, 1);
      assert.equal(store.totals().total, 330);
    } finally {
      store.close();
    }

    const after = new Database(filePath);
    try {
      const rows = after.prepare("SELECT id, wallet, action, points, tx_hash, metadata, created_at FROM points_ledger ORDER BY id").all();
      assert.deepEqual(rows, before);
      assert.equal(rows.filter((row) => row.action === "bug_report").length, 1);
      assert.equal(rows.find((row) => row.action === "bug_report").points, 500);
      const tableSql = after.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'points_ledger'").get().sql;
      assert.match(tableSql, /'bug_report'/);
      for (const action of ["bug_report", "security", "security_finding", "finding"]) {
        assert.throws(
          () =>
            after
              .prepare(
                `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
                 VALUES (?, ?, 100, ?, NULL, ?)`,
              )
              .run(OTHER, action, TX4, created),
          /excluded_action/,
        );
      }
      assert.equal(after.prepare("SELECT COUNT(*) AS n FROM points_ledger").get().n, before.length);
    } finally {
      after.close();
    }

    const again = open();
    try {
      assert.equal(again.walletPoints(USER).total, 100);
      assert.equal(again.walletPoints(USER).rank, 2);
      assert.equal(again.byWallet(USER).length, 1);
    } finally {
      again.close();
    }

    const finalDb = new Database(filePath);
    try {
      const rows = finalDb.prepare("SELECT id, wallet, action, points, tx_hash, metadata, created_at FROM points_ledger ORDER BY id").all();
      assert.deepEqual(rows, before);
    } finally {
      finalDb.close();
    }
  });
});
