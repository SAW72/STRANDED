// @vitest-environment jsdom
// A rejected signature must leave Sign usable for another attempt.
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WagmiProvider } from "wagmi";
import { SIGNATURE_CANCELLED } from "./lib/relayerError";
import { wagmiConfig } from "./wagmi";

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RESCUE = "0x3333333333333333333333333333333333333333";

const signCalls = vi.hoisted(() => ({ n: 0 }));

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
    useSignTypedData: () => ({
      signTypedDataAsync: async () => {
        signCalls.n += 1;
        throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      },
    }),
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
  return { ...actual, submitRescue: async () => ({ ok: true, txHash: `0x${"cd".repeat(32)}`, stubRpc: false }) };
});

afterEach(() => {
  signCalls.n = 0;
  vi.unstubAllEnvs();
});

const tick = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

it("signs again after the wallet rejects the signature", async () => {
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
    const sign = () => {
      const node = container.querySelector("[data-testid='sign-order']");
      if (!(node instanceof HTMLButtonElement)) throw new Error("missing sign");
      return node;
    };
    expect(sign().disabled).toBe(false);
    await act(async () => {
      sign().click();
    });
    for (let i = 0; i < 5; i += 1) await tick();
    expect(signCalls.n).toBe(1);
    expect(container.querySelector(".danger")?.textContent).toBe(SIGNATURE_CANCELLED);
    expect(sign().disabled, "Sign should be available after a rejected signature").toBe(false);
    await act(async () => {
      sign().click();
    });
    for (let i = 0; i < 5; i += 1) await tick();
    expect(signCalls.n).toBe(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
