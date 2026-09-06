import { describe, expect, it } from "vitest";
import { sampleFixtureQuote } from "./fixture";
import { buildOrder } from "./order";
import { publicSubmitError, rescueRequestBody, rescuesUrl, submitRescue } from "./rescues";

const SIG = (`0x${"11".repeat(32)}${"22".repeat(32)}1c`) as `0x${string}`;
const R = (`0x${"11".repeat(32)}`) as `0x${string}`;
const S = (`0x${"22".repeat(32)}`) as `0x${string}`;

describe("rescuesUrl / rescueRequestBody", () => {
  it("builds POST /v1/rescues on the Relayer origin", () => {
    expect(rescuesUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787/v1/rescues");
  });

  it("serializes the signed Order plus permit", () => {
    const quote = sampleFixtureQuote();
    const order = buildOrder({ quote });
    const body = rescueRequestBody({
      chainId: 84532,
      order,
      orderSignature: SIG,
      permitV: 28,
      permitR: R,
      permitS: S,
      swapData: "0xabcd",
    });
    expect(body.orderSignature).toBe(SIG);
    expect(body.v).toBe(28);
    expect(body.r).toBe(R);
    expect(body.s).toBe(S);
    expect(body.swapData).toBe("0xabcd");
    const posted = body.order as Record<string, unknown>;
    expect(posted.user).toBe(order.user);
    expect(posted.tokenIn).toBe(order.tokenIn);
    expect(posted.amountIn).toBe(order.amountIn.toString());
    expect(posted.nativeTo).toBe(order.nativeTo);
    expect(posted).not.toHaveProperty("safeRecipient");
  });
});

describe("submitRescue POST /v1/rescues", () => {
  const quote = sampleFixtureQuote();
  const input = {
    chainId: 84532,
    order: buildOrder({ quote }),
    orderSignature: SIG,
    permitV: 28,
    permitR: R,
    permitS: S,
  };

  it("posts to /v1/rescues and reads txHash", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("http://relayer.test/v1/rescues");
      expect(init?.method).toBe("POST");
      const posted = JSON.parse(String(init?.body));
      expect(posted.orderSignature).toBe(SIG);
      expect(posted.order.tokenIn).toBe(quote.tokenIn);
      return new Response(JSON.stringify({ ok: true, txHash: `0x${"ab".repeat(32)}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result).toEqual({ ok: true, txHash: `0x${"ab".repeat(32)}`, stubRpc: false });
  });

  it("does not treat not_found as success", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 });
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not available/i);
  });

  it("does not invent a hash when the Relayer is unreachable", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("offline");
    };
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result.ok).toBe(false);
  });

  it("surfaces insufficient_balance instead of a generic 502", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "insufficient_balance" }), { status: 400 });
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/remaining balance/i);
  });

  it("surfaces used_nonce as a fresh-quote error", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "used_nonce" }), { status: 400 });
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/fresh quote/i);
  });

  it("surfaces simulation_failed SwapFailed instead of a silent reset", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "simulation_failed", revert: "SwapFailed" }), {
        status: 502,
      });
    const result = await submitRescue("http://relayer.test", input, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/mock swap router/i);
      expect(result.reason).toMatch(/not broadcast/i);
    }
  });
});

describe("publicSubmitError", () => {
  it("keeps the Relayer revert name in the reason", () => {
    expect(publicSubmitError(502, { ok: false, error: "simulation_failed", revert: "SwapFailed" })).toMatch(
      /mock swap router/i,
    );
    expect(
      publicSubmitError(502, {
        ok: false,
        error: "simulation_failed",
        revert: "The contract function \"rescueWithPermit\" reverted with the following signature: 0x81ceff30",
      }),
    ).toMatch(/mock swap router/i);
  });

  it("maps ERC2612InvalidSigner (0x4b800e46) to a permit-mismatch reason", () => {
    const reason = publicSubmitError(502, {
      ok: false,
      error: "simulation_failed",
      revert: 'The contract function "rescueWithPermit" reverted with the following signature: 0x4b800e46',
    });
    expect(reason.toLowerCase()).toMatch(/permit/);
    expect(reason).not.toMatch(/0x4b800e46/);
  });
});
