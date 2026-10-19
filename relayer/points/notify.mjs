import { createHmac } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const TX_RE = /^0x[0-9a-f]{64}$/;
const CHAINS = new Set([84532, 421614]);

let tail = Promise.resolve();

function enqueueWork(fn) {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function flushPointsNotify() {
  return tail;
}

export function pointsPushEnabled(env = process.env) {
  return Boolean(String(env.POINTS_INGEST_SECRET || "").trim() && String(env.POINTS_API_URL || "").trim());
}

export function pointsOutboxPath(dataDir) {
  return join(dataDir || process.env.DATA_DIR || "./data", "points-outbox.jsonl");
}

/**
 * After a rescue is confirmed. Returns immediately.
 * Does nothing when POINTS_INGEST_SECRET or POINTS_API_URL is unset.
 * Never call this from the broadcast retry callback.
 */
export function schedulePointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) return { enabled: false };
  const run = enqueueWork(() => deliverOne({ ...opts, env }));
  void run.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

/** Startup and explicit retry. No-op when the hook is disabled. */
export function schedulePointsRetry(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) return { enabled: false };
  const run = enqueueWork(() => sendPending({ ...opts, env }));
  void run.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

export function deliverPointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) return Promise.resolve({ enabled: false });
  return enqueueWork(() => deliverOne({ ...opts, env }));
}

export function retryPointsOutbox(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) return Promise.resolve({ enabled: false });
  return enqueueWork(() => sendPending({ ...opts, env }));
}

async function deliverOne(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const pending = await readState(file);
  if (!pending.has(item.txHash)) {
    await appendLine(file, { op: "enqueue", chainId: item.chainId, txHash: item.txHash, at: stamp(opts) });
  }
  return sendItems(file, opts, [item]);
}

async function sendPending(opts) {
  const file = pointsOutboxPath(opts.dataDir);
  const pending = await readState(file);
  if (pending.size === 0) return { enabled: true, sent: 0 };
  const items = [...pending.values()];
  return sendItems(file, opts, items);
}

async function sendItems(file, opts, items) {
  let sent = 0;
  for (const item of items) {
    const result = await postIngest(opts, item);
    if (result.ok) {
      sent += 1;
      await appendLine(file, { op: "delivered", txHash: item.txHash, at: stamp(opts) });
    } else if (result.permanent) {
      await appendLine(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: result.error });
    } else {
      await appendLine(file, { op: "attempt", txHash: item.txHash, at: stamp(opts), error: result.error });
    }
  }
  return { enabled: true, sent };
}

async function postIngest(opts, item) {
  const env = opts.env || process.env;
  const body = JSON.stringify({ chainId: item.chainId, txHash: item.txHash });
  const timestamp = String(Math.floor(stampMs(opts) / 1000));
  const signature = createHmac("sha256", String(env.POINTS_INGEST_SECRET).trim())
    .update(`${timestamp}\n${body}`)
    .digest("hex");
  const root = String(env.POINTS_API_URL).trim().replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${root}/v1/ingest`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-points-timestamp": timestamp,
        "x-points-signature": signature,
      },
      body,
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { ok: false, error: `http_${response.status}` };
  }
  return { ok: false, error: `http_${response.status}`, permanent: true };
}

function normalizeItem(chainId, txHash) {
  const id = Number(chainId);
  const hash = String(txHash || "").trim().toLowerCase();
  if (!CHAINS.has(id)) {
    const err = new Error("invalid_chain");
    err.code = "invalid_chain";
    throw err;
  }
  if (!TX_RE.test(hash)) {
    const err = new Error("invalid_tx_hash");
    err.code = "invalid_tx_hash";
    throw err;
  }
  return { chainId: id, txHash: hash };
}

function stamp(opts) {
  return new Date(stampMs(opts)).toISOString();
}

function stampMs(opts) {
  return opts.now ? opts.now() : Date.now();
}

async function appendLine(file, record) {
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

async function readState(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return new Map();
    throw err;
  }
  const pending = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row.txHash !== "string") continue;
    if (row.op === "enqueue") {
      if (!pending.has(row.txHash)) pending.set(row.txHash, { chainId: Number(row.chainId), txHash: row.txHash });
    } else if (row.op === "delivered" || row.op === "dropped") {
      pending.delete(row.txHash);
    }
  }
  return pending;
}
