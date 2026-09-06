/** Generic window.ethereum connector — often Phantom when several wallets are installed. */
export function isGenericInjectedConnector(connector: { id: string }): boolean {
  return connector.id === "injected";
}

export function isAlreadyPendingError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code: unknown }).code)
      : undefined;
  return code === -32002 || /already pending/i.test(raw) || /resource unavailable/i.test(raw);
}

export function connectErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (isAlreadyPendingError(error)) {
    return "MetaMask is waiting in the Chrome toolbar. Click the fox icon, approve or reject, then pick MetaMask again.";
  }
  if (/user rejected/i.test(raw) || /rejected the request/i.test(raw)) {
    return "Wallet request was cancelled. Pick a wallet to try again.";
  }
  if (!raw.trim()) return "Couldn’t connect. Pick a wallet to try again.";
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  if (/viem@|wagmi@|details:/i.test(firstLine)) {
    return "Couldn’t connect. Pick a wallet to try again.";
  }
  return firstLine || "Couldn’t connect. Pick a wallet to try again.";
}

const ACCOUNT_METHODS = new Set(["wallet_requestPermissions", "eth_requestAccounts"]);

type RequestArgs = { method?: string; params?: unknown };

/** Reuse one in-flight accounts/permissions RPC so MetaMask is not asked twice. */
export function withSingleInFlightRequest<T extends { request: (args: RequestArgs) => unknown }>(
  provider: T,
): T {
  const tagged = provider as T & { __gasRescueDedupe?: boolean };
  if (tagged.__gasRescueDedupe) return provider;
  const orig = provider.request.bind(provider);
  let inflight: Promise<unknown> | null = null;
  let inflightMethod: string | null = null;
  const wrapped = (args: RequestArgs) => {
    const method = args?.method ?? "";
    if (ACCOUNT_METHODS.has(method) && inflight) {
      if (method === inflightMethod) return inflight;
      if (method === "eth_requestAccounts") {
        return inflight.then((result) => {
          if (Array.isArray(result) && typeof result[0] === "string") return result;
          return orig({ method: "eth_accounts" });
        });
      }
      return inflight;
    }
    const result = orig(args);
    if (ACCOUNT_METHODS.has(method) && result && typeof (result as Promise<unknown>).then === "function") {
      inflightMethod = method;
      inflight = (result as Promise<unknown>).finally(() => {
        inflight = null;
        inflightMethod = null;
      });
      return inflight;
    }
    return result;
  };
  try {
    tagged.request = wrapped as T["request"];
    tagged.__gasRescueDedupe = true;
  } catch {
    /* provider.request may be frozen */
  }
  return provider;
}

type WalletProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

/** Drop a stuck MetaMask permissions request so the user can connect again. */
export async function clearStuckWalletPermissions(connector: {
  getProvider?: () => Promise<unknown>;
}): Promise<void> {
  if (!connector.getProvider) return;
  const provider = (await connector.getProvider()) as WalletProvider | undefined;
  if (!provider || typeof provider.request !== "function") return;
  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    /* ignore — not every wallet implements revoke */
  }
}

/** Synchronous lock so Connect cannot start a second wallet_requestPermissions. */
export function createConnectGuard() {
  let locked = false;
  return {
    tryBegin(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    forceBegin(): void {
      locked = true;
    },
    end(): void {
      locked = false;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}

/**
 * EIP-6963 announced wallets first, in discovery order (not MetaMask-first).
 * Bare `injected` / window.ethereum last so the picker is actually choosable.
 */
export function orderWalletConnectors<T extends { id: string }>(connectors: readonly T[]): T[] {
  const seen = new Set<string>();
  const announced: T[] = [];
  const generic: T[] = [];
  for (const connector of connectors) {
    if (seen.has(connector.id)) continue;
    seen.add(connector.id);
    if (isGenericInjectedConnector(connector)) generic.push(connector);
    else announced.push(connector);
  }
  return [...announced, ...generic];
}
