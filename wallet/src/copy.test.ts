import { describe, expect, it } from "vitest";
import {
  AMOUNT_HELPER,
  AMOUNT_LABEL,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  REVIEW_SUBTITLE,
  REVIEW_TRUST_LINE,
} from "./copy";

describe("review-screen copy", () => {
  it("uses human labels instead of raw field names", () => {
    expect(AMOUNT_LABEL).toBe("Amount to rescue");
    expect(FEE_LABEL).toBe("Rescue fee");
    expect(FEE_TO_LABEL).toBe("Fee goes to");
    expect(AMOUNT_LABEL).not.toBe("amount");
    expect(FEE_LABEL).not.toMatch(/feeAmount/);
    expect(FEE_TO_LABEL).not.toMatch(/feeTo/);
  });

  it("includes subtitle, per-row helpers, and a trust line", () => {
    expect(REVIEW_SUBTITLE.length).toBeGreaterThan(20);
    expect(AMOUNT_HELPER.length).toBeGreaterThan(10);
    expect(FEE_HELPER).toMatch(/1%/);
    expect(FEE_TO_HELPER.toLowerCase()).toMatch(/address/);
    expect(REVIEW_TRUST_LINE.toLowerCase()).toMatch(/confirm/);
  });

  it("keeps GET /quotes and clamp language out of end-user strings", () => {
    const surface = [
      REVIEW_SUBTITLE,
      REVIEW_TRUST_LINE,
      AMOUNT_LABEL,
      AMOUNT_HELPER,
      FEE_LABEL,
      FEE_HELPER,
      FEE_TO_LABEL,
      FEE_TO_HELPER,
    ].join(" ");
    expect(surface).not.toMatch(/GET \/quotes/i);
    expect(surface).not.toMatch(/clamp/i);
    expect(surface).not.toMatch(/\bfeeAmount\b/);
    expect(surface).not.toMatch(/\bfeeTo\b/);
  });
});
