import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fail } from "../httpError.mjs";
import { createBuildQuote } from "../quote.mjs";
import { createRescueLimiter, parseRescueLimitConfig } from "../rescueLimit.mjs";
import { req, withServer } from "./harness.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const USER2 = "0x2222222222222222222222222222222222222222";
const USER3 = "0x3333333333333333333333333333333333333333";
const USER4 = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x5649fF51123D534044aA7E6cBc8762698Ffed713";
const EOA = "0x9999999999999999999999999999999999999999";
const ORIGIN = "http://localhost:5173";

function quoteBody(extra = {}) {
  return JSON.stringify({ user: USER, tokenIn: TOKEN, amountIn: "1000000000000000000", ...extra });
}

function rescueBody(user = USER) {
  return JSON.stringify({ order: { user } });
}

function post(url, path, { body = quoteBody(), headers = {}, origin = ORIGIN } = {}) {
  return req(url, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body,
  });
}

async function limitedServer(opts, fn) {
  const limiter = createRescueLimiter({
    config: opts.config || parseRescueLimitConfig(opts.env || {}),
    now: opts.now,
    log: () => {},
  });
  await limiter.ready;
  return withServer(
    {
      rescueLimiter: limiter,
      trustedProxyHops: opts.trustedProxyHops ?? 1,
      chainId: 421614,
      buildQuote: opts.buildQuote,
      submitRescue: opts.submitRescue,
      killSwitch: opts.killSwitch,
    },
    fn,
  );
}

describe("rescue limits over HTTP", () => {
  it("returns 429 on the second rescue in the window, then allows it after the window", async () => {
    let t = 1_700_000_000_000;
    await limitedServer(
      {
        config: { perWallet: 1, perIp: 5, windowMs: 4 * 60 * 60 * 1000 },
        now: () => t,
      },
      async ({ url, quoteCalls, rescueCalls }) => {
        const health = await req(url, "/health");
        assert.equal(health.status, 200);
        assert.equal(health.body.paused, false);
        assert.deepEqual(health.body.rescueLimits, {
          perWallet: 1,
          perIp: 5,
          windowMs: 4 * 60 * 60 * 1000,
          walletEnabled: true,
          ipEnabled: true,
          trustedProxyHops: 1,
        });
        assert.equal(JSON.stringify(health.body).includes(USER), false);

        const quote = await post(url, "/v1/quotes");
        assert.equal(quote.status, 200);
        assert.equal(quoteCalls(), 1);

        const first = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(first.status, 200);
        assert.equal(first.body.ok, true);
        assert.equal(rescueCalls(), 1);

        const againQuote = await post(url, "/v1/quotes");
        assert.equal(againQuote.status, 429);
        assert.equal(againQuote.body.ok, false);
        assert.equal(againQuote.body.error, "rate_limited_wallet");
        assert.match(againQuote.body.message, /already got a rescue/);
        assert.match(againQuote.body.message, new RegExp(againQuote.body.retryAt));
        assert.equal(againQuote.body.retryAfter, 4 * 60 * 60);
        assert.equal(againQuote.headers.get("retry-after"), String(againQuote.body.retryAfter));
        assert.equal(againQuote.headers.get("access-control-allow-origin"), ORIGIN);
        assert.equal(againQuote.headers.get("content-type").includes("application/json"), true);
        assert.equal(quoteCalls(), 1);

        const againRescue = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(againRescue.status, 429);
        assert.equal(againRescue.body.error, "rate_limited_wallet");
        assert.equal(againRescue.headers.get("retry-after"), String(againRescue.body.retryAfter));
        assert.equal(rescueCalls(), 1);

        const badOrigin = await post(url, "/v1/rescues", {
          body: rescueBody(),
          origin: "https://evil.example",
        });
        assert.equal(badOrigin.status, 429);
        assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

        t += 4 * 60 * 60 * 1000 + 1;
        const later = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(later.status, 200);
        assert.equal(rescueCalls(), 2);
      },
    );
  });

  it("enforces the IP backstop and the Render forwarding hop", async () => {
    await limitedServer(
      { config: { perWallet: 10, perIp: 1, windowMs: 60_000 }, trustedProxyHops: 1 },
      async ({ url, rescueCalls }) => {
        const a = await post(url, "/v1/rescues", {
          body: rescueBody(USER),
          headers: { "x-forwarded-for": "203.0.113.50, 104.22.17.40" },
        });
        assert.equal(a.status, 200);

        const spoofSameClient = await post(url, "/v1/rescues", {
          body: rescueBody(USER2),
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.50, 104.22.17.40" },
        });
        assert.equal(spoofSameClient.status, 429);
        assert.equal(spoofSameClient.body.error, "rate_limited_ip");
        assert.match(spoofSameClient.body.message, /this network/);
        assert.ok(spoofSameClient.body.retryAfter >= 1);
        assert.equal(spoofSameClient.headers.get("retry-after"), String(spoofSameClient.body.retryAfter));
        assert.equal(rescueCalls(), 1);

        const cloudflareAddressAlone = await post(url, "/v1/rescues", {
          body: rescueBody(USER3),
          headers: { "x-forwarded-for": "104.22.17.40" },
        });
        assert.equal(cloudflareAddressAlone.status, 200);

        const cf = await post(url, "/v1/rescues", {
          body: rescueBody(USER4),
          headers: {
            "cf-connecting-ip": "198.51.100.7",
            "x-forwarded-for": "8.8.8.8, 9.9.9.9",
          },
        });
        assert.equal(cf.status, 200);

        const cfAgain = await post(url, "/v1/rescues", {
          body: rescueBody("0x5555555555555555555555555555555555555555"),
          headers: {
            "cf-connecting-ip": "198.51.100.7",
            "x-forwarded-for": "203.0.113.1",
          },
        });
        assert.equal(cfAgain.status, 429);
        assert.equal(cfAgain.body.error, "rate_limited_ip");
      },
    );
  });

  it("applies env overrides and disables", async () => {
    const overridden = parseRescueLimitConfig({
      RESCUE_LIMIT_PER_WALLET: "2",
      RESCUE_LIMIT_PER_IP: "10",
      RESCUE_LIMIT_WINDOW_HOURS: "1",
    });
    await limitedServer({ config: overridden }, async ({ url }) => {
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody() })).status, 200);
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody() })).status, 200);
      const third = await post(url, "/v1/rescues", { body: rescueBody() });
      assert.equal(third.status, 429);
      assert.equal(third.body.error, "rate_limited_wallet");
      assert.match(third.body.message, /used its 2 rescues/);
    });

    const disabled = parseRescueLimitConfig({
      RESCUE_LIMIT_PER_WALLET: "0",
      RESCUE_LIMIT_PER_IP: "off",
    });
    await limitedServer({ config: disabled }, async ({ url }) => {
      const health = await req(url, "/health");
      assert.equal(health.body.rescueLimits.walletEnabled, false);
      assert.equal(health.body.rescueLimits.ipEnabled, false);
      assert.equal(health.body.rescueLimits.perWallet, null);
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody() })).status, 200);
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody() })).status, 200);
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody(USER2) })).status, 200);
    });
  });

  it("does not count a failed rescue, and the kill switch still wins", async () => {
    let n = 0;
    await limitedServer(
      {
        config: { perWallet: 1, perIp: 5, windowMs: 60_000 },
        submitRescue: async () => {
          n += 1;
          if (n === 1) {
            throw fail(502, "simulation_failed", "simulation failed", { revert: "SwapFailed" });
          }
          return { ok: true, txHash: `0x${"cd".repeat(32)}` };
        },
      },
      async ({ url, rescueCalls, killSwitch }) => {
        const failed = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(failed.status, 502);
        assert.equal(failed.body.error, "simulation_failed");
        assert.equal(failed.body.revert, "SwapFailed");
        assert.equal(failed.text.includes("stack"), false);

        const second = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(second.status, 200);
        assert.equal(rescueCalls(), 2);

        const third = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(third.status, 429);

        killSwitch.pause();
        const paused = await post(url, "/v1/rescues", { body: rescueBody() });
        assert.equal(paused.status, 503);
        assert.equal(paused.body.error, "relayer_paused");
        assert.equal(paused.headers.get("access-control-allow-origin"), ORIGIN);
        assert.equal(rescueCalls(), 2);
      },
    );
  });

  it("holds the slot while a rescue is in flight and releases it on failure", async () => {
    let release;
    let calls = 0;
    await limitedServer(
      {
        config: { perWallet: 1, perIp: 5, windowMs: 60_000 },
        submitRescue: () => {
          calls += 1;
          if (calls > 1) return { ok: true, txHash: `0x${"ab".repeat(32)}` };
          return new Promise((resolve, reject) => {
            release = { resolve, reject };
          });
        },
      },
      async ({ url, rescueCalls }) => {
        const pending = post(url, "/v1/rescues", { body: rescueBody() });
        try {
          for (let i = 0; i < 50 && rescueCalls() < 1; i += 1) {
            await new Promise((r) => setTimeout(r, 10));
          }
          assert.equal(rescueCalls(), 1);
          const queued = await post(url, "/v1/quotes");
          assert.equal(queued.status, 429);
          assert.equal(queued.body.error, "rate_limited_wallet");
          assert.match(queued.body.message, /already in progress/);
          release.reject(fail(502, "simulation_failed", "simulation failed", { revert: "SwapFailed" }));
          const settled = await pending;
          assert.equal(settled.status, 502);
          const after = await post(url, "/v1/rescues", { body: rescueBody() });
          assert.equal(after.status, 200);
        } finally {
          release?.reject?.(fail(502, "simulation_failed", "simulation failed"));
        }
      },
    );
  });
});

describe("readable quote and rescue errors", () => {
  it("returns 400 for bad JSON, addresses, amounts, a missing user, and the wrong chain", async () => {
    await withServer({}, async ({ url, quoteCalls, rescueCalls }) => {
      const cases = [
        ["/v1/quotes", "", 400, "invalid_json"],
        ["/v1/quotes", "   ", 400, "invalid_json"],
        ["/v1/quotes", "{", 400, "invalid_json"],
        ["/v1/quotes", "null", 400, "invalid_json"],
        ["/v1/quotes", "[]", 400, "invalid_json"],
        ["/v1/rescues", "", 400, "invalid_json"],
        ["/v1/rescues", "{", 400, "invalid_json"],
        ["/v1/quotes", JSON.stringify({}), 400, "missing_user"],
        ["/v1/quotes", JSON.stringify({ user: "", amountIn: "1" }), 400, "missing_user"],
        ["/v1/rescues", JSON.stringify({}), 400, "missing_user"],
        ["/v1/rescues", JSON.stringify({ order: {} }), 400, "missing_user"],
        ["/v1/quotes", JSON.stringify({ user: "0x1234", amountIn: "1" }), 400, "invalid_address"],
        ["/v1/quotes", JSON.stringify({ user: USER, tokenIn: "not-an-address", amountIn: "1" }), 400, "invalid_address"],
        ["/v1/rescues", JSON.stringify({ order: { user: "0xzz" } }), 400, "invalid_address"],
        ["/v1/quotes", JSON.stringify({ user: USER, amountIn: "abc" }), 400, "invalid_amount"],
        ["/v1/quotes", JSON.stringify({ user: USER, amountIn: "-5" }), 400, "invalid_amount"],
        ["/v1/quotes", JSON.stringify({ user: USER, amountIn: "0" }), 400, "invalid_amount"],
        ["/v1/quotes", JSON.stringify({ user: USER }), 400, "invalid_amount"],
        ["/v1/quotes", JSON.stringify({ user: USER, amountIn: "1", chainId: 1 }), 400, "wrong_chain"],
        ["/v1/quotes", JSON.stringify({ user: USER, amountIn: "1", chainId: 84532 }), 400, "wrong_chain"],
      ];
      for (const [path, body, status, code] of cases) {
        const res = await post(url, path, { body });
        assert.equal(res.status, status, `${path} ${body}`);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.error, code, `${path} ${body}`);
        assert.equal(typeof res.body.message, "string");
        assert.equal(res.text.includes("SECRET"), false);
        assert.equal(res.text.toLowerCase().includes("stack"), false);
        assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
        if (code === "wrong_chain") assert.equal(res.body.message, "this Relayer is Arb Sepolia only");
        if (code === "invalid_address" && String(body).includes("tokenIn")) {
          assert.match(res.body.message, /tokenIn/);
        }
        if (code === "invalid_address" && String(body).includes("0x1234")) {
          assert.match(res.body.message, /user/);
        }
      }
      assert.equal(quoteCalls(), 0);
      assert.equal(rescueCalls(), 0);
    });
  });

  it("prefers a readable 400 over a 429 when the body is invalid", async () => {
    let t = 1_000;
    await limitedServer({ config: { perWallet: 1, perIp: 1, windowMs: 60_000 }, now: () => t }, async ({ url }) => {
      assert.equal((await post(url, "/v1/rescues", { body: rescueBody() })).status, 200);
      const bad = await post(url, "/v1/quotes", { body: "{" });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error, "invalid_json");
      const chain = await post(url, "/v1/quotes", {
        body: JSON.stringify({ user: USER, amountIn: "1", chainId: 1 }),
      });
      assert.equal(chain.status, 400);
      assert.equal(chain.body.error, "wrong_chain");
    });
  });

  it("maps EOA, amount_too_small, insolvency, and upstream failures through HTTP", async () => {
    function rpc(overrides) {
      return {
        getCode: overrides.getCode || (async () => "0x1234"),
        getBalance: overrides.getBalance || (async () => 10n ** 18n),
        readContract: overrides.readContract,
      };
    }
    const build = (publicClient) =>
      createBuildQuote({
        publicClient,
        nonceStore: { reserve: async () => 1n },
        rescueLog: { append: async () => {} },
        tokenAddress: TOKEN,
        feeTo: USER2,
        router: USER3,
        swap: USER4,
        relayerAddress: USER,
        chainId: 421614,
        log: () => {},
      });

    await withServer(
      {
        buildQuote: build(
          rpc({
            getCode: async () => "0x",
            readContract: async () => {
              throw new Error("should not read");
            },
          }),
        ),
      },
      async ({ url }) => {
        const res = await post(url, "/v1/quotes", {
          body: JSON.stringify({ user: USER, tokenIn: EOA, amountIn: "1" }),
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "token_not_contract");
        assert.match(res.body.message, /no contract code/);
      },
    );

    await withServer(
      {
        buildQuote: build(
          rpc({
            readContract: async ({ functionName }) => {
              if (functionName === "balanceOf") return 10n ** 18n;
              if (functionName === "symbol") return "GRTT";
              if (functionName === "decimals") return 18;
              if (functionName === "quote") return 0n;
              throw new Error(`unexpected ${functionName}`);
            },
          }),
        ),
      },
      async ({ url }) => {
        const res = await post(url, "/v1/quotes");
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "amount_too_small");
        assert.match(res.body.message, /too small/);
      },
    );

    await withServer(
      {
        buildQuote: build(
          rpc({
            getBalance: async () => 1n,
            readContract: async ({ functionName }) => {
              if (functionName === "balanceOf") return 10n ** 18n;
              if (functionName === "symbol") return "GRTT";
              if (functionName === "decimals") return 18;
              if (functionName === "quote") return 1000n;
              throw new Error(functionName);
            },
          }),
        ),
      },
      async ({ url }) => {
        const res = await post(url, "/v1/quotes");
        assert.equal(res.status, 502);
        assert.equal(res.body.error, "quote_unavailable");
        assert.match(res.body.message, /not have enough native gas/);
      },
    );

    await withServer(
      {
        buildQuote: build(
          rpc({
            getCode: async () => {
              throw new Error("https://rpc.example/SECRETKEY connection reset");
            },
          }),
        ),
      },
      async ({ url }) => {
        const res = await post(url, "/v1/quotes");
        assert.equal(res.status, 502);
        assert.equal(res.body.error, "upstream_unavailable");
        assert.equal(res.text.includes("SECRETKEY"), false);
        assert.equal(res.text.includes("https://"), false);
        assert.equal(res.text.toLowerCase().includes("stack"), false);
      },
    );

    await withServer(
      {
        buildQuote: async () => {
          const err = new Error("https://rpc.example/SECRETKEY\n    at secret");
          err.stack = "Error: secret\n    at boom";
          throw err;
        },
      },
      async ({ url }) => {
        const res = await post(url, "/v1/quotes", { body: quoteBody() });
        assert.equal(res.status, 500);
        assert.deepEqual(res.body, { ok: false, error: "request_failed" });
        assert.equal(res.text.includes("SECRETKEY"), false);
        assert.equal(res.text.includes("at boom"), false);
      },
    );
  });
});
