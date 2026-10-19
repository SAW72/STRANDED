/**
 * Replay rescue_ok rows from DATA_DIR/rescues.jsonl.
 * Uses the sender and nonce lookup when the call is known, and skips a row otherwise.
 * Does not reset attempt counters. No-op unless both
 * POINTS_INGEST_SECRET and POINTS_API_URL are set in the environment.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http as viemHttp } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { backfillPointsRescue, findTxAtNonce, pointsMinConfirmations, pointsPushEnabled } from "../points/notify.mjs";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const CHAINS = new Set([84532, 421614]);

export function rescueTxsFromJsonl(text, defaultChainId) {
  const fallback = Number(defaultChainId);
  const out = [];
  const seen = new Set();
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || row.event !== "rescue_ok") continue;
    const txHash = String(row.txHash || "").trim();
    if (!TX_RE.test(txHash)) continue;
    const fromRow = Number(row.chainId);
    const chainId = CHAINS.has(fromRow) ? fromRow : CHAINS.has(fallback) ? fallback : 0;
    if (!CHAINS.has(chainId)) continue;
    const key = `${chainId}:${txHash.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rowOut = { chainId, txHash: txHash.toLowerCase() };
    const txFrom = String(row.txFrom || "").trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(txFrom)) rowOut.txFrom = txFrom;
    if (row.txNonce !== undefined && row.txNonce !== null && /^\d+$/.test(String(row.txNonce).trim())) {
      rowOut.txNonce = Number(row.txNonce);
    }
    const txTo = String(row.txTo || "").trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(txTo)) rowOut.txTo = txTo;
    const txInput = String(row.txInput || "").trim().toLowerCase();
    if (/^0x[0-9a-f]*$/.test(txInput) && txInput.length >= 10) rowOut.txInput = txInput;
    out.push(rowOut);
  }
  return out;
}

async function main() {
  if (!pointsPushEnabled(process.env)) {
    console.log("points_backfill disabled");
    return;
  }
  const dataDir = process.env.DATA_DIR || "./data";
  let text = "";
  try {
    text = await readFile(join(dataDir, "rescues.jsonl"), "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log("points_backfill empty");
      return;
    }
    throw err;
  }
  const rows = rescueTxsFromJsonl(text, process.env.CHAIN_ID);
  const rpcUrl = String(process.env.RPC_URL || "").trim();
  let lookupNonce;
  let confirmReceipt;
  if (rpcUrl) {
    const chain = Number(process.env.CHAIN_ID) === 84532 ? baseSepolia : arbitrumSepolia;
    const client = createPublicClient({ chain, transport: viemHttp(rpcUrl) });
    lookupNonce = (from, nonce) => findTxAtNonce(client, from, nonce);
    confirmReceipt = (hash) =>
      client.waitForTransactionReceipt({
        hash,
        confirmations: pointsMinConfirmations(process.env, hash),
        timeout: 20_000,
      });
  }
  let skipped = 0;
  for (const row of rows) {
    const result = await backfillPointsRescue({ ...row, dataDir, env: process.env, lookupNonce, confirmReceipt });
    if (result && result.skipped) skipped += 1;
  }
  console.log(`points_backfill done ${rows.length} skipped ${skipped}`);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch(() => {
    console.error("points_backfill", "error");
    process.exitCode = 1;
  });
}
