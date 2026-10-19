// @vitest-environment jsdom
// Two sign clicks in one turn must post once.
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
    useAccount: () => ({
      address: WALLET,
      isConnected: true,
      chainId: 421614,
      addresses: [WALLET],
      status: "connected",
      connector: undefined,
      isConnecting: false,
      isReconnecting: false,
      isDisconnected: false,
    }),
    usePublicClient: () => ({}),
    useSwitchChain: () => ({ switchChain: () => {} }),
    useSignTypedData: () => ({ signTypedDataAsync: async () => `0x${"11".repeat(32)}${"22".repeat(32)}1b` }),
    useReadContract: (params?: { functionName?: string }) => {
      if (params?.functionName === "symbol") {
        return { data: "GRTT", isPending: false, isLoading: false, isError: false, status: "success" };
      }
      if (params?.functionName === "decimals") return { data: 18, isPending: false, isError: false, status: "success" };
      return { data: false, isPending: false, isError: false, status: "success", refetch: async () => ({ data: false }) };
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
    fetchRescueQuote: async () => ({
      ok: true,
      source: "relayer",
      quote: sampleFixtureQuote({ chainId: 421614, user: WALLET, tokenIn: TOKEN, tokenSymbol: "GRTT" }),
    }),
  };
});

vi.mock("./lib/rescues", async () => {
  const actual = await vi.importActual<typeof import("./lib/rescues")>("./lib/rescues");
  return {
    ...actual,
    submitRescue: async () => {
      const bucket = globalThis as { __signPosts?: number };
      bucket.__signPosts = (bucket.__signPosts ?? 0) + 1;
      return { ok: true, txHash: `0x${"ab".repeat(32)}`, stubRpc: false };
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __signPosts?: number }).__signPosts;
});

const tick = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

it("a second sign click in the same turn does not post again", async () => {
  (globalThis as { __signPosts?: number }).__signPosts = 0;
  vi.stubEnv("VITE_RELAYER_URL_ARB_SEPOLIA", "https://relayer.example.invalid");
  vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", TOKEN);
  vi.stubEnv("VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA", RESCUE);
  vi.stubEnv("VITE_RELAYER_URL", "");
  vi.stubEnv("VITE_RELAYER_BASE_URL", "");
  vi.stubEnv("RELAYER_BASE_URL", "");
  const { App } = await import("./App");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <App />
          </QueryClientProvider>
        </WagmiProvider>,
      );
    });
    await tick();
    const input = container.querySelector("input[inputmode='decimal']");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing amount");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let i = 0; i < 5; i += 1) await tick();
    const confirm = container.querySelector("[data-testid='confirm-details']");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("missing confirm");
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      confirm.click();
    });
    const sign = container.querySelector("[data-testid='sign-order']");
    if (!(sign instanceof HTMLButtonElement)) throw new Error("missing sign");
    expect(sign.disabled).toBe(false);
    await act(async () => {
      sign.click();
      sign.click();
    });
    for (let i = 0; i < 5; i += 1) await tick();
    expect((globalThis as { __signPosts?: number }).__signPosts).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
