import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ledgerErrorCode } from "../src/errors";
import {
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
    expect(rpc.calls()).toBe(1);
    expect(await ledgerCount()).toEqual({ n: before.n + 2, s: before.s + 150 });

    const wallet = await getPoints(secret, `/points/${USER}`, "https://strandedtoken.trade");
    expect(wallet.headers.get("access-control-allow-origin")).toBe("https://strandedtoken.trade");
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
});
