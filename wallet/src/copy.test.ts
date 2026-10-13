import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import {
  AMOUNT_HELPER,
  AMOUNT_LABEL,
  AMOUNT_SWAP_HELPER,
  AMOUNT_SWAP_LABEL,
  BROWSER_WALLET_LABEL,
  CONNECT_HINT,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  FIXTURE_BANNER,
  GAS_RECEIVED_LABEL,
  MIN_OUT_LABEL,
  NATIVE_TO_LABEL,
  PICK_WALLET_TITLE,
  RECEIPT_TITLE,
  REMAINDER_TO_LABEL,
  REVIEW_SUBTITLE,
  REVIEW_TRUST_LINE,
  SAMPLE_BADGE,
  TX_HASH_LABEL,
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
  RECEIPT_TITLE,
  TX_HASH_LABEL,
  GAS_RECEIVED_LABEL,
].join(" ");

describe("review-screen copy", () => {
  it("uses human labels for swap-for-gas + move-out", () => {
    expect(AMOUNT_LABEL).toBe("Amount to rescue");
    expect(AMOUNT_SWAP_LABEL).toBe("Amount swapped for gas");
    expect(REMAINDER_TO_LABEL).toBe("Remainder destination");
    expect(FEE_LABEL).toBe("Rescue fee");
    expect(FEE_TO_LABEL).toBe("Fee destination");
    expect(NATIVE_TO_LABEL).toBe("Native gas destination");
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

describe("points copy", () => {
  const pointsCopy = Object.entries(copy)
    .filter(([key, value]) => key.startsWith("POINTS_") && typeof value === "string")
    .map(([, value]) => value);

  it("fails if points copy contains $, reward, or token value", () => {
    expect(pointsCopy.length).toBeGreaterThan(0);
    for (const line of pointsCopy) {
      expect(line).not.toMatch(/\$/);
      expect(line.toLowerCase()).not.toContain("reward");
      expect(line.toLowerCase()).not.toContain("token value");
      expect(line.toLowerCase()).not.toContain("airdrop");
      expect(line.toLowerCase()).not.toMatch(/\bearn\b/);
    }
  });

  it("states the points disclaimer exactly", () => {
    expect(copy.POINTS_DISCLAIMER).toBe(
      "Points are an off-chain record of activity only. They are not a token, have no cash value, can't be sold, transferred or redeemed, may be adjusted or cancelled at any time, and do not convert to anything.",
    );
  });

  it("introduces recorded activity by category", () => {
    expect(copy.POINTS_INTRO).toBe("Enter a wallet address to see recorded activity by category.");
  });

  it("keeps the registry claim label", () => {
    expect(copy.POINTS_ACTION_REGISTRY_CLAIM).toBe("Registry claim");
  });
});

describe("wallet picker copy", () => {
  it("does not tell the user to use a generic Injected connector", () => {
    expect(PICK_WALLET_TITLE).toBe("Choose a wallet");
    expect(CONNECT_HINT.toLowerCase()).toMatch(/metamask/);
    expect(CONNECT_HINT.toLowerCase()).toMatch(/phantom/);
    expect(`${CONNECT_HINT} ${BROWSER_WALLET_LABEL}`).not.toMatch(/\bInjected\b/);
  });
});
