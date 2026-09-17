import { describe, expect, it } from "vitest";
import { gasRescueLensAbi, isHackQuestStatusJson, lensCallArgs, optionalLensAddress } from "./lens";
import { ARB_SEPOLIA_DEMO } from "./demoPath";

describe("GasRescueLens wallet consumer", () => {
  it("exposes status / readiness / receipt / hackQuestReport (no Permit2 setters)", () => {
    const names = gasRescueLensAbi.map((item) => ("name" in item ? item.name : ""));
    expect(names).toContain("status");
    expect(names).toContain("arbDemoReadiness");
    expect(names).toContain("rescueReceiptOrMissing");
    expect(names).toContain("hackQuestReport");
    expect(names).toContain("demoPathHash");
    expect(names).not.toContain("setPermit2Enabled");
    expect(names).not.toContain("setPermit2");
  });

  it("does not invent a Lens address", () => {
    expect(optionalLensAddress("")).toBeNull();
    expect(optionalLensAddress("not-an-address")).toBeNull();
    expect(optionalLensAddress(ARB_SEPOLIA_DEMO.swap)).toBe(ARB_SEPOLIA_DEMO.swap);
  });

  it("accepts HackQuestStatus JSON and rejects Permit2-on blobs", () => {
    const ok = JSON.stringify({
      product: "GasRescueSwap",
      buildathon: "2026-09-17-day5",
      permit2Enabled: false,
      hasRescueReceipt: false,
      lensEphemeral: true,
      grttDemoPathHash: "0x01",
      hotWalletUnderfunded: true,
      liveSubmitBlocked: true,
      recommendedJudgePath: "fixture-demo-no-top-up",
      demoVideoExists: true,
      judgeNote:
        "hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake",
      feePostureNote: "match=flat-1pct-tokenIn; amountSwap=20pct-gas-topup-not-fee; slip=100bps-fail-closed; usd-hybrid=deferred-not-a-relayer-bug; owner=Relayer-Backend-do-not-rewrite",
      liveVsTip: "live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy",
    });
    expect(isHackQuestStatusJson(ok)).toBe(true);
    expect(
      isHackQuestStatusJson(
        JSON.stringify({
          product: "GasRescueSwap",
          buildathon: "2026-09-17-day4",
          permit2Enabled: false,
          hasRescueReceipt: false,
          lensEphemeral: true,
          grttDemoPathHash: "0x01",
        }),
      ),
    ).toBe(true);
    expect(
      isHackQuestStatusJson(
        JSON.stringify({
          product: "GasRescueSwap",
          buildathon: "2026-09-14-day2",
          permit2Enabled: false,
          hasRescueReceipt: false,
          lensEphemeral: true,
          grttDemoPathHash: "0x01",
        }),
      ),
    ).toBe(true);
    expect(isHackQuestStatusJson('{"product":"GasRescueSwap","permit2Enabled":true}')).toBe(false);
    expect(isHackQuestStatusJson("not-json")).toBe(false);

    const args = lensCallArgs(
      ARB_SEPOLIA_DEMO.dryNativeTo,
      0n,
      0n,
      ARB_SEPOLIA_DEMO.dryNativeTo,
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(args[0]).toBe(ARB_SEPOLIA_DEMO.dryNativeTo);
    expect(args[2]).toBe(0n);
  });
});
