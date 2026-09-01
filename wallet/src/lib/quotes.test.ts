import { describe, expect, it } from "vitest";
import { fetchRescueQuote, parseQuoteResponse, quotesUrl } from "./quotes";

const USER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const FEE_TO = "0x3333333333333333333333333333333333333333" as const;

const validBody = {
  amount: "100000000000000000000",
  feeAmount: "1000000000000000000",
  feeTo: FEE_TO,
  tokenDecimals: 18,
};

describe("parseQuoteResponse", () => {
  it("reads required fields from a flat body", () => {
    const quote = parseQuoteResponse(validBody);
    expect(quote).toEqual({
      amount: 100n * 10n ** 18n,
      feeAmount: 10n ** 18n,
      feeTo: FEE_TO,
      tokenDecimals: 18,
    });
  });

  it("unwraps { quote } and { quotes: [] }", () => {
    expect(parseQuoteResponse({ quote: validBody })?.feeTo).toBe(FEE_TO);
    expect(parseQuoteResponse({ quotes: [validBody] })?.amount).toBe(100n * 10n ** 18n);
  });

  it("returns null when required fields are missing — does not invent values", () => {
    expect(parseQuoteResponse({})).toBeNull();
    expect(parseQuoteResponse({ amount: validBody.amount, feeAmount: validBody.feeAmount })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, feeTo: undefined })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, tokenDecimals: undefined })).toBeNull();
    expect(parseQuoteResponse({ ...validBody, feeAmount: validBody.amount })).toBeNull();
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

  it("fails closed when RELAYER_BASE_URL is empty", async () => {
    const result = await fetchRescueQuote("  ", params);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/RELAYER_BASE_URL/);
  });

  it("fails closed on HTTP error and does not synthesize a quote", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } });
    const result = await fetchRescueQuote("http://relayer.test", params, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/HTTP 404/);
  });

  it("fails closed when the body is missing quote fields", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
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
      expect(result.quote.feeTo).toBe(FEE_TO);
      expect(result.source).toContain("/quotes");
    }
  });
});
