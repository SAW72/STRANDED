// @vitest-environment jsdom
import { act, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { wagmiConfig } from "./wagmi";

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
  window.history.pushState({}, "", "/");
});

describe("App routes", () => {
  it("renders Points at /points", async () => {
    const view = await renderAt("/points", <App />);
    expect(view.container.querySelector("[data-testid='points-address']")).not.toBeNull();
    expect(view.container.querySelector("[data-testid='points-how']")?.textContent).toMatch(
      /How points are recorded/,
    );
    expect(view.container.querySelector("[data-testid='points-home']")?.getAttribute("href")).toBe("/");
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).toBeNull();
    await view.unmount();
  });

  it("hides rescue quote fields when no wallet is connected", async () => {
    const view = await renderAt("/", <App />);
    expect(view.container.querySelector("[data-testid='points-address']")).toBeNull();
    expect(view.container.querySelector("[data-testid='rescue-quote-fields']")).toBeNull();
    expect(view.container.querySelector(".review-row")).toBeNull();
    expect(view.container.querySelector("[data-testid='rescue-quote-collapsed']")?.textContent).toMatch(
      /connect a wallet/i,
    );
    const disclosures = view.container.querySelectorAll("[data-testid='token-disclosure']");
    expect(disclosures).toHaveLength(1);
    expect(view.container.querySelector("[data-testid='demo-banner']")?.textContent ?? "").not.toMatch(
      /this token/i,
    );
    await view.unmount();
  });
});
