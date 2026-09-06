/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAYER_URL?: string;
  readonly VITE_RELAYER_URL_ARB_SEPOLIA?: string;
  readonly RELAYER_BASE_URL?: string;
  readonly VITE_RELAYER_BASE_URL?: string;
  readonly VITE_GAS_RESCUE_ADDRESS?: string;
  readonly VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS_ARB_SEPOLIA?: string;
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string;
  readonly VITE_ARB_SEPOLIA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
