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

describe("App routes", () => {
  it("renders Points at /points", async () => {
    const view = await renderAt("/points", <App />);
    expect(view.container.querySelector("[data-testid='points-address']")).not.toBeNull();
    const how = view.container.querySelector("[data-testid='points-how']");
    expect(how?.id).toBe("how-points-are-recorded");
    expect(how?.textContent).toMatch(/How points are recorded/);
    expect(view.container.querySelector("[data-testid='points-home']")?.getAttribute("href")).toBe("/");
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).toBeNull();
    await view.unmount();
  });

  it("hides the quote and keeps confirm and sign locked when no wallet is connected", async () => {
    const view = await renderAt("/", <App />);
    expect(view.container.querySelector("[data-testid='points-address']")).toBeNull();
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).toBeNull();
    expect(view.container.querySelector(".review-row")).toBeNull();
    expect(view.container.querySelector("[data-testid='rescue-quote-collapsed']")?.textContent).toBe(
      "Connect a wallet to see the rescue quote.",
    );
    expect(button(view.container, "confirm-details").disabled).toBe(true);
    expect(button(view.container, "sign-order").disabled).toBe(true);
    expect(view.container.textContent).not.toContain("Details confirmed. You can sign next.");
    const disclosures = view.container.querySelectorAll("[data-testid='token-disclosure']");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.textContent).not.toMatch(/\bGRTT\b/);
    const banner = view.container.querySelector("[data-testid='demo-banner']")?.textContent ?? "";
    expect(banner).toBe(UNKNOWN_DEMO_BANNER);
    expect(banner).not.toMatch(/\bGRTT\b/);
    expect(banner).not.toMatch(/this token/i);
    await view.unmount();
  });

  it("hides quote rows and locks confirm when a wallet is connected without a quote", async () => {
    vi.stubEnv("VITE_RELAYER_URL_ARB_SEPOLIA", "local-sample-off");
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const view = await renderAt("/", <App />);
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).toBeNull();
    expect(view.container.querySelector(".review-row")).toBeNull();
    expect(view.container.querySelector("[data-testid='rescue-quote-collapsed']")?.textContent).toBe(
      "Enter an amount to see a quote.",
    );
    expect(button(view.container, "confirm-details").disabled).toBe(true);
    expect(button(view.container, "sign-order").disabled).toBe(true);
    await act(async () => {
      button(view.container, "confirm-details").click();
    });
    expect(view.container.textContent).not.toContain("Details confirmed. You can sign next.");
    expect(button(view.container, "sign-order").disabled).toBe(true);
    await view.unmount();
  });

  it("shows the quote and unlocks confirm only after a wallet is connected", async () => {
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const view = await renderAt("/", <App />);
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).not.toBeNull();
    const rows = [...view.container.querySelectorAll(".review-row")];
    expect(rows.length).toBeGreaterThan(0);
    expect(view.container.querySelector("[data-testid='rescue-quote-collapsed']")).toBeNull();
    const values = rows.map((row) => row.querySelector(".review-value")?.textContent ?? "").join("\n");
    expect(values).toMatch(/SDEMO/);
    expect(values).not.toMatch(/\bGRTT\b/);
    for (const row of rows) {
      expect(row.querySelector(".review-value")?.textContent).not.toBe("—");
    }
    const confirm = button(view.container, "confirm-details");
    const sign = button(view.container, "sign-order");
    expect(confirm.disabled).toBe(false);
    expect(sign.disabled).toBe(true);
    await act(async () => {
      confirm.click();
    });
    expect(view.container.textContent).toContain("Details confirmed. You can sign next.");
    expect(button(view.container, "sign-order").disabled).toBe(false);
    expect(view.container.querySelector("[data-testid='demo-banner']")?.textContent).toBe(
      UNKNOWN_DEMO_BANNER,
    );
    expect(view.container.querySelector("[data-testid='sample-banner']")?.textContent).toContain(
      SAMPLE_BADGE,
    );
    await view.unmount();
  });

  it("renders SDEMO when the on-chain symbol is empty", async () => {
    readState.symbol = "";
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const view = await renderAt("/", <App />);
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")?.textContent).toMatch(/SDEMO/);
    expect(view.container.textContent).not.toMatch(/\bGRTT\b/);
    expect(view.container.querySelector("[data-testid='sample-banner']")?.textContent).toContain(
      SAMPLE_BADGE,
    );
    await view.unmount();
  });

  it("renders SDEMO when the chain reports GRTT or gMOCK", async () => {
    readState.symbol = "GRTT";
    accountState.address = WALLET;
    accountState.isConnected = true;
    accountState.chainId = ARB_SEPOLIA_CHAIN_ID;
    const grtt = await renderAt("/", <App />);
    const grttRows = grtt.container.querySelector("[data-testid='rescue-quote-fields']")?.textContent ?? "";
    expect(grttRows).toMatch(/SDEMO/);
    expect(grtt.container.textContent).not.toMatch(/\bGRTT\b/);
    expect(grtt.container.querySelector("[data-testid='sample-banner']")?.textContent).toContain(SAMPLE_BADGE);
    expect(grtt.container.querySelector("[data-testid='demo-banner']")?.textContent).toBe(UNKNOWN_DEMO_BANNER);
    await grtt.unmount();

    readState.symbol = "gMOCK";
    const gmock = await renderAt("/", <App />);
    expect(gmock.container.querySelector("[data-testid='rescue-quote-fields']")?.textContent).toMatch(/SDEMO/);
    expect(gmock.container.textContent).not.toMatch(/\bgMOCK\b/);
    expect(gmock.container.textContent).not.toMatch(/\bGRTT\b/);
    expect(gmock.container.querySelector("[data-testid='sample-banner']")?.textContent).toContain(SAMPLE_BADGE);
    await gmock.unmount();
  });

  it("shows SDEMO on the token row when a token is configured", async () => {
    vi.stubEnv("VITE_TOKEN_ADDRESS_ARB_SEPOLIA", WALLET);

    function tokenRow(container: HTMLElement): string {
      const dt = [...container.querySelectorAll("dt")].find((node) => node.textContent === "Token");
      const dd = dt?.nextElementSibling;
      if (!(dd instanceof HTMLElement)) throw new Error("missing token row");
      return dd.textContent ?? "";
    }

    readState.symbol = "GRTT";
    const grtt = await renderAt("/", <App />);
    const grttToken = tokenRow(grtt.container);
    expect(grttToken).toMatch(/SDEMO/);
    expect(grttToken).not.toMatch(/\bGRTT\b/);
    expect(grttToken).not.toBe("not configured");
    await grtt.unmount();

    readState.symbol = "";
    const empty = await renderAt("/", <App />);
    const emptyToken = tokenRow(empty.container);
    expect(emptyToken).toMatch(/SDEMO/);
    expect(emptyToken).not.toMatch(/\bToken\b/);
    expect(emptyToken).not.toBe("not configured");
    await empty.unmount();
  });

  it("names Base Sepolia in the disclosure when that network is selected", async () => {
    const view = await renderAt("/", <App />);
    const disclosure = () => view.container.querySelector("[data-testid='token-disclosure']")?.textContent ?? "";
    expect(disclosure()).toContain("Arbitrum Sepolia");
    const base = [...view.container.querySelectorAll("button")].find((button) => button.textContent === "Base Sepolia");
    if (!(base instanceof HTMLButtonElement)) throw new Error("missing Base Sepolia");
    await act(async () => {
      base.click();
    });
    expect(disclosure()).toContain("Base Sepolia");
    expect(disclosure()).not.toContain("Arbitrum");
    await view.unmount();
  });
});
