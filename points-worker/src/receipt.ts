import { keccak256, toBytes } from "viem";
import { allowlistedSwap } from "./allowlist";
import { PointsError } from "./errors";

export const RESCUED_EVENT =
  "Rescued(address,address,uint256,uint256,uint256,uint256,address,address,uint256,address)";

export const RESCUED_TOPIC = keccak256(toBytes(RESCUED_EVENT));

/** Test seam. Production uses the Workers fetch. */
export const rpcClient: { fetch: typeof fetch } = {
  fetch: (input, init) => globalThis.fetch(input, init),
};

export type RescuedParties = {
  user: string;
  relayer: string;
};

type RpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  removed?: boolean;
};

type RpcReceipt = {
  status?: string;
  logs?: RpcLog[];
};

export function rpcUrlFor(
  chainId: number,
  env: { BASE_SEPOLIA_RPC_URL?: string; ARB_SEPOLIA_RPC_URL?: string },
): string | null {
  const raw = chainId === 84532 ? env.BASE_SEPOLIA_RPC_URL : chainId === 421614 ? env.ARB_SEPOLIA_RPC_URL : "";
  const url = String(raw || "").trim();
  return url || null;
}

export async function readRescuedParties(rpcUrl: string, txHash: string, chainId: number): Promise<RescuedParties> {
  const allow = allowlistedSwap(chainId);
  if (!allow) throw new PointsError(400, "wrong_chain");
  const receipt = await fetchReceipt(rpcUrl, txHash);
  if (!receipt) throw new PointsError(404, "receipt_not_found");
  const status = hexQuantity(receipt.status);
  if (status === null) throw new PointsError(502, "invalid_receipt");
  if (status !== 1n) throw new PointsError(400, "status_failed");
  return partiesFromLogs(receipt.logs || [], allow);
}

async function fetchReceipt(rpcUrl: string, txHash: string): Promise<RpcReceipt | null> {
  let response: Response;
  try {
    response = await rpcClient.fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PointsError(502, "rpc_failed");
  }
  if (!response.ok) throw new PointsError(502, "rpc_failed");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PointsError(502, "rpc_failed");
  }
  if (!payload || typeof payload !== "object") throw new PointsError(502, "rpc_failed");
  const record = payload as { error?: unknown; result?: unknown };
  if (record.error) throw new PointsError(502, "rpc_failed");
  if (record.result === null) return null;
  if (!record.result || typeof record.result !== "object") throw new PointsError(502, "invalid_receipt");
  return record.result as RpcReceipt;
}

function partiesFromLogs(logs: RpcLog[], allow: string): RescuedParties {
  const live = logs.filter((log) => log && log.removed !== true);
  const rescued = live.filter((log) => topic0(log) === RESCUED_TOPIC);
  const matched = rescued.filter((log) => sameAddress(log.address, allow));
  if (matched.length > 1) throw new PointsError(400, "invalid_receipt");
  if (matched.length === 1) return decodeRescued(matched[0]);
  if (rescued.length > 0) throw new PointsError(400, "wrong_contract");
  throw new PointsError(400, "missing_rescued_log");
}

function decodeRescued(log: RpcLog): RescuedParties {
  const topics = log.topics || [];
  const user = addressFromWord(topics[1]);
  const data = String(log.data || "").toLowerCase().replace(/^0x/, "");
  if (!user || !/^[0-9a-f]*$/.test(data) || data.length < 64 * 7) {
    throw new PointsError(400, "invalid_receipt");
  }
  const relayer = addressFromWord(`0x${data.slice(64 * 6, 64 * 7)}`);
  if (!relayer) throw new PointsError(400, "invalid_receipt");
  return { user, relayer };
}

function topic0(log: RpcLog): string {
  const topic = log.topics && log.topics[0];
  return typeof topic === "string" ? topic.toLowerCase() : "";
}

function sameAddress(left: string | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function addressFromWord(word: string | undefined): string | null {
  if (typeof word !== "string") return null;
  const hex = word.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const address = `0x${hex.slice(24)}`;
  if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
  return address;
}

function hexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
