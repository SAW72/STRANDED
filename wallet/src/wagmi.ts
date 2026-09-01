import { http, createConfig } from "wagmi";
import { arbitrumSepolia, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, rpcUrl } from "./config";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, arbitrumSepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [baseSepolia.id]: http(rpcUrl(BASE_SEPOLIA_CHAIN_ID)),
    [arbitrumSepolia.id]: http(rpcUrl(ARB_SEPOLIA_CHAIN_ID)),
  },
});
