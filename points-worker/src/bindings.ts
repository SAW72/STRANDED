export interface PointsBindings {
  DB: D1Database;
  POINTS_INGEST_SECRET?: string;
  BASE_SEPOLIA_RPC_URL?: string;
  ARB_SEPOLIA_RPC_URL?: string;
  /** Optional. JSON or "chainId:0xaddr,0xaddr;chainId:0xaddr". Unset means no token check. */
  TOKEN_IN_ALLOWLIST?: string;
  /** Optional. Defaults to 2 when unset. */
  POINTS_MIN_CONFIRMATIONS?: string;
}
