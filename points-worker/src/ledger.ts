import { RELAYER_JOB_POINTS, RESCUE_POINTS, UNSCORED_ACTIONS, clientAction } from "./activity";
import { PointsError, ledgerErrorCode } from "./errors";

const HIDDEN_ACTIONS = ["bug_report", "security", "security_finding", "finding", ...UNSCORED_ACTIONS];
const HIDDEN_SQL = HIDDEN_ACTIONS.map((action) => `'${action}'`).join(", ");

export type LedgerRow = {
  id: number;
  wallet: string;
  action: string;
  points: number;
  txHash: string;
  metadata: string | null;
  createdAt: string;
};

export type ActivityInsert = {
  wallet: string;
  action: string;
  points: number;
  txHash: string;
  metadata: string | null;
  createdAt: string;
};

export async function insertActivity(db: D1Database, row: ActivityInsert): Promise<"inserted" | "duplicate"> {
  if (row.action === "wallet_session") throw new PointsError(400, "wallet_session_disabled");
  try {
    await db.batch([
      db.prepare("PRAGMA recursive_triggers = ON"),
      db.prepare(
        `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(row.wallet, row.action, row.points, row.txHash, row.metadata, row.createdAt),
    ]);
    return "inserted";
  } catch (err) {
    const code = ledgerErrorCode(err);
    if (code === "duplicate") return "duplicate";
    if (code === "excluded_action" || code === "append-only") throw new PointsError(409, code);
    throw err;
  }
}

function insertStatement(db: D1Database, row: ActivityInsert): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.wallet, row.action, row.points, row.txHash, row.metadata, row.createdAt);
}

export async function recordRescue(
  db: D1Database,
  input: { user: string; relayer: string; txHash: string; chainId: number },
): Promise<{ duplicate: boolean }> {
  const createdAt = new Date().toISOString();
  const metadata = JSON.stringify({ chainId: input.chainId });
  const rows: ActivityInsert[] = [
    {
      wallet: input.user,
      action: "rescue_completed",
      points: RESCUE_POINTS,
      txHash: input.txHash,
      metadata,
      createdAt,
    },
    {
      wallet: input.relayer,
      action: "relayer_job",
      points: RELAYER_JOB_POINTS,
      txHash: input.txHash,
      metadata,
      createdAt,
    },
  ];
  try {
    await db.batch([
      db.prepare("PRAGMA recursive_triggers = ON"),
      insertStatement(db, rows[0]),
      insertStatement(db, rows[1]),
    ]);
    return { duplicate: false };
  } catch (err) {
    const code = ledgerErrorCode(err);
    if (code === "excluded_action" || code === "append-only") throw new PointsError(409, code);
    if (code !== "duplicate") throw err;
    const existing = await db
      .prepare(
        `SELECT action FROM points_ledger
         WHERE tx_hash = ? AND action IN ('rescue_completed', 'relayer_job')`,
      )
      .bind(input.txHash)
      .all<{ action: string }>();
    const have = new Set((existing.results || []).map((row) => row.action));
    const missing = rows.filter((row) => !have.has(row.action));
    if (missing.length === 0) return { duplicate: true };
    await db.batch([db.prepare("PRAGMA recursive_triggers = ON"), ...missing.map((row) => insertStatement(db, row))]);
    return { duplicate: false };
  }
}

export async function rowsForWallet(db: D1Database, wallet: string): Promise<LedgerRow[]> {
  const result = await db
    .prepare(
      `SELECT id, wallet, action, points, tx_hash AS txHash, metadata, created_at AS createdAt
       FROM points_ledger
       WHERE wallet = ?
         AND action NOT IN (${HIDDEN_SQL})
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(wallet)
    .all<LedgerRow>();
  return result.results || [];
}

export const LEADERBOARD_LIMIT = 100;

export async function leaderboardTotals(
  db: D1Database,
  limit = LEADERBOARD_LIMIT,
): Promise<Array<{ wallet: string; total: number }>> {
  const cap = Number.isInteger(limit) && limit > 0 && limit <= LEADERBOARD_LIMIT ? limit : LEADERBOARD_LIMIT;
  const result = await db
    .prepare(
      `SELECT wallet, SUM(points) AS total
       FROM points_ledger
       WHERE action NOT IN (${HIDDEN_SQL})
       GROUP BY wallet
       HAVING SUM(points) > 0
       ORDER BY SUM(points) DESC, wallet ASC
       LIMIT ${cap}`,
    )
    .all<{ wallet: string; total: number }>();
  return (result.results || []).map((row) => ({ wallet: row.wallet, total: Number(row.total) }));
}

export function chainIdFromMetadata(metadata: string | null): number | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { chainId?: unknown };
    if (typeof parsed.chainId === "number" && Number.isSafeInteger(parsed.chainId) && parsed.chainId > 0) {
      return parsed.chainId;
    }
  } catch {
    return null;
  }
  return null;
}

export type ClientEntry = {
  action: string;
  points: number;
  txHash: string | null;
  chainId: number | null;
};

export type ClientCategory = {
  action: string;
  points: number;
  count: number;
};

export function projectRows(rows: LedgerRow[]): {
  total: number;
  categories: ClientCategory[];
  entries: ClientEntry[];
} {
  const entries: ClientEntry[] = rows.map((row) => ({
    action: clientAction(row.action),
    points: Number(row.points),
    txHash: row.txHash,
    chainId: chainIdFromMetadata(row.metadata),
  }));
  const categories: ClientCategory[] = [];
  const byAction = new Map<string, ClientCategory>();
  let total = 0;
  for (const entry of entries) {
    total += entry.points;
    let category = byAction.get(entry.action);
    if (!category) {
      category = { action: entry.action, points: 0, count: 0 };
      byAction.set(entry.action, category);
      categories.push(category);
    }
    category.points += entry.points;
    category.count += 1;
  }
  return { total, categories, entries };
}
