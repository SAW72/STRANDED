/**
 * Replay durable unresolved outbox rows.
 * Stop the relayer first. Set CHAIN_ID to 84532 or 421614 and set RPC_URL.
 * There is no default RPC URL. A row that still cannot be resolved is printed and left in place.
 */
import { pathToFileURL } from "node:url";
import { createPublicClient, http as viemHttp } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import {
  backfillPointsRescue,
  findTxAtNonce,
  pointsMinConfirmations,
  pointsPushEnabled,
  readUnresolvedPoints,
} from "../points/notify.mjs";

const CHAINS = new Set([84532, 421614]);

function resolvableRow(row) {
  if (!row || !row.txFrom || row.txNonce === undefined || row.txNonce === null || !row.txTo) return false;
  if (!row.sentBlock) return false;
  if (row.txInput && String(row.txInput).length >= 10) return true;
  return Boolean(row.txInputHash && row.txSelector);
}

export async function runResolve(env = process.env) {
  if (!pointsPushEnabled(env)) {
    console.log("points_resolve disabled");
    return { rows: 0, resolved: 0 };
  }
  const chainId = Number(env.CHAIN_ID);
  if (!CHAINS.has(chainId)) {
    console.error("points_resolve", "chain");
    return { rows: 0, resolved: 0 };
  }
  const rpcUrl = String(env.RPC_URL || "").trim();
  if (!rpcUrl) {
    console.error("points_resolve", "rpc");
    return { rows: 0, resolved: 0 };
  }
  const dataDir = env.DATA_DIR || "./data";
  const chain = chainId === 84532 ? baseSepolia : arbitrumSepolia;
  const client = createPublicClient({ chain, transport: viemHttp(rpcUrl) });
  const rows = (await readUnresolvedPoints(dataDir)).filter((row) => row.chainId === chainId);
  let resolved = 0;
  for (const row of rows) {
    try {
      if (!resolvableRow(row)) {
        console.log(`points_resolve unresolved ${row.txHash}`);
        continue;
      }
      const looked = await findTxAtNonce(client, row.txFrom, row.txNonce, row);
      if (!looked || looked.status !== "found" || !looked.tx || !looked.tx.hash) {
        console.log(`points_resolve unresolved ${row.txHash}`);
        continue;
      }
      const replacedBy = String(looked.tx.hash).toLowerCase();
      const result = await backfillPointsRescue({
        ...row,
        chainId,
        dataDir,
        env,
        lookupNonce: async () => looked,
        confirmReceipt: (hash) =>
          client.waitForTransactionReceipt({
            hash,
            confirmations: pointsMinConfirmations(env, hash),
            timeout: 20_000,
          }),
      });
      if (Number(result && result.sent) > 0) {
        resolved += 1;
        console.log(`points_resolve ${row.txHash} ${replacedBy}`);
      } else {
        console.log(`points_resolve unresolved ${row.txHash}`);
      }
    } catch {
      console.error("points_resolve", "row", row.txHash);
    }
  }
  console.log(`points_resolve done ${rows.length} resolved ${resolved}`);
  return { rows: rows.length, resolved };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runResolve(process.env).catch(() => {
    console.error("points_resolve", "error");
    process.exitCode = 1;
  });
}
