import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
  notePointsCancel,
  notePointsReceiptReplacement,
  notePointsReplacement,
  pointsMinConfirmations,
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

describe("points push", { concurrency: false }, () => {
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
      assert.equal(scheduled.enabled, true);
      assert.equal(scheduled.scheduled, true);
      assert.equal(typeof scheduled.durable.then, "function");
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
    assert.match(src, /confirmations: pointsMinConfirmations\(process\.env, hash\)/);
    assert.equal(src.includes("confirmations: 1"), false);
    assert.match(src, /onReplaced/);
    assert.match(src, /notePointsReceiptReplacement/);
    assert.equal(src.slice(broadcast, consumed).includes("schedulePointsNotify"), false);
    assert.equal(src.slice(broadcast, consumed).includes("notePointsReceiptReplacement"), false);
    assert.equal(src.slice(broadcast, consumed).includes("waitForTransactionReceipt"), false);
    assert.equal(src.slice(broadcast, consumed).includes("pointsOutbox"), false);
  });

  it("retries a 404 receipt_not_found instead of dropping it (O5)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-404-"));
    const secret = runtimeSecret();
    const hash = tx();
    let pending = true;
    const fetchImpl = async () => {
      if (pending) return new Response(JSON.stringify({ ok: false, error: "receipt_not_found" }), { status: 404 });
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

  it("backs off, keeps retrying after the cap, and compacts via rename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-backoff-"));
    const secret = runtimeSecret();
    const hash = tx();
    const delays = [];
    const queued = [];
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
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
        jitter: () => 0,
      });
      assert.equal(first.sent, 0);
      assert.deepEqual(delays, [1000]);
      for (let i = 0; i < 6 && queued.length > 0; i += 1) {
        const run = queued.shift();
        await run();
        await flushPointsNotify();
      }
      assert.deepEqual(delays.slice(0, 5), [1000, 2000, 4000, 8000, 16000]);
      assert.equal(delays[5], 30_000);
      assert.ok(delays.every((ms) => ms <= 60_000));
      assert.ok(logs.some((line) => line.startsWith("points_notify cap ") && line.includes(hash)));
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(text.includes('"op":"dropped"'), false);
      assert.match(text, /"op":"enqueue"/);
      const lines = text.split("\n").filter((line) => line.trim());
      assert.ok(lines.length < 6);
      const pending = JSON.parse(lines[0]);
      assert.equal(pending.op, "enqueue");
      assert.ok(pending.attempts >= 1);
      const names = await readdir(dir);
      assert.equal(names.some((name) => name.endsWith(".tmp")), false);
      const info = await stat(pointsOutboxPath(dir));
      assert.equal(info.mode & 0o777, 0o600);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("credits a backlog after the old 31s stop, with a linear post count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-backlog-"));
    const secret = runtimeSecret();
    const hashes = Array.from({ length: 60 }, () => tx());
    const posts = [];
    let up = false;
    const queued = [];
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      posts.push(body.txHash);
      if (!up) return new Response("down", { status: 503 });
      return new Response("ok", { status: 200 });
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = (fn) => {
      queued.push(fn);
    };
    try {
      for (const hash of hashes) {
        const result = await deliverPointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl,
          scheduleDelay,
          jitter: () => 1,
        });
        assert.equal(result.sent, 0);
      }
      assert.equal(posts.length, hashes.length);
      let guard = 0;
      while (queued.length > 0 && posts.length < hashes.length * 6 && guard < 1000) {
        guard += 1;
        const batch = queued.splice(0, queued.length);
        for (const run of batch) await run();
        await flushPointsNotify();
      }
      assert.equal(posts.length, hashes.length * 6);
      up = true;
      const rest = queued.splice(0, queued.length);
      for (const run of rest) await run();
      await flushPointsNotify();
      const per = new Map();
      for (const hash of posts) per.set(hash, (per.get(hash) || 0) + 1);
      assert.equal(per.size, hashes.length);
      for (const hash of hashes) assert.equal(per.get(hash), 7);
      const pending = new Set();
      for (const line of (await readFile(pointsOutboxPath(dir), "utf8")).split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (row.op === "enqueue") pending.add(row.txHash);
        if (row.op === "delivered" || row.op === "dropped") pending.delete(row.txHash);
      }
      assert.equal(pending.size, 0);
      assert.ok(posts.length < hashes.length * hashes.length);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("credits good txs while one receipt stays pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-stuck-"));
    const secret = runtimeSecret();
    const stuck = tx();
    const goodA = tx();
    const goodB = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, [stuck, goodA, goodB]);
    const fetchImpl = async (_url, init) => {
      posts.push(JSON.parse(init.body).txHash);
      return new Response("ok", { status: 200 });
    };
    const confirmReceipt = (hash) => {
      if (hash === stuck) return new Promise(() => {});
      return { status: "success", transactionHash: hash };
    };
    try {
      const started = Date.now();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        confirmWaitMs: 40,
        scheduleDelay: () => {},
      });
      const elapsed = Date.now() - started;
      assert.equal(result.sent, 2);
      assert.ok(elapsed < 2_000);
      assert.deepEqual(posts.slice().sort(), [goodA, goodB].sort());
      const rows = (await readFile(file, "utf8"))
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const stillPending = rows.filter((row) => row.op === "enqueue" && row.txHash === stuck);
      assert.equal(stillPending.length, 1);
      assert.equal(rows.some((row) => row.op === "delivered" && row.txHash === stuck), false);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops a failed receipt without holding the other items", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-drop-"));
    const secret = runtimeSecret();
    const dropped = tx();
    const goodA = tx();
    const goodB = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, [dropped, goodA, goodB]);
    try {
      const started = Date.now();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => (hash === dropped ? { status: "reverted" } : { status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 2);
      assert.ok(Date.now() - started < 2_000);
      assert.deepEqual(posts.slice().sort(), [goodA, goodB].sort());
      const text = await readFile(file, "utf8");
      assert.equal(text.includes(dropped), false);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("posts the receipt hash when a replacement is mined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-replace-"));
    const secret = runtimeSecret();
    const originalHash = tx();
    const replacement = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const fetchImpl = async (_url, init) => {
      posts.push(JSON.parse(init.body).txHash);
      return new Response("ok", { status: 200 });
    };
    try {
      const result = await deliverPointsNotify({
        chainId: 84532,
        txHash: originalHash,
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt: async () => ({ status: "0x1", transactionHash: replacement }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 1);
      assert.deepEqual(posts, [replacement]);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, new RegExp(`"op":"delivered","txHash":"${replacement}"`));
      assert.match(text, /"error":"replaced"/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops a tx that stays missing and logs it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-missing-"));
    const secret = runtimeSecret();
    const hash = tx();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    let posts = 0;
    const fetchImpl = async () => {
      posts += 1;
      return new Response(JSON.stringify({ ok: false, error: "receipt_not_found" }), { status: 404 });
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = () => {};
    try {
      let dropped = false;
      await deliverPointsNotify({ chainId: 84532, txHash: hash, dataDir: dir, env, fetchImpl, scheduleDelay });
      for (let i = 0; i < 12 && !dropped; i += 1) {
        await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
        const text = await readFile(pointsOutboxPath(dir), "utf8");
        dropped = text.includes('"op":"dropped"');
      }
      assert.equal(dropped, true);
      assert.equal(posts, 8);
      assert.ok(logs.some((line) => line.startsWith("points_notify not_found ") && line.includes(hash)));
      const after = posts;
      await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay });
      assert.equal(posts, after);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("flushes an older pending item when a new rescue arrives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-flush-"));
    const secret = runtimeSecret();
    const older = tx();
    const newer = tx();
    const posts = [];
    let up = false;
    const fetchImpl = async (_url, init) => {
      posts.push(JSON.parse(init.body).txHash);
      if (!up) return new Response("down", { status: 503 });
      return new Response("ok", { status: 200 });
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      const first = await deliverPointsNotify({
        chainId: 84532,
        txHash: older,
        dataDir: dir,
        env,
        fetchImpl,
        scheduleDelay: () => {},
      });
      assert.equal(first.sent, 0);
      clearPointsRetryTimers();
      up = true;
      const second = await deliverPointsNotify({
        chainId: 84532,
        txHash: newer,
        dataDir: dir,
        env,
        fetchImpl,
        scheduleDelay: () => {},
      });
      assert.equal(second.sent, 2);
      assert.equal(posts.filter((hash) => hash === older).length, 2);
      assert.equal(posts.filter((hash) => hash === newer).length, 1);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("logs an invalid confirmation depth and keeps 2", () => {
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    try {
      const hash = tx();
      assert.equal(pointsMinConfirmations({}), 2);
      assert.equal(logs.length, 0);
      assert.equal(pointsMinConfirmations({ POINTS_MIN_CONFIRMATIONS: "0" }, hash), 2);
      assert.equal(pointsMinConfirmations({ POINTS_MIN_CONFIRMATIONS: "nope" }, hash), 2);
      assert.equal(pointsMinConfirmations({ POINTS_MIN_CONFIRMATIONS: "129" }, hash), 2);
      assert.equal(pointsMinConfirmations({ POINTS_MIN_CONFIRMATIONS: "4" }, hash), 4);
      const lines = logs.filter((line) => line.includes("points_notify confirmations"));
      assert.equal(lines.length, 3);
      assert.ok(lines.every((line) => line.includes(hash)));
    } finally {
      console.error = original;
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
    const confirmReceipt = () => {
      if (mode === "pending") return new Promise(() => {});
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
        confirmWaitMs: 20,
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

  it("credits a new rescue while four receipts are stuck", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-n2-"));
    const secret = runtimeSecret();
    const stuck = [tx(), tx(), tx(), tx()];
    const fresh = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const confirmReceipt = (hash) => {
      if (stuck.includes(hash)) return new Promise(() => {});
      return { status: "success", transactionHash: hash };
    };
    const base = {
      chainId: 84532,
      dataDir: dir,
      env,
      fetchImpl: async (_url, init) => {
        posts.push(JSON.parse(init.body).txHash);
        return new Response("ok", { status: 200 });
      },
      confirmReceipt,
      confirmWaitMs: 4_000,
      scheduleDelay: () => {},
    };
    const waiting = [];
    try {
      for (const hash of stuck) waiting.push(deliverPointsNotify({ ...base, txHash: hash }));
      const started = Date.now();
      const result = await deliverPointsNotify({ ...base, txHash: fresh });
      const elapsed = Date.now() - started;
      console.log("n2_credit_ms", elapsed);
      assert.equal(result.sent, 1, `n2_credit_ms ${elapsed}`);
      assert.ok(elapsed < 2_000, `n2_credit_ms ${elapsed}`);
      assert.deepEqual(posts, [fresh]);
    } finally {
      clearPointsRetryTimers();
      await Promise.allSettled(waiting);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finishes two stuck receipts in one wait", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-one-wait-"));
    const secret = runtimeSecret();
    const hashes = [tx(), tx()];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, hashes);
    const waitMs = 250;
    try {
      const started = Date.now();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: () => new Promise(() => {}),
        confirmWaitMs: waitMs,
        scheduleDelay: () => {},
      });
      const elapsed = Date.now() - started;
      assert.equal(result.sent, 0);
      assert.ok(elapsed < waitMs * 1.8, `elapsed ${elapsed}`);
      assert.ok(elapsed >= waitMs);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a speed-up across a restart and credits the new hash once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-speed-"));
    const secret = runtimeSecret();
    const originalHash = tx();
    const replacement = tx();
    const posts = [];
    const seen = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, [originalHash]);
    try {
      await notePointsReplacement({
        chainId: 84532,
        txHash: originalHash,
        replacedBy: replacement,
        dataDir: dir,
      });
      const linked = await readFile(file, "utf8");
      assert.match(linked, /"op":"replace"/);
      assert.match(linked, new RegExp(replacement));
      clearPointsRetryTimers();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => {
          seen.push(hash);
          return { status: "success", transactionHash: hash };
        },
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 1);
      assert.deepEqual(seen, [replacement]);
      assert.deepEqual(posts, [replacement]);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a cancel across a restart and posts nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-cancel-"));
    const secret = runtimeSecret();
    const hash = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, [hash]);
    try {
      await notePointsCancel({ chainId: 84532, txHash: hash, dataDir: dir });
      clearPointsRetryTimers();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (seen) => ({ status: "success", transactionHash: seen }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 0);
      assert.deepEqual(posts, []);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives up on a tx that never mines and logs the hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-unmined-"));
    const secret = runtimeSecret();
    const hash = tx();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    let confirms = 0;
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const confirmReceipt = () => {
      confirms += 1;
      return new Promise(() => {});
    };
    try {
      await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt,
        confirmWaitMs: 5,
        scheduleDelay: () => {},
      });
      let gaveUp = false;
      for (let i = 0; i < 40 && !gaveUp; i += 1) {
        await retryPointsOutbox({
          dataDir: dir,
          env,
          fetchImpl: async () => new Response("ok", { status: 200 }),
          confirmReceipt,
          confirmWaitMs: 5,
          scheduleDelay: () => {},
        });
        gaveUp = logs.some((line) => line.includes("points_notify not_mined") && line.includes(hash));
      }
      assert.equal(gaveUp, true);
      assert.equal(confirms, 24);
      assert.ok(logs.some((line) => line.includes("points_notify not_mined") && line.includes(hash)));
      const after = confirms;
      const again = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt,
        confirmWaitMs: 5,
        scheduleDelay: () => {},
      });
      assert.equal(again.sent, 0);
      assert.equal(confirms, after);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps an unreachable URL pending and alerts with the hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-alert-"));
    const secret = runtimeSecret();
    const hash = tx();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl: async () => {
          throw new Error("offline");
        },
        scheduleDelay: () => {},
      });
      for (let i = 0; i < 30; i += 1) {
        await retryPointsOutbox({
          dataDir: dir,
          env,
          fetchImpl: async () => new Response("<html>missing</html>", { status: 404 }),
          scheduleDelay: () => {},
        });
      }
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(text.includes('"op":"dropped"'), false);
      assert.match(text, /"op":"enqueue"/);
      assert.ok(logs.some((line) => line.includes("points_notify alert") && line.includes(hash)));
      assert.equal(logs.some((line) => line.includes("not_mined")), false);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retries 425, 408, and 429, then delivers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-http-"));
    const secret = runtimeSecret();
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      for (const status of [425, 408, 429]) {
        const hash = tx();
        let code = status;
        const fetchImpl = async () => new Response("later", { status: code });
        const first = await deliverPointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl,
          scheduleDelay: () => {},
        });
        assert.equal(first.sent, 0);
        const midway = await readFile(pointsOutboxPath(dir), "utf8");
        assert.match(midway, new RegExp(`http_${status}`));
        const parked = midway
          .split("\n")
          .filter((line) => line.includes(hash))
          .map((line) => JSON.parse(line));
        assert.equal(parked.some((row) => row.op === "dropped"), false);
        code = 200;
        const second = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
        assert.equal(second.sent, 1);
      }
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caps how many restart items confirm at once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-parallel-"));
    const secret = runtimeSecret();
    const hashes = Array.from({ length: 6 }, () => tx());
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, hashes);
    let active = 0;
    let peak = 0;
    try {
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: async (hash) => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 40));
          active -= 1;
          return { status: "success", transactionHash: hash };
        },
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 6);
      assert.equal(peak, 4);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a same-tick replacement across a restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-same-tick-"));
    const secret = runtimeSecret();
    const original = tx();
    const replacement = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      const queued = schedulePointsNotify({
        chainId: 84532,
        txHash: original,
        dataDir: dir,
        env,
        fetchImpl: () => new Promise(() => {}),
        fetchTimeoutMs: 0,
      });
      const linked = notePointsReceiptReplacement(
        { chainId: 84532, txHash: original, dataDir: dir },
        { reason: "replaced", transaction: { hash: replacement } },
      );
      await Promise.all([queued.durable, linked]);
      clearPointsRetryTimers();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 1);
      assert.deepEqual(posts, [replacement]);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies a replacement written before the enqueue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-link-first-"));
    const secret = runtimeSecret();
    const original = tx();
    const replacement = tx();
    const posts = [];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      await notePointsReplacement({
        chainId: 84532,
        txHash: original,
        replacedBy: replacement,
        dataDir: dir,
      });
      const result = await deliverPointsNotify({
        chainId: 84532,
        txHash: original,
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 1);
      assert.deepEqual(posts, [replacement]);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a new rescue while posts are hanging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-lock-"));
    const secret = runtimeSecret();
    const hashes = [tx(), tx(), tx()];
    const fresh = tx();
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    let started = 0;
    try {
      const hanging = hashes.map((hash) =>
        schedulePointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl: () => {
            started += 1;
            return new Promise(() => {});
          },
          fetchTimeoutMs: 0,
        }),
      );
      await Promise.all(hanging.map((job) => job.durable));
      const deadline = Date.now() + 1_000;
      while (started < 3 && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(started, 3);
      const marked = Date.now();
      const queued = schedulePointsNotify({
        chainId: 84532,
        txHash: fresh,
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        scheduleDelay: () => {},
      });
      await queued.durable;
      assert.ok(Date.now() - marked < 1_000);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, new RegExp(fresh));
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps ten rescues that stop after they are queued", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-stop-"));
    const secret = runtimeSecret();
    const hashes = Array.from({ length: 10 }, () => tx());
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const posts = [];
    const releases = [];
    try {
      const jobs = hashes.map((hash) => {
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        releases.push(release);
        return deliverPointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl: () => gate,
          fetchTimeoutMs: 0,
        });
      });
      const deadline = Date.now() + 1_000;
      let text = "";
      while (Date.now() < deadline) {
        try {
          text = await readFile(pointsOutboxPath(dir), "utf8");
        } catch {
          text = "";
        }
        if (hashes.every((hash) => text.includes(hash))) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
      for (const hash of hashes) assert.match(text, new RegExp(hash));
      for (const release of releases) release(new Response("down", { status: 503 }));
      await Promise.all(jobs);
      clearPointsRetryTimers();
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 10);
      assert.equal(new Set(posts).size, 10);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("credits after a long outage and one receipt timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-outage-"));
    const secret = runtimeSecret();
    const hash = tx();
    const delays = [];
    const queued = [];
    let mode = "outage";
    let posts = 0;
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const scheduleDelay = (fn, ms) => {
      delays.push(ms);
      queued.push(fn);
    };
    const fetchImpl = async () => {
      if (mode !== "up") throw new Error("connection refused");
      posts += 1;
      return new Response("ok", { status: 200 });
    };
    const confirmReceipt = () => {
      if (mode === "timeout") return new Promise(() => {});
      return { status: "success", transactionHash: hash };
    };
    const base = {
      chainId: 84532,
      txHash: hash,
      dataDir: dir,
      env,
      fetchImpl,
      confirmReceipt,
      scheduleDelay,
      jitter: () => 0,
    };
    try {
      await deliverPointsNotify(base);
      let guard = 0;
      while (delays.reduce((sum, ms) => sum + ms, 0) < 14 * 60 * 1000 && guard < 80) {
        guard += 1;
        const batch = queued.splice(0, queued.length);
        assert.ok(batch.length > 0);
        for (const fn of batch) await fn();
      }
      assert.ok(delays.reduce((sum, ms) => sum + ms, 0) >= 14 * 60 * 1000);
      assert.ok(guard > 24);
      clearPointsRetryTimers();
      const parked = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(parked.includes('"op":"dropped"'), false);
      mode = "timeout";
      await retryPointsOutbox({ ...base, confirmWaitMs: 15 });
      const mid = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(mid.includes('"op":"dropped"'), false);
      mode = "up";
      const result = await retryPointsOutbox(base);
      assert.equal(result.sent, 1);
      assert.equal(posts, 1);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not treat an rpc failure as a missing receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-rpc-"));
    const secret = runtimeSecret();
    const hash = tx();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    let mode = "rpc";
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const confirmReceipt = () => {
      if (mode === "rpc") throw new Error("connection refused");
      if (mode === "timeout") return new Promise(() => {});
      return { status: "success", transactionHash: hash };
    };
    const fetchImpl = async () => new Response("ok", { status: 200 });
    try {
      await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        scheduleDelay: () => {},
      });
      for (let i = 0; i < 30; i += 1) {
        await retryPointsOutbox({
          dataDir: dir,
          env,
          fetchImpl,
          confirmReceipt,
          scheduleDelay: () => {},
        });
      }
      const parked = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(parked.includes('"op":"dropped"'), false);
      assert.equal(parked.includes("receipt_not_found"), false);
      assert.equal(logs.some((line) => line.includes("not_mined")), false);
      mode = "timeout";
      await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        confirmWaitMs: 15,
        scheduleDelay: () => {},
      });
      const mid = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(mid.includes('"op":"dropped"'), false);
      mode = "up";
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl,
        confirmReceipt,
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 1);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a config 400 and a 403 pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-config-"));
    const secret = runtimeSecret();
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    try {
      const samples = [
        { status: 400, body: JSON.stringify({ ok: false, error: "token_not_allowed" }) },
        { status: 403, body: "no" },
      ];
      for (const sample of samples) {
        const hash = tx();
        let open = true;
        const fetchImpl = async () => new Response(open ? sample.body : "ok", { status: open ? sample.status : 200 });
        await deliverPointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl,
          scheduleDelay: () => {},
        });
        for (let i = 0; i < 30; i += 1) {
          await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
        }
        const parked = await readFile(pointsOutboxPath(dir), "utf8");
        const rows = parked
          .split("\n")
          .filter((line) => line.includes(hash))
          .map((line) => JSON.parse(line));
        assert.equal(rows.some((row) => row.op === "dropped"), false);
        assert.ok(logs.some((line) => line.includes("points_notify alert") && line.includes(hash)));
        open = false;
        const result = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
        assert.equal(result.sent, 1);
      }
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops an explicit rejection and keeps the record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-reject-"));
    const secret = runtimeSecret();
    const hash = tx();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      const result = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        dataDir: dir,
        env,
        fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "status_failed" }), { status: 400 }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 0);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, /"op":"dropped"/);
      assert.match(text, /status_failed/);
      assert.ok(logs.some((line) => line.includes("points_notify dropped") && line.includes(hash)));
      const again = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        scheduleDelay: () => {},
      });
      assert.equal(again.sent, 0);
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("logs retries with the status and attempt number", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-retry-log-"));
    const secret = runtimeSecret();
    const logs = [];
    const original = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
    };
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    try {
      for (const status of [401, 429, 503]) {
        const hash = tx();
        await deliverPointsNotify({
          chainId: 84532,
          txHash: hash,
          dataDir: dir,
          env,
          fetchImpl: async () => new Response("later", { status }),
          scheduleDelay: () => {},
        });
        assert.ok(logs.some((line) => line.startsWith(`points_notify retry ${status} 1 `) && line.includes(hash)));
      }
    } finally {
      console.error = original;
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts the next item while one receipt is still waiting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-slot-"));
    const secret = runtimeSecret();
    const hashes = [tx(), tx(), tx(), tx(), tx()];
    const slow = hashes[0];
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, hashes);
    const seen = new Map();
    const waitMs = 250;
    const started = Date.now();
    try {
      const result = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: (hash) => {
          seen.set(hash, Date.now() - started);
          if (hash === slow) return new Promise(() => {});
          return { status: "success", transactionHash: hash };
        },
        confirmWaitMs: waitMs,
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 4);
      assert.ok(seen.get(hashes[4]) < waitMs);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes a leftover temp file before the next pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-tmp-"));
    const secret = runtimeSecret();
    const hash = tx();
    const env = { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
    const file = pointsOutboxPath(dir);
    await mkdirPending(dir, file, [hash]);
    const { writeFile } = await import("node:fs/promises");
    const leftover = `${file}.9.tmp`;
    await writeFile(leftover, "partial", { mode: 0o600 });
    try {
      await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        scheduleDelay: () => {},
      });
      const names = await readdir(dir);
      assert.equal(names.some((name) => name.endsWith(".tmp")), false);
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

async function mkdirPending(dir, file, hashes) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const lines = hashes.map((hash) =>
    JSON.stringify({ op: "enqueue", chainId: 84532, txHash: hash, at: "2026-10-19T00:00:00.000Z", attempts: 0 }),
  );
  await writeFile(file, `${lines.join("\n")}\n`, { mode: 0o600 });
}

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
