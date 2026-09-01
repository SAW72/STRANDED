import { describe, expect, it } from "vitest";
import { sampleFixtureRaw } from "./fixture";
import {
  DISPLAY_BEFORE_CONFIRM,
  displayBeforeConfirm,
  fetchRescueQuote,
  hasRequiredQuoteFields,
  ORDER_REVIEW_FIELDS,
  parseQuoteResponse,
  quotesUrl,
} from "./quotes";

const USER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const FEE_TO = "0x3333333333333333333333333333333333333333" as const;
const TO = "0x4444444444444444444444444444444444444444" as const;
const NATIVE_TO = "0x5555555555555555555555555555555555555555" as const;
const ROUTER = "0x6666666666666666666666666666666666666666" as const;
const PATH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const validBody = {
  quoteId: "q-1",
  chainId: 84532,
  tokenIn: TOKEN,
  tokenSymbol: "MOCK",
  tokenDecimals: 18,
  user: USER,
  amountIn: "100000000000000000000",
  amountSwap: "10000000000000000000",
  feeAmount: "1000000000000000000",
  feeTo: FEE_TO,
  to: TO,
  nativeTo: NATIVE_TO,
  minAmountOut: "2500000000000000",
  amountRemainder: "89000000000000000000",
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
    expect(quote?.amountIn).toBe(100n * 10n ** 18n);
    expect(quote?.amountSwap).toBe(10n * 10n ** 18n);
    expect(quote?.amountRemainder).toBe(89n * 10n ** 18n);
    expect(quote?.nativeTo).toBe(NATIVE_TO);
    expect(quote?.to).toBe(TO);
    expect(quote?.tokenIn).toBe(TOKEN);
    expect(quote?.chainId).toBe(84532);
    expect(quote?.pathHash).toBe(PATH);
  });

  it("unwraps { quote } and { quotes: [] }", () => {
    expect(parseQuoteResponse({ quote: validBody })?.nativeTo).toBe(NATIVE_TO);
    expect(parseQuoteResponse({ quotes: [validBody] })?.amountIn).toBe(100n * 10n ** 18n);
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

  it("parses the checked-in sample fixture shape", () => {
    expect(parseQuoteResponse(sampleFixtureRaw())).not.toBeNull();
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

describe("quotesUrl", () => {
  it("builds GET /quotes on the Relayer origin", () => {
    const url = quotesUrl("http://127.0.0.1:8787/", {
      chainId: 84532,
      token: TOKEN,
      amount: 5n,
      user: USER,
    });
    expect(url).toBe(
      "http://127.0.0.1:8787/quotes?chainId=84532&token=0x2222222222222222222222222222222222222222&amount=5&user=0x1111111111111111111111111111111111111111",
    );
  });
});

describe("fetchRescueQuote", () => {
  const params = { chainId: 84532, token: TOKEN, amount: 10n, user: USER };

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

  it("fails closed on HTTP error and does not synthesize a quote", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/HTTP 404/);
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

  it("returns the Relayer quote when GET /quotes is well-formed", async () => {
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
