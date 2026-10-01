import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_ARB_GRTT, liveDemoToken } from "./demoToken";
import { isSupportedDemoToken } from "./demoPath";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("live demo token", () => {
  it("defaults to live GRTT when the env override is empty", () => {
    vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", "");
    expect(liveDemoToken()).toBe(LIVE_ARB_GRTT);
  });

  it("uses VITE_TOKEN_ADDRESS_ARB_SEPOLIA when set", () => {
    const next = "0x0000000000000000000000000000000000000001";
    vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", next);
    expect(liveDemoToken().toLowerCase()).toBe(next);
    expect(isSupportedDemoToken(liveDemoToken())).toBe(true);
  });
});
