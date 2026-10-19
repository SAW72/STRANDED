import { env } from "cloudflare:workers";
import worker from "../src/index";
import type { PointsBindings } from "../src/bindings";
import { GAS_RESCUE_SWAP } from "../src/allowlist";
import { RESCUED_TOPIC, rpcClient } from "../src/receipt";

export const USER = "0x1111111111111111111111111111111111111111";
export const RELAYER = "0x2222222222222222222222222222222222222222";
export const OTHER_USER = "0x3333333333333333333333333333333333333333";
export const OTHER_RELAYER = "0x4444444444444444444444444444444444444444";
export const EMPTY = "0x9999999999999999999999999999999999999999";
export const NATIVE_TO = "0x5555555555555555555555555555555555555555";
export const TOKEN_IN = "0x6666666666666666666666666666666666666666";

const encoder = new TextEncoder();

export function runtimeSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function txHash(label: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  bytes[0] = label.charCodeAt(0) & 0xff;
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function bindings(secret: string): PointsBindings {
  return {
    DB: env.DB,
    POINTS_INGEST_SECRET: secret,
    BASE_SEPOLIA_RPC_URL: "https://example.invalid/base",
    ARB_SEPOLIA_RPC_URL: "https://example.invalid/arb",
  };
}

export async function mac(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}\n${body}`));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function installReceipt(receipt: unknown, opts: { head?: string } = {}): { calls: () => number } {
  let calls = 0;
  const head = opts.head ?? "0x20";
  rpcClient.fetch = async (input, init) => {
    calls += 1;
    const url = String(input);
    if (!url.startsWith("https://example.invalid/")) throw new Error("offline");
    let method = "eth_getTransactionReceipt";
    try {
      const parsed = JSON.parse(String(init && "body" in init ? init.body : ""));
      if (parsed && typeof parsed.method === "string") method = parsed.method;
    } catch {
      method = "eth_getTransactionReceipt";
    }
    const result = method === "eth_blockNumber" ? head : receipt;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls: () => calls };
}

export function installOfflineFetch(): { calls: () => number } {
  let calls = 0;
  rpcClient.fetch = async () => {
    calls += 1;
    throw new Error("offline");
  };
  return { calls: () => calls };
}

function padded(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

export function rescuedReceipt(opts: {
  chainId: number;
  user?: string;
  relayer?: string;
  status?: string;
  blockNumber?: string;
  contract?: string;
  logs?: unknown[] | null;
}): { status: string; blockNumber: string; logs: unknown[] } {
  const contract = opts.contract ?? GAS_RESCUE_SWAP[opts.chainId];
  const user = opts.user ?? USER;
  const relayer = opts.relayer ?? RELAYER;
  const logs =
    opts.logs === null
      ? []
      : opts.logs ?? [
          {
            address: contract,
            topics: [RESCUED_TOPIC, `0x${padded(user)}`, `0x${padded(TOKEN_IN)}`, `0x${padded(NATIVE_TO)}`],
            data: `0x${[
              "0".repeat(64),
              "0".repeat(64),
              "0".repeat(64),
              "0".repeat(64),
              padded(NATIVE_TO),
              "0".repeat(64),
              padded(relayer),
            ].join("")}`,
          },
        ];
  return { status: opts.status ?? "0x1", blockNumber: opts.blockNumber ?? "0x1", logs };
}

export async function postIngest(
  secret: string,
  body: unknown,
  opts: { timestamp?: string; signature?: string | null; origin?: string } = {},
): Promise<Response> {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(nowSeconds());
  const signature = opts.signature === null ? "" : opts.signature ?? (await mac(secret, timestamp, raw));
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": String(encoder.encode(raw).byteLength),
    "x-points-timestamp": timestamp,
    "x-points-signature": signature,
  });
  if (opts.origin) headers.set("origin", opts.origin);
  return worker.fetch(
    new Request("https://points.invalid/v1/ingest", { method: "POST", headers, body: raw }),
    bindings(secret),
  );
}

export function getPoints(secret: string, path: string, origin?: string): Promise<Response> {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return worker.fetch(new Request(`https://points.invalid${path}`, { headers }), bindings(secret));
}

export async function ledgerCount(): Promise<{ n: number; s: number }> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS s FROM points_ledger").first<{
    n: number;
    s: number;
  }>();
  return { n: Number(row?.n ?? 0), s: Number(row?.s ?? 0) };
}
