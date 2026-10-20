// @vitest-environment jsdom
import { act, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { ARB_SEPOLIA_CHAIN_ID } from "./lib/chains";
import { SAMPLE_BADGE } from "./copy";
import { UNKNOWN_DEMO_BANNER } from "./lib/tokenDisclosure";
import { wagmiConfig } from "./wagmi";

const WALLET = "0x1111111111111111111111111111111111111111" as const;

const accountState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
  chainId: undefined as number | undefined,
}));

const readState = vi.hoisted(() => ({
  symbol: undefined as unknown,
}));

vi.mock("./lib/holdings", () => ({
  readLiveHoldings: async () => ({ tokenBalance: 10n ** 24n, nativeBalance: 0n }),
  readLivePermitAuth: async () => ({ tokenName: "Sample", permitNonce: 0n }),
}));

vi.mock("wagmi", async () => {
  const actual = await vi.importActual<typeof import("wagmi")>("wagmi");
  return {
    ...actual,
    useAccount: () => ({
      address: accountState.address,
      isConnected: accountState.isConnected,
      chainId: accountState.chainId,
      addresses: accountState.address ? [accountState.address] : undefined,
      status: accountState.isConnected ? "connected" : "disconnected",
      connector: undefined,
      isConnecting: false,
      isReconnecting: false,
      isDisconnected: !accountState.isConnected,
    }),
    usePublicClient: () => undefined,
    useReadContract: ((params?: { functionName?: string }) => {
      if (params?.functionName === "symbol") return { data: readState.symbol };
      return { data: undefined };
    }) as typeof actual.useReadContract,
  };
});

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const node = container.querySelector(`[data-testid='${testId}']`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing ${testId}`);
  return node;
}

async function renderAt(pathname: string, ui: ReactElement) {
  window.history.pushState({}, "", pathname);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </WagmiProvider>,
    );
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  accountState.address = undefined;
  accountState.isConnected = false;
  accountState.chainId = undefined;
  readState.symbol = undefined;
  vi.unstubAllEnvs();
  window.history.pushState({}, "", "/");
});

describe("sample mode ticker", () => {
  it("sample mode with a configured GRTT token shows no GRTT anywhere (per element)", async () => {
    vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", WALLET);
    readState.symbol = "GRTT";
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const view = await renderAt("/", <App />);
    const c = view.container;
    const parts: Record<string, string> = {
      banner: c.querySelector("[data-testid='demo-banner']")?.textContent ?? "",
      disclosure: [...c.querySelectorAll("[data-testid='token-disclosure']")].map((n) => n.textContent).join("|"),
      sample: c.querySelector("[data-testid='sample-banner']")?.textContent ?? "",
      rows: [...c.querySelectorAll(".review-row")].map((r) => r.textContent).join("|"),
      dd: [...c.querySelectorAll("dd")].map((n) => n.textContent).join("|"),
    };
    expect(parts.rows.length).toBeGreaterThan(0);
    expect(parts.rows).toContain("SDEMO");
    for (const [k, v] of Object.entries(parts)) expect(v.includes("GRTT"), `${k}: ${v}`).toBe(false);
    expect((c.textContent ?? "").includes("GRTT")).toBe(false);
    expect(parts.sample).toContain(SAMPLE_BADGE);
    expect(parts.banner).toBe(UNKNOWN_DEMO_BANNER);
    await view.unmount();
  });

  it("keeps confirm available once the sample rows are on screen", async () => {
    vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", WALLET);
    readState.symbol = "GRTT";
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const view = await renderAt("/", <App />);
    expect(button(view.container, "confirm-details").disabled).toBe(false);
    await view.unmount();
  });
});
