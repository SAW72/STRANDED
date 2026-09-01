import { describe, expect, it } from "vitest";
import {
  AMOUNT_HELPER,
  AMOUNT_LABEL,
  AMOUNT_SWAP_HELPER,
  AMOUNT_SWAP_LABEL,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  FIXTURE_BANNER,
  MIN_OUT_LABEL,
  NATIVE_TO_LABEL,
  REMAINDER_TO_LABEL,
  REVIEW_SUBTITLE,
  REVIEW_TRUST_LINE,
  SAMPLE_BADGE,
} from "./copy";

const surface = [
  REVIEW_SUBTITLE,
  REVIEW_TRUST_LINE,
  AMOUNT_LABEL,
  AMOUNT_HELPER,
  AMOUNT_SWAP_LABEL,
  AMOUNT_SWAP_HELPER,
  REMAINDER_TO_LABEL,
  FEE_LABEL,
  FEE_HELPER,
  FEE_TO_LABEL,
  FEE_TO_HELPER,
  NATIVE_TO_LABEL,
  MIN_OUT_LABEL,
  FIXTURE_BANNER,
  SAMPLE_BADGE,
].join(" ");

describe("review-screen copy", () => {
  it("uses human labels for swap-for-gas + move-out", () => {
    expect(AMOUNT_LABEL).toBe("Amount to rescue");
    expect(AMOUNT_SWAP_LABEL).toBe("Amount swapped for gas");
    expect(REMAINDER_TO_LABEL).toBe("Remainder goes to");
    expect(FEE_LABEL).toBe("Rescue fee");
    expect(FEE_TO_LABEL).toBe("Fee goes to");
    expect(NATIVE_TO_LABEL).toBe("Native gas to");
    expect(MIN_OUT_LABEL).toBe("Min native out");
    expect(AMOUNT_LABEL).not.toBe("amountIn");
    expect(FEE_LABEL).not.toMatch(/feeAmount/);
    expect(NATIVE_TO_LABEL).not.toMatch(/nativeTo|safeRecipient/);
  });

  it("describes swap-for-gas, not a fee-skim-only product", () => {
    expect(REVIEW_SUBTITLE.toLowerCase()).toMatch(/swapped for native gas|swap/);
    expect(AMOUNT_SWAP_HELPER.toLowerCase()).toMatch(/gas/);
    expect(surface.toLowerCase()).not.toMatch(/fee-skim|fee skim/);
  });

  it("labels the fixture as sample / not live", () => {
    expect(FIXTURE_BANNER.toLowerCase()).toMatch(/sample/);
    expect(FIXTURE_BANNER.toLowerCase()).toMatch(/not live/);
    expect(SAMPLE_BADGE.toLowerCase()).toMatch(/sample/);
  });

  it("keeps GET /quotes, clamp, and safeRecipient out of end-user strings", () => {
    expect(surface).not.toMatch(/GET \/quotes/i);
    expect(surface).not.toMatch(/clamp/i);
    expect(surface).not.toMatch(/\bfeeAmount\b/);
    expect(surface).not.toMatch(/\bnativeTo\b/);
    expect(surface).not.toMatch(/safeRecipient/i);
  });
});
