import { describe, expect, it } from "vitest";
import configSource from "./config.ts?raw";
import copySource from "./copy.ts?raw";
import pointsClientSource from "./lib/points.ts?raw";
import pointsPageSource from "./Points.tsx?raw";
import {
  ARB_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LIVE_SDEMO_ADDRESS,
  LIVE_TDEMO_FAUCET,
  pointsApiUrl,
  relayerUrl,
  sdemoFaucetAddress,
} from "./config";
import { createPointsClient } from "./lib/points";

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

describe("sdemo faucet config", () => {
  it("uses the tDEMO faucet unless a different address is set", () => {
    expect(sdemoFaucetAddress()).toBe(LIVE_TDEMO_FAUCET);
    expect(LIVE_SDEMO_ADDRESS).toBe("0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C");
  });
});

describe("points API config", () => {
  it("uses the example client by default and does not bake a points URL", () => {
    expect(pointsApiUrl()).toBe("");
    expect(createPointsClient().source).toBe("example");
    expect(createPointsClient("").source).toBe("example");
    const sources = [configSource, pointsPageSource, copySource, pointsClientSource].join("\n");
    expect(sources).not.toMatch(/https?:\/\//i);
    expect(sources).not.toMatch(/VITE_POINTS_API_URL\s*=\s*["']https?:/i);
  });
});

