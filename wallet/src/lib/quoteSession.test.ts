import { describe, expect, it } from "vitest";
import { sampleFixtureQuote } from "./fixture";
import { canPromptSignatures, rescuePhase } from "./processGate";
import { QUOTES_QUERY_KEY, quoteSessionAfterRescueError, quoteSessionAfterRescueSuccess } from "./quoteSession";

describe("quoteSessionAfterRescueSuccess", () => {
  it("drops signed order, signature, and confirm so a second rescue cannot replay nonce", () => {
    const next = quoteSessionAfterRescueSuccess();
    expect(next.signed).toBeNull();
    expect(next.detailsConfirmed).toBe(false);
    expect(next.signing).toBe(false);
    expect(next.signError).toBeNull();
    expect(next.submitState).toEqual({ kind: "idle" });
    expect(QUOTES_QUERY_KEY).toBe("quotes");
  });
});

describe("quoteSessionAfterRescueError", () => {
  it("keeps the error, drops confirm and the cached quote, and blocks Sign until a new quote is confirmed", () => {
    const stale = sampleFixtureQuote();
    const message = "This wallet already got a rescue. You can try again at 6:00 PM.";
    const reset = quoteSessionAfterRescueError({ message, relayerMessage: true });

    expect(reset.submitState).toEqual({ kind: "error", message, relayerMessage: true });
    expect(reset.detailsConfirmed).toBe(false);
    expect(reset.signed).toBeNull();
    expect(reset.dropCachedQuote).toBe(true);

    const quoteAfterError = reset.dropCachedQuote ? null : stale;
    expect(quoteAfterError).toBeNull();
    expect(quoteAfterError).not.toBe(stale);

    const blocked = rescuePhase({
      quote: quoteAfterError,
      detailsConfirmed: reset.detailsConfirmed,
      signing: reset.signing,
      signed: Boolean(reset.signed),
    });
    expect(blocked).toBe("needs_quote");
    expect(canPromptSignatures(blocked)).toBe(false);

    const fresh = sampleFixtureQuote();
    expect(
      canPromptSignatures(
        rescuePhase({
          quote: fresh,
          detailsConfirmed: false,
          signing: false,
          signed: false,
        }),
      ),
    ).toBe(false);

    expect(
      canPromptSignatures(
        rescuePhase({
          quote: fresh,
          detailsConfirmed: true,
          signing: false,
          signed: false,
        }),
      ),
    ).toBe(true);
  });

  it("keeps a plain rescue error when the response is not a relayer message", () => {
    const reset = quoteSessionAfterRescueError({
      message: "Could not reach Relayer POST /v1/rescues at http://relayer.test.",
    });
    expect(reset.submitState).toEqual({
      kind: "error",
      message: "Could not reach Relayer POST /v1/rescues at http://relayer.test.",
    });
    expect(reset.submitState.relayerMessage).toBeUndefined();
    expect(reset.dropCachedQuote).toBe(true);
  });
});
