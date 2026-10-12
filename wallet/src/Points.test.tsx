// @vitest-environment jsdom
import { act, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARB_SEPOLIA_CHAIN_ID, transactionUrl } from "./lib/chains";
import {
  EXAMPLE_POINTS_ADDRESS,
  createPointsClient,
  type PointsClient,
  type WalletPoints,
} from "./lib/points";
import { isPointsRoute, Points } from "./Points";

const TX = `0x${"ab".repeat(32)}`;
const EMPTY_ADDRESS = "0x3333333333333333333333333333333333333333";

const loadedWallet: WalletPoints = {
  wallet: EXAMPLE_POINTS_ADDRESS,
  total: 140,
  rank: 2,
  categories: [
    { action: "rescue", points: 100, count: 1 },
    { action: "registry_find", points: 30, count: 1 },
    { action: "session", points: 10, count: 1 },
  ],
  entries: [
    { action: "rescue", points: 100, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
    { action: "registry_find", points: 30, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
    { action: "session", points: 10, txHash: null, chainId: null },
  ],
};

function client(partial: Partial<PointsClient> & Pick<PointsClient, "getWallet">): PointsClient {
  return {
    source: "http",
    getLeaderboard: () => Promise.reject(new Error("leaderboard unused")),
    ...partial,
  };
}

async function render(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(ui);
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

async function lookup(container: HTMLElement, address: string) {
  const input = container.querySelector("[data-testid='points-address']");
  const button = container.querySelector("button[type='submit']");
  if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
    throw new Error("points form is missing");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("missing input value setter");
    setter.call(input, address);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    button.click();
  });
}

describe("points route", () => {
  it("matches /points only", () => {
    expect(isPointsRoute("/points")).toBe(true);
    expect(isPointsRoute("/points/")).toBe(true);
    expect(isPointsRoute("/")).toBe(false);
    expect(isPointsRoute("/point")).toBe(false);
    expect(isPointsRoute("/points/extra")).toBe(false);
  });
});

describe("Points page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a loaded ledger with category points, total, rank, and tx links", async () => {
    const getWallet = vi.fn(async () => loadedWallet);
    const view = await render(<Points client={client({ getWallet })} />);
    await lookup(view.container, "  " + EXAMPLE_POINTS_ADDRESS.toUpperCase().replace("0X", "0x") + " ");

    expect(getWallet).toHaveBeenCalledWith(EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-loaded']")).not.toBeNull();
    expect(view.container.querySelector("[data-testid='points-total']")?.textContent).toBe("140");
    expect(view.container.querySelector("[data-testid='points-rank']")?.textContent).toBe("2");
    expect(view.container.querySelector("[data-testid='points-wallet']")?.textContent).toBe(
      EXAMPLE_POINTS_ADDRESS,
    );
    const categories = [...view.container.querySelectorAll("[data-testid='points-category']")].map(
      (node) => node.textContent,
    );
    expect(categories.join(" ")).toContain("Rescue");
    expect(categories.join(" ")).toContain("100");
    expect(categories.join(" ")).toContain("Registry find");
    expect(categories.join(" ")).toContain("30");
    expect(categories.join(" ")).toContain("Session");
    const links = [...view.container.querySelectorAll("[data-testid='points-tx']")];
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(transactionUrl(ARB_SEPOLIA_CHAIN_ID, TX));
    expect(view.container.textContent).toContain("No transaction");
    expect(view.container.textContent).toContain("nothing is promised");
    expect(view.container.textContent?.toLowerCase()).not.toContain("reward");
    expect(view.container.textContent).not.toContain("$");
    expect(view.container.textContent?.toLowerCase()).not.toContain("connect wallet");
    await view.unmount();
  });

  it("renders an empty result for a valid address with no rows", async () => {
    const getWallet = vi.fn(async (wallet: string) => ({
      wallet,
      total: 0,
      rank: null,
      categories: [],
      entries: [],
    }));
    const view = await render(<Points client={client({ source: "example", getWallet })} />);
    expect(view.container.querySelector("[data-testid='points-example']")).not.toBeNull();
    await lookup(view.container, EMPTY_ADDRESS);
    expect(getWallet).toHaveBeenCalledWith(EMPTY_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-empty']")?.textContent).toMatch(/no points/i);
    expect(view.container.querySelector("[data-testid='points-loaded']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-disclaimer']")?.textContent).toMatch(/not a token/i);
    await view.unmount();
  });

  it("shows a plain error for an invalid address and does not call the client", async () => {
    const getWallet = vi.fn();
    const view = await render(<Points client={client({ getWallet })} />);
    await lookup(view.container, "not-an-address");
    expect(getWallet).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-testid='points-invalid']")?.textContent).toBe(
      "Enter a valid wallet address.",
    );
    expect(view.container.querySelector("[data-testid='points-loaded']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-error']")).toBeNull();
    await view.unmount();
  });

  it("renders the error state when the client fails", async () => {
    const getWallet = vi.fn(async () => {
      throw new Error("down");
    });
    const view = await render(<Points client={client({ getWallet })} />);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-error']")?.textContent).toMatch(/couldn’t load points/i);
    expect(view.container.querySelector("[data-testid='points-loaded']")).toBeNull();
    expect(view.container.textContent).not.toContain("down");
    expect(view.container.querySelector("button[type='submit']")).not.toBeNull();
    expect(view.container.textContent?.toLowerCase()).not.toContain("connect");
    await view.unmount();
  });

  it("shows Example data on each example result, including after the page banner", async () => {
    const getWallet = vi.fn(async (wallet: string) => {
      if (wallet === EMPTY_ADDRESS) {
        return { wallet, total: 0, rank: null, categories: [], entries: [] };
      }
      return loadedWallet;
    });
    const view = await render(<Points client={client({ source: "example", getWallet })} />);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);

    const loaded = view.container.querySelector("[data-testid='points-loaded']");
    expect(loaded).not.toBeNull();
    const loadedResults = [...(loaded?.querySelectorAll("[data-testid='points-result']") ?? [])];
    expect(loadedResults.length).toBeGreaterThan(0);
    for (const result of loadedResults) {
      expect(result.querySelector("[data-testid='points-result-example']")?.textContent).toBe("Example data");
    }
    for (const row of loaded?.querySelectorAll("[data-testid='points-category'], [data-testid='points-entry']") ?? []) {
      expect(row.querySelector("[data-testid='points-result-example']")?.textContent).toBe("Example data");
    }

    await lookup(view.container, EMPTY_ADDRESS);
    const empty = view.container.querySelector("[data-testid='points-empty']");
    expect(empty?.querySelector("[data-testid='points-result-example']")?.textContent).toBe("Example data");
    expect(view.container.querySelector("[data-testid='points-loaded']")).toBeNull();
    await view.unmount();
  });

  it("uses the example client from the page default without a baked URL", async () => {
    expect(createPointsClient().source).toBe("example");
    const view = await render(<Points />);
    expect(view.container.querySelector("[data-testid='points-example']")?.textContent).toMatch(/example data/i);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-total']")?.textContent).toBe("140");
    const href = view.container.querySelector("[data-testid='points-tx']")?.getAttribute("href") ?? "";
    expect(href.startsWith("https://sepolia.arbiscan.io/tx/")).toBe(true);
    await view.unmount();
  });
});
