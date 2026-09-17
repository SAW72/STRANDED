import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRelayerApp } from "../app.mjs";
import { createKillSwitch } from "../killSwitch.mjs";

async function withServer(deps, fn) {
  const killSwitch = deps.killSwitch || createKillSwitch();
  let quoteCalls = 0;
  let rescueCalls = 0;
  const server = createRelayerApp({
    killSwitch,
    liveStatus: async () => ({ ok: true, live: true, chainId: 421614, stubRpc: false }),
    buildQuote: async () => {
      quoteCalls += 1;
      return { quoteId: "q-live", nonce: "1" };
    },
    submitRescue: async () => {
      rescueCalls += 1;
      return { ok: true, txHash: `0x${"ab".repeat(32)}` };
    },
    allowedOrigins: ["http://localhost:5173"],
    ...deps,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await fn({
      port,
      killSwitch,
      quoteCalls: () => quoteCalls,
      rescueCalls: () => rescueCalls,
      url: `http://127.0.0.1:${port}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function req(url, path, init = {}) {
  const res = await fetch(`${url}${path}`, init);
  const body = await res.json();
  return { status: res.status, body };
}

describe("relayer HTTP kill switch", () => {
  it("refuses quotes and rescues when paused; health stays 200 with paused=true", async () => {
    await withServer({ killSwitch: createKillSwitch({ initial: true }) }, async ({ url, quoteCalls, rescueCalls }) => {
      const health = await req(url, "/health");
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.paused, true);
      assert.equal(health.body.chainId, 421614);

      const quote = await req(url, "/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "0x1", tokenIn: "0x2", amountIn: "1" }),
      });
      assert.equal(quote.status, 503);
      assert.equal(quote.body.error, "relayer_paused");
      assert.equal(quoteCalls(), 0);

      const rescue = await req(url, "/v1/rescues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: { user: "0x1", nonce: "1" } }),
      });
      assert.equal(rescue.status, 503);
      assert.equal(rescue.body.error, "relayer_paused");
      assert.equal(rescueCalls(), 0);
    });
  });

  it("admin pause/unpause requires the secret and does not exist without one", async () => {
    await withServer({ adminSecret: "" }, async ({ url }) => {
      const missing = await req(url, "/v1/admin/pause", { method: "POST" });
      assert.equal(missing.status, 404);
    });

    await withServer({ adminSecret: "s3cret", killSwitch: createKillSwitch({ initial: false }) }, async ({ url }) => {
      const wrong = await req(url, "/v1/admin/pause", {
        method: "POST",
        headers: { "x-admin-secret": "nope" },
      });
      assert.equal(wrong.status, 401);

      const pause = await req(url, "/v1/admin/pause", {
        method: "POST",
        headers: { "x-admin-secret": "s3cret" },
      });
      assert.equal(pause.status, 200);
      assert.equal(pause.body.paused, true);

      const health = await req(url, "/v1/health");
      assert.equal(health.body.paused, true);

      const unpause = await req(url, "/v1/admin/unpause", {
        method: "POST",
        headers: { authorization: "Bearer s3cret" },
      });
      assert.equal(unpause.status, 200);
      assert.equal(unpause.body.paused, false);
    });
  });
});
