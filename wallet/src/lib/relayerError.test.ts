import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFixtureQuote } from "./fixture";
import { buildOrder } from "./order";
import { QUOTE_ERROR } from "../copy";
import { fetchRescueQuote } from "./quotes";
import {
  RELAYER_FETCH_TIMEOUT_MS,
  RESCUE_COULD_NOT_SEND,
  RESCUE_SERVICE_BUSY,
  RESCUE_SERVICE_TIMEOUT,
  RESCUE_SUBMIT_TIMEOUT,
  RESCUE_UNREACHABLE,
  busyServiceMessage,
  relayerUserMessage,
  type RelayerMessageContext,
} from "./relayerError";
import { publicSubmitError, submitRescue } from "./rescues";

const LOCALE = "en-US";
const TIME_ZONE = "America/New_York";
const NOW = new Date("2026-10-01T15:00:00.000Z");
const SAME_DAY_ISO = "2026-10-01T22:00:00.000Z";
const NEXT_DAY_ISO = "2026-10-02T22:42:00.000Z";

const context: RelayerMessageContext = { now: NOW, locale: LOCALE };

const USER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const SIG = (`0x${"11".repeat(32)}${"22".repeat(32)}1c`) as `0x${string}`;
const R = (`0x${"11".repeat(32)}`) as `0x${string}`;
const S = (`0x${"22".repeat(32)}`) as `0x${string}`;

const quoteParams = {
  user: USER,
  tokenIn: TOKEN,
  amountIn: 10n ** 18n,
  chainId: 84532,
  to: USER,
  nativeTo: USER,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function walletLimitBody(iso = SAME_DAY_ISO) {
  return {
    ok: false,
    error: "rate_limited_wallet",
    message: `This wallet already got a rescue. You can try again at ${iso}.`,
    retryAfter: 14400,
    retryAt: iso,
  };
}

function ipLimitBody() {
  return {
    ok: false,
    error: "rate_limited_ip",
    message: `Too many rescues from this network already went through (limit 3). You can try again at ${NEXT_DAY_ISO}.`,
    retryAfter: 100000,
    retryAt: NEXT_DAY_ISO,
  };
}

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    locale: LOCALE,
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: TIME_ZONE,
  } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relayerUserMessage", () => {
  it("rewrites a same-day wallet 429 to local time and drops the ISO string", () => {
    const text = relayerUserMessage(429, walletLimitBody(), context);
    expect(text).toBe("This wallet already got a rescue. You can try again at 6:00 PM.");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/rate_limited|HTTP/);
  });

  it("includes the date when the IP retry is not today", () => {
    const text = relayerUserMessage(429, ipLimitBody(), context);
    expect(text).toBe(
      "Too many rescues from this network already went through (limit 3). You can try again at Oct 2, 6:42 PM.",
    );
    expect(text).not.toContain(NEXT_DAY_ISO);
  });

  it("computes local time from retryAfter seconds when retryAt is absent", () => {
    const text = relayerUserMessage(
      429,
      {
        ok: false,
        error: "rate_limited_wallet",
        message: `This wallet already got a rescue. You can try again at ${SAME_DAY_ISO}.`,
        retryAfter: 3600,
      },
      context,
    );
    expect(text).toBe("This wallet already got a rescue. You can try again at 12:00 PM.");
    expect(text).not.toContain(SAME_DAY_ISO);
  });

  it("adds a local-time sentence when retryAfter is the only clock and the message has no ISO", () => {
    const text = relayerUserMessage(
      429,
      {
        ok: false,
        error: "rate_limited_ip",
        message: "Too many rescues from this network already went through.",
        retryAfter: 3600,
      },
      context,
    );
    expect(text).toBe("Too many rescues from this network already went through. You can try again at 12:00 PM.");
  });

  it("leaves the server message unchanged when neither retry field parses", () => {
    const message = `This wallet already got a rescue. You can try again at ${SAME_DAY_ISO}.`;
    expect(
      relayerUserMessage(429, { ok: false, error: "rate_limited_wallet", message, retryAt: "tomorrow" }, context),
    ).toBe(message);
  });

  it("uses the 400 message for invalid_address and insufficient_balance", () => {
    expect(
      relayerUserMessage(400, {
        ok: false,
        error: "invalid_address",
        message: "user must be an 0x address (20 bytes).",
      }),
    ).toBe("user must be an 0x address (20 bytes).");
    expect(
      relayerUserMessage(400, {
        ok: false,
        error: "insufficient_balance",
        message: "Amount is larger than this wallet's token balance.",
      }),
    ).toBe("Amount is larger than this wallet's token balance.");
  });

  it("uses the 502 message for upstream_unavailable and quote_unavailable", () => {
    expect(
      relayerUserMessage(502, {
        ok: false,
        error: "upstream_unavailable",
        message: "The network request failed. Try again in a moment.",
      }),
    ).toBe("The network request failed. Try again in a moment.");
    expect(
      relayerUserMessage(502, {
        ok: false,
        error: "quote_unavailable",
        message: "The swap router does not have enough native gas for this quote.",
      }),
    ).toBe("The swap router does not have enough native gas for this quote.");
  });

  it("returns null for a non-JSON body, a missing message, and other statuses", () => {
    expect(relayerUserMessage(502, null)).toBeNull();
    expect(relayerUserMessage(502, "bad gateway")).toBeNull();
    expect(relayerUserMessage(400, { ok: false, error: "insufficient_balance" })).toBeNull();
    expect(relayerUserMessage(400, { ok: false, error: "invalid_address", message: "  " })).toBeNull();
    expect(relayerUserMessage(503, { ok: false, error: "relayer_paused", message: "raw" })).toBeNull();
    expect(relayerUserMessage(429, [])).toBeNull();
  });

  it("uses the busy sentence for a non-object 502, 503, or 504 and leaves JSON objects alone", () => {
    expect(RELAYER_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
    expect(RELAYER_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(busyServiceMessage(502, null)).toBe(RESCUE_SERVICE_BUSY);
    expect(busyServiceMessage(503, "bad gateway")).toBe(RESCUE_SERVICE_BUSY);
    expect(busyServiceMessage(504, [])).toBe(RESCUE_SERVICE_BUSY);
    expect(busyServiceMessage(502, { ok: false, error: "simulation_failed" })).toBeNull();
    expect(
      busyServiceMessage(503, { ok: false, error: "relayer_paused", message: "Rescue is paused." }),
    ).toBeNull();
    expect(
      busyServiceMessage(504, { ok: false, error: "gateway", message: "Try later from upstream." }),
    ).toBeNull();
    expect(busyServiceMessage(400, null)).toBeNull();
    expect(busyServiceMessage(404, "nope")).toBeNull();
  });
});

describe("quote and rescue endpoints", () => {
  const rescueInput = {
    chainId: 84532,
    order: buildOrder({ quote: sampleFixtureQuote() }),
    orderSignature: SIG,
    permitV: 28,
    permitR: R,
    permitS: S,
  };

  async function quoteReason(status: number, body: unknown, raw = false) {
    const fetchImpl: typeof fetch = async () =>
      raw
        ? new Response(String(body), { status, headers: { "Content-Type": "text/plain" } })
        : jsonResponse(status, body);
    const result = await fetchRescueQuote("http://relayer.test", quoteParams, fetchImpl, context);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected quote failure");
    return result;
  }

  async function rescueReason(status: number, body: unknown, raw = false) {
    const fetchImpl: typeof fetch = async () =>
      raw
        ? new Response(String(body), { status, headers: { "Content-Type": "text/plain" } })
        : jsonResponse(status, body);
    const result = await submitRescue("http://relayer.test", rescueInput, fetchImpl, context);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rescue failure");
    return result;
  }

  it("shows the 429 wallet and IP messages in local time", async () => {
    const wallet = await quoteReason(429, walletLimitBody());
    expect(wallet.reason).toBe("This wallet already got a rescue. You can try again at 6:00 PM.");
    expect(wallet.userMessage).toBe(wallet.reason);

    const ip = await rescueReason(429, ipLimitBody());
    expect(ip.reason).toBe(
      "Too many rescues from this network already went through (limit 3). You can try again at Oct 2, 6:42 PM.",
    );
    expect(ip.relayerMessage).toBe(true);
    expect(publicSubmitError(429, ipLimitBody(), context)).toBe(ip.reason);
  });

  it("uses retryAfter when retryAt is missing", async () => {
    const body = {
      ok: false,
      error: "rate_limited_wallet",
      message: `A rescue for this wallet is already in progress. You can try again at ${SAME_DAY_ISO}.`,
      retryAfter: 3600,
    };
    const quote = await quoteReason(429, body);
    expect(quote.reason).toBe("A rescue for this wallet is already in progress. You can try again at 12:00 PM.");
    const rescue = await rescueReason(429, body);
    expect(rescue.reason).toBe(quote.reason);
  });

  it("shows 400 invalid_address and insufficient_balance messages", async () => {
    const invalid = {
      ok: false,
      error: "invalid_address",
      message: "tokenIn must be an 0x address (20 bytes).",
    };
    const balance = {
      ok: false,
      error: "insufficient_balance",
      message: "Amount is larger than this wallet's token balance.",
    };
    expect((await quoteReason(400, invalid)).reason).toBe("tokenIn must be an 0x address (20 bytes).");
    expect((await quoteReason(400, balance)).reason).toBe("Amount is larger than this wallet's token balance.");
    expect((await rescueReason(400, invalid)).reason).toBe("tokenIn must be an 0x address (20 bytes).");
    expect((await rescueReason(400, balance)).reason).toBe("Amount is larger than this wallet's token balance.");
    expect((await quoteReason(400, balance)).reason).not.toMatch(/Lower the amount/);
    expect((await rescueReason(400, balance)).reason).not.toMatch(/fresh quote/);
  });

  it("shows 502 upstream_unavailable and quote_unavailable messages", async () => {
    const upstream = {
      ok: false,
      error: "upstream_unavailable",
      message: "The network request failed. Try again in a moment.",
    };
    const quoteDown = {
      ok: false,
      error: "quote_unavailable",
      message: "The swap router does not have enough native gas for this quote.",
    };
    expect((await quoteReason(502, upstream)).reason).toBe(upstream.message);
    expect((await rescueReason(502, upstream)).reason).toBe(upstream.message);
    expect((await quoteReason(502, quoteDown)).reason).toBe(quoteDown.message);
    expect((await rescueReason(502, quoteDown)).reason).toBe(quoteDown.message);
    expect((await quoteReason(502, upstream)).reason).not.toMatch(/HTTP 502/);
  });

  it("shows a plain busy sentence for a non-JSON 502 and still fails the quote", async () => {
    const quote = await quoteReason(502, "<html>bad gateway</html>", true);
    expect(quote.ok).toBe(false);
    expect(quote.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(quote.userMessage).toBe(RESCUE_SERVICE_BUSY);
    expect(quote.reason).not.toMatch(/Relayer|HTTP|502|\/v1\//);

    const rescue = await rescueReason(502, "<html>bad gateway</html>", true);
    expect(rescue.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(rescue.relayerMessage).toBe(true);
    expect(rescue.reason).not.toMatch(/Relayer|HTTP|502|\/v1\//);
    expect(publicSubmitError(502, null)).toBe(RESCUE_SERVICE_BUSY);
  });

  it("shows the same busy sentence when the 502 body is unparseable", async () => {
    const quote = await quoteReason(502, "{", true);
    expect(quote.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(quote.userMessage).toBe(RESCUE_SERVICE_BUSY);

    const rescue = await rescueReason(502, "{", true);
    expect(rescue.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(rescue.relayerMessage).toBe(true);

    const quotePrimitive = await quoteReason(502, 1);
    expect(quotePrimitive.reason).toBe(RESCUE_SERVICE_BUSY);
    const rescueArray = await rescueReason(502, []);
    expect(rescueArray.reason).toBe(RESCUE_SERVICE_BUSY);
  });

  it("keeps the existing sentence when the JSON message is missing", async () => {
    const quote = await quoteReason(400, { ok: false, error: "insufficient_balance" });
    expect(quote.reason).toBe(
      "Amount is larger than this wallet's token balance. Lower the amount for a fresh quote.",
    );
    expect(quote.userMessage).toBeUndefined();

    const rescue = await rescueReason(400, { ok: false, error: "insufficient_balance" });
    expect(rescue.reason).toBe(
      "Amount is larger than this wallet's token balance. Request a fresh quote for the remaining balance.",
    );
    expect(rescue.relayerMessage).toBeUndefined();

    const bare = await quoteReason(400, { ok: false, error: "invalid_address" });
    expect(bare.reason).toBe(QUOTE_ERROR);
    expect(bare.reason).not.toMatch(/Relayer POST|HTTP \d+/);
  });

  it("uses the busy sentence for a non-JSON 503 and 504, and keeps a JSON message", async () => {
    const quote503 = await quoteReason(503, "<html>unavailable</html>", true);
    expect(quote503.ok).toBe(false);
    expect(quote503.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(quote503.userMessage).toBe(RESCUE_SERVICE_BUSY);

    const rescue504 = await rescueReason(504, "{", true);
    expect(rescue504.reason).toBe(RESCUE_SERVICE_BUSY);
    expect(rescue504.relayerMessage).toBe(true);

    const paused = await quoteReason(503, {
      ok: false,
      error: "relayer_paused",
      message: "Rescue quotes are paused right now. Try again later.",
    });
    expect(paused.reason).toMatch(/paused/i);
    expect(paused.reason).not.toBe(RESCUE_SERVICE_BUSY);

    const json504 = await rescueReason(504, {
      ok: false,
      error: "gateway",
      message: "Try later from upstream.",
    });
    expect(json504.reason).toBe(RESCUE_COULD_NOT_SEND);
    expect(json504.reason).not.toMatch(/Relayer POST|HTTP \d+|gateway/);
  });

  it("times out a hung quote and rescue and blocks the quote", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        if (!signal) {
          reject(new Error("missing timeout signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

    const quote = await fetchRescueQuote("http://relayer.test", quoteParams, hang, { timeoutMs: 40 });
    expect(quote.ok).toBe(false);
    if (quote.ok) throw new Error("expected quote timeout");
    expect(quote.reason).toBe(RESCUE_SERVICE_TIMEOUT);
    expect(quote.userMessage).toBe(RESCUE_SERVICE_TIMEOUT);
    expect(quote.reason).not.toMatch(/Relayer|HTTP/);

    const rescue = await submitRescue("http://relayer.test", rescueInput, hang, { timeoutMs: 40 });
    expect(rescue.ok).toBe(false);
    if (rescue.ok) throw new Error("expected rescue timeout");
    expect(rescue.reason).toBe(RESCUE_SUBMIT_TIMEOUT);
    expect(rescue.reason).not.toBe(RESCUE_SERVICE_TIMEOUT);
    expect(rescue.relayerMessage).toBe(true);
    expect(rescue.reason).not.toMatch(/Relayer|HTTP/);
  });

  it("uses a plain sentence when the quote or rescue cannot be reached", async () => {
    const offline: typeof fetch = async () => {
      throw new Error("offline");
    };
    const quote = await fetchRescueQuote("http://relayer.test", quoteParams, offline);
    expect(quote.ok).toBe(false);
    if (quote.ok) throw new Error("expected quote failure");
    expect(quote.reason).toBe(RESCUE_UNREACHABLE);
    expect(quote.userMessage).toBe(RESCUE_UNREACHABLE);
    expect(quote.reason).not.toMatch(/Relayer POST|HTTP \d+/);

    const rescue = await submitRescue("http://relayer.test", rescueInput, offline);
    expect(rescue.ok).toBe(false);
    if (rescue.ok) throw new Error("expected rescue failure");
    expect(rescue.reason).toBe(RESCUE_UNREACHABLE);
    expect(rescue.relayerMessage).toBe(true);
  });

  it("reads Retry-After when the body has no retry time, and ignores bad values", async () => {
    const message = `This wallet already got a rescue. You can try again at ${SAME_DAY_ISO}.`;
    const body = { ok: false, error: "rate_limited_wallet", message };

    const fromSeconds = relayerUserMessage(429, body, { ...context, retryAfterHeader: "3600" });
    expect(fromSeconds).toBe("This wallet already got a rescue. You can try again at 12:00 PM.");

    const fromDate = relayerUserMessage(429, body, {
      ...context,
      retryAfterHeader: "Fri, 02 Oct 2026 22:42:00 GMT",
    });
    expect(fromDate).toBe("This wallet already got a rescue. You can try again at Oct 2, 6:42 PM.");

    const bodyWins = {
      ...body,
      retryAt: SAME_DAY_ISO,
    };
    expect(
      relayerUserMessage(429, bodyWins, {
        ...context,
        retryAfterHeader: "Fri, 02 Oct 2026 22:42:00 GMT",
      }),
    ).toBe("This wallet already got a rescue. You can try again at 6:00 PM.");

    const retryAfterWins = relayerUserMessage(
      429,
      { ...body, retryAfter: 3600 },
      { ...context, retryAfterHeader: "Fri, 02 Oct 2026 22:42:00 GMT" },
    );
    expect(retryAfterWins).toBe("This wallet already got a rescue. You can try again at 12:00 PM.");

    expect(
      relayerUserMessage(429, { ...body, retryAt: "2020-01-01T00:00:00.000Z" }, context),
    ).toBe(message);
    expect(relayerUserMessage(429, body, { ...context, retryAfterHeader: "nope" })).toBe(message);
    expect(relayerUserMessage(429, body, { ...context, retryAfterHeader: "-5" })).toBe(message);
    expect(
      relayerUserMessage(429, body, { ...context, retryAfterHeader: "Wed, 01 Oct 2025 00:00:00 GMT" }),
    ).toBe(message);
    expect(
      relayerUserMessage(429, { ...body, retryAt: "2026-09-01T00:00:00.000Z", retryAfter: -30 }, {
        ...context,
        retryAfterHeader: "3600",
      }),
    ).toBe("This wallet already got a rescue. You can try again at 12:00 PM.");

    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(body), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "3600" },
      });
    const quote = await fetchRescueQuote("http://relayer.test", quoteParams, fetchImpl, context);
    expect(quote.ok).toBe(false);
    if (quote.ok) throw new Error("expected quote failure");
    expect(quote.reason).toBe("This wallet already got a rescue. You can try again at 12:00 PM.");
  });
});
