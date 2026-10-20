import { MAX_SKEW_SECONDS, normalizeSecret, signaturesMatch, timestampSkewSeconds } from "./auth";
import type { PointsBindings } from "./bindings";
import { allowlistedSwap } from "./allowlist";
import { PointsError } from "./errors";
import { empty, json } from "./http";
import { leaderboardTotals, projectRows, recordRescue, rowsForWallet } from "./ledger";
import { allowWalletRead, WALLET_READ_CACHE } from "./readLimit";
import { minConfirmations, readRescuedParties, rpcUrlFor } from "./receipt";
import { parseTokenAllowlist } from "./tokenAllowlist";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;
const LEADERBOARD_MEMO_MS = 30_000;

let leaderboardMemo: { at: number; rows: Array<{ wallet: string; total: number; rescues: number }> } | null = null;

export function resetLeaderboardCache(): void {
  leaderboardMemo = null;
}
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_BODY_BYTES = 4096;

export default {
  async fetch(request: Request, env: PointsBindings): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (request.method === "OPTIONS") return empty(request, 204);
      if (request.method === "POST" && path === "/v1/ingest") return await ingest(request, env);
      if (request.method === "GET" && path === "/points/leaderboard") return await leaderboard(request, env);
      if (request.method === "GET" && path.startsWith("/points/")) return await walletPoints(request, env, path);
      return json(request, 404, { ok: false, error: "not_found" });
    } catch (err) {
      if (err instanceof PointsError) return json(request, err.status, { ok: false, error: err.code });
      console.log(JSON.stringify({ event: "points_error" }));
      return json(request, 500, { ok: false, error: "internal" });
    }
  },
};

async function ingest(request: Request, env: PointsBindings): Promise<Response> {
  assertBodyCap(request);
  const secret = normalizeSecret(env.POINTS_INGEST_SECRET);
  if (!secret) {
    console.log(JSON.stringify({ event: "points_ingest_unconfigured" }));
    throw new PointsError(401, "bad_signature");
  }
  const rawBody = await readRawBody(request);
  const timestamp = request.headers.get("x-points-timestamp") ?? "";
  const signature = request.headers.get("x-points-signature") ?? "";
  const signed = await signaturesMatch(secret, timestamp, rawBody, signature);
  if (!signed) throw new PointsError(401, "bad_signature");
  const skew = timestampSkewSeconds(timestamp, Date.now());
  if (skew === null || skew > MAX_SKEW_SECONDS) throw new PointsError(401, "stale_timestamp");

  const body = parseIngestBody(rawBody);
  if (body.action === "wallet_session") throw new PointsError(400, "wallet_session_disabled");
  if (body.action === "registry_find_posted" || body.action === "registry_find_claimed") {
    throw new PointsError(400, "registry_deferred");
  }
  if (body.action !== undefined) throw new PointsError(400, "invalid_body");
  if (!allowlistedSwap(body.chainId)) throw new PointsError(400, "wrong_chain");

  const rpcUrl = rpcUrlFor(body.chainId, env);
  if (!rpcUrl) throw new PointsError(503, "rpc_unconfigured");
  const parties = await readRescuedParties(rpcUrl, body.txHash, body.chainId, {
    minConfirmations: minConfirmations(env.POINTS_MIN_CONFIRMATIONS),
    tokenAllowlist: parseTokenAllowlist(env.TOKEN_IN_ALLOWLIST),
  });
  const recorded = await recordRescue(env.DB, {
    user: parties.user,
    relayer: parties.relayer,
    txHash: body.txHash,
    chainId: body.chainId,
  });
  return json(request, 200, { ok: true, duplicate: recorded.duplicate });
}

async function walletPoints(request: Request, env: PointsBindings, path: string): Promise<Response> {
  if (!allowWalletRead(request)) throw new PointsError(429, "rate_limited");
  let raw: string;
  try {
    raw = decodeURIComponent(path.slice("/points/".length));
  } catch {
    throw new PointsError(400, "invalid_address");
  }
  if (!ADDRESS_RE.test(raw)) throw new PointsError(400, "invalid_address");
  const wallet = raw.toLowerCase();
  const rows = await rowsForWallet(env.DB, wallet);
  const projected = projectRows(rows);
  return json(
    request,
    200,
    {
      wallet,
      total: projected.total,
      categories: projected.categories,
      entries: projected.entries,
    },
    WALLET_READ_CACHE,
  );
}

async function leaderboard(request: Request, env: PointsBindings): Promise<Response> {
  if (!allowWalletRead(request)) throw new PointsError(429, "rate_limited");
  const now = Date.now();
  if (!leaderboardMemo || now - leaderboardMemo.at >= LEADERBOARD_MEMO_MS) {
    const board = await leaderboardTotals(env.DB);
    leaderboardMemo = {
      at: now,
      rows: board.map((row) => ({ wallet: row.wallet, total: row.total, rescues: row.rescues })),
    };
  }
  return json(request, 200, { rows: leaderboardMemo.rows }, WALLET_READ_CACHE);
}

function assertBodyCap(request: Request): void {
  const declared = request.headers.get("content-length");
  if (declared === null || !/^[0-9]+$/.test(declared)) throw new PointsError(400, "invalid_body");
  const declaredBytes = Number(declared);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_BODY_BYTES) {
    throw new PointsError(400, "invalid_body");
  }
}

async function readRawBody(request: Request): Promise<string> {
  assertBodyCap(request);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new PointsError(400, "invalid_body");
  return new TextDecoder().decode(bytes);
}

function parseIngestBody(raw: string): { chainId: number; txHash: string; action?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PointsError(400, "invalid_body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PointsError(400, "invalid_body");
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "chainId" && key !== "txHash" && key !== "action") throw new PointsError(400, "invalid_body");
  }
  const chainId = record.chainId;
  const txHash = record.txHash;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId)) throw new PointsError(400, "invalid_body");
  if (typeof txHash !== "string" || !TX_RE.test(txHash)) throw new PointsError(400, "invalid_body");
  const action = record.action;
  if (action !== undefined && typeof action !== "string") throw new PointsError(400, "invalid_body");
  return { chainId, txHash: txHash.toLowerCase(), action };
}
