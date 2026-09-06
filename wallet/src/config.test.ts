import { describe, expect, it } from "vitest";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, relayerUrl } from "./config";

describe("relayerUrl", () => {
  it("never points Arb at the Base Relayer origin", () => {
    const arb = relayerUrl(ARB_SEPOLIA_CHAIN_ID);
    const base = relayerUrl(BASE_SEPOLIA_CHAIN_ID);
    if (arb) {
      expect(arb).not.toBe(base);
      expect(arb).not.toMatch(/2\.29\.20\.224/);
    }
  });
});

