import { describe, expect, it } from "vitest";
import { FIXTURE_HELP, QUOTE_ERROR, QUOTE_LOADING } from "../copy";
import { quoteUiStatus } from "./quoteStatus";

const readyInput = {
  hasRelayer: true,
  connectedOnNetwork: true,
  hasAmount: true,
  fetching: false,
  quoteReady: false,
  fetchFailed: false,
  usingFixture: false,
};

describe("quoteUiStatus", () => {
  it("uses the user-facing loading line", () => {
    expect(quoteUiStatus({ ...readyInput, fetching: true })).toEqual({
      kind: "loading",
      message: QUOTE_LOADING,
    });
    expect(QUOTE_LOADING).toBe("Getting your rescue quote…");
  });

  it("uses the user-facing error line and does not mention quotes internals", () => {
    const status = quoteUiStatus({ ...readyInput, fetchFailed: true });
    expect(status).toEqual({ kind: "error", message: QUOTE_ERROR });
    expect(QUOTE_ERROR).toBe("Couldn’t load rescue details. Try again.");
    expect(QUOTE_ERROR.toLowerCase()).not.toMatch(/quotes|clamp|feeamount/);
  });

  it("does not invent a ready quote when the fetch failed", () => {
    expect(quoteUiStatus({ ...readyInput, fetchFailed: true }).kind).not.toBe("ready");
  });

  it("does not present fixture help as a live ready quote", () => {
    const status = quoteUiStatus({ ...readyInput, hasRelayer: false, usingFixture: true });
    expect(status.kind).not.toBe("ready");
    expect(status).toEqual({ kind: "idle", message: FIXTURE_HELP });
  });
});
