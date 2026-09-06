import type { Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { withSingleInFlightRequest } from "./connectors";

type Eip6963Detail = {
  info: { rdns: string; name: string; icon?: string; uuid: string };
  provider: { request: (args: { method?: string; params?: unknown }) => unknown };
};

function walletConnector(detail: Eip6963Detail) {
  return injected({
    target: {
      ...detail.info,
      id: detail.info.rdns,
      provider: withSingleInFlightRequest(detail.provider) as never,
    },
    shimDisconnect: false,
  });
}

/**
 * Installed wallets via EIP-6963. shimDisconnect is off so MetaMask only
 * receives eth_requestAccounts (one extension popup).
 */
export function eip6963InjectedConnectors() {
  if (typeof window === "undefined") return [];
  const connectors: ReturnType<typeof injected>[] = [];
  const seen = new Set<string>();
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    const rdns = detail?.info?.rdns;
    if (!rdns || seen.has(rdns) || !detail.provider) return;
    seen.add(rdns);
    connectors.push(walletConnector(detail));
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  return connectors;
}

/** Wallets that announce after first paint (no second MetaMask connector). */
export function watchLateWallets(config: Config) {
  if (typeof window === "undefined") return;
  const seen = new Set(config.connectors.map((connector) => connector.id));
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    const rdns = detail?.info?.rdns;
    if (!rdns || seen.has(rdns) || !detail.provider) return;
    seen.add(rdns);
    const connector = config._internal.connectors.setup(walletConnector(detail));
    config._internal.connectors.setState((existing) => [...existing, connector]);
  });
}

export function fallbackInjectedConnector() {
  return injected({ shimDisconnect: false });
}
