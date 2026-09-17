import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN_KEY = /private[_-]?key|secret|mnemonic|seed|signature|permit|admin/i;
const FORBIDDEN_NAMES = new Set([
  "v",
  "r",
  "s",
  "permitv",
  "permitr",
  "permits",
  "ordersignature",
  "relayer_private_key",
  "authorization",
]);

function isForbiddenKey(key) {
  const k = String(key);
  if (FORBIDDEN_NAMES.has(k.toLowerCase())) return true;
  return FORBIDDEN_KEY.test(k);
}

/** Safe Order / quote fields for ops. Never includes keys or permit material. */
export function orderLogSummary(body = {}) {
  const order = body.order && typeof body.order === "object" ? body.order : body;
  const pick = (obj, key) => (obj && obj[key] !== undefined && obj[key] !== null ? String(obj[key]) : null);
  return {
    quoteId: pick(body, "quoteId"),
    user: pick(order, "user") || pick(body, "user"),
    tokenIn: pick(order, "tokenIn") || pick(body, "tokenIn"),
    amountIn: pick(order, "amountIn") || pick(body, "amountIn"),
    feeAmount: pick(order, "feeAmount") || pick(body, "feeAmount"),
    amountSwap: pick(order, "amountSwap") || pick(body, "amountSwap"),
    minAmountOut: pick(order, "minAmountOut") || pick(body, "minAmountOut"),
    nonce: pick(order, "nonce") || pick(body, "nonce"),
    deadline: pick(order, "deadline") || pick(body, "deadline"),
    chainId: pick(order, "chainId") || pick(body, "chainId"),
    router: pick(order, "router") || pick(body, "router"),
  };
}

export function sanitizeLogRecord(record) {
  const out = {};
  if (!record || typeof record !== "object") return out;
  for (const [key, value] of Object.entries(record)) {
    if (isForbiddenKey(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "bigint") {
      out[key] = value.toString();
      continue;
    }
    if (value !== null && typeof value === "object") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Append-only JSONL under DATA_DIR. Testnet-grade durable log (local file).
 *
 * @param {object} [opts]
 * @param {string} [opts.dataDir]
 * @param {() => number} [opts.now]
 * @param {string} [opts.fileName]
 */
export function createRescueLog(opts = {}) {
  const dataDir = opts.dataDir || "./data";
  const fileName = opts.fileName || "rescues.jsonl";
  const filePath = join(dataDir, fileName);
  const now = opts.now || Date.now;
  let ready = null;

  async function ensureDir() {
    if (!ready) {
      ready = mkdir(dataDir, { recursive: true });
    }
    await ready;
  }

  async function append(event) {
    await ensureDir();
    const record = sanitizeLogRecord({
      ts: new Date(now()).toISOString(),
      ...orderLogSummary(event),
      ...event,
    });
    await appendFile(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return record;
  }

  return { append, filePath, dataDir };
}
