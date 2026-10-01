import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AMOUNT_TOO_SMALL_MESSAGE, ARB_SEPOLIA_ONLY, UPSTREAM_MESSAGE } from "../httpError.mjs";
import { createBuildQuote } from "../quote.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x5649fF51123D534044aA7E6cBc8762698Ffed713";
const EOA = "0x9999999999999999999999999999999999999999";
const ROUTER = "0x3333333333333333333333333333333333333333";
const FEE = "0x4444444444444444444444444444444444444444";
const SWAP = "0x5555555555555555555555555555555555555555";
const RELAYER = "0x6666666666666666666666666666666666666666";

function builder(client, extra = {}) {
  const calls = [];
  let reserved = 0;
  const buildQuote = createBuildQuote({
    publicClient: client,
    nonceStore: {
      reserve: async (user) => {
        reserved += 1;
        calls.push(["reserve", user]);
        return 7n;
      },
    },
    rescueLog: { append: async () => {} },
    tokenAddress: TOKEN,
    feeTo: FEE,
    router: ROUTER,
    swap: SWAP,
    relayerAddress: RELAYER,
    chainId: 421614,
    log: () => {},
    ...extra,
  });
  return { buildQuote, calls, reserved: () => reserved };
}

function client(overrides = {}) {
  const seen = [];
  return {
    seen,
    getCode: overrides.getCode || (async () => "0x1234"),
    getBalance: overrides.getBalance || (async () => 10n ** 18n),
    readContract: async (args) => {
      seen.push(args.functionName);
      if (overrides.readContract) return overrides.readContract(args, seen);
      if (args.functionName === "balanceOf") return 10n ** 18n;
      if (args.functionName === "symbol") return "GRTT";
      if (args.functionName === "decimals") return 18;
      if (args.functionName === "quote") return 10n ** 14n;
      if (args.functionName === "payAmount") throw new Error("payAmount should not run");
      throw new Error(`unexpected ${args.functionName}`);
    },
  };
}

const oneToken = { user: USER, tokenIn: TOKEN, amountIn: "1000000000000000000" };

describe("quote builder", () => {
  it("keeps the locked-router payout math", async () => {
    const rpc = client();
    const { buildQuote, reserved } = builder(rpc);
    const quote = await buildQuote(oneToken);
    assert.equal(quote.chainId, 421614);
    assert.equal(quote.tokenIn, TOKEN);
    assert.equal(quote.amountIn, "1000000000000000000");
    assert.equal(quote.amountSwap, "200000000000000000");
    assert.equal(quote.feeAmount, "10000000000000000");
    assert.equal(quote.amountRemainder, "790000000000000000");
    assert.equal(quote.amountOut, "100000000000000");
    assert.equal(quote.minAmountOut, "99000000000000");
    assert.equal(quote.slippageBps, 100);
    assert.equal(quote.quoteSource, "locked-demo-router");
    assert.equal(quote.nonce, "7");
    assert.equal(reserved(), 1);
    assert.equal(quote.feeTo, FEE);
    assert.equal(quote.router, ROUTER);
  });

  it("rejects a malformed user, token, amount, and the wrong chain before RPC", async () => {
    const rpc = client({
      getCode: async () => {
        throw new Error("rpc should not run");
      },
    });
    const { buildQuote, reserved } = builder(rpc);
    const cases = [
      [{ user: "", amountIn: "1" }, "missing_user", 400],
      [{ amountIn: "1" }, "missing_user", 400],
      [{ user: "0x1234", amountIn: "1" }, "invalid_address", 400],
      [{ user: USER, tokenIn: "nope", amountIn: "1" }, "invalid_address", 400],
      [{ user: USER, amountIn: "abc" }, "invalid_amount", 400],
      [{ user: USER, amountIn: "-5" }, "invalid_amount", 400],
      [{ user: USER, amountIn: "0" }, "invalid_amount", 400],
      [{ user: USER }, "invalid_amount", 400],
      [{ user: USER, amountIn: "1", chainId: 1 }, "wrong_chain", 400],
      [{ user: USER, amountIn: "1", chainId: "84532" }, "wrong_chain", 400],
    ];
    for (const [body, code, status] of cases) {
      await assert.rejects(buildQuote(body), (err) => {
        assert.equal(err.error, code);
        assert.equal(err.status, status);
        if (code === "wrong_chain") assert.equal(err.publicMessage, ARB_SEPOLIA_ONLY);
        return true;
      });
    }
    assert.equal(reserved(), 0);
  });

  it("returns token_not_contract for an EOA with no code", async () => {
    const rpc = client({
      getCode: async ({ address }) => (address.toLowerCase() === EOA.toLowerCase() ? "0x" : "0x1234"),
      readContract: async () => {
        throw new Error("balanceOf should not run");
      },
    });
    const { buildQuote, reserved } = builder(rpc);
    await assert.rejects(buildQuote({ user: USER, tokenIn: EOA, amountIn: "1" }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, "token_not_contract");
      assert.match(err.publicMessage, /no contract code/);
      return true;
    });
    assert.equal(reserved(), 0);
  });

  it("returns amount_too_small when the router quote pays zero and does not fall back", async () => {
    const rpc = client({
      readContract: async (args) => {
        if (args.functionName === "balanceOf") return 10n ** 18n;
        if (args.functionName === "symbol") return "GRTT";
        if (args.functionName === "decimals") return 18;
        if (args.functionName === "quote") return 0n;
        if (args.functionName === "payAmount") throw new Error("payAmount should not run");
        throw new Error(args.functionName);
      },
    });
    const { buildQuote, reserved } = builder(rpc);
    await assert.rejects(buildQuote(oneToken), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, "amount_too_small");
      assert.equal(err.publicMessage, AMOUNT_TOO_SMALL_MESSAGE);
      return true;
    });
    assert.equal(reserved(), 0);
  });

  it("falls back to payAmount when quote() is missing", async () => {
    const rpc = client({
      readContract: async (args) => {
        if (args.functionName === "balanceOf") return 10n ** 18n;
        if (args.functionName === "symbol") return "GRTT";
        if (args.functionName === "decimals") return 18;
        if (args.functionName === "quote") throw new Error("execution reverted");
        if (args.functionName === "payAmount") return 1000n;
        throw new Error(args.functionName);
      },
    });
    const { buildQuote } = builder(rpc);
    const quote = await buildQuote({ ...oneToken, amountIn: "1000" });
    assert.equal(quote.quoteSource, "mock-swap-router");
    assert.equal(quote.amountOut, "1000");
  });

  it("keeps router insolvency as quote_unavailable and hides upstream details", async () => {
    const poor = client({
      getBalance: async () => 1n,
      readContract: async (args) => {
        if (args.functionName === "balanceOf") return 10n ** 18n;
        if (args.functionName === "symbol") return "GRTT";
        if (args.functionName === "decimals") return 18;
        if (args.functionName === "quote") return 1000n;
        throw new Error(args.functionName);
      },
    });
    const { buildQuote, reserved } = builder(poor);
    await assert.rejects(buildQuote(oneToken), (err) => {
      assert.equal(err.status, 502);
      assert.equal(err.error, "quote_unavailable");
      assert.match(err.publicMessage, /not have enough native gas/);
      return true;
    });
    assert.equal(reserved(), 0);

    const logs = [];
    const down = client({
      getCode: async () => {
        throw new Error("https://rpc.example/SECRETKEY boom");
      },
    });
    const hidden = builder(down, { log: (...parts) => logs.push(parts.join(" ")) });
    await assert.rejects(hidden.buildQuote(oneToken), (err) => {
      assert.equal(err.status, 502);
      assert.equal(err.error, "upstream_unavailable");
      assert.equal(err.publicMessage, UPSTREAM_MESSAGE);
      assert.equal(JSON.stringify(err.publicMessage).includes("SECRETKEY"), false);
      return true;
    });
    assert.equal(logs.some((line) => line.includes("SECRETKEY") || line.includes("https://")), false);
  });

  it("returns insufficient_balance and invalid_amount_split without reserving a nonce", async () => {
    const rpc = client({
      readContract: async (args) => {
        if (args.functionName === "balanceOf") return 1n;
        if (args.functionName === "symbol") return "GRTT";
        if (args.functionName === "decimals") return 18;
        if (args.functionName === "quote") return 1000n;
        throw new Error(args.functionName);
      },
    });
    const { buildQuote, reserved } = builder(rpc);
    await assert.rejects(buildQuote(oneToken), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, "insufficient_balance");
      return true;
    });

    const rich = client({
      readContract: async (args) => {
        if (args.functionName === "balanceOf") return 1000n;
        if (args.functionName === "symbol") return "GRTT";
        if (args.functionName === "decimals") return 18;
        throw new Error(args.functionName);
      },
    });
    const split = builder(rich);
    await assert.rejects(split.buildQuote({ user: USER, tokenIn: TOKEN, amountIn: "100", amountSwap: "99" }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, "invalid_amount_split");
      assert.match(err.publicMessage, /amountSwap \+ feeAmount must be < amountIn/);
      return true;
    });
    assert.equal(reserved() + split.reserved(), 0);
  });
});
