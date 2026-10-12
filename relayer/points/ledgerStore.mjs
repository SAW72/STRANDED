import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

/**
 * Append-only points ledger.
 *
 * Points are off-chain scores and are unpaid. This module is not mounted on
 * relayer routes and does not talk to a chain.
 *
 * The database is a SQLite file at DATA_DIR/points-ledger.sqlite
 * (better-sqlite3). There is no update or delete API. Table triggers reject
 * UPDATE and DELETE. BEFORE INSERT rejects a repeated id or
 * (wallet, action, tx_hash), including REPLACE while recursive triggers are off.
 *
 * Rubric ids match docs/POINTS-PROGRAM.md. Amounts are not decided here.
 */
export const POINTS_ACTIONS = Object.freeze([
  "rescue_completed",
  "relayer_job",
  "registry_find_posted",
  "registry_find_claimed",
  "wallet_session",
  "bug_report",
]);

const ACTION_SET = new Set(POINTS_ACTIONS);
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const ONCHAIN_TX_RE = /^0x[0-9a-fA-F]{64}$/;
const SYNTHETIC_TX_RE = /^off:[0-9a-f]{64}$/;
const METADATA_MAX = 4096;
const SCHEMA_SQL = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const FORBIDDEN_KEY = /private[_-]?key|secret|mnemonic|seed|signature|permit|password|authorization|admin/i;
const FORBIDDEN_NAMES = new Set(["__proto__", "prototype", "constructor"]);

const LEDGER_FILE = "points-ledger.sqlite";

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function isForbiddenKey(key) {
  const name = String(key);
  if (FORBIDDEN_NAMES.has(name.toLowerCase())) return true;
  return FORBIDDEN_KEY.test(name);
}

function assertNoSecrets(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecrets(item);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw fail("invalid_metadata");
    assertNoSecrets(nested);
  }
}

function normalizeWallet(wallet) {
  const key = String(wallet ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(key)) throw fail("invalid_address");
  return key;
}

function normalizeAction(action) {
  const key = String(action ?? "").trim();
  if (!ACTION_SET.has(key)) throw fail("invalid_action");
  return key;
}

function normalizePoints(points) {
  if (typeof points === "bigint") {
    if (points <= 0n || points > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("invalid_points");
    return Number(points);
  }
  if (typeof points === "number") {
    if (!Number.isSafeInteger(points) || points <= 0) throw fail("invalid_points");
    return points;
  }
  if (typeof points === "string") {
    const text = points.trim();
    if (!/^[1-9][0-9]*$/.test(text)) throw fail("invalid_points");
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n <= 0) throw fail("invalid_points");
    return n;
  }
  throw fail("invalid_points");
}

/**
 * Deterministic tx_hash for an off-chain row.
 * `parts` must distinguish the event (a week id, a report id, and so on).
 * The same action and parts always yield the same key. Parts are trimmed
 * and lowercased before hashing.
 * @param {string} action
 * @param {string | string[]} parts
 */
export function syntheticTxKey(action, parts) {
  const normalized = normalizeAction(action);
  const list = Array.isArray(parts) ? parts : [parts];
  if (list.length === 0) throw fail("invalid_tx_hash");
  const body = list.map((part) => {
    const text = String(part ?? "").trim().toLowerCase();
    if (!text) throw fail("invalid_tx_hash");
    return text;
  });
  const digest = createHash("sha256").update([normalized, ...body].join("\n")).digest("hex");
  return `off:${digest}`;
}

function normalizeTxHash(txHash) {
  const raw = String(txHash ?? "").trim();
  if (ONCHAIN_TX_RE.test(raw)) return raw.toLowerCase();
  if (SYNTHETIC_TX_RE.test(raw)) return raw;
  throw fail("invalid_tx_hash");
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) throw fail("invalid_metadata");
  if (Object.getPrototypeOf(metadata) !== Object.prototype && Object.getPrototypeOf(metadata) !== null) {
    throw fail("invalid_metadata");
  }
  assertNoSecrets(metadata);
  let text;
  try {
    text = JSON.stringify(metadata);
  } catch {
    throw fail("invalid_metadata");
  }
  if (!text || text.length > METADATA_MAX) throw fail("invalid_metadata");
  return text;
}

function normalizeCreatedAt(value, now) {
  const raw = value === undefined || value === null ? now() : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) throw fail("invalid_created_at");
  return date.toISOString();
}

function isDuplicateError(err) {
  const code = String(err?.code || "");
  // The BEFORE INSERT trigger aborts a repeated id or (wallet, action, tx_hash)
  // with SQLITE_CONSTRAINT_TRIGGER before the UNIQUE index is reported.
  if (code.includes("UNIQUE") || code.includes("PRIMARYKEY") || code.includes("TRIGGER")) return true;
  return String(err?.message || "").includes("UNIQUE constraint failed");
}

function parseMetadata(text) {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw fail("invalid_metadata");
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    wallet: row.wallet,
    action: row.action,
    points: Number(row.points),
    txHash: row.txHash,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt,
  };
}

function addPoints(sum, points) {
  const next = sum + points;
  if (!Number.isSafeInteger(next)) throw fail("invalid_points");
  return next;
}

function foldActions(rows) {
  const byAction = {};
  let total = 0;
  for (const row of rows) {
    const points = Number(row.points);
    byAction[row.action] = points;
    total = addPoints(total, points);
  }
  return { total, byAction };
}

function tighten(filePath) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      chmodSync(filePath + suffix, 0o600);
    } catch {
      // The sidecar file is absent until SQLite creates it.
    }
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dataDir] Directory for the SQLite file. Defaults to DATA_DIR or ./data.
 * @param {string} [opts.dbPath] Full path. Wins over dataDir.
 * @param {() => number} [opts.now]
 */
export function createLedgerStore(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || "./data";
  const filePath = opts.dbPath || join(dataDir, LEDGER_FILE);
  const now = opts.now || Date.now;
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  const db = new Database(filePath);
  let closed = false;
  tighten(filePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("recursive_triggers = ON");
  db.exec(SCHEMA_SQL);
  tighten(filePath);

  const insert = db.prepare(`
    INSERT INTO points_ledger (wallet, action, points, tx_hash, metadata, created_at)
    VALUES (@wallet, @action, @points, @tx_hash, @metadata, @created_at)
  `);
  const byId = db.prepare(`
    SELECT id, wallet, action, points, tx_hash AS txHash, metadata, created_at AS createdAt
    FROM points_ledger
    WHERE id = ?
  `);
  const byWalletStmt = db.prepare(`
    SELECT id, wallet, action, points, tx_hash AS txHash, metadata, created_at AS createdAt
    FROM points_ledger
    WHERE wallet = ?
    ORDER BY created_at ASC, id ASC
  `);
  const sumForWallet = db.prepare(`
    SELECT action, SUM(points) AS points
    FROM points_ledger
    WHERE wallet = ?
    GROUP BY action
    ORDER BY action ASC
  `);
  const sumAll = db.prepare(`
    SELECT wallet, action, SUM(points) AS points
    FROM points_ledger
    GROUP BY wallet, action
    ORDER BY wallet ASC, action ASC
  `);

  function assertOpen() {
    if (closed) throw fail("ledger_closed");
  }

  /**
   * Insert one ledger row. A repeated (wallet, action, txHash) throws
   * `duplicate` and does not add the points again.
   * @param {object} entry
   */
  function append(entry) {
    assertOpen();
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw fail("invalid_entry");
    const row = {
      wallet: normalizeWallet(entry.wallet),
      action: normalizeAction(entry.action),
      points: normalizePoints(entry.points),
      tx_hash: normalizeTxHash(entry.txHash),
      metadata: normalizeMetadata(entry.metadata),
      created_at: normalizeCreatedAt(entry.createdAt, now),
    };
    try {
      const info = insert.run(row);
      return mapRow(byId.get(info.lastInsertRowid));
    } catch (err) {
      if (isDuplicateError(err)) throw fail("duplicate");
      if (String(err?.code || "").includes("CONSTRAINT")) throw fail("invalid_ledger_row");
      throw err;
    }
  }

  function byWallet(wallet) {
    assertOpen();
    return byWalletStmt.all(normalizeWallet(wallet)).map(mapRow);
  }

  /**
   * Point totals. Pass a wallet for that address only.
   * With no wallet, returns the sum across every address.
   */
  function totals(wallet) {
    assertOpen();
    if (wallet === undefined) {
      const grouped = new Map();
      const byAction = {};
      let total = 0;
      for (const row of sumAll.all()) {
        const points = Number(row.points);
        total = addPoints(total, points);
        byAction[row.action] = addPoints(byAction[row.action] || 0, points);
        let entry = grouped.get(row.wallet);
        if (!entry) {
          entry = { wallet: row.wallet, total: 0, byAction: {} };
          grouped.set(row.wallet, entry);
        }
        entry.total = addPoints(entry.total, points);
        entry.byAction[row.action] = points;
      }
      return { total, byAction, wallets: [...grouped.values()] };
    }
    const key = normalizeWallet(wallet);
    return { wallet: key, ...foldActions(sumForWallet.all(key)) };
  }

  function close() {
    if (closed) return;
    closed = true;
    tighten(filePath);
    db.close();
  }

  return Object.freeze({ append, byWallet, totals, close, filePath });
}
