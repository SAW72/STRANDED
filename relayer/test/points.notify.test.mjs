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
    try {
      const first = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash.toUpperCase(),
        dataDir: dir,
        env,
        fetchImpl,
      });
      assert.equal(first.sent, 0);
      const midway = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(midway, /"op":"enqueue"/);
      assert.match(midway, /"op":"attempt"/);
      assert.equal(midway.includes(secret), false);

      fail = false;
      const second = await retryPointsOutbox({ dataDir: dir, env, fetchImpl });
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
    assert.ok(broadcast !== -1 && consumed > broadcast && logged > consumed && notify > logged);
    assert.equal(src.slice(broadcast, consumed).includes("schedulePointsNotify"), false);
    assert.equal(src.slice(broadcast, consumed).includes("pointsOutbox"), false);
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
