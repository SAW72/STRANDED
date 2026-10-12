import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { POINTS_ACTIONS, createLedgerStore, isDuplicateError, syntheticTxKey } from "../points/ledgerStore.mjs";
import { MAX_POINTS_PER_ROW } from "../points/rubric.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const MIXED = `0x${"AbCdEf01".repeat(5)}`;
const MIXED_LOWER = `0x${"abcdef01".repeat(5)}`;
const TX = `0x${"ab".repeat(32)}`;
const TX_MIXED = `0x${"aB".repeat(32)}`;
const TX2 = `0x${"cd".repeat(32)}`;

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
      const row = store.append({
        wallet: MIXED,
        action: "rescue_completed",
        points: 100,
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
      store.append({ wallet: USER, action: "rescue_completed", points: 100, txHash: TX });
      store.append({ wallet: USER, action: "relayer_job", points: 50, txHash: TX });
      store.append({ wallet: OTHER, action: "rescue_completed", points: 100, txHash: TX });

      assert.throws(
        () => store.append({ wallet: USER.toUpperCase(), action: "rescue_completed", points: 100, txHash: TX_MIXED }),
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
      assert.equal(store.totals().total, 250);
      assert.equal(store.totals().wallets.length, 2);
    });
  });

  it("uses a deterministic synthetic key for an off-chain action", async () => {
    await withStore((store) => {
      const first = syntheticTxKey("wallet_session", ["2026-W41", USER.toUpperCase()]);
      const again = syntheticTxKey("wallet_session", ["2026-w41", USER]);
      assert.equal(first, again);
      assert.notEqual(first, syntheticTxKey("wallet_session", ["2026-W42", USER]));
      assert.match(first, /^off:[0-9a-f]{64}$/);

      store.append({ wallet: USER, action: "wallet_session", points: 10, txHash: first });
      assert.throws(
        () => store.append({ wallet: USER, action: "wallet_session", points: 10, txHash: again }),
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
          () => store.append({ wallet, action: "rescue_completed", points: 1, txHash: TX }),
          rejection("invalid_address"),
        );
      }
      assert.throws(() => store.byWallet("0x1234"), rejection("invalid_address"));
      assert.throws(() => store.totals("nope"), rejection("invalid_address"));

      const badPoints = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0", "-3", "", null, 0n];
      for (const points of badPoints) {
        assert.throws(
          () => store.append({ wallet: USER, action: "rescue_completed", points, txHash: TX }),
          rejection("invalid_points"),
        );
      }

      assert.throws(
        () => store.append({ wallet: USER, action: "not_an_action", points: 1, txHash: TX }),
        rejection("invalid_action"),
      );
      assert.throws(
        () => store.append({ wallet: USER, action: "rescue_completed", points: 1, txHash: "0xabc" }),
        rejection("invalid_tx_hash"),
      );
      assert.throws(
        () => store.append({ wallet: USER, action: "rescue_completed", points: 1, txHash: "" }),
        rejection("invalid_tx_hash"),
      );

      const secretField = "not-stored";
      assert.throws(
        () =>
          store.append({
            wallet: USER,
            action: "bug_report",
            points: 100,
            txHash: syntheticTxKey("bug_report", ["report-1"]),
            metadata: { private_key: secretField },
          }),
        (err) => rejection("invalid_metadata")(err) && !err.message.includes(secretField),
      );

      assert.deepEqual(store.byWallet(USER), []);
      assert.equal(store.totals(USER).total, 0);
      assert.equal(store.totals().total, 0);

      store.append({ wallet: USER, action: "registry_find_posted", points: "30", txHash: TX });
      store.append({ wallet: USER, action: "registry_find_claimed", points: 50n, txHash: TX });
      assert.equal(store.totals(USER).total, 80);
    });
  });

  it("has no update or delete path, and triggers block raw UPDATE and DELETE", async () => {
    await withStore((store) => {
      assert.deepEqual(Object.keys(store).sort(), ["append", "byWallet", "close", "filePath", "totals"]);
      assert.equal(Object.hasOwn(store, "update"), false);
      assert.equal(Object.hasOwn(store, "delete"), false);

      store.append({ wallet: USER, action: "rescue_completed", points: 100, txHash: TX });
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
      const inserted = store.append({
        wallet: USER,
        action: "rescue_completed",
        points: 100,
        txHash: TX,
      });
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
    assert.equal(POINTS_ACTIONS.length, 6);
    assert.match(sql, new RegExp(`points <= ${MAX_POINTS_PER_ROW}`));
  });

  it("rejects a null tx_hash and an over-cap points value", async () => {
    await withStore((store) => {
      store.append({
        wallet: USER,
        action: "bug_report",
        points: MAX_POINTS_PER_ROW,
        txHash: syntheticTxKey("bug_report", ["at-cap"]),
      });
      assert.throws(
        () =>
          store.append({
            wallet: USER,
            action: "bug_report",
            points: MAX_POINTS_PER_ROW + 1,
            txHash: syntheticTxKey("bug_report", ["over-cap"]),
          }),
        rejection("invalid_points"),
      );
      assert.throws(
        () =>
          store.append({
            wallet: USER,
            action: "bug_report",
            points: String(MAX_POINTS_PER_ROW + 1),
            txHash: syntheticTxKey("bug_report", ["over-cap-text"]),
          }),
        rejection("invalid_points"),
      );

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
                 VALUES (?, 'bug_report', ?, ?, NULL, '2024-01-01T00:00:00.000Z')`,
              )
              .run(USER, MAX_POINTS_PER_ROW + 1, syntheticTxKey("bug_report", ["sql-over-cap"])),
          /CHECK constraint failed/,
        );
        const top = db.prepare("SELECT points FROM points_ledger WHERE action = 'bug_report'").get();
        assert.equal(top.points, MAX_POINTS_PER_ROW);
      } finally {
        db.close();
      }
    });
  });

  it("sets created_at from the server clock and ignores a caller timestamp", async () => {
    await withStore((store) => {
      const row = store.append({
        wallet: USER,
        action: "rescue_completed",
        points: 100,
        txHash: TX,
        createdAt: "1999-01-01T00:00:00.000Z",
      });
      assert.equal(row.createdAt, "2023-11-14T22:13:20.000Z");
      const again = store.append({
        wallet: USER,
        action: "relayer_job",
        points: 50,
        txHash: TX,
        createdAt: "not-a-date",
      });
      assert.equal(again.createdAt, "2023-11-14T22:13:20.000Z");
    });
  });

  it("matches isDuplicateError only to the duplicate trigger message", async () => {
    await withStore((store) => {
      store.append({ wallet: USER, action: "rescue_completed", points: 100, txHash: TX });
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
});
