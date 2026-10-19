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
import { POINTS_DISCLAIMER, POINTS_INTRO, POINTS_WEIGHTS_NOTE } from "./copy";
import { EXCLUDED_POINTS_ACTIONS } from "../../shared/excludedPointsActions.mjs";
import copySource from "./copy.ts?raw";
import pointsPageSource from "./Points.tsx?raw";
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

  it("renders a loaded ledger with category points and tx links, without total or rank", async () => {
    const getWallet = vi.fn(async () => loadedWallet);
    const view = await render(<Points client={client({ getWallet })} />);
    await lookup(view.container, "  " + EXAMPLE_POINTS_ADDRESS.toUpperCase().replace("0X", "0x") + " ");

    expect(getWallet).toHaveBeenCalledWith(EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-loaded']")).not.toBeNull();
    expect(view.container.querySelector("[data-testid='points-total']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-rank']")).toBeNull();
    expect(view.container.textContent).not.toMatch(/\bTotal\b/);
    expect(view.container.textContent).not.toMatch(/\bRank\b/);
    expect(view.container.querySelector("[data-testid='points-disclaimer']")?.textContent).toBe(POINTS_DISCLAIMER);
    expect(view.container.textContent).toContain(POINTS_INTRO);
    const weights = view.container.querySelector("[data-testid='points-weights']");
    expect(weights?.textContent).toBe(POINTS_WEIGHTS_NOTE);
    const categoryBlock = [...view.container.querySelectorAll("[data-testid='points-result']")].find((node) =>
      node.textContent?.includes("By category"),
    );
    expect(categoryBlock?.textContent).toContain(POINTS_WEIGHTS_NOTE);
    expect(view.container.querySelector("[data-testid='points-wallet']")?.textContent).toBe(
      EXAMPLE_POINTS_ADDRESS,
    );
    const categories = [...view.container.querySelectorAll("[data-testid='points-category']")].map(
      (node) => node.textContent,
    );
    expect(categories.join(" ")).toContain("Rescue");
    expect(categories.join(" ")).toContain("100");
    const rescueRow = categories.find((text) => text.includes("100") && text.includes("Rescue"));
    expect(rescueRow).not.toMatch(/placeholder|TBD/);
    expect(categories.join(" ")).toContain("Registry find");
    expect(categories.join(" ")).toContain("30");
    expect(categories.join(" ")).toContain("Session");
    const links = [...view.container.querySelectorAll("[data-testid='points-tx']")];
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(transactionUrl(ARB_SEPOLIA_CHAIN_ID, TX));
    expect(view.container.textContent).toContain("No transaction");
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
    expect(view.container.querySelector("[data-testid='points-weights']")).toBeNull();
    expect(view.container.textContent).not.toContain(POINTS_WEIGHTS_NOTE);
    expect(view.container.querySelector("[data-testid='points-disclaimer']")?.textContent).toMatch(/not a token/i);
    await view.unmount();
  });

  it("shows a plain error for an invalid address and does not call the client", async () => {
    const getWallet = vi.fn();
    const view = await render(<Points client={client({ getWallet })} />);
    await lookup(view.container, "not-an-address");
    expect(getWallet).not.toHaveBeenCalled();
    const error = view.container.querySelector("[data-testid='points-invalid']");
    const input = view.container.querySelector("[data-testid='points-address']");
    expect(error?.textContent).toBe("Enter a valid wallet address.");
    expect(error?.id).toBe("points-address-error");
    expect(input?.getAttribute("aria-describedby")).toBe("points-address-error");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
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

  for (const action of EXCLUDED_POINTS_ACTIONS) {
    it(`hides ${action} beside a rescue row`, async () => {
      const beside: WalletPoints = {
        wallet: EXAMPLE_POINTS_ADDRESS,
        total: 117,
        rank: 1,
        categories: [
          { action: "rescue", points: 100, count: 1 },
          { action, points: 17, count: 1 },
        ],
        entries: [
          { action: "rescue", points: 100, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
          { action, points: 17, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
        ],
      };
      const view = await render(<Points client={client({ getWallet: async () => beside })} />);
      await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
      const categories = [...view.container.querySelectorAll("[data-testid='points-category']")].map(
        (node) => node.textContent ?? "",
      );
      const entries = [...view.container.querySelectorAll("[data-testid='points-entry']")].map(
        (node) => node.textContent ?? "",
      );
      expect(categories).toHaveLength(1);
      expect(entries).toHaveLength(1);
      expect(categories[0]).toContain("Rescue");
      expect(categories[0]).toContain("100");
      expect(entries[0]).toContain("Rescue");
      expect(`${categories.join(" ")}\n${entries.join(" ")}`).not.toContain("17");
      expect(`${categories.join(" ")}\n${entries.join(" ")}`).not.toContain(action);
      expect(view.container.querySelector("[data-testid='points-weights']")?.textContent).toBe(POINTS_WEIGHTS_NOTE);
      await view.unmount();
    });
  }

  it("shows an action that is not on the excluded list beside rescue", async () => {
    const beside: WalletPoints = {
      wallet: EXAMPLE_POINTS_ADDRESS,
      total: 117,
      rank: 1,
      categories: [
        { action: "rescue", points: 100, count: 1 },
        { action: "audit", points: 17, count: 1 },
      ],
      entries: [
        { action: "rescue", points: 100, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
        { action: "audit", points: 17, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
      ],
    };
    const view = await render(<Points client={client({ getWallet: async () => beside })} />);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    const categories = [...view.container.querySelectorAll("[data-testid='points-category']")].map(
      (node) => node.textContent ?? "",
    );
    const entries = [...view.container.querySelectorAll("[data-testid='points-entry']")].map(
      (node) => node.textContent ?? "",
    );
    expect(categories).toHaveLength(2);
    expect(entries).toHaveLength(2);
    expect(categories.join(" ")).toContain("Rescue");
    expect(categories.join(" ")).toContain("100");
    expect(categories.join(" ")).toContain("17");
    expect(entries.join(" ")).toContain("17");
    await view.unmount();
  });

  it("hides excluded actions in categories and entries and still shows rescue", async () => {
    const excluded = ["bug_report", "security", "security_finding", "finding"] as const;
    const hidden: WalletPoints = {
      wallet: EXAMPLE_POINTS_ADDRESS,
      total: 100,
      rank: 1,
      categories: [
        { action: "rescue", points: 100, count: 1 },
        ...excluded.map((action, index) => ({ action, points: 200 + index, count: 1 })),
      ],
      entries: [
        { action: "rescue", points: 100, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
        ...excluded.map((action, index) => ({
          action,
          points: 200 + index,
          txHash: TX,
          chainId: ARB_SEPOLIA_CHAIN_ID,
        })),
      ],
    };
    const view = await render(<Points client={client({ getWallet: async () => hidden })} />);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);

    const categories = [...view.container.querySelectorAll("[data-testid='points-category']")].map(
      (node) => node.textContent ?? "",
    );
    const entries = [...view.container.querySelectorAll("[data-testid='points-entry']")].map(
      (node) => node.textContent ?? "",
    );
    expect(categories).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(categories[0]).toContain("Rescue");
    expect(categories[0]).toContain("100");
    expect(categories[0]).not.toMatch(/placeholder|TBD/);
    expect(entries[0]).toContain("Rescue");
    expect(entries[0]).toContain("100");
    const visible = `${categories.join("\n")}\n${entries.join("\n")}`;
    for (const [index, action] of excluded.entries()) {
      expect(visible).not.toContain(action);
      expect(visible).not.toContain(String(200 + index));
    }
    expect(visible).not.toContain("Other");
    await view.unmount();
  });

  it("shows the empty state when every row is an excluded action", async () => {
    const excludedOnly: WalletPoints = {
      wallet: EXAMPLE_POINTS_ADDRESS,
      total: 500,
      rank: 1,
      categories: [
        { action: "bug_report", points: 500, count: 1 },
        { action: "security", points: 300, count: 1 },
        { action: "security_finding", points: 200, count: 1 },
        { action: "finding", points: 100, count: 1 },
      ],
      entries: [
        { action: "bug_report", points: 500, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
        { action: "security", points: 300, txHash: TX, chainId: ARB_SEPOLIA_CHAIN_ID },
        { action: "security_finding", points: 200, txHash: null, chainId: null },
        { action: "finding", points: 100, txHash: null, chainId: null },
      ],
    };
    const view = await render(<Points client={client({ getWallet: async () => excludedOnly })} />);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-loaded']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-empty']")?.textContent).toMatch(/no points/i);
    expect(view.container.querySelector("[data-testid='points-category']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-entry']")).toBeNull();
    expect(view.container.textContent).not.toMatch(/bug_report|security_finding|finding|\bsecurity\b|Other/);
    await view.unmount();
  });

  it("rejects a bug report label in the points source", () => {
    const points = pointsPageSource;
    const copy = copySource;
    expect(points).not.toMatch(/["']Bug report["']/);
    expect(points).not.toMatch(/POINTS_ACTION_BUG_REPORT/);
    expect(copy).not.toMatch(/Bug report/);
    expect(points).not.toMatch(/^\s*(bug_report|security|security_finding|finding)\s*:/m);
    expect(copy).not.toMatch(/bug_report|security_finding|Security finding|Finding report|POINTS_ACTION_BUG_REPORT/);
    expect(copy).toContain('POINTS_ACTION_RESCUE = "Rescue"');
    expect(copy).not.toMatch(/placeholder, TBD/);
    expect(copy).toContain(POINTS_DISCLAIMER);
    expect(copy).toContain(POINTS_INTRO);
    expect(copy).toContain('POINTS_ACTION_REGISTRY_CLAIM = "Registry claim"');
    expect(points).not.toMatch(/data-testid=["']points-total["']/);
    expect(points).not.toMatch(/data-testid=["']points-rank["']/);
    expect(points).not.toMatch(/POINTS_TOTAL_LABEL|POINTS_RANK_LABEL|POINTS_UNRANKED/);
  });

  it("labels a ledger wallet_session as Session", async () => {
    const view = await render(
      <Points
        client={client({
          getWallet: () =>
            Promise.resolve({
              wallet: EXAMPLE_POINTS_ADDRESS,
              total: 10,
              rank: null,
              categories: [{ action: "wallet_session", points: 10, count: 1 }],
              entries: [{ action: "wallet_session", points: 10, txHash: null, chainId: null }],
            }),
        })}
      />,
    );
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    const visible = [...view.container.querySelectorAll("[data-testid='points-category'], [data-testid='points-entry']")]
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(visible).toContain("Session");
    expect(visible).toContain("10");
    expect(visible).not.toContain("Other");
    expect(visible).not.toContain("wallet_session");
    await view.unmount();
  });

  it("explains how points are recorded and links back home", async () => {
    const view = await render(<Points />);
    const how = view.container.querySelector("[data-testid='points-how']");
    expect(how?.id).toBe("how-points-are-recorded");
    expect(how?.textContent).toMatch(/How points are recorded/);
    expect(how?.textContent).toMatch(/completed rescues/);
    expect(how?.textContent).toMatch(/relayer jobs/);
    expect(how?.textContent).toMatch(/registry finds posted or claimed/);
    expect(how?.textContent).toMatch(/10 per week for an active wallet session/);
    expect(how?.textContent).toMatch(/off-chain/);
    expect(how?.textContent).toMatch(/no value/);
    expect(how?.textContent).toMatch(/not a token/);
    expect(how?.textContent).toMatch(/can't be transferred/);
    expect(how?.textContent).not.toMatch(/\b100\b/);
    expect(how?.textContent).not.toMatch(/placeholder/i);
    const home = view.container.querySelector("[data-testid='points-home']");
    expect(home?.getAttribute("href")).toBe("/");
    expect(home?.textContent).toBe("Back to home");
    await view.unmount();
  });

  it("scrolls to the how section when that hash is opened", async () => {
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(arg) {
      if (this.id === "how-points-are-recorded") calls.push(arg);
    };
    const previousMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;
    window.location.hash = "#how-points-are-recorded";
    const view = await render(<Points />);
    expect(calls).toEqual([{ behavior: "smooth", block: "start" }]);
    await view.unmount();
    HTMLElement.prototype.scrollIntoView = previous;
    window.matchMedia = previousMedia;
    window.location.hash = "";
  });

  it("scrolls to the how section without motion when reduced motion is set", async () => {
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(arg) {
      if (this.id === "how-points-are-recorded") calls.push(arg);
    };
    const previousMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;
    window.location.hash = "#how-points-are-recorded";
    const view = await render(<Points />);
    expect(calls).toEqual([{ behavior: "auto", block: "start" }]);
    await view.unmount();
    HTMLElement.prototype.scrollIntoView = previous;
    window.matchMedia = previousMedia;
    window.location.hash = "";
  });

  it("uses the example client from the page default without a baked URL", async () => {
    expect(createPointsClient().source).toBe("example");
    const view = await render(<Points />);
    expect(view.container.querySelector("[data-testid='points-example']")?.textContent).toMatch(/example data/i);
    await lookup(view.container, EXAMPLE_POINTS_ADDRESS);
    expect(view.container.querySelector("[data-testid='points-total']")).toBeNull();
    expect(view.container.querySelector("[data-testid='points-rank']")).toBeNull();
    expect(view.container.textContent).not.toMatch(/\bTotal\b/);
    expect(view.container.textContent).not.toMatch(/\bRank\b/);
    expect(view.container.textContent).toContain("Rescue");
    expect(view.container.textContent).not.toMatch(/placeholder, TBD/);
    const href = view.container.querySelector("[data-testid='points-tx']")?.getAttribute("href") ?? "";
    expect(href.startsWith("https://sepolia.arbiscan.io/tx/")).toBe(true);
    await view.unmount();
  });
});
