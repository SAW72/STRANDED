import { describe, expect, it } from "vitest";
import { sampleFixtureRaw } from "./fixture";
import {
  DISPLAY_BEFORE_CONFIRM,
  displayBeforeConfirm,
  fetchRescueQuote,
  hasRequiredQuoteFields,
  ORDER_REVIEW_FIELDS,
  parseQuoteResponse,
  quoteRequestBody,
  quotesUrl,
} from "./quotes";

const USER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const FEE_TO = "0x3333333333333333333333333333333333333333" as const;
const TO = "0x1111111111111111111111111111111111111111" as const;
const NATIVE_TO = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x6666666666666666666666666666666666666666" as const;
const PATH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const validBody = {
  quoteId: "q-1",
  chainId: 84532,
  tokenIn: TOKEN,
  tokenSymbol: "mPERMIT",
  tokenDecimals: 18,
  user: USER,
  amountIn: "1000000000000000000",
  amountSwap: "200000000000000000",
  feeAmount: "10000000000000000",
  feeTo: FEE_TO,
  to: TO,
  nativeTo: NATIVE_TO,
  minAmountOut: "1000000000000000",
  amountRemainder: "790000000000000000",
  router: ROUTER,
  pathHash: PATH,
  deadline: "1893456000",
  nonce: "1",
};

const feeSkimBody = {
  amount: "100000000000000000000",
  feeAmount: "1000000000000000000",
  feeTo: FEE_TO,
  tokenDecimals: 18,
};

describe("parseQuoteResponse", () => {
  it("reads the canonical swap-for-gas fields", () => {
    const quote = parseQuoteResponse(validBody);
    expect(quote).not.toBeNull();
    expect(quote?.amountIn).toBe(10n ** 18n);
    expect(quote?.amountSwap).toBe(2n * 10n ** 17n);
    expect(quote?.feeAmount).toBe(10n ** 16n);
    expect(quote?.amountRemainder).toBe(79n * 10n ** 16n);
    expect(quote?.nativeTo).toBe(NATIVE_TO);
    expect(quote?.tokenSymbol).toBe("mPERMIT");
    expect(quote?.pathHash).toBe(PATH);
    expect(quote?.amountOut).toBeUndefined();
  });

  it("keeps optional amountOut when the Relayer sends it", () => {
    const quote = parseQuoteResponse({ ...validBody, amountOut: "100000000000000" });
    expect(quote?.amountOut).toBe(10n ** 14n);
  });

  it("unwraps { quote } and { quotes: [] }", () => {
    expect(parseQuoteResponse({ quote: validBody })?.nativeTo).toBe(NATIVE_TO);
    expect(parseQuoteResponse({ quotes: [validBody] })?.amountIn).toBe(10n ** 18n);
  });

  it("accepts Arb Sepolia chainId 421614", () => {
    const quote = parseQuoteResponse({ ...validBody, chainId: 421614, quoteId: "q-arb" });
    expect(quote?.chainId).toBe(421614);
  });

  it("returns null for the old fee-skim shape — does not invent swap legs", () => {
    expect(parseQuoteResponse(feeSkimBody)).toBeNull();
    expect(parseQuoteResponse({ ...feeSkimBody, amountIn: validBody.amountIn })).toBeNull();
  });

  it("does not treat safeRecipient as nativeTo", () => {
    const { nativeTo: _dropped, ...rest } = validBody;
    expect(parseQuoteResponse({ ...rest, safeRecipient: NATIVE_TO })).toBeNull();
  });

  it("returns null when required fields are missing or the split does not add up", () => {
    expect(parseQuoteResponse({})).toBeNull();
    expect(parseQuoteResponse({ ...validBody, nativeTo: undefined })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, pathHash: "0xab" })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, chainId: 1 })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, amountRemainder: "1" })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, feeAmount: validBody.amountIn })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, amountSwap: "0" })).toBeNull();
  });

  it("parses the Relayer dry-mock fixture", () => {
    expect(parseQuoteResponse(sampleFixtureRaw())).not.toBeNull();
  });

  it("fails closed when eip712 disagrees with top-level fields", () => {
    const raw = sampleFixtureRaw();
    const eip = raw.eip712 as { message: { nativeTo: string } };
    eip.message.nativeTo = "0x5555555555555555555555555555555555555555";
    expect(parseQuoteResponse(raw)).toBeNull();
  });
});

describe("displayBeforeConfirm / required fields", () => {
  it("exposes the freeze display keys", () => {
    expect([...DISPLAY_BEFORE_CONFIRM]).toEqual([
      "amountIn",
      "amountSwap",
      "amountRemainder",
      "feeAmount",
      "feeTo",
      "to",
      "nativeTo",
      "minAmountOut",
      "tokenSymbol",
      "tokenDecimals",
      "chainId",
    ]);
    expect([...ORDER_REVIEW_FIELDS]).toContain("nativeTo");
    expect([...ORDER_REVIEW_FIELDS]).not.toContain("safeRecipient");
  });

  it("projects displayBeforeConfirm from a valid quote", () => {
    const quote = parseQuoteResponse(validBody)!;
    expect(displayBeforeConfirm(quote)).toEqual({
      amountIn: quote.amountIn,
      amountSwap: quote.amountSwap,
      amountRemainder: quote.amountRemainder,
      feeAmount: quote.feeAmount,
      feeTo: quote.feeTo,
      to: quote.to,
      nativeTo: quote.nativeTo,
      minAmountOut: quote.minAmountOut,
      tokenSymbol: quote.tokenSymbol,
      tokenDecimals: quote.tokenDecimals,
      chainId: quote.chainId,
    });
    expect(hasRequiredQuoteFields(quote)).toBe(true);
    expect(hasRequiredQuoteFields(null)).toBe(false);
  });
});

describe("quotesUrl / quoteRequestBody", () => {
  it("builds POST /v1/quotes on the Relayer origin", () => {
    expect(quotesUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787/v1/quotes");
  });

  it("serializes required and optional POST fields", () => {
    expect(
      quoteRequestBody({
        user: USER,
        tokenIn: TOKEN,
        amountIn: 10n ** 18n,
        chainId: 84532,
        amountSwap: 2n * 10n ** 17n,
        to: USER,
        nativeTo: USER,
        slippageBps: 100,
      }),
    ).toEqual({
      user: USER,
      tokenIn: TOKEN,
      amountIn: "1000000000000000000",
      chainId: 84532,
      amountSwap: "200000000000000000",
      to: USER,
      nativeTo: USER,
      slippageBps: 100,
    });
  });
});

describe("fetchRescueQuote POST /v1/quotes", () => {
  const params = {
    user: USER,
    tokenIn: TOKEN,
    amountIn: 10n ** 18n,
    chainId: 84532,
    to: USER,
    nativeTo: USER,
    slippageBps: 100,
  };

  it("fails closed when the Relayer URL is empty", async () => {
    const result = await fetchRescueQuote("  ", params);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/VITE_RELAYER_URL/);
  });

  it("refuses mainnet chain ids", async () => {
    const result = await fetchRescueQuote("http://relayer.test", { ...params, chainId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Base Sepolia or Arb Sepolia/);
  });

  it("POSTs JSON and fails closed on HTTP error", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe("http://relayer.test/v1/quotes");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.user).toBe(USER);
      expect(body.tokenIn).toBe(TOKEN);
      expect(body.amountIn).toBe("1000000000000000000");
      expect(body.slippageBps).toBe(100);
      return new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } });
    };
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/HTTP 404/);
  });

  it("surfaces insufficient_balance from the Relayer", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "insufficient_balance" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/token balance/i);
  });

  it("fails closed when the body is the old fee-skim shape", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(feeSkimBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing required fields/);
  });

  it("returns the Relayer quote when POST /v1/quotes is well-formed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(validBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote.nativeTo).toBe(NATIVE_TO);
      expect(result.source).toBe("relayer");
    }
  });

  it("rejects a quote whose chainId does not match the request", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ...validBody, chainId: 421614 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
  });
});
