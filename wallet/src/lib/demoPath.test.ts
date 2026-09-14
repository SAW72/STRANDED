import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { sampleFixtureQuote } from "./fixture";
import { ARB_SEPOLIA_CHAIN_ID } from "./chains";
import {
  ARB_SEPOLIA_DEMO,
  demoPathHash,
  dryGmockFixturePathHash,
  dryGrttFixturePathHash,
  encodeSwapExact,
  isSupportedDemoToken,
  matchesDemoPath,
  quotePathStatus,
} from "./demoPath";
import { RELAYER_DRY_PATH_HASH } from "./fixture";

describe("Arb Sepolia demo path registry", () => {
  it("encodes swapExact like the live Relayer and Foundry library", () => {
    const data = encodeSwapExact(
      ARB_SEPOLIA_DEMO.grtt,
      ARB_SEPOLIA_DEMO.amountSwap,
      ARB_SEPOLIA_DEMO.dryNativeTo,
    );
    expect(data.startsWith("0x")).toBe(true);
    expect(data.length).toBeGreaterThan(10);
    const hash = demoPathHash(
      ARB_SEPOLIA_DEMO.grtt,
      ARB_SEPOLIA_DEMO.amountSwap,
      ARB_SEPOLIA_DEMO.dryNativeTo,
    );
    expect(hash).toBe(keccak256(data));
    expect(hash).toBe(dryGrttFixturePathHash());
    expect(hash).not.toBe(RELAYER_DRY_PATH_HASH);
    expect(hash).not.toBe(dryGmockFixturePathHash());
  });

  it("binds tokenIn, amountSwap, and nativeTo", () => {
    const a = dryGrttFixturePathHash();
    const otherAmount = demoPathHash(
      ARB_SEPOLIA_DEMO.grtt,
      ARB_SEPOLIA_DEMO.amountSwap + 1n,
      ARB_SEPOLIA_DEMO.dryNativeTo,
    );
    const otherTo = demoPathHash(
      ARB_SEPOLIA_DEMO.grtt,
      ARB_SEPOLIA_DEMO.amountSwap,
      ARB_SEPOLIA_DEMO.relayer,
    );
    expect(a).not.toBe(otherAmount);
    expect(a).not.toBe(otherTo);
    expect(
      matchesDemoPath(
        ARB_SEPOLIA_DEMO.grtt,
        ARB_SEPOLIA_DEMO.amountSwap,
        ARB_SEPOLIA_DEMO.dryNativeTo,
        a,
      ),
    ).toBe(true);
    expect(
      matchesDemoPath(
        ARB_SEPOLIA_DEMO.grtt,
        ARB_SEPOLIA_DEMO.amountSwap,
        ARB_SEPOLIA_DEMO.dryNativeTo,
        RELAYER_DRY_PATH_HASH,
      ),
    ).toBe(false);
  });

  it("labels wallet dry fixtures instead of treating 0xbbb as live", () => {
    const arb = sampleFixtureQuote({ chainId: ARB_SEPOLIA_CHAIN_ID });
    expect(arb.pathHash).toBe(RELAYER_DRY_PATH_HASH);
    expect(quotePathStatus(arb)).toBe("wallet-dry-placeholder");
    expect(isSupportedDemoToken(arb.tokenIn)).toBe(true);

    const liveShaped = {
      ...arb,
      pathHash: dryGrttFixturePathHash(),
    };
    expect(quotePathStatus(liveShaped)).toBe("matches-demo-path");

    const bad = { ...arb, pathHash: dryGmockFixturePathHash() };
    expect(quotePathStatus(bad)).toBe("mismatch");
  });
});
