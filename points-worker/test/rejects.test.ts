import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { GAS_RESCUE_SWAP } from "../src/allowlist";
import { ledgerErrorCode } from "../src/errors";
import { insertActivity } from "../src/ledger";
import {
  EMPTY,
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

describe.sequential("rejected ingest", () => {
  beforeEach(() => {
    installOfflineFetch();
  });

  it("turns recursive triggers on inside a write batch", async () => {
    const batch = await env.DB.batch([
      env.DB.prepare("PRAGMA recursive_triggers = ON"),
      env.DB.prepare("PRAGMA recursive_triggers"),
    ]);
    const row = batch[1]?.results?.[0] as { recursive_triggers?: number } | undefined;
    expect(Number(row?.recursive_triggers)).toBe(1);
  });

  it("maps an excluded action insert to excluded_action", async () => {
    let caught: unknown;
    try {
      await insertActivity(env.DB, {
        wallet: USER,
        action: "bug_report",
        points: 1,
        txHash: txHash("b"),
        metadata: null,
        createdAt: "2026-10-19T00:00:00.000Z",
      });
    } catch (err) {
      caught = err;
    }
    expect(ledgerErrorCode(caught)).toBe("excluded_action");
    expect(await ledgerCount()).toEqual({ n: 0, s: 0 });
  });

  it("rejects wallet_session before any receipt fetch", async () => {
    const rpc = installOfflineFetch();
    const response = await postIngest(secret, {
      chainId: 84532,
      txHash: txHash("w"),
      action: "wallet_session",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "wallet_session_disabled" });
    expect(rpc.calls()).toBe(0);
    await expect(
      insertActivity(env.DB, {
        wallet: USER,
        action: "wallet_session",
        points: 10,
        txHash: txHash("s"),
        metadata: null,
        createdAt: "2026-10-19T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "wallet_session_disabled" });
    expect(await ledgerCount()).toEqual({ n: 0, s: 0 });
  });

  it("rejects a bad signature", async () => {
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532 }));
    const response = await postIngest(
      secret,
      { chainId: 84532, txHash: txHash("a") },
      { signature: "aa" },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "bad_signature" });
    expect(rpc.calls()).toBe(0);
  });

  it("rejects a timestamp more than 5 minutes off", async () => {
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532 }));
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("t") }, {
      timestamp: String(nowSeconds() - 301),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "stale_timestamp" });
    expect(rpc.calls()).toBe(0);
  });

  it("rejects status 0", async () => {
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532, status: "0x0" }));
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("z") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "status_failed" });
    expect(rpc.calls()).toBe(1);
  });

  it("rejects a Rescued log from a contract that is not allowlisted for the chain", async () => {
    const rpc = installReceipt(
      rescuedReceipt({ chainId: 84532, contract: GAS_RESCUE_SWAP[421614] }),
    );
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("c") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "wrong_contract" });
    expect(rpc.calls()).toBe(1);
  });

  it("rejects a registry action without calling RPC", async () => {
    const rpc = installOfflineFetch();
    const response = await postIngest(secret, {
      chainId: 84532,
      txHash: txHash("r"),
      action: "registry_find_posted",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "registry_deferred" });
    expect(rpc.calls()).toBe(0);
  });

  it("rejects a chain that is not allowlisted", async () => {
    const rpc = installOfflineFetch();
    const response = await postIngest(secret, { chainId: 1, txHash: txHash("n") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "wrong_chain" });
    expect(rpc.calls()).toBe(0);
  });

  it("rejects a receipt with no Rescued log", async () => {
    const rpc = installReceipt(
      rescuedReceipt({
        chainId: 84532,
        logs: [
          {
            address: GAS_RESCUE_SWAP[84532],
            topics: [`0x${"11".repeat(32)}`],
            data: "0x",
          },
        ],
      }),
    );
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("m") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "missing_rescued_log" });
    expect(rpc.calls()).toBe(1);
  });

  it("does not allow a foreign origin and leaves the ledger empty", async () => {
    const response = await getPoints(secret, `/points/${EMPTY}`, "https://example.invalid");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({
      wallet: EMPTY,
      total: 0,
      categories: [],
      entries: [],
    });
    expect(body).not.toHaveProperty("rank");
    expect(await ledgerCount()).toEqual({ n: 0, s: 0 });
  });
});
