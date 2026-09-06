import { describe, expect, it } from "vitest";
import {
  connectErrorMessage,
  createConnectGuard,
  isAlreadyPendingError,
  isGenericInjectedConnector,
  orderWalletConnectors,
  withSingleInFlightRequest,
} from "./connectors";

const injected = { id: "injected", name: "Injected" };
const phantom = { id: "app.phantom", name: "Phantom" };
const metaMask = { id: "io.metamask", name: "MetaMask" };
const rabby = { id: "io.rabby", name: "Rabby" };

describe("orderWalletConnectors", () => {
  it("keeps announced wallets in discovery order and puts generic injected last", () => {
    expect(orderWalletConnectors([injected, phantom, metaMask, rabby])).toEqual([
      phantom,
      metaMask,
      rabby,
      injected,
    ]);
  });

  it("does not hardcode MetaMask first", () => {
    const ordered = orderWalletConnectors([injected, phantom, metaMask]);
    expect(ordered[0]).toEqual(phantom);
    expect(ordered.map((c) => c.id)).not.toEqual(["io.metamask", "app.phantom", "injected"]);
  });

  it("dedupes by id", () => {
    expect(orderWalletConnectors([phantom, phantom, injected, injected])).toEqual([phantom, injected]);
  });

  it("returns only generic injected when nothing else is announced", () => {
    expect(orderWalletConnectors([injected])).toEqual([injected]);
  });
});

describe("isGenericInjectedConnector", () => {
  it("matches the bare injected id only", () => {
    expect(isGenericInjectedConnector(injected)).toBe(true);
    expect(isGenericInjectedConnector(metaMask)).toBe(false);
    expect(isGenericInjectedConnector(phantom)).toBe(false);
  });
});

describe("connectErrorMessage", () => {
  it("hides viem internals on a user-rejected request", () => {
    expect(
      connectErrorMessage(
        new Error("User rejected the request.\n\nDetails: User rejected the request.\nVersion: viem@2.56.1"),
      ),
    ).toBe("Wallet request was cancelled. Pick a wallet to try again.");
  });

  it("explains an already-pending wallet request", () => {
    const err = new Error(
      "Request of type 'wallet_requestPermissions' already pending for origin http://localhost:5173. Please wait.",
    );
    expect(isAlreadyPendingError(err)).toBe(true);
    expect(connectErrorMessage(err)).toMatch(/fox icon/i);
  });
});

describe("withSingleInFlightRequest", () => {
  it("does not start a second wallet_requestPermissions while one is in flight", async () => {
    let calls = 0;
    let resolveFirst!: (value: unknown) => void;
    const provider = {
      request: (args: { method?: string }) => {
        if (args.method !== "wallet_requestPermissions") return Promise.resolve([]);
        calls += 1;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      },
    };
    const wrapped = withSingleInFlightRequest(provider);
    const first = wrapped.request({ method: "wallet_requestPermissions" });
    const second = wrapped.request({ method: "wallet_requestPermissions" });
    expect(calls).toBe(1);
    resolveFirst([{ parentCapability: "eth_accounts" }]);
    await first;
    await second;
    expect(calls).toBe(1);
  });

  it("does not start a second eth_requestAccounts while one is in flight", async () => {
    let calls = 0;
    let resolveFirst!: (value: string[]) => void;
    const provider = {
      request: (args: { method?: string }) => {
        if (args.method !== "eth_requestAccounts") return Promise.resolve([]);
        calls += 1;
        return new Promise<string[]>((resolve) => {
          resolveFirst = resolve;
        });
      },
    };
    const wrapped = withSingleInFlightRequest(provider);
    const first = wrapped.request({ method: "eth_requestAccounts" }) as Promise<string[]>;
    const second = wrapped.request({ method: "eth_requestAccounts" }) as Promise<string[]>;
    expect(calls).toBe(1);
    resolveFirst(["0xabc"]);
    expect(await first).toEqual(["0xabc"]);
    expect(await second).toEqual(["0xabc"]);
    expect(calls).toBe(1);
  });
});

describe("createConnectGuard", () => {
  it("lets only one connect start until it ends", () => {
    const guard = createConnectGuard();
    expect(guard.tryBegin()).toBe(true);
    expect(guard.tryBegin()).toBe(false);
    expect(guard.tryBegin()).toBe(false);
    expect(guard.isLocked()).toBe(true);
    guard.end();
    expect(guard.isLocked()).toBe(false);
    expect(guard.tryBegin()).toBe(true);
  });
});
