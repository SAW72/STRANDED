import { describe, expect, it } from "vitest";
import { sampleFixtureQuote } from "./fixture";
import { canPromptSignatures, confirmDetailsEnabled, rescuePhase } from "./processGate";

const quote = sampleFixtureQuote();

describe("process gate", () => {
  it("stays on needs_quote when the quote is missing", () => {
    expect(
      rescuePhase({ quote: null, detailsConfirmed: true, signing: false, signed: false }),
    ).toBe("needs_quote");
    expect(canPromptSignatures("needs_quote")).toBe(false);
  });

  it("requires Confirm details before the Order + permit path", () => {
    expect(
      rescuePhase({ quote, detailsConfirmed: false, signing: false, signed: false }),
    ).toBe("review");
    expect(confirmDetailsEnabled("review")).toBe(true);
    expect(canPromptSignatures("review")).toBe(false);

    expect(
      rescuePhase({ quote, detailsConfirmed: true, signing: false, signed: false }),
    ).toBe("confirmed");
    expect(canPromptSignatures("confirmed")).toBe(true);
  });

  it("does not skip the gate into signing", () => {
    expect(
      canPromptSignatures(
        rescuePhase({
          quote,
          detailsConfirmed: false,
          signing: false,
          signed: false,
        }),
      ),
    ).toBe(false);
  });
});
