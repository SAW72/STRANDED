import { http, createConfig } from "wagmi";
import { arbitrumSepolia, baseSepolia } from "wagmi/chains";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, rpcUrl } from "./config";
import {
  eip6963InjectedConnectors,
  fallbackInjectedConnector,
  watchLateWallets,
} from "./lib/injectedWallets";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, arbitrumSepolia],
  // Do not use wagmi MIPD: it creates a second MetaMask connector with
  // shimDisconnect: true (wallet_requestPermissions + eth_requestAccounts).
  multiInjectedProviderDiscovery: false,
  // No persisted reconnect — do not talk to the user's extension until they pick it.
  storage: null,
  connectors: [...eip6963InjectedConnectors(), fallbackInjectedConnector()],
  transports: {
    [baseSepolia.id]: http(rpcUrl(BASE_SEPOLIA_CHAIN_ID)),
    [arbitrumSepolia.id]: http(rpcUrl(ARB_SEPOLIA_CHAIN_ID)),
  },
});

watchLateWallets(wagmiConfig);
