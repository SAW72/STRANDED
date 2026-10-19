/**
 * One-time replay of rescue_ok tx hashes from DATA_DIR/rescues.jsonl.
 * Not run by tests, CI, or this change. No-op unless both
 * POINTS_INGEST_SECRET and POINTS_API_URL are set in the environment.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deliverPointsNotify, pointsPushEnabled } from "../points/notify.mjs";

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
    out.push({ chainId, txHash: txHash.toLowerCase() });
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
  for (const row of rows) {
    await deliverPointsNotify({ ...row, dataDir, env: process.env });
  }
  console.log(`points_backfill queued ${rows.length}`);
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
