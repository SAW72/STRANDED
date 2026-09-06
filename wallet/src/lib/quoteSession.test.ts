import { describe, expect, it } from "vitest";
import { QUOTES_QUERY_KEY, quoteSessionAfterRescueSuccess } from "./quoteSession";

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
