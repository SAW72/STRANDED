import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { ledgerErrorCode } from "../src/errors";
import { allowWalletRead, WALLET_READ_LIMIT, WALLET_READ_MAX_KEYS, walletReadBucketCount } from "../src/readLimit";
import { minConfirmations, rpcClient } from "../src/receipt";
import { parseTokenAllowlist } from "../src/tokenAllowlist";
import {
  EMPTY,
  TOKEN_IN,
  USER,
  bindings,
  getPoints,
  installOfflineFetch,
  installReceipt,
  ledgerCount,
  mac,
  nowSeconds,
  postIngest,
  rescuedReceipt,
  runtimeSecret,
  txHash,
} from "./helpers";

const secret = runtimeSecret();

describe.sequential("ingest hardening", () => {
  beforeEach(() => {
    installOfflineFetch();
  });

  it("hides an unset or short secret behind bad_signature", async () => {
    const rpc = installOfflineFetch();
    const unset = bindings(secret);
    delete unset.POINTS_INGEST_SECRET;
    const missing = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2" },
        body: "{}",
      }),
      unset,
    );
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ ok: false, error: "bad_signature" });

    const shortEnv = bindings("too-short");
    const short = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2" },
        body: "{}",
      }),
      shortEnv,
    );
    expect(short.status).toBe(401);
    expect(await short.json()).toEqual({ ok: false, error: "bad_signature" });
    expect(rpc.calls()).toBe(0);
  });

  it("trims a long secret before checking the signature", async () => {
    const hash = txHash("p");
    installReceipt(rescuedReceipt({ chainId: 84532 }));
    const raw = JSON.stringify({ chainId: 84532, txHash: hash });
    const timestamp = String(nowSeconds());
    const signature = await mac(secret, timestamp, raw);
    const response = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(raw).byteLength),
          "x-points-timestamp": timestamp,
          "x-points-signature": signature,
        },
        body: raw,
      }),
      bindings(` ${secret}\n`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: false });
  });

  it("rejects a body that does not match the signature", async () => {
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532 }));
    const signed = JSON.stringify({ chainId: 84532, txHash: txHash("s") });
    const timestamp = String(nowSeconds());
    const signature = await mac(secret, timestamp, signed);
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("t") }, { timestamp, signature });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "bad_signature" });
    expect(rpc.calls()).toBe(0);
  });

  it("answers a CORS preflight and ignores an Origin of null", async () => {
    const headers = new Headers({ origin: "https://strandedtoken.trade" });
    const preflight = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", { method: "OPTIONS", headers }),
      bindings(secret),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://strandedtoken.trade");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-points-signature");

    const response = await getPoints(secret, `/points/${EMPTY}`, "null");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a missing content length and a body over 4 KB before using the receipt", async () => {
    const rpc = installReceipt(rescuedReceipt({ chainId: 84532 }));
    const hash = txHash("b");
    const timestamp = String(nowSeconds());
    const raw = JSON.stringify({ chainId: 84532, txHash: hash, pad: "a".repeat(5000) });
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(4096);
    const signature = await mac(secret, timestamp, raw);
    const oversized = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(raw).byteLength),
          "x-points-timestamp": timestamp,
          "x-points-signature": signature,
        },
        body: raw,
      }),
      bindings(secret),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ ok: false, error: "invalid_body" });

    const undeclared = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-points-timestamp": timestamp,
          "x-points-signature": signature,
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          },
        }),
        // @ts-expect-error Workers and Node accept a streamed body without a length.
        duplex: "half",
      }),
      bindings(secret),
    );
    expect(undeclared.status).toBe(400);
    expect(await undeclared.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(rpc.calls()).toBe(0);
  });

  it("rejects a bad body and a bad tx hash", async () => {
    const rpc = installOfflineFetch();
    const timestamp = String(nowSeconds());
    const raw = "not-json";
    const signature = await mac(secret, timestamp, raw);
    const bad = await worker.fetch(
      new Request("https://points.invalid/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(raw.length),
          "x-points-timestamp": timestamp,
          "x-points-signature": signature,
        },
        body: raw,
      }),
      bindings(secret),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_body" });

    const hash = await postIngest(secret, { chainId: 84532, txHash: "0x1234" });
    expect(hash.status).toBe(400);
    expect(await hash.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(rpc.calls()).toBe(0);
  });

  it("returns receipt_not_found while the receipt is still null", async () => {
    const rpc = installReceipt(null);
    const before = await ledgerCount();
    const response = await postIngest(secret, { chainId: 84532, txHash: txHash("n") });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "receipt_not_found" });
    expect(rpc.calls()).toBe(1);
    expect(await ledgerCount()).toEqual(before);
  });

  it("rejects a removed log, two matching logs, a missing status, a non-hex status, and short data", async () => {
    const base = rescuedReceipt({ chainId: 84532 });
    const removed = installReceipt({
      status: "0x1",
      blockNumber: "0x1",
      logs: [{ ...(base.logs[0] as object), removed: true }],
    });
    const removedResponse = await postIngest(secret, { chainId: 84532, txHash: txHash("r") });
    expect(removedResponse.status).toBe(400);
    expect(await removedResponse.json()).toEqual({ ok: false, error: "missing_rescued_log" });
    expect(removed.calls()).toBe(2);

    const doubled = installReceipt({
      status: "0x1",
      blockNumber: "0x1",
      logs: [base.logs[0], base.logs[0]],
    });
    const doubledResponse = await postIngest(secret, { chainId: 84532, txHash: txHash("d") });
    expect(doubledResponse.status).toBe(400);
    expect(await doubledResponse.json()).toEqual({ ok: false, error: "invalid_receipt" });
    expect(doubled.calls()).toBe(2);

    const missingStatus = installReceipt({ blockNumber: "0x1", logs: base.logs });
    const missingStatusResponse = await postIngest(secret, { chainId: 84532, txHash: txHash("m") });
    expect(missingStatusResponse.status).toBe(502);
    expect(await missingStatusResponse.json()).toEqual({ ok: false, error: "invalid_receipt" });
    expect(missingStatus.calls()).toBe(1);

    const textStatus = installReceipt({ status: "success", blockNumber: "0x1", logs: base.logs });
    const textStatusResponse = await postIngest(secret, { chainId: 84532, txHash: txHash("x") });
    expect(textStatusResponse.status).toBe(502);
    expect(await textStatusResponse.json()).toEqual({ ok: false, error: "invalid_receipt" });
    expect(textStatus.calls()).toBe(1);

    const shortLog = {
      ...(base.logs[0] as { data: string }),
      data: "0x" + "00".repeat(32),
    };
    installReceipt({ status: "0x1", blockNumber: "0x1", logs: [shortLog] });
    const shortResponse = await postIngest(secret, { chainId: 84532, txHash: txHash("h") });
    expect(shortResponse.status).toBe(400);
    expect(await shortResponse.json()).toEqual({ ok: false, error: "invalid_receipt" });
  });

  it("maps an RPC error and an RPC timeout to rpc_failed", async () => {
    rpcClient.fetch = async () => new Response("no", { status: 500 });
    const failed = await postIngest(secret, { chainId: 84532, txHash: txHash("e") });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ ok: false, error: "rpc_failed" });

    rpcClient.fetch = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const timedOut = await postIngest(secret, { chainId: 84532, txHash: txHash("o") });
    expect(timedOut.status).toBe(502);
    expect(await timedOut.json()).toEqual({ ok: false, error: "rpc_failed" });
  });

  it("waits for the default confirmation depth and then records", async () => {
    const hash = txHash("c");
    const before = await ledgerCount();
    const shallow = installReceipt(rescuedReceipt({ chainId: 84532, blockNumber: "0x5" }), { head: "0x5" });
    const waiting = await postIngest(secret, { chainId: 84532, txHash: hash });
    expect(waiting.status).toBe(425);
    expect(await waiting.json()).toEqual({ ok: false, error: "awaiting_confirmations" });
    expect(shallow.calls()).toBe(2);
    expect(await ledgerCount()).toEqual(before);

    installReceipt(rescuedReceipt({ chainId: 84532, blockNumber: "0x5" }), { head: "0x6" });
    const ready = await postIngest(secret, { chainId: 84532, txHash: hash });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, duplicate: false });
  });

  it("checks tokenIn only when TOKEN_IN_ALLOWLIST is set", async () => {
    const openHash = txHash("u");
    installReceipt(rescuedReceipt({ chainId: 84532 }));
    const open = await postIngest(secret, { chainId: 84532, txHash: openHash });
    expect(open.status).toBe(200);

    const listedHash = txHash("l");
    const allowed = bindings(secret);
    allowed.TOKEN_IN_ALLOWLIST = JSON.stringify({ 84532: [TOKEN_IN] });
    installReceipt(rescuedReceipt({ chainId: 84532 }));
    const listed = await postSigned(allowed, { chainId: 84532, txHash: listedHash });
    expect(listed.status).toBe(200);

    const blocked = bindings(secret);
    blocked.TOKEN_IN_ALLOWLIST = `84532:${USER}`;
    installReceipt(rescuedReceipt({ chainId: 84532 }));
    const denied = await postSigned(blocked, { chainId: 84532, txHash: txHash("k") });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ ok: false, error: "token_not_allowed" });
  });

  it("rejects wallet_session in the database as well as the API", async () => {
    const before = await ledgerCount();
    let caught: unknown;
    try {
      await env.DB.prepare(
        `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
         VALUES (?, 'wallet_session', 5, ?, NULL, ?)`,
      )
        .bind(USER, txHash("q"), "2026-10-19T00:00:00.000Z")
        .run();
    } catch (err) {
      caught = err;
    }
    expect(ledgerErrorCode(caught)).toBe("excluded_action");
    expect(await ledgerCount()).toEqual(before);
  });

  it("returns 400 for a bad address and a broken percent-escape", async () => {
    const bad = await getPoints(secret, "/points/0x1234");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_address" });

    const broken = await getPoints(secret, "/points/%E0%A4%A");
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ ok: false, error: "invalid_address" });
  });

  it("logs an invalid confirmation depth and still waits for 2", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      expect(minConfirmations(undefined)).toBe(2);
      expect(minConfirmations("")).toBe(2);
      expect(lines).toEqual([]);
      expect(minConfirmations("0")).toBe(2);
      expect(minConfirmations("nope")).toBe(2);
      expect(minConfirmations("129")).toBe(2);
      expect(minConfirmations("16")).toBe(16);
    } finally {
      console.log = original;
    }
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.includes("points_confirmations_invalid"))).toBe(true);

    const shallow = bindings(secret);
    shallow.POINTS_MIN_CONFIRMATIONS = "0";
    installReceipt(rescuedReceipt({ chainId: 84532, blockNumber: "0x5" }), { head: "0x5" });
    const waiting = await postSigned(shallow, { chainId: 84532, txHash: txHash("z") });
    expect(waiting.status).toBe(425);
    expect(await waiting.json()).toEqual({ ok: false, error: "awaiting_confirmations" });
  });

  it("logs a bad allowlist entry and keeps a valid address", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const map = parseTokenAllowlist(`84532:${TOKEN_IN},not-an-address;nope:${TOKEN_IN}`);
      expect(map?.get(84532)?.has(TOKEN_IN)).toBe(true);
      expect(parseTokenAllowlist(undefined)).toBeNull();
    } finally {
      console.log = original;
    }
    expect(lines.some((line) => line.includes("points_allowlist_ignored"))).toBe(true);
    expect(lines.some((line) => line.includes("not-an-address"))).toBe(false);
  });

  it("evicts expired read-limit keys and stays bounded", () => {
    const now = 1_000_000;
    for (let i = 0; i < WALLET_READ_MAX_KEYS; i += 1) {
      const request = new Request("https://points.invalid/points/leaderboard", {
        headers: { "cf-connecting-ip": `old-${i}` },
      });
      expect(allowWalletRead(request, now)).toBe(true);
    }
    expect(walletReadBucketCount()).toBe(WALLET_READ_MAX_KEYS);
    const later = new Request("https://points.invalid/points/leaderboard", {
      headers: { "cf-connecting-ip": "fresh" },
    });
    expect(allowWalletRead(later, now + 60_000)).toBe(true);
    expect(walletReadBucketCount()).toBe(1);
    const freshNow = now + 120_000;
    for (let i = 0; i < WALLET_READ_MAX_KEYS + 25; i += 1) {
      const request = new Request("https://points.invalid/points/leaderboard", {
        headers: { "cf-connecting-ip": `live-${i}` },
      });
      allowWalletRead(request, freshNow);
    }
    expect(walletReadBucketCount()).toBeLessThanOrEqual(WALLET_READ_MAX_KEYS);
  });

  it("stops wallet reads after the per-caller cap", async () => {
    let last: Response | null = null;
    for (let i = 0; i < WALLET_READ_LIMIT + 1; i += 1) {
      last = await getPoints(secret, `/points/${EMPTY}`);
    }
    expect(last?.status).toBe(429);
    expect(await last?.json()).toEqual({ ok: false, error: "rate_limited" });
  });
});

async function postSigned(
  envBindings: ReturnType<typeof bindings>,
  body: { chainId: number; txHash: string },
): Promise<Response> {
  const raw = JSON.stringify(body);
  const timestamp = String(nowSeconds());
  const signature = await mac(String(envBindings.POINTS_INGEST_SECRET), timestamp, raw);
  return worker.fetch(
    new Request("https://points.invalid/v1/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(raw).byteLength),
        "x-points-timestamp": timestamp,
        "x-points-signature": signature,
      },
      body: raw,
    }),
    envBindings,
  );
}
