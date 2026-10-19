/**
 * Replay rescue_ok rows from DATA_DIR/rescues.jsonl.
 * Stop the relayer first. This script and the relayer write the same outbox file.
 * Rows for the process CHAIN_ID are posted. Other chains are skipped.
 * A waiting row keeps its attempt counters. One bad row does not stop the run.
 * No-op unless both POINTS_INGEST_SECRET and POINTS_API_URL are set.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http as viemHttp } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { backfillRows, findTxAtNonce, pointsMinConfirmations, pointsPushEnabled } from "../points/notify.mjs";

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
    if (row.sentBlock !== undefined && row.sentBlock !== null && /^\d+$/.test(String(row.sentBlock).trim())) {
      rowOut.sentBlock = Number(row.sentBlock);
    }
    out.push(rowOut);
  }
  return out;
}

export async function runBackfill(env = process.env) {
  if (!pointsPushEnabled(env)) {
    console.log("points_backfill disabled");
    return { rows: 0, skipped: 0, failed: 0, sent: 0 };
  }
  const chainId = Number(env.CHAIN_ID);
  if (!CHAINS.has(chainId)) {
    console.error("points_backfill", "chain");
    return { rows: 0, skipped: 0, failed: 0, sent: 0 };
  }
  const dataDir = env.DATA_DIR || "./data";
  let text = "";
  try {
    text = await readFile(join(dataDir, "rescues.jsonl"), "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log("points_backfill empty");
      return { rows: 0, skipped: 0, failed: 0, sent: 0 };
    }
    throw err;
  }
  const rows = rescueTxsFromJsonl(text, chainId).filter((row) => row.chainId === chainId);
  const rpcUrl = String(env.RPC_URL || "").trim();
  let lookupNonce;
  let confirmReceipt;
  if (rpcUrl) {
    const chain = chainId === 84532 ? baseSepolia : arbitrumSepolia;
    const client = createPublicClient({ chain, transport: viemHttp(rpcUrl) });
    lookupNonce = (from, nonce, hint) => findTxAtNonce(client, from, nonce, hint || {});
    confirmReceipt = (hash) =>
      client.waitForTransactionReceipt({
        hash,
        confirmations: pointsMinConfirmations(env, hash),
        timeout: 20_000,
      });
  }
  const result = await backfillRows(rows, { dataDir, env, lookupNonce, confirmReceipt });
  console.log(`points_backfill done ${rows.length} skipped ${result.skipped} failed ${result.failed}`);
  return { rows: rows.length, ...result };
}

async function main() {
  await runBackfill(process.env);
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
