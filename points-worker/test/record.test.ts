import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ledgerErrorCode } from "../src/errors";
import { LEADERBOARD_LIMIT, leaderboardTotals, recordRescue } from "../src/ledger";
import { resetLeaderboardCache } from "../src/index";
import { WALLET_READ_LIMIT } from "../src/readLimit";
import {
  EMPTY,
  OTHER_RELAYER,
  OTHER_USER,
  RELAYER,
  USER,
  getPoints,
  installOfflineFetch,
  installReceipt,
  ledgerCount,
  nowSeconds,
  postIngest,
  rescuedReceipt,
  runtimeSecret,
  txHash,
} from "./helpers";

const secret = runtimeSecret();
const firstTx = txHash("A");
const secondTx = txHash("B");

describe.sequential("recorded activity", () => {
  beforeEach(() => {
    installOfflineFetch();
  });

  it("records a rescue and a relayer job from a valid signature and receipt", async () => {
    const before = await ledgerCount();
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532, user: USER, relayer: RELAYER }));
    const response = await postIngest(
      secret,
      { chainId: 84532, txHash: firstTx },
      { origin: "https://strandedtoken.trade" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://strandedtoken.trade");
    expect(await response.json()).toEqual({ ok: true, duplicate: false });
    expect(rpc.calls()).toBe(2);
    expect(await ledgerCount()).toEqual({ n: before.n + 2, s: before.s + 150 });

    const wallet = await getPoints(secret, `/points/${USER}`, "https://strandedtoken.trade");
    expect(wallet.headers.get("access-control-allow-origin")).toBe("https://strandedtoken.trade");
    expect(wallet.headers.get("cache-control")).toBe("public, max-age=30");
    const walletBody = await wallet.json();
    expect(walletBody).toEqual({
      wallet: USER,
      total: 100,
      categories: [{ action: "rescue", points: 100, count: 1 }],
      entries: [{ action: "rescue", points: 100, txHash: firstTx, chainId: 84532 }],
    });
    expect(walletBody).not.toHaveProperty("rank");

    const relayer = await getPoints(secret, `/points/${RELAYER.toUpperCase()}`);
    const relayerBody = await relayer.json();
    expect(relayerBody).toEqual({
      wallet: RELAYER,
      total: 50,
      categories: [{ action: "relayer_job", points: 50, count: 1 }],
      entries: [{ action: "relayer_job", points: 50, txHash: firstTx, chainId: 84532 }],
    });
    expect(relayerBody).not.toHaveProperty("rank");

    const board = await getPoints(secret, "/points/leaderboard", "https://strandedtoken.trade");
    const boardBody = await board.json();
    expect(boardBody).toEqual({
      rows: [
        { wallet: USER, total: 100 },
        { wallet: RELAYER, total: 50 },
      ],
    });
    expect(board.headers.get("cache-control")).toBe("public, max-age=30");
    expect(JSON.stringify(boardBody)).not.toContain('"rank"');
  });

  it("does not double count a duplicate ingest", async () => {
    const before = await ledgerCount();
    installReceipt(rescuedReceipt({ chainId: 84532, user: USER, relayer: RELAYER }));
    const response = await postIngest(secret, { chainId: 84532, txHash: firstTx });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(await ledgerCount()).toEqual(before);
    const wallet = await getPoints(secret, `/points/${USER}`);
    const walletBody = await wallet.json();
    expect(walletBody).toMatchObject({ total: 100 });
    expect(walletBody).not.toHaveProperty("rank");
  });

  it("accepts a timestamp 300 seconds off and still rejects 301", async () => {
    installReceipt(rescuedReceipt({ chainId: 421614, user: OTHER_USER, relayer: OTHER_RELAYER }));
    const accepted = await postIngest(secret, { chainId: 421614, txHash: secondTx }, {
      timestamp: String(nowSeconds() - 300),
    });
    expect(accepted.status).toBe(200);
    const wallet = await getPoints(secret, `/points/${OTHER_USER}`);
    expect(await wallet.json()).toMatchObject({
      wallet: OTHER_USER,
      total: 100,
      categories: [{ action: "rescue", points: 100, count: 1 }],
      entries: [{ action: "rescue", points: 100, txHash: secondTx, chainId: 421614 }],
    });

    const rpc = installReceipt(rescuedReceipt({ chainId: 84532 }));
    const stale = await postIngest(secret, { chainId: 84532, txHash: txHash("C") }, {
      timestamp: String(nowSeconds() - 301),
    });
    expect(stale.status).toBe(401);
    expect(rpc.calls()).toBe(0);
  });

  it("maps update and delete to append-only and keeps the rows", async () => {
    const before = await ledgerCount();
    let updated: unknown;
    try {
      await env.DB.prepare("UPDATE points_ledger SET points = 1").run();
    } catch (err) {
      updated = err;
    }
    let deleted: unknown;
    try {
      await env.DB.prepare("DELETE FROM points_ledger").run();
    } catch (err) {
      deleted = err;
    }
    expect(ledgerErrorCode(updated)).toBe("append-only");
    expect(ledgerErrorCode(deleted)).toBe("append-only");
    expect(await ledgerCount()).toEqual(before);
  });

  it("heals missing rows in one batch call", async () => {
    const batches: Array<Array<{ sql?: string }>> = [];
    let failNext = true;
    const db = {
      prepare(sql: string) {
        const stmt = {
          sql,
          bind() {
            return stmt;
          },
          async all() {
            return { results: [] as Array<{ action: string }> };
          },
        };
        return stmt;
      },
      async batch(stmts: Array<{ sql?: string }>) {
        batches.push(stmts);
        if (failNext) {
          failNext = false;
          throw new Error("duplicate");
        }
        return [];
      },
    };
    const healed = await recordRescue(db as unknown as D1Database, {
      user: USER,
      relayer: RELAYER,
      txHash: txHash("Z"),
      chainId: 84532,
    });
    expect(healed.duplicate).toBe(false);
    expect(batches).toHaveLength(2);
    const inserts = batches[1].map((stmt) => String(stmt.sql || "")).filter((sql) => sql.includes("INSERT INTO points_ledger"));
    expect(inserts).toHaveLength(2);
    expect(batches[1].some((stmt) => String(stmt.sql || "").includes("PRAGMA"))).toBe(true);
  });

  it("heals a partial rescue in one batch", async () => {
    const hash = txHash("H");
    await env.DB.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, 'rescue_completed', 100, ?, ?, ?)`,
    )
      .bind(USER, hash, JSON.stringify({ chainId: 84532 }), "2026-10-19T00:00:00.000Z")
      .run();
    const healed = await recordRescue(env.DB, {
      user: USER,
      relayer: RELAYER,
      txHash: hash,
      chainId: 84532,
    });
    expect(healed.duplicate).toBe(false);
    const rows = await env.DB.prepare(`SELECT action FROM points_ledger WHERE tx_hash = ? ORDER BY action`)
      .bind(hash)
      .all<{ action: string }>();
    expect((rows.results || []).map((row) => row.action)).toEqual(["relayer_job", "rescue_completed"]);
    const again = await recordRescue(env.DB, {
      user: USER,
      relayer: RELAYER,
      txHash: hash,
      chainId: 84532,
    });
    expect(again.duplicate).toBe(true);
  });

  it("limits and caches the leaderboard", async () => {
    const capped = await leaderboardTotals(env.DB, 1);
    const full = await leaderboardTotals(env.DB, LEADERBOARD_LIMIT);
    expect(capped.length).toBe(Math.min(1, full.length));
    if (full.length > 0) expect(capped[0]).toEqual(full[0]);
    for (let i = 1; i < full.length; i += 1) {
      const prev = full[i - 1];
      const row = full[i];
      expect(prev.total > row.total || (prev.total === row.total && prev.wallet <= row.wallet)).toBe(true);
    }
    let last = await getPoints(secret, "/points/leaderboard");
    expect(last.headers.get("cache-control")).toBe("public, max-age=30");
    for (let i = 0; i < WALLET_READ_LIMIT; i += 1) {
      last = await getPoints(secret, "/points/leaderboard");
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("throws for an invalid relayer and leaves the earlier row on a failed heal", async () => {
    const before = await ledgerCount();
    await expect(
      recordRescue(env.DB, {
        user: USER,
        relayer: "not-a-relayer",
        txHash: txHash("R"),
        chainId: 84532,
      }),
    ).rejects.toBeTruthy();
    expect(await ledgerCount()).toEqual(before);

    const hash = txHash("S");
    await env.DB.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, 'rescue_completed', 100, ?, ?, ?)`,
    )
      .bind(USER, hash, JSON.stringify({ chainId: 84532 }), "2026-10-19T00:00:00.000Z")
      .run();
    await expect(
      recordRescue(env.DB, {
        user: USER,
        relayer: "not-a-relayer",
        txHash: hash,
        chainId: 84532,
      }),
    ).rejects.toBeTruthy();
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM points_ledger WHERE tx_hash = ?").bind(hash).first<{ n: number }>();
    expect(Number(left?.n)).toBe(1);
  });

  it("reuses the leaderboard aggregate until the server cache is reset", async () => {
    resetLeaderboardCache();
    const first = await getPoints(secret, "/points/leaderboard");
    expect(first.status).toBe(200);
    const cached = await first.json();
    const hash = txHash("L");
    await env.DB.prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, 'rescue_completed', 100, ?, ?, ?)`,
    )
      .bind(EMPTY, hash, JSON.stringify({ chainId: 84532 }), "2026-10-19T00:00:00.000Z")
      .run();
    const second = await getPoints(secret, "/points/leaderboard");
    expect(await second.json()).toEqual(cached);
    resetLeaderboardCache();
    const third = await getPoints(secret, "/points/leaderboard");
    const fresh = (await third.json()) as { rows: Array<{ wallet: string; total: number }> };
    expect(fresh.rows.some((row) => row.wallet === EMPTY)).toBe(true);
  });
});
