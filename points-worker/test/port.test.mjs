import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const repo = new URL("../../", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

describe("schema port", () => {
  it("keeps the relayer schema, including CHECKs, STRICT, triggers, and the partial unique index", () => {
    const migration = read(new URL("migrations/0001_init.sql", root));
    const schema = read(new URL("relayer/points/schema.sql", repo));
    assert.match(schema, /'wallet_session'/);
    assert.match(migration, /CHECK \(action <> 'wallet_session'\)/);
    assert.match(migration, /'wallet_session'/);
    assert.doesNotMatch(migration, /'registry_find_claimed',\s*'wallet_session'/);
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
