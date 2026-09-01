import { http, createConfig } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { baseSepoliaRpcUrl } from "./config";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [baseSepolia.id]: http(baseSepoliaRpcUrl()),
  },
});
