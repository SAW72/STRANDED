// @vitest-environment jsdom
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wagmi";

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RESCUE = "0x3333333333333333333333333333333333333333";

vi.mock("wagmi", async () => {
  const actual = await vi.importActual<typeof import("wagmi")>("wagmi");
  return {
    ...actual,
    useAccount: () => ({ address: WALLET, isConnected: true, chainId: 421614, addresses: [WALLET], status: "connected", connector: undefined, isConnecting: false, isReconnecting: false, isDisconnected: false }),
    usePublicClient: () => ({}),
    useSwitchChain: () => ({ switchChain: () => {} }),
    useSignTypedData: () => ({ signTypedDataAsync: async () => `0x${"11".repeat(32)}${"22".repeat(32)}1b` }),
    useReadContract: (p?: { functionName?: string }) => {
      if (p?.functionName === "symbol") return { data: "GRTT" };
      if (p?.functionName === "decimals") return { data: 18 };
      return { data: false, refetch: async () => ({ data: false }) };
    },
  };
});
vi.mock("./lib/holdings", () => ({
  readLiveHoldings: async () => ({ tokenBalance: 10n ** 24n, nativeBalance: 0n }),
  readLivePermitAuth: async () => ({ tokenName: "Fake", permitNonce: 0n }),
}));
vi.mock("./lib/quotes", async () => {
  const actual = await vi.importActual<typeof import("./lib/quotes")>("./lib/quotes");
  const { sampleFixtureQuote } = await vi.importActual<typeof import("./lib/fixture")>("./lib/fixture");
  return {
    ...actual,
    fetchRescueQuote: async () => ({ ok: true, source: "relayer", quote: sampleFixtureQuote({ chainId: 421614, user: WALLET, tokenIn: TOKEN, tokenSymbol: "GRTT" }) }),
  };
});
vi.mock("./lib/rescues", async () => {
  const actual = await vi.importActual<typeof import("./lib/rescues")>("./lib/rescues");
  return { ...actual, submitRescue: async () => ({ ok: true, txHash: `0x${"ab".repeat(32)}`, stubRpc: false }) };
});

afterEach(() => vi.unstubAllEnvs());

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

it("hides a live receipt after switching into sample mode", async () => {
  vi.stubEnv("VITE_RELAYER_URL_ARB_SEPOLIA", "https://relayer.example.invalid");
  vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", TOKEN);
  vi.stubEnv("VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA", RESCUE);
  vi.stubEnv("VITE_RELAYER_URL", "");
  vi.stubEnv("VITE_RELAYER_BASE_URL", "");
  vi.stubEnv("RELAYER_BASE_URL", "");
  const { App } = await import("./App");
  const c = document.createElement("div");
  document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => {
    root.render(<WagmiProvider config={wagmiConfig} reconnectOnMount={false}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider></WagmiProvider>);
  });
  await tick();
  const input = c.querySelector("input[inputmode='decimal']") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (let i = 0; i < 5; i++) await tick();
  const confirm = c.querySelector("[data-testid='confirm-details']") as HTMLButtonElement;
  expect(confirm.disabled, "confirm should unlock on live quote").toBe(false);
  await act(async () => confirm.click());
  const sign = c.querySelector("[data-testid='sign-order']") as HTMLButtonElement;
  await act(async () => sign.click());
  for (let i = 0; i < 5; i++) await tick();
  const receipt = () => c.querySelector("[data-testid='rescue-receipt']")?.textContent ?? "";
  expect(receipt(), c.querySelector(".danger")?.textContent ?? "no receipt").toMatch(/GRTT/); // live mode: real ticker is fine
  const base = [...c.querySelectorAll(".chain-switch button")].find((b) => /Base/.test(b.textContent ?? "")) as HTMLButtonElement;
  await act(async () => base.click());
  for (let i = 0; i < 3; i++) await tick();
  const page = c.textContent ?? "";
  // Requirement: sample/demo mode must never show a real ticker.
  expect(page).not.toMatch(/\bGRTT\b/);
  await act(async () => root.unmount());
});
