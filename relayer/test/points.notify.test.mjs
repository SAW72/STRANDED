import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rescueTxsFromJsonl } from "../scripts/backfill-points.mjs";
import {
  clearPointsRetryTimers,
  deliverPointsNotify,
  flushPointsNotify,
  pointsOutboxPath,
  retryPointsOutbox,
  schedulePointsNotify,
} from "../points/notify.mjs";

function runtimeSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tx() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("points push", () => {
  it("is a no-op when either env value is unset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-off-"));
    const calls = [];
    const fetchImpl = async () => {
      calls.push("fetch");
      throw new Error("offline");
    };
    try {
      const secretOnly = schedulePointsNotify({
        chainId: 84532,
        txHash: tx(),
        dataDir: dir,
        env: { POINTS_INGEST_SECRET: runtimeSecret() },
        fetchImpl,
      });
      const urlOnly = schedulePointsNotify({
        chainId: 84532,
        txHash: tx(),
        dataDir: dir,
        env: { POINTS_API_URL: "https://points.invalid" },
        fetchImpl,
      });
      const neither = await retryPointsOutbox({ dataDir: dir, env: {}, fetchImpl });
      assert.deepEqual(secretOnly, { enabled: false });
      assert.deepEqual(urlOnly, { enabled: false });
      assert.deepEqual(neither, { enabled: false });
      assert.deepEqual(calls, []);
      await assert.rejects(stat(pointsOutboxPath(dir)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends to the outbox and retries a failed post", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-on-"));
    const secret = runtimeSecret();
    const hash = tx();
    const seen = [];
    let fail = true;
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      if (fail) return new Response("no", { status: 503 });
      return new Response("ok", { status: 200 });
    };
    const env = {
      POINTS_INGEST_SECRET: secret,
      POINTS_API_URL: "https://points.invalid/",
    };
    const scheduleDelay = () => {};
    try {
      const first = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash.toUpperCase(),
        dataDir: dir,
        env,
        fetchImpl,
        scheduleDelay,
      });
      assert.equal(first.sent, 0);
      const midway = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(midway, /"op":"enqueue"/);
      assert.match(midway, /"op":"attempt"/);
      assert.equal(midway.includes(secret), false);

      fail = false;
      const second = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(second.sent, 1);
      const done = await readFile(pointsOutboxPath(dir), "utf8");
      assert.ok(done.startsWith(midway));
      assert.match(done, /"op":"delivered"/);

      const third = await retryPointsOutbox({ dataDir: dir, env, fetchImpl });
      assert.equal(third.sent, 0);
      assert.equal(seen.length, 2);
      for (const call of seen) {
        assert.equal(call.url, "https://points.invalid/v1/ingest");
        const body = call.init.body;
        assert.equal(body, JSON.stringify({ chainId: 84532, txHash: hash }));
        const timestamp = call.init.headers["x-points-timestamp"];
        const expected = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
        assert.equal(call.init.headers["x-points-signature"], expected);
        assert.ok(call.init.signal);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("schedules the post without waiting for the response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-async-"));
    const secret = runtimeSecret();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = () => gate.then(() => new Response("ok", { status: 200 }));
    try {
      let settled = false;
      const pending = flushPointsNotify();
      const scheduled = schedulePointsNotify({
        chainId: 421614,
        txHash: tx(),
        dataDir: dir,
        env: { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" },
        fetchImpl,
      });
      assert.deepEqual(scheduled, { enabled: true, scheduled: true });
      queueMicrotask(() => {
        settled = true;
      });
      await Promise.resolve();
      assert.equal(settled, true);
      release();
      await flushPointsNotify();
      await pending;
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, /"op":"delivered"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays after broadcast in the relayer and out of the retry callback", () => {
    const src = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");
    const broadcast = src.indexOf("const txHash = await withBroadcastRetry");
    const consumed = src.indexOf("nonceStore.markConsumed");
    const logged = src.indexOf('event: "rescue_ok"');
    const notify = src.indexOf("schedulePointsNotify({");
    const wait = src.indexOf("waitForTransactionReceipt");
    assert.ok(broadcast !== -1 && consumed > broadcast && logged > consumed && notify > logged);
    assert.ok(wait > logged);
    assert.equal(src.slice(broadcast, consumed).includes("schedulePointsNotify"), false);
    assert.equal(src.slice(broadcast, consumed).includes("waitForTransactionReceipt"), false);
    assert.equal(src.slice(broadcast, consumed).includes("pointsOutbox"), false);
  });

  it("retries a 404 receipt_not_found instead of dropping it (O5)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-404-"));
    const secret = runtimeSecret();
    const hash = tx();
    let pending = true;
    const fetchImpl = async () => {
      if (pending) return new Response("missing", { status: 404 });
      return new Response("ok", { status: 200 });
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = () => {};
    try {
      const first = await deliverPointsNotify({ chainId: 84532, txHash: hash, dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(first.sent, 0);
      const midway = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(midway, /"op":"attempt"/);
      assert.match(midway, /http_404/);
      assert.equal(midway.includes('"op":"dropped"'), false);
      pending = false;
      const second = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(second.sent, 1);
      const done = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(done, /"op":"delivered"/);
      const third = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(third.sent, 0);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a 401 pending so a later retry can send (O6)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-401-"));
    const secret = runtimeSecret();
    const hash = tx();
    let status = 401;
    const fetchImpl = async () => new Response("no", { status });
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = () => {};
    try {
      const first = await deliverPointsNotify({ chainId: 421614, txHash: hash, dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(first.sent, 0);
      const midway = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(midway, /http_401/);
      assert.equal(midway.includes('"op":"dropped"'), false);
      status = 200;
      const second = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(second.sent, 1);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("backs off automatic retries, stops at the cap, and compacts the outbox (O4)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-backoff-"));
    const secret = runtimeSecret();
    const hash = tx();
    const delays = [];
    const queued = [];
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = (fn, ms) => {
      delays.push(ms);
      queued.push(fn);
    };
    try {
      const first = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl,
        scheduleDelay,
      });
      assert.equal(first.sent, 0);
      assert.deepEqual(delays, [1000]);
      for (let i = 0; i < 8 && queued.length > 0; i += 1) {
        const run = queued.shift();
        await run();
        await flushPointsNotify();
      }
      assert.ok(delays.length >= 2);
      assert.ok(delays[1] > delays[0]);
      assert.ok(delays.length <= 6);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(text.includes('"op":"dropped"'), false);
      assert.match(text, /"op":"enqueue"/);
      const lines = text.split("\n").filter((line) => line.trim());
      assert.ok(lines.length < 6);
      const pending = JSON.parse(lines[0]);
      assert.equal(pending.op, "enqueue");
      assert.ok(pending.attempts >= 1);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("posts only after a successful receipt and skips a reverted one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-confirm-"));
    const secret = runtimeSecret();
    const hash = tx();
    const calls = [];
    let mode = "pending";
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response("ok", { status: 200 });
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const confirmReceipt = async () => {
      if (mode === "pending") throw new Error("not mined");
      if (mode === "reverted") return { status: "reverted" };
      return { status: "success" };
    };
    try {
      const waiting = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        scheduleDelay: () => {},
      });
      assert.equal(waiting.sent, 0);
      assert.deepEqual(calls, []);
      const parked = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(parked, /receipt_pending/);
      assert.equal(parked.includes('"op":"dropped"'), false);

      mode = "success";
      const mined = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, confirmReceipt, scheduleDelay: () => {} });
      assert.equal(mined.sent, 1);
      assert.equal(calls.length, 1);

      const other = tx();
      mode = "reverted";
      const reverted = await deliverPointsNotify({
        chainId: 84532,
        txHash: other,
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        scheduleDelay: () => {},
      });
      assert.equal(reverted.sent, 0);
      assert.equal(calls.length, 1);
      const done = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(done, /status_failed/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an http URL and a short secret", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-url-"));
    const errors = [];
    const original = console.error;
    console.error = (...args) => {
      errors.push(args.join(" "));
    };
    try {
      const httpUrl = schedulePointsNotify({
        chainId: 84532,
        txHash: tx(),
        dataDir: dir,
        env: { POINTS_INGEST_SECRET: runtimeSecret(), POINTS_API_URL: "http://points.invalid" },
        fetchImpl: async () => {
          throw new Error("fetched");
        },
      });
      const short = schedulePointsNotify({
        chainId: 84532,
        txHash: tx(),
        dataDir: dir,
        env: { POINTS_INGEST_SECRET: "short-secret", POINTS_API_URL: "https://points.invalid" },
      });
      assert.deepEqual(httpUrl, { enabled: false });
      assert.deepEqual(short, { enabled: false });
      assert.ok(errors.some((line) => line === "points_notify url"));
      assert.equal(errors.some((line) => line.includes("http://")), false);
      await assert.rejects(stat(pointsOutboxPath(dir)));
    } finally {
      console.error = original;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("backfill parser", () => {
  it("replays rescue_ok tx hashes and skips other lines", () => {
    const hash = tx();
    const text = [
      JSON.stringify({ event: "quote", txHash: hash, chainId: "84532" }),
      JSON.stringify({ event: "rescue_error", txHash: hash, chainId: "84532" }),
      JSON.stringify({ event: "rescue_ok", txHash: hash.toUpperCase(), chainId: "84532" }),
      JSON.stringify({ event: "rescue_ok", txHash: hash, chainId: "84532" }),
      JSON.stringify({ event: "rescue_ok", chainId: "421614" }),
      "not-json",
    ].join("\n");
    assert.deepEqual(rescueTxsFromJsonl(text), [{ chainId: 84532, txHash: hash }]);
  });
});
