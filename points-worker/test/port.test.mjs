import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const repo = new URL("../../", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

describe("schema port", () => {
  it("keeps the relayer schema, including CHECKs, STRICT, triggers, and the partial unique index", () => {
    const migration = read(new URL("migrations/0001_init.sql", root));
    const rebuild = read(new URL("migrations/0002_rebuild_action_check.sql", root));
    const schema = read(new URL("relayer/points/schema.sql", repo));
    assert.match(schema, /CHECK \(action <> 'wallet_session'\)/);
    assert.doesNotMatch(schema, /'registry_find_claimed',\s*'wallet_session'/);
    assert.match(migration, /CHECK \(action <> 'wallet_session'\)/);
    assert.match(migration, /'wallet_session'/);
    assert.doesNotMatch(migration, /'registry_find_claimed',\s*'wallet_session'/);
    assert.match(rebuild, /CREATE TABLE points_ledger_archive/);
    assert.match(rebuild, /CREATE TABLE points_ledger_next/);
    assert.match(rebuild, /CHECK \(action <> 'wallet_session'\)/);
    assert.match(rebuild, /ALTER TABLE points_ledger_next RENAME TO points_ledger/);
    assert.match(rebuild, /CREATE UNIQUE INDEX points_ledger_onchain_action_tx/);
    assert.doesNotMatch(read(new URL("migrations/0001_init.sql", root)), /points_ledger_next/);
    assert.match(migration, /\) STRICT;/);
    assert.match(migration, /RAISE\(ABORT, 'duplicate'\)/);
    assert.match(migration, /RAISE\(ABORT, 'append-only'\)/);
    assert.match(migration, /RAISE\(ABORT, 'excluded_action'\)/);
    assert.match(migration, /CREATE UNIQUE INDEX points_ledger_onchain_action_tx/);
    assert.match(migration, /WHERE substr\(tx_hash,1,2\)='0x'/);
    assert.doesNotMatch(migration, /foreign_keys/);
    assert.doesNotMatch(migration, /busy_timeout/);
  });
});

describe("action check rebuild", () => {
  it("adds the CHECK to a table created before that CHECK existed", () => {
    const db = new DatabaseSync(":memory:");
    const wallet = "0x1111111111111111111111111111111111111111";
    const kept = `0x${"ab".repeat(32)}`;
    const session = `0x${"cd".repeat(32)}`;
    db.exec(`
      CREATE TABLE points_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet TEXT NOT NULL,
        action TEXT NOT NULL,
        points INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          action IN (
            'rescue_completed',
            'relayer_job',
            'registry_find_posted',
            'registry_find_claimed',
            'wallet_session'
          )
        )
      );
      CREATE TRIGGER points_ledger_no_delete
      BEFORE DELETE ON points_ledger
      BEGIN
        SELECT RAISE(ABORT, 'append-only');
      END;
    `);
    db.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, 'rescue_completed', 100, ?, NULL, '2026-10-19T00:00:00.000Z')`,
    ).run(wallet, kept);
    db.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, 'wallet_session', 10, ?, NULL, '2026-10-19T00:00:00.000Z')`,
    ).run(wallet, session);
    db.exec(read(new URL("migrations/0002_rebuild_action_check.sql", root)));
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'points_ledger'").get();
    assert.match(table.sql, /CHECK \(action <> 'wallet_session'\)/);
    const keptRows = db.prepare("SELECT action, tx_hash FROM points_ledger ORDER BY id").all();
    assert.equal(keptRows.length, 1);
    assert.equal(keptRows[0].action, "rescue_completed");
    assert.equal(keptRows[0].tx_hash, kept);
    const archived = db.prepare("SELECT action, tx_hash, wallet, points FROM points_ledger_archive").all();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].action, "wallet_session");
    assert.equal(archived[0].tx_hash, session);
    assert.equal(archived[0].wallet, wallet);
    assert.equal(archived[0].points, 10);
    assert.throws(() => {
      db.prepare(
        `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
         VALUES (?, 'wallet_session', 10, ?, NULL, '2026-10-19T00:00:00.000Z')`,
      ).run(wallet, session);
    });
    assert.ok(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'points_ledger_onchain_action_tx'",
      ).get(),
    );
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'points_ledger'").get();
    assert.ok(seq.seq >= 1);
    const next = db
      .prepare(
        `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
         VALUES (?, 'relayer_job', 50, ?, NULL, '2026-10-19T00:00:00.000Z')`,
      )
      .run(wallet, kept);
    assert.ok(Number(next.lastInsertRowid) > Number(seq.seq));
    db.close();
  });
});

describe("observability config", () => {
  it("keeps logs when traces are off", () => {
    const wrangler = read(new URL("wrangler.jsonc", root));
    const ledger = read(new URL("src/ledger.ts", root));
    assert.match(wrangler, /"logs"\s*:\s*\{[^}]*"head_sampling_rate"\s*:\s*1/s);
    assert.match(wrangler, /"invocation_logs"\s*:\s*false/);
    assert.match(wrangler, /"traces"\s*:\s*\{[^}]*"enabled"\s*:\s*false/s);
    assert.doesNotMatch(wrangler, /"head_sampling_rate"\s*:\s*0\s*,\s*"logs"/);
    assert.match(ledger, /LIMIT \$\{cap\}/);
  });
});

describe("allowlist", () => {
  it("uses the GasRescueSwap addresses already in wallet/src/lib/fixture.ts", () => {
    const fixture = read(new URL("wallet/src/lib/fixture.ts", repo));
    const allow = read(new URL("src/allowlist.ts", root));
    const base = fixture.match(/export const BASE_SEPOLIA_DEPLOY = \{[\s\S]*?gasRescue: "(0x[0-9a-fA-F]{40})"/);
    const arb = fixture.match(/export const ARB_SEPOLIA_DEPLOY = \{[\s\S]*?gasRescue: "(0x[0-9a-fA-F]{40})"/);
    assert.ok(base && arb);
    assert.match(allow, new RegExp(base[1]));
    assert.match(allow, new RegExp(arb[1]));
    assert.match(allow, /84532/);
    assert.match(allow, /421614/);
  });
});

describe("heal batch", () => {
  it("inserts the missing rows in one batch", () => {
    const ledger = read(new URL("src/ledger.ts", root));
    const start = ledger.indexOf("const missing = rows.filter");
    const end = ledger.indexOf("return { duplicate: false };", start);
    const heal = ledger.slice(start, end);
    assert.ok(start !== -1 && end > start);
    assert.match(heal, /db\.batch\(/);
    assert.equal(heal.match(/db\.batch\(/g).length, 1);
    assert.doesNotMatch(heal, /for\s*\(\s*const row of missing\s*\)/);
    assert.doesNotMatch(heal, /insertActivity/);
  });
});

describe("rubric figures", () => {
  it("records the same flat figures as relayer/points/rubric.mjs", () => {
    const rubric = read(new URL("relayer/points/rubric.mjs", repo));
    const activity = read(new URL("src/activity.ts", root));
    assert.match(rubric, /RESCUE_POINTS_PLACEHOLDER = 100/);
    assert.match(rubric, /relayer_job: 50/);
    assert.match(activity, /RESCUE_POINTS = 100/);
    assert.match(activity, /RELAYER_JOB_POINTS = 50/);
  });
});
