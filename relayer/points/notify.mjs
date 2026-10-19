import { createHmac } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const TX_RE = /^0x[0-9a-f]{64}$/;
const CHAINS = new Set([84532, 421614]);
const MIN_SECRET_BYTES = 32;
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_AUTO_ATTEMPTS = 6;
const COMPACT_AFTER_LINES = 6;

let tail = Promise.resolve();
const scheduledRetries = new Set();
const retryTimers = new Map();

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

export function clearPointsRetryTimers() {
  for (const handle of retryTimers.values()) clearTimeout(handle);
  retryTimers.clear();
  scheduledRetries.clear();
}

export function configuredIngestSecret(env = process.env) {
  const secret = String(env.POINTS_INGEST_SECRET || "").trim();
  if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) return "";
  return secret;
}

export function pointsApiRoot(env = process.env) {
  const raw = String(env.POINTS_API_URL || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  return raw.replace(/\/$/, "");
}

export function pointsPushEnabled(env = process.env) {
  return Boolean(configuredIngestSecret(env) && pointsApiRoot(env));
}

function noteUrl(env) {
  const raw = String(env.POINTS_API_URL || "").trim();
  if (raw && !pointsApiRoot(env)) console.error("points_notify", "url");
}

export function pointsOutboxPath(dataDir) {
  return join(dataDir || process.env.DATA_DIR || "./data", "points-outbox.jsonl");
}

/**
 * Queues a post after an optional receipt wait. Returns immediately.
 * Does nothing when the secret is under 32 bytes or POINTS_API_URL is not https.
 * Never call this from the broadcast retry callback.
 */
export function schedulePointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return { enabled: false };
  }
  const run = enqueueWork(() => deliverOne({ ...opts, env }));
  void run.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

/** Startup and explicit retry. No-op when the hook is disabled. */
export function schedulePointsRetry(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return { enabled: false };
  }
  const run = enqueueWork(() => sendPending({ ...opts, env }));
  void run.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

export function deliverPointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return Promise.resolve({ enabled: false });
  }
  return enqueueWork(() => deliverOne({ ...opts, env }));
}

export function retryPointsOutbox(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return Promise.resolve({ enabled: false });
  }
  return enqueueWork(() => sendPending({ ...opts, env }));
}

async function deliverOne(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const pending = await readState(file);
  if (!pending.has(item.txHash)) {
    await appendLine(file, { op: "enqueue", chainId: item.chainId, txHash: item.txHash, at: stamp(opts), attempts: 0 });
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
    const gate = await confirmIfNeeded(opts, item);
    if (gate === "pending") {
      const attempts = await noteAttempt(file, opts, item, "receipt_pending");
      scheduleBackoff(opts, item.txHash, attempts);
      continue;
    }
    if (gate === "rejected") {
      await appendLine(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: "status_failed" });
      continue;
    }
    const result = await postIngest(opts, item);
    if (result.ok) {
      sent += 1;
      await appendLine(file, { op: "delivered", txHash: item.txHash, at: stamp(opts) });
    } else if (result.permanent) {
      await appendLine(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: result.error });
    } else {
      const attempts = await noteAttempt(file, opts, item, result.error);
      scheduleBackoff(opts, item.txHash, attempts);
    }
  }
  return { enabled: true, sent };
}

async function confirmIfNeeded(opts, item) {
  if (typeof opts.confirmReceipt !== "function") return "ready";
  let receipt;
  try {
    receipt = await opts.confirmReceipt(item.txHash);
  } catch {
    return "pending";
  }
  return receiptAccepted(receipt) ? "ready" : "rejected";
}

function receiptAccepted(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const status = receipt.status;
  return status === "success" || status === "0x1" || status === 1;
}

async function noteAttempt(file, opts, item, error) {
  const pending = await readState(file);
  const attempts = (pending.get(item.txHash)?.attempts || 0) + 1;
  await appendLine(file, { op: "attempt", txHash: item.txHash, at: stamp(opts), error, attempts });
  return attempts;
}

function scheduleBackoff(opts, txHash, attempts) {
  if (attempts >= MAX_AUTO_ATTEMPTS) return;
  if (scheduledRetries.has(txHash)) return;
  scheduledRetries.add(txHash);
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  const run = async () => {
    scheduledRetries.delete(txHash);
    retryTimers.delete(txHash);
    await sendPending(opts);
  };
  if (typeof opts.scheduleDelay === "function") {
    opts.scheduleDelay(run, delay);
    return;
  }
  const handle = setTimeout(() => {
    void enqueueWork(run).catch(() => {
      console.error("points_notify", "error");
    });
  }, delay);
  if (typeof handle.unref === "function") handle.unref();
  retryTimers.set(txHash, handle);
}

async function postIngest(opts, item) {
  const env = opts.env || process.env;
  const secret = configuredIngestSecret(env);
  const root = pointsApiRoot(env);
  if (!secret || !root) return { ok: false, error: "unconfigured" };
  const body = JSON.stringify({ chainId: item.chainId, txHash: item.txHash });
  const timestamp = String(Math.floor(stampMs(opts) / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  if (
    response.status === 401 ||
    response.status === 404 ||
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
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
  await maybeCompact(file);
}

async function maybeCompact(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < COMPACT_AFTER_LINES) return;
  const pending = await readState(file);
  const next = [...pending.values()]
    .map((item) =>
      JSON.stringify({
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: new Date().toISOString(),
        attempts: item.attempts,
      }),
    )
    .join("\n");
  await writeFile(file, next ? `${next}\n` : "", { mode: 0o600 });
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
      if (!pending.has(row.txHash)) {
        pending.set(row.txHash, {
          chainId: Number(row.chainId),
          txHash: row.txHash,
          attempts: Number(row.attempts) || 0,
        });
      }
    } else if (row.op === "attempt") {
      const current = pending.get(row.txHash);
      if (current) current.attempts += 1;
    } else if (row.op === "delivered" || row.op === "dropped") {
      pending.delete(row.txHash);
    }
  }
  return pending;
}
